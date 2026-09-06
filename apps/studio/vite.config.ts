/* Development only.
 *
 * Users never run this. The studio is served by the local server in
 * @flowkit/host, from the bundle `bun run build:viewer` produces — that
 * is the thing that ships, and the thing an exported snapshot carries.
 *
 * This exists for one reason: editing the canvas with hot reload. It serves
 * the source and proxies the API to the real server, so what runs here talks
 * to the same store, the same command layer and the same op-log as everything
 * else. Nothing about the API lives in this file any more.
 *
 * It used to hold the API, as middleware, and could not import a Store —
 * Vite loads its config in Node and externalises workspace packages — so
 * every write shelled out to a child process and the studio became a second
 * writer on the project file. That is what the local server fixed.
 *
 *   bun run serve     the real thing
 *   bun run dev:hmr   this, alongside it
 */

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API = 'http://127.0.0.1:5190';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/projects': API,
      '/command': API,
      '/selection': API,
    },
  },
});
