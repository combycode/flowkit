/* The compiler itself. One test, because it is one call — but the call is the
 * whole reason Tailwind is workable here: the candidates go in directly, so a
 * design that lives in a JSON document never has to be spread over files for a
 * scanner to find. */

import { describe, expect, test } from 'bun:test';
import { TAILWIND_DEFAULT_INPUT } from '@flowkit/core';
import { compileTailwind, tailwindVersion } from '../src/tailwind';

describe('compileTailwind', () => {
  test('builds the utilities it is given, and nothing else', async () => {
    const css = await compileTailwind(TAILWIND_DEFAULT_INPUT, ['flex', 'gap-4']);

    expect(css).toContain('.flex');
    expect(css).toContain('.gap-4');
    expect(css).not.toContain('.rounded-xl');
  });

  /* 2.9MB is the whole framework; a design uses a fraction of it, and that
     fraction is what a screen has to carry. */
  test('the sheet is a fraction of the framework', async () => {
    const css = await compileTailwind(TAILWIND_DEFAULT_INPUT, ['flex', 'gap-4', 'text-sm']);

    expect(css.length).toBeLessThan(200 * 1024);
  });

  test('the entry can carry a theme of the project’s own', async () => {
    const css = await compileTailwind(
      `${TAILWIND_DEFAULT_INPUT}\n@theme { --color-brand: #ff0066; }`,
      ['bg-brand'],
    );

    expect(css).toContain('#ff0066');
  });

  /* A plugin is somebody's code running as part of a design build. */
  test('a plugin is refused rather than loaded', async () => {
    expect(
      compileTailwind(`${TAILWIND_DEFAULT_INPUT}\n@plugin "whatever";`, ['flex']),
    ).rejects.toThrow();
  });

  test('says which compiler made it', async () => {
    expect(await tailwindVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
