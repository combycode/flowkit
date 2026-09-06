/* Which classes get compiled, and for whom.
 *
 * The interesting half of Tailwind support is not the compiler — it is
 * deciding what to hand it. A project can have a client side on utilities and
 * an operator side on somebody's component CSS, and the two must not widen
 * each other's stylesheet.
 */

import { describe, expect, test } from 'bun:test';
import type { Item, ProjectDoc } from '../src/index';
import {
  fingerprint,
  TAILWIND_INPUT,
  tailwindBuild,
  tailwindCandidates,
  tailwindHeader,
  tailwindItems,
  tailwindStale,
  tailwindStamp,
} from '../src/index';

const item = (over: Partial<Item> & { html: string }): Item => ({
  tier: 'screen',
  props: {},
  fixtures: { default: { values: {} } },
  ...over,
});

function project(items: Record<string, Item>, sheets: Record<string, string> = {}): ProjectDoc {
  return {
    schema: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    kit: {
      preset: 'none',
      base: '',
      sheets,
      themes: { dark: { label: 'Dark', tokens: {} } },
      defaultTheme: 'dark',
      fonts: [],
    },
    items,
    flow: { nodes: {}, edges: {}, groups: [] },
    strings: { defaultLocale: 'en', locales: { en: { label: 'English', entries: {} } } },
    assets: {},
    viewports: [{ id: 'mobile', label: 'M', device: 'mobile', width: 390, height: 844 }],
  };
}

describe('what gets compiled', () => {
  /* The sheet a screen NAMES decides everything else about its styles, so it
     decides this too. */
  test('only the screens on Tailwind, and the parts they use', () => {
    const doc = project({
      home: item({ html: '<main class="flex gap-4"><x-card/></main>', sheets: ['tailwind'] }),
      card: item({ tier: 'component', html: '<div class="rounded-xl p-4"></div>' }),
      admin: item({ html: '<main class="p-button p-6"></main>', sheets: ['primereact'] }),
    });

    expect(tailwindItems(doc)).toEqual(['card', 'home']);
    expect(tailwindCandidates(doc)).toEqual(['flex', 'gap-4', 'p-4', 'rounded-xl']);
  });

  test('a part used by both sides is counted once', () => {
    const doc = project({
      home: item({ html: '<main><x-card/></main>', sheets: ['tailwind'] }),
      other: item({ html: '<main><x-card/></main>', sheets: ['tailwind'] }),
      card: item({ tier: 'component', html: '<div class="rounded-xl"></div>' }),
    });

    expect(tailwindItems(doc)).toEqual(['card', 'home', 'other']);
    expect(tailwindCandidates(doc)).toEqual(['rounded-xl']);
  });

  /* Tailwind's own scanner reads whole files and takes anything that could be
     a utility. Here the document knows where its classes are, and reading the
     prose as well would put every English word through the compiler. */
  test('class attributes only, not the words on the screen', () => {
    const doc = project({
      home: item({ html: '<p class="text-sm">flex items-center gap-4</p>', sheets: ['tailwind'] }),
    });

    expect(tailwindCandidates(doc)).toEqual(['text-sm']);
  });

  /* A variant may render markup of its own, and a utility that exists only in
     one state is still a utility the sheet has to carry. */
  test('a class that lives only in a variant is still compiled', () => {
    const doc = project({
      home: item({ html: '<main class="flex"><x-card/></main>', sheets: ['tailwind'] }),
      card: item({
        tier: 'component',
        html: '<div class="rounded-xl"></div>',
        variants: { loud: { class: 'shadow-lg', html: '<div class="rounded-xl ring-2"></div>' } },
      }),
    });

    expect(tailwindCandidates(doc)).toEqual(['flex', 'ring-2', 'rounded-xl', 'shadow-lg']);
  });

  test('and a part referenced only by a variant is still reached', () => {
    const doc = project({
      home: item({ html: '<main><x-card/></main>', sheets: ['tailwind'] }),
      card: item({
        tier: 'component',
        html: '<div></div>',
        variants: { loud: { html: '<div><x-badge/></div>' } },
      }),
      badge: item({ tier: 'element', html: '<b class="text-xs"></b>' }),
    });

    expect(tailwindItems(doc)).toEqual(['badge', 'card', 'home']);
    expect(tailwindCandidates(doc)).toEqual(['text-xs']);
  });

  test('a part that nothing on Tailwind uses is not scanned', () => {
    const doc = project({
      home: item({ html: '<main class="flex"></main>', sheets: ['tailwind'] }),
      lonely: item({ tier: 'component', html: '<div class="never-compiled"></div>' }),
    });

    expect(tailwindCandidates(doc)).not.toContain('never-compiled');
  });

  test('a cycle between parts does not hang the scan', () => {
    const doc = project({
      home: item({ html: '<main><x-a/></main>', sheets: ['tailwind'] }),
      a: item({ tier: 'component', html: '<div class="a-class"><x-b/></div>' }),
      b: item({ tier: 'component', html: '<div class="b-class"><x-a/></div>' }),
    });

    expect(tailwindCandidates(doc)).toEqual(['a-class', 'b-class']);
  });
});

describe('knowing when it is behind', () => {
  const withSheet = (css: string) =>
    project(
      { home: item({ html: '<main class="flex"></main>', sheets: ['tailwind'] }) },
      { tailwind: css },
    );

  test('a project without the sheet is never stale', () => {
    const doc = project({ home: item({ html: '<main class="flex"></main>' }) });
    expect(tailwindStale(doc)).toBe(false);
  });

  test('a sheet built from this markup is current', () => {
    const doc = withSheet('');
    const built = withSheet(tailwindHeader(tailwindBuild(doc).stamp));

    expect(tailwindStale(built)).toBe(false);
  });

  test('and one built from other markup is not', () => {
    const doc = withSheet(tailwindHeader('deadbeef'));
    expect(tailwindStale(doc)).toBe(true);
  });

  /* The entry CSS carries the theme, so changing it changes the output as
     surely as changing a class name does. */
  test('the entry counts as much as the markup', () => {
    const doc = withSheet('');
    const current = withSheet(tailwindHeader(tailwindBuild(doc).stamp));
    current.kit.sheets[TAILWIND_INPUT] = '@import "tailwindcss";\n@theme { --color-brand: red }';

    expect(tailwindStale(current)).toBe(true);
  });

  test('a sheet nobody stamped is treated as behind', () => {
    expect(tailwindStale(withSheet('.flex { display: flex }'))).toBe(true);
    expect(tailwindStamp('.flex { display: flex }')).toBeUndefined();
  });
});

describe('fingerprint', () => {
  test('the same list gives the same answer, a different one does not', () => {
    expect(fingerprint(['a', 'b'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['b', 'a']));
  });

  /* Otherwise ['ab'] and ['a','b'] would look like the same build. */
  test('the boundaries between entries are part of it', () => {
    expect(fingerprint(['ab'])).not.toBe(fingerprint(['a', 'b']));
  });
});
