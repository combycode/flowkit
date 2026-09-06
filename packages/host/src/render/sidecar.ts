/* The Chromium sidecar: composed HTML in, PNG out.
 *
 * Spike B established that this is deterministic — two independently built
 * Chromium engines a major version apart produced byte-identical renders of
 * the hardest screens in the design. So a PNG from here is trustworthy enough
 * to judge a layout by, which is the whole point: a model that cannot see its
 * own output is editing blind.
 *
 * One browser per server, started LAZILY on the first render and reused after.
 * Starting it eagerly would spawn Chromium for every session that never
 * renders anything, and a fresh browser per screenshot would pay ~2s of
 * startup each time instead of ~450ms amortised.
 *
 * HEADLESS ONLY. Nothing here ever opens a window.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { exists, sleep } from '../fsx';
import { Cdp, evaluate } from './cdp';
import { activePort, profileDir, sweep } from './port';

export interface RenderRequest {
  html: string;
  width: number;
  height: number;
  /** 1 for a model to look at, 2 for a deliverable.
   *
   *  Image cost scales with pixel count and models downscale large images
   *  anyway, so 2x doubles the tokens for no extra information. The default is
   *  deliberately 1. */
  scale?: number;
  /** Scroll the first scrolling PANE to the bottom before capturing — what
   *  STRAIW's own exporter does, because a chat is read at its latest message.
   *
   *  A pane, never the document. A page whose own body is longer than the
   *  viewport is an ordinary document and is read from the top; scrolling it
   *  would photograph its end and silently lose its beginning. */
  scrollToEnd?: boolean;
  /** Capture this box of the PAGE rather than the viewport, at `scale`.
   *
   *  A map is far larger than any sensible viewport, and the interesting part
   *  of it is usually a corner. Chromium captures beyond the viewport for a
   *  clip, so the page is laid out once and any region of it can be
   *  photographed without scrolling or resizing anything. */
  clip?: { x: number; y: number; width: number; height: number };
  /** A JS expression polled until it is truthy, before capturing.
   *
   *  `document.fonts.ready` covers the top document only. A page of frames is
   *  not finished when IT is finished, and a screenshot taken in between is a
   *  picture of a layout that never existed. */
  waitFor?: string;
  /** How long to wait for `waitFor`. A slow page should produce a late
   *  screenshot, never a hung tool call. */
  waitMs?: number;
  /** What to do about anything moving on the page. Defaults to `freeze`.
   *
   *  A screenshot of a running animation is a picture of a moment, and the
   *  next one is a picture of a different moment: three STRAIW screens came
   *  back with different bytes from two captures of the SAME document, because
   *  a waiting indicator was mid-pulse. An export nobody can reproduce is one
   *  nobody can diff, and a specification whose pictures change every time it
   *  is written is a specification nobody trusts. */
  animations?: 'freeze' | 'run';
}

/** Rewind everything that moves to its first frame and hold it there.
 *
 *  Frame 0, not "animation: none". Turning animations off leaves the element
 *  in whatever state the base rules give it, and something drawn ENTIRELY by
 *  its animation — a spinner whose keyframes carry the opacity — then
 *  disappears from the picture. The first frame is what a person sees when the
 *  screen opens, and it is the same every time.
 *
 *  Same-origin frames too: a kit sheet draws each part in an iframe of its
 *  own, and the parts are exactly what moves. */
const FREEZE = `(() => {
  const hold = (doc) => {
    for (const animation of doc.getAnimations ? doc.getAnimations() : []) {
      try { animation.pause(); animation.currentTime = 0; } catch {}
    }
    for (const frame of doc.querySelectorAll('iframe')) {
      try { if (frame.contentDocument) hold(frame.contentDocument); } catch {}
    }
  };
  hold(document);
  return 1;
})()`;

export interface RenderResult {
  /** base64 PNG. */
  data: string;
  width: number;
  height: number;
  ms: number;
}

/** Where Chromium might be. Overridable, because a hardcoded path is the
 *  first thing to break on another machine. */
function candidates(): string[] {
  const fromEnv = process.env.FLOWKIT_CHROME ?? process.env.DESIGN_FLOW_CHROME;
  const local = process.env.LOCALAPPDATA ?? '';
  return [
    ...(fromEnv ? [fromEnv] : []),
    // Playwright's cache holds several builds; the newest is picked below.
    ...(local ? [`${local}/ms-playwright`] : []),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
}

async function findChrome(): Promise<string> {
  for (const path of candidates()) {
    if (path.endsWith('ms-playwright')) {
      const found = await newestPlaywrightChromium(path);
      if (found) return found;
      continue;
    }
    if (await exists(path)) return path;
  }
  throw new Error(
    'No Chromium found. Set FLOWKIT_CHROME to a Chrome, Edge or Chromium executable.',
  );
}

async function newestPlaywrightChromium(root: string): Promise<string | undefined> {
  const { readdir } = await import('node:fs/promises');
  let builds: string[];
  try {
    builds = await readdir(root);
  } catch {
    return undefined;
  }
  const numbered = builds
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const build of numbered) {
    for (const rel of [
      'chrome-win64/chrome.exe',
      'chrome-linux/chrome',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    ]) {
      const path = `${root}/${build}/${rel}`;
      if (await exists(path)) return path;
    }
  }
  return undefined;
}

/** How many times to try starting a browser before giving up.
 *
 *  Three, because the failures worth surviving are races — a port let go a
 *  moment ago, a profile a dying instance still holds — and a race that loses
 *  three times in a row is not a race. */
const ATTEMPTS = 3;

/** How long one browser gets to answer before that attempt is written off.
 *
 *  Generous, because a cold Chromium on a loaded machine has taken most of ten
 *  seconds here — and finite, because the alternative turned out to be forever. */
const STARTUP_MS = 20_000;

/** And how long a single request to it gets. A socket that accepts and then
 *  says nothing is exactly what an un-timed `fetch` waits on indefinitely. */
const REQUEST_MS = 2_000;

export class Sidecar {
  private proc: ChildProcess | undefined;
  private cdp: Cdp | undefined;
  private frameId = '';
  private starting: Promise<void> | undefined;
  /** Reported by the browser at launch, never chosen here — see ./port. */
  private port = 0;
  /** The scratch profile this sidecar's browser is using. Ours, made by us,
   *  and removed on the way out — one is about ten megabytes and a machine
   *  that exports every day should not fill with them. */
  private profile = '';
  /** Kills the browser if this process goes away. Held so it can be taken off
   *  again: a long-lived server that starts and stops several sidecars would
   *  otherwise accumulate exit handlers until node warns about a leak. */
  private readonly onHostExit = () => this.stop();
  /** One render at a time: the browser has a single page, so concurrent
   *  captures would photograph each other's documents. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly profileRoot = `${process.env.TEMP ?? '/tmp'}/flowkit-render`) {}

  /** The port this sidecar ended up on, or 0 before it has started. */
  get debugPort(): number {
    return this.port;
  }

  /** How tall this document is at this width, in CSS pixels.
   *
   *  A generated page is as long as the registry makes it, and a screenshot is
   *  as tall as the viewport — so a kit page of thirty components exports as
   *  its first screenful and nothing says the rest was cut. Measuring it is
   *  how the page gets a viewport that fits.
   *
   *  Queued with the renders: one browser, one page. */
  async measure(html: string, width: number): Promise<number> {
    const next = this.queue.then(
      () => this.measureNow(html, width),
      () => this.measureNow(html, width),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async measureNow(html: string, width: number): Promise<number> {
    await this.start();
    const cdp = this.cdp;
    if (!cdp) throw new Error('render sidecar not running');

    /* SHORT on purpose. `documentElement.scrollHeight` is never less than the
     * viewport, so measuring in a tall window reports the window: a sheet of
     * 2200px measured at 4000 came back as 4000, and three quarters of the
     * export was empty. */
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 200,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.setDocumentContent', { frameId: this.frameId, html });

    /* The page's fonts AND those of anything it draws in a frame of its own.
     *
     * A kit sheet puts every part in an iframe so the design's media queries
     * see a real window width, and each frame sizes itself to its content once
     * its typeface has arrived. Waiting only on the outer document measured
     * the page mid-settle, and the sheet was stored several hundred pixels
     * taller than it turned out to be — a band of empty ground under an
     * export that nothing explained. */
    await evaluate(
      cdp,
      '(() => { const inner = [...document.querySelectorAll("iframe")]' +
        '.map((f) => { try { const d = f.contentDocument; return d && d.fonts ? d.fonts.ready : 0; }' +
        ' catch { return 0; } });' +
        ' return Promise.all([document.fonts.ready, ...inner]).then(() => 1); })()',
    );

    // Held at the first frame here too, so the height measured is the height
    // that will be photographed — an animation that grows something would
    // otherwise be measured at one size and captured at another.
    await evaluate(cdp, FREEZE);

    const measured = await evaluate<number>(
      cdp,
      '(() => { const d = document.documentElement; const b = document.body;' +
        ' return Math.max(d.scrollHeight, b ? b.scrollHeight : 0); })()',
    );
    return typeof measured === 'number' ? measured : 0;
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const next = this.queue.then(
      () => this.renderNow(request),
      () => this.renderNow(request),
    );
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async renderNow(request: RenderRequest): Promise<RenderResult> {
    const started = Date.now();
    await this.start();
    const cdp = this.cdp;
    if (!cdp) throw new Error('render sidecar not running');

    const scale = request.scale ?? 1;
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: request.width,
      height: request.height,
      // With a clip, the scale belongs to the capture rather than to the
      // device: scaling the device too would render every screen at that size
      // and blur the result instead of shrinking it.
      deviceScaleFactor: request.clip ? 1 : scale,
      mobile: false,
    });
    await cdp.send('Page.setDocumentContent', { frameId: this.frameId, html: request.html });
    // Webfonts arrive after load and move every line of text, so waiting for
    // them is the difference between a real screenshot and a misleading one.
    await evaluate(cdp, 'document.fonts.ready.then(() => 1)');
    if (request.waitFor) await this.waitFor(cdp, request.waitFor, request.waitMs ?? 30_000);
    if (request.scrollToEnd !== false) {
      await evaluate(
        cdp,
        `(() => {
          // Inside the body only: including the root made the document itself
          // the first match on any long page, so a kit page of eight rows was
          // captured at its footer with its heading scrolled away.
          const all = [...document.body.querySelectorAll('*')];
          const scroller = all.find(e => e.scrollHeight > e.clientHeight + 4);
          if (scroller) scroller.scrollTop = scroller.scrollHeight;
          return 1;
        })()`,
      );
    }
    await sleep(300); // let the font paint settle
    if (request.animations !== 'run') await evaluate(cdp, FREEZE);

    const { data } = await cdp.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      ...(request.clip ? { clip: { ...request.clip, scale }, captureBeyondViewport: true } : {}),
    });

    const shot = request.clip
      ? { width: request.clip.width * scale, height: request.clip.height * scale }
      : { width: request.width * scale, height: request.height * scale };

    return {
      data,
      width: Math.round(shot.width),
      height: Math.round(shot.height),
      ms: Date.now() - started,
    };
  }

  /** Poll rather than await a promise from the page: an expression that never
   *  settles would hang the tool call, and a picture a little late is better
   *  than a session that stops answering. */
  private async waitFor(cdp: Cdp, expression: string, limit: number): Promise<void> {
    const until = Date.now() + limit;
    while (Date.now() < until) {
      const ready = await evaluate(cdp, `(${expression}) ? 1 : 0`).catch(() => 0);
      if (ready) return;
      await sleep(120);
    }
  }

  private start(): Promise<void> {
    this.starting ??= this.launch().catch((err) => {
      // A failed launch must not poison every later attempt.
      this.starting = undefined;
      throw err;
    });
    return this.starting;
  }

  /** Try, and try again on another port.
   *
   *  Every failure this retries is a collision with another browser: ours from
   *  a previous run that has not finished dying, or a second sidecar in a
   *  different process. Both leave the same trace — a port that answers nothing
   *  — and both are gone by the next attempt. */
  private async launch(): Promise<void> {
    let last: Error | undefined;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      try {
        await this.launchOnce();
        return;
      } catch (error) {
        last = error as Error;
        this.stop();
        await sleep(200 * attempt);
      }
    }
    throw new Error(
      `Could not start the render sidecar in ${ATTEMPTS} attempts. ${last?.message ?? ''}`.trim(),
    );
  }

  private async launchOnce(): Promise<void> {
    const exe = await findChrome();

    // Anything a hard kill left behind, before adding one more of our own.
    await sweep(this.profileRoot).catch(() => 0);

    /* A directory nobody else can be holding. Sharing one was the original
     * fault: the second browser found the first's lock, handed over its
     * arguments and exited — silently, and with a zero exit code. */
    const dir = profileDir(this.profileRoot);
    this.profile = dir;

    const proc = spawn(
      exe,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--force-color-profile=srgb',
        // Chromium picks; see ./port for why choosing it here cannot be done
        // safely.
        '--remote-debugging-port=0',
        `--user-data-dir=${dir}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    this.proc = proc;

    /* A browser that exits during startup used to cost eighteen seconds of
     * polling and then a message about a debug port, which described the
     * symptom and hid the cause. */
    let exited: number | undefined;
    proc.once('exit', (code) => {
      exited = code ?? -1;
    });

    // Chromium outlives its parent on Windows. Without this every export left
    // one running, holding the port the next one wanted.
    process.once('exit', this.onHostExit);

    /* A DEADLINE, not a count of tries. Under load — four exports at once, each
     * with its own browser — one attempt hung indefinitely: a socket that
     * accepts and then says nothing leaves `fetch` waiting forever, and a poll
     * built out of un-timed requests inherits that. Every request below is
     * bounded, and so is the loop around them. */
    const until = Date.now() + STARTUP_MS;
    let version = '';
    while (!version && Date.now() < until) {
      if (exited !== undefined) {
        throw new Error(`Chromium exited (${exited}) before it opened a debug port`);
      }
      // The port comes from the browser's own file, so what is asked below is
      // the browser this process started and no other.
      this.port = this.port || (await activePort(dir)) || 0;
      if (this.port > 0) version = (await this.ask<{ Browser: string }>('version'))?.Browser ?? '';
      if (!version) await sleep(120);
    }
    if (!version) {
      throw new Error(
        this.port > 0
          ? `Chromium did not answer on ${this.port} within ${Math.round(STARTUP_MS / 1000)}s`
          : `Chromium never wrote a debug port into ${dir} within ` +
              `${Math.round(STARTUP_MS / 1000)}s`,
      );
    }

    const targets = await this.ask<{ type: string; webSocketDebuggerUrl: string }[]>('list');
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('render sidecar started with no page target');

    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const { frameTree } = await cdp.send<{ frameTree: { frame: { id: string } } }>(
      'Page.getFrameTree',
    );
    this.cdp = cdp;
    this.frameId = frameTree.frame.id;
  }

  /** One question to the browser's HTTP endpoint, bounded. `undefined` means
   *  "no answer yet", which during startup is the normal case. */
  private async ask<T>(what: 'version' | 'list'): Promise<T | undefined> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json/${what}`, {
        signal: AbortSignal.timeout(REQUEST_MS),
      });
      return res.ok ? ((await res.json()) as T) : undefined;
    } catch {
      return undefined;
    }
  }

  stop(): void {
    this.cdp?.close();
    this.cdp = undefined;
    this.starting = undefined;
    process.removeListener('exit', this.onHostExit);
    try {
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = undefined;
    this.port = 0;

    /* SYNCHRONOUS, and only ever a directory this sidecar made, after the
     * browser holding it has been killed. `stop` runs from an exit handler,
     * where the loop is already done and a promise never gets its turn — the
     * async version left twenty-two profiles behind in one afternoon. A
     * failure here is untidy rather than wrong, and `sweep` catches it on some
     * later run. */
    const profile = this.profile;
    this.profile = '';
    if (!profile.startsWith(`${this.profileRoot}-`)) return;
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* Windows keeps handles open for a moment after the browser it belonged
       * to was killed, so this first attempt usually fails. Try again the slow
       * way — which does nothing at all if this was the exit handler, and that
       * is what `sweep` is for. */
      rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(
        () => undefined,
      );
    }
  }
}
