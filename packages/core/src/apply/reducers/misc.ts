/* The small domains: `project.*`, `viewport.*`, `asset.*`.
 *
 * Grouped because each is two or three commands with no shared logic worth a
 * file of its own. If any of them grows a real concern it gets promoted.
 */

import type { Command, Diagnostic } from '../../types/commands';
import type { DomainReducer, Reduction } from '../../types/reducers';
import { diagnostic, unknown } from '../diagnostics';
import { freeId, withKey, withoutKey } from '../records';

type ProjectCommand = Extract<Command, { t: `project.${string}` | `viewport.${string}` }>;
type AssetCommand = Extract<Command, { t: `asset.${string}` }>;

export const projectReducer: DomainReducer<ProjectCommand> = {
  domain: 'project',

  match: (cmd): cmd is ProjectCommand =>
    cmd.t.startsWith('project.') || cmd.t.startsWith('viewport.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];
    if (cmd.t === 'viewport.delete') {
      if (!doc.viewports.some((v) => v.id === cmd.id)) {
        out.push(
          unknown(
            'unknown-viewport',
            'viewport',
            cmd.id,
            doc.viewports.map((v) => v.id),
          ),
        );
      } else if (doc.viewports.length <= 1) {
        out.push(
          diagnostic({
            code: 'in-use',
            message: 'Cannot delete the only viewport; screens need a size to render at.',
          }),
        );
      } else {
        const used = Object.entries(doc.flow.nodes)
          .filter(([, n]) => n.viewport === cmd.id)
          .map(([id]) => id);
        if (used.length > 0) {
          out.push(
            diagnostic({
              code: 'in-use',
              message: `Viewport "${cmd.id}" is selected by ${used.length} node(s).`,
              available: used.slice(0, 25),
            }),
          );
        }
      }
    }
    return out;
  },

  reduce(doc, cmd): Reduction {
    switch (cmd.t) {
      case 'project.rename':
        return {
          doc: { ...doc, name: cmd.name },
          inverse: [{ t: 'project.rename', name: doc.name }],
        };

      case 'viewport.set': {
        const before = doc.viewports.find((v) => v.id === cmd.viewport.id);
        const viewports = before
          ? doc.viewports.map((v) => (v.id === cmd.viewport.id ? cmd.viewport : v))
          : [...doc.viewports, cmd.viewport];
        return {
          doc: { ...doc, viewports },
          inverse: [
            before
              ? { t: 'viewport.set', viewport: before }
              : { t: 'viewport.delete', id: cmd.viewport.id },
          ],
        };
      }

      case 'viewport.delete': {
        const before = doc.viewports.find((v) => v.id === cmd.id);
        if (!before) return { doc, inverse: [] };
        return {
          doc: { ...doc, viewports: doc.viewports.filter((v) => v.id !== cmd.id) },
          inverse: [{ t: 'viewport.set', viewport: before }],
        };
      }
    }
  },
};

export const assetReducer: DomainReducer<AssetCommand> = {
  domain: 'asset',

  match: (cmd): cmd is AssetCommand => cmd.t.startsWith('asset.'),

  precheck(doc, cmd) {
    const out: Diagnostic[] = [];
    if (cmd.t === 'asset.delete') {
      if (!doc.assets[cmd.id]) {
        out.push(unknown('unknown-asset', 'asset', cmd.id, Object.keys(doc.assets)));
      } else {
        const fonts = doc.kit.fonts.filter((f) => f.asset === cmd.id);
        if (fonts.length > 0) {
          out.push(
            diagnostic({
              code: 'in-use',
              message:
                `Asset "${cmd.id}" backs ${fonts.length} font face(s): ` +
                `${fonts.map((f) => `${f.family} ${f.weight}`).join(', ')}. Remove them first.`,
            }),
          );
        }
      }
    }
    return out;
  },

  reduce(doc, cmd): Reduction {
    switch (cmd.t) {
      case 'asset.add': {
        const id = cmd.id ?? freeId(doc.assets, 'asset-');
        return {
          doc: { ...doc, assets: withKey(doc.assets, id, cmd.asset) },
          inverse: [{ t: 'asset.delete', id }],
        };
      }

      case 'asset.delete': {
        const before = doc.assets[cmd.id];
        if (!before) return { doc, inverse: [] };
        return {
          doc: { ...doc, assets: withoutKey(doc.assets, cmd.id) },
          inverse: [{ t: 'asset.add', id: cmd.id, asset: before }],
        };
      }
    }
  },
};
