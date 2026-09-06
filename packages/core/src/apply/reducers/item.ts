/* The `item.*` and `fixture.*` domains — the registry.
 *
 * `item.setHtml` is the coarse write (sketch a screen, try a variant); the
 * rest are surgical. Two granularities of the same thing, both permanent.
 */

import type { Command, Diagnostic } from '../../types/commands';
import type { Item, ProjectDoc, SlotFill } from '../../types/project';
import type { DomainReducer, Reduction } from '../../types/reducers';
import { diagnostic, unknown } from '../diagnostics';
import { type Patch, patch, renameKey, withKey, withoutKey } from '../records';

type ItemCommand = Extract<Command, { t: `item.${string}` | `fixture.${string}` }>;

const names = (doc: ProjectDoc) => Object.keys(doc.items);

/** The item a command targets, whatever the field is called.
 *
 *  Matched on `t` rather than by probing for an `item` field: `fixture.*`
 *  names its target `item: string`, while `item.replace` uses `item: Item` for
 *  the payload, so a structural check reads the wrong one. */
function targetName(cmd: ItemCommand): string {
  switch (cmd.t) {
    case 'item.rename':
      return cmd.from;
    case 'fixture.set':
    case 'fixture.delete':
      return cmd.item;
    default:
      return cmd.name;
  }
}

export const itemReducer: DomainReducer<ItemCommand> = {
  domain: 'item',

  match: (cmd): cmd is ItemCommand => cmd.t.startsWith('item.') || cmd.t.startsWith('fixture.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];
    const name = targetName(cmd);

    // `item.replace` is deliberately create-or-replace, so it checks nothing:
    // it is how an undo puts a deleted item back AND how it reverts a partial
    // edit, and those two cases differ only in whether the name is taken.
    if (cmd.t === 'item.replace') return out;

    if (cmd.t === 'item.create') {
      // Names are unique ACROSS tiers, so `<x-button>` needs no tier prefix to
      // resolve. Silently replacing an existing item would lose work.
      if (doc.items[cmd.name]) {
        out.push(
          diagnostic({
            code: 'duplicate-name',
            item: cmd.name,
            message:
              `An item named "${cmd.name}" already exists (tier ` +
              `"${doc.items[cmd.name]?.tier}"). Names are unique across tiers; ` +
              `use item.setHtml to change it, or pick another name.`,
          }),
        );
      }
      return out;
    }

    if (!doc.items[name]) {
      out.push(unknown('unknown-item', 'item', name, names(doc)));
      return out;
    }

    if (cmd.t === 'item.rename' && doc.items[cmd.to]) {
      out.push(
        diagnostic({
          code: 'duplicate-name',
          item: cmd.to,
          message: `An item named "${cmd.to}" already exists.`,
        }),
      );
    }

    if (cmd.t === 'item.delete') {
      const used = usedBy(doc, name);
      if (used.length > 0) {
        out.push(
          diagnostic({
            code: 'in-use',
            item: name,
            message:
              `"${name}" is still used by ${used.length} node(s): ` +
              `${used.slice(0, 5).join(', ')}. Delete or repoint them first.`,
            available: used,
          }),
        );
      }
    }

    if (cmd.t === 'item.setDefaultVariant' && cmd.variant !== null) {
      const declared = Object.keys(doc.items[name]?.variants ?? {});
      if (!declared.includes(cmd.variant)) {
        out.push(unknown('unknown-variant', 'variant', cmd.variant, declared));
      }
    }

    if (cmd.t === 'fixture.delete') {
      if (cmd.fixture === 'default') {
        out.push(
          diagnostic({
            code: 'missing-fixture',
            item: name,
            message: 'The "default" fixture cannot be deleted; every item needs one.',
          }),
        );
      } else if (!doc.items[name]?.fixtures[cmd.fixture]) {
        out.push(
          unknown(
            'unknown-fixture',
            'fixture',
            cmd.fixture,
            Object.keys(doc.items[name]?.fixtures ?? {}),
          ),
        );
      }
    }

    return out;
  },

  reduce(doc, cmd): Reduction {
    const name = targetName(cmd);
    const before = doc.items[name];

    switch (cmd.t) {
      case 'item.create': {
        const created: Item = {
          tier: cmd.tier,
          html: cmd.html ?? '',
          props: {},
          fixtures: { default: { values: {} } },
          ...(cmd.description ? { description: cmd.description } : {}),
        };
        return {
          doc: { ...doc, items: withKey(doc.items, cmd.name, created) },
          inverse: [{ t: 'item.delete', name: cmd.name }],
        };
      }

      case 'item.replace':
        return {
          doc: { ...doc, items: withKey(doc.items, name, cmd.item) },
          // Replacing something that was absent undoes to deleting it.
          inverse: before ? restore(name, before) : [{ t: 'item.delete', name }],
        };

      case 'item.delete':
        return {
          doc: { ...doc, items: withoutKey(doc.items, name) },
          inverse: restore(name, before),
        };

      case 'item.rename':
        // A rename that only renamed the key left every REFERENCE dangling —
        // canvas nodes pointing at the old screen name, `<x-oldname>` in other
        // markup, slot fills — so exports came out as "Missing item". The name
        // is used in four places; all four move together, or the rename is a
        // silent corruption. The inverse runs the same rewrite the other way.
        return {
          doc: renameEverywhere(doc, cmd.from, cmd.to),
          inverse: [{ t: 'item.rename', from: cmd.to, to: cmd.from }],
        };

      case 'item.setHtml':
        return replace(doc, name, before, { html: cmd.html });

      case 'item.setCss':
        return replace(doc, name, before, {
          css: cmd.css,
          ...(cmd.cssPrefix !== undefined ? { cssPrefix: cmd.cssPrefix } : {}),
        });

      case 'item.setProp':
        return replace(doc, name, before, {
          props: withKey(before?.props ?? {}, cmd.prop, cmd.spec),
        });

      /* Only the fields the command actually carries.
       *
       * `patch` treats an undefined value as "remove this", which is what lets
       * a field be cleared deliberately — so naming all three unconditionally
       * meant setting a description ALSO cleared the pinned viewport, and
       * would now clear the meta with it. Omitting a key leaves it alone;
       * naming it as undefined still clears it, the same rule NodePatch
       * already states. */
      case 'item.setMeta':
        return replace(doc, name, before, {
          ...('description' in cmd ? { description: cmd.description } : {}),
          ...('viewport' in cmd ? { viewport: cmd.viewport } : {}),
          ...('meta' in cmd ? { meta: cmd.meta } : {}),
          ...('tier' in cmd ? { tier: cmd.tier } : {}),
        });

      case 'item.setVariant':
        return replace(doc, name, before, {
          variants: withKey(before?.variants ?? {}, cmd.variant, cmd.value),
        });

      case 'item.deleteVariant':
        return replace(doc, name, before, {
          variants: withoutKey(before?.variants ?? {}, cmd.variant),
          // A default pointing at a variant that no longer exists would leave
          // every bare reference naming nothing.
          ...(before?.defaultVariant === cmd.variant ? { defaultVariant: undefined } : {}),
        });

      case 'item.setImage':
        return replace(doc, name, before, { image: cmd.asset ?? undefined });

      case 'item.setRoot':
        return replace(doc, name, before, { rootAttrs: cmd.attrs ?? undefined });

      case 'item.setSize':
        return replace(doc, name, before, { size: cmd.size ?? undefined });

      case 'item.setDefaultVariant':
        return replace(doc, name, before, {
          defaultVariant: cmd.variant ?? undefined,
        });

      case 'fixture.set':
        return replace(doc, name, before, {
          fixtures: withKey(before?.fixtures ?? {}, cmd.fixture, cmd.value),
        });

      case 'fixture.delete':
        return replace(doc, name, before, {
          fixtures: withoutKey(before?.fixtures ?? {}, cmd.fixture),
        });
    }
  },
};

/** Nodes referencing an item, so deleting one cannot orphan the flow. */
function usedBy(doc: ProjectDoc, name: string): string[] {
  return Object.entries(doc.flow.nodes)
    .filter(([, n]) => n.screen === name || n.layout === name)
    .map(([id]) => id);
}

/** Rename an item AND every reference to it, in one pass.
 *
 *  Four kinds of reference name an item:
 *    · a node's `screen` or `layout`;
 *    · a node slot filled with a screen or an item;
 *    · `<x-name>` (and `</x-name>`) in any item's markup or a variant's markup.
 *  Missing any one leaves a dangling pointer that renders as "Missing item". */
function renameEverywhere(doc: ProjectDoc, from: string, to: string): ProjectDoc {
  const swapMarkup = (html: string): string => renameRef(html, from, to);

  const items = Object.fromEntries(
    Object.entries(renameKey(doc.items, from, to)).map(([key, item]) => [
      key,
      {
        ...item,
        html: swapMarkup(item.html),
        ...(item.variants
          ? {
              variants: Object.fromEntries(
                Object.entries(item.variants).map(([v, variant]) => [
                  v,
                  variant.html !== undefined
                    ? { ...variant, html: swapMarkup(variant.html) }
                    : variant,
                ]),
              ),
            }
          : {}),
      },
    ]),
  );

  const nodes = Object.fromEntries(
    Object.entries(doc.flow.nodes).map(([id, n]) => [
      id,
      {
        ...n,
        ...(n.screen === from ? { screen: to } : {}),
        ...(n.layout === from ? { layout: to } : {}),
        ...(n.slots ? { slots: renameSlots(n.slots, from, to) } : {}),
      },
    ]),
  );

  return { ...doc, items, flow: { ...doc.flow, nodes } };
}

function renameSlots(
  slots: Record<string, SlotFill>,
  from: string,
  to: string,
): Record<string, SlotFill> {
  return Object.fromEntries(
    Object.entries(slots).map(([slot, fill]) => {
      if (fill.kind === 'screen' && fill.screen === from) return [slot, { ...fill, screen: to }];
      if (fill.kind === 'item' && fill.item === from) return [slot, { ...fill, item: to }];
      return [slot, fill];
    }),
  );
}

/** Rewrite `<x-from>` / `</x-from>` to the new name, and nothing that merely
 *  starts with it: `<x-from>` moves, `<x-fromage>` does not. */
function renameRef(html: string, from: string, to: string): string {
  if (!html.includes(`<x-${from}`) && !html.includes(`</x-${from}`)) return html;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`(</?x-)${escaped}(?![\\w-])`, 'g'), `$1${to}`);
}

/** Every partial edit shares one shape: patch the item, and the inverse is
 *  putting the previous whole item back. Restoring wholesale rather than
 *  field-by-field means undo cannot drift from the edit. */
function replace(
  doc: ProjectDoc,
  name: string,
  before: Item | undefined,
  changes: Patch<Item>,
): Reduction {
  if (!before) return { doc, inverse: [] };
  return {
    doc: { ...doc, items: withKey(doc.items, name, patch(before, changes)) },
    inverse: restore(name, before),
  };
}

/** The command that puts an item back exactly as it was.
 *
 *  One `item.replace`, not a rebuild from `item.create` plus a stream of
 *  setters: the rebuild fails on `duplicate-name` whenever the item still
 *  exists — which is every partial edit — and a stream of setters can only add
 *  fields, never remove one the edit introduced. */
const restore = (name: string, before: Item | undefined): Command[] =>
  before ? [{ t: 'item.replace', name, item: before }] : [];
