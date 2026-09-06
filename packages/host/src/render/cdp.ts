/* A ~60-line CDP client. Enough to render HTML and capture a PNG.
 *
 * Playwright is the right tool for the product. Its launch path does not work
 * from this particular process context (the --remote-debugging-pipe handshake
 * never completes, and connectOverCDP hangs on target enumeration), while raw
 * CDP over a debug port works fine — so verification scripts talk to the
 * browser directly rather than fighting the wrapper. */

export class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { ok: (v: any) => void; err: (e: Error) => void }>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      const p = this.pending.get(msg.id);
      if (!p) return; // an event, not a reply
      this.pending.delete(msg.id);
      msg.error ? p.err(new Error(msg.error.message)) : p.ok(msg.result);
    };
  }

  static connect(url: string, timeoutMs = 15000): Promise<Cdp> {
    return new Promise((res, rej) => {
      const ws = new WebSocket(url);
      const t = setTimeout(() => rej(new Error(`websocket to ${url} timed out`)), timeoutMs);
      ws.onopen = () => {
        clearTimeout(t);
        res(new Cdp(ws));
      };
      ws.onerror = () => {
        clearTimeout(t);
        rej(new Error(`websocket to ${url} failed`));
      };
    });
  }

  send<T = any>(method: string, params: object = {}, timeoutMs = 30000): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((ok, err) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        err(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        ok: (v) => {
          clearTimeout(t);
          ok(v);
        },
        err: (e) => {
          clearTimeout(t);
          err(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* already gone */
    }
  }
}

/** Run an async expression in the page and return its value. */
export async function evaluate<T>(cdp: Cdp, expression: string): Promise<T> {
  const r = await cdp.send<any>('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    throw new Error(r.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result.value as T;
}
