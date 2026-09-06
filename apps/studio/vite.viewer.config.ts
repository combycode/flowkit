/* The build behind a shared snapshot.
 *
 * Same source as the studio — one canvas, whose hands are tied when the
 * document is embedded rather than fetched. Only the packaging differs, and
 * it differs for one reason:
 *
 * A snapshot is opened by double-clicking a file. Under `file://` a module
 * script is fetched with CORS and refused, so the ordinary SPA build — which
 * emits `<script type="module" crossorigin>` — produces a blank page. Library
 * mode with an IIFE gives one classic script and one stylesheet, which the
 * exporter inlines into a single file that opens from a disk, an email
 * attachment or a USB stick with nothing else present.
 *
 * No dev server, no plugins beyond React: this build never runs anything.
 */

import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Library mode deliberately leaves this for the consuming app to define —
  // correct for a library, fatal for a page. React reads it on the first
  // render, so without this the bundle throws `process is not defined` and
  // nothing mounts at all.
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist-viewer',
    emptyOutDir: true,
    // One stylesheet rather than one per chunk — there is only one document
    // to put it in.
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/main.tsx'),
      name: 'FlowkitViewer',
      formats: ['iife'],
      fileName: () => 'viewer.js',
      cssFileName: 'viewer',
    },
  },
});
