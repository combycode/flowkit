/* Chromium discovery must be cross-platform. The sidecar spawns a system
 * browser and drives it over CDP; if it cannot find one, nothing renders. The
 * original candidate list keyed the Playwright cache off LOCALAPPDATA — a
 * Windows-only variable — so macOS and Linux never saw a downloaded Chromium,
 * and macOS lacked Edge/Chromium fallbacks. These lock the resolution down
 * without needing a real browser. */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { candidates, newestPlaywrightChromium } from '../src/render/sidecar';

afterEach(() => {
  delete process.env.FLOWKIT_CHROME;
  delete process.env.DESIGN_FLOW_CHROME;
});

describe('chromium discovery is cross-platform', () => {
  test('the Playwright cache is looked up on macOS and Linux, not only Windows', () => {
    const c = candidates();
    const home = homedir();
    expect(c).toContain(`${home}/Library/Caches/ms-playwright`); // macOS
    expect(c).toContain(`${home}/.cache/ms-playwright`); // Linux
  });

  test('a system browser path is offered for each platform', () => {
    const c = candidates();
    expect(c.some((p) => p.includes('Program Files'))).toBe(true); // Windows
    expect(c).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'); // macOS
    expect(c).toContain('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'); // macOS Edge
    expect(c).toContain('/usr/bin/chromium'); // Linux
  });

  test('FLOWKIT_CHROME overrides everything — first in the list', () => {
    process.env.FLOWKIT_CHROME = '/my/own/chrome';
    expect(candidates()[0]).toBe('/my/own/chrome');
  });

  test('the newest Playwright build wins, whatever the OS layout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fk-pw-'));
    try {
      // Lay down three builds, each with all three per-OS executables, so the
      // test resolves on whatever platform it runs.
      for (const build of ['chromium-1000', 'chromium-1200', 'chromium-1155']) {
        for (const rel of [
          'chrome-win64/chrome.exe',
          'chrome-linux/chrome',
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        ]) {
          const p = join(root, build, rel);
          await mkdir(dirname(p), { recursive: true });
          await writeFile(p, '');
        }
      }
      const found = await newestPlaywrightChromium(root);
      expect(found).toContain('chromium-1200'); // not 1155, not 1000
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('an empty or missing cache directory yields nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fk-pw-empty-'));
    try {
      expect(await newestPlaywrightChromium(root)).toBeUndefined();
      expect(await newestPlaywrightChromium(join(root, 'does-not-exist'))).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
