#!/usr/bin/env bun
/* Build flowkit as it ships — the one thing that cannot be checked without
 * actually installing it, so it gets a real build and a real smoke test.
 *
 * Output lands in `packages/mcp-server/dist/`:
 *   flowkit.js   the CLI + server + core + host, bundled into one file;
 *   main.js      the server entry `.mcp.json` points at (imports flowkit.js);
 *   viewer/      the studio bundle, so the canvas ships INSIDE the package
 *                and is found next to the built file rather than up a source
 *                tree that will not exist once published.
 *
 * Third-party runtime deps stay EXTERNAL and are declared in the package's
 * dependencies, so npm installs and dedupes them rather than baking a second
 * copy of tailwind into our file.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const PKG = join(ROOT, 'packages', 'mcp-server');
const DIST = join(PKG, 'dist');
const VIEWER_SRC = join(ROOT, 'apps', 'studio', 'dist-viewer');

/** Installed by npm, not bundled. */
const EXTERNAL = ['@modelcontextprotocol/sdk', 'zod', 'tailwindcss'];

async function main() {
  console.log('flowkit build\n');

  // 1. the viewer must exist first — the package ships it.
  if (!(await exists(join(VIEWER_SRC, 'viewer.js')))) {
    console.log('  building the viewer…');
    await run('bun', ['run', 'build:viewer'], ROOT);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  // 2. bundle the CLI (which pulls in the server, core and host) into one file.
  console.log('  bundling the server…');
  const built = await Bun.build({
    entrypoints: [join(PKG, 'src', 'cli.ts')],
    outdir: DIST,
    target: 'bun',
    format: 'esm',
    external: EXTERNAL,
    naming: 'flowkit.js',
  });
  if (!built.success) {
    for (const log of built.logs) console.error(log);
    throw new Error('bundle failed');
  }

  // 3. the entry `.mcp.json` names. Kept tiny and separate so `bin` and the
  //    server entry are distinct files, as the manifests expect.
  await writeFile(join(DIST, 'main.js'), "#!/usr/bin/env bun\nimport './flowkit.js';\n", 'utf8');

  // 4. the canvas, beside the built file where findViewerBundle looks first.
  console.log('  copying the viewer…');
  await mkdir(join(DIST, 'viewer'), { recursive: true });
  for (const f of ['viewer.js', 'viewer.css']) {
    await cp(join(VIEWER_SRC, f), join(DIST, 'viewer', f));
  }

  // 5. a slim package.json for the published artefact: real dependencies, a
  //    bin that points at the bundle, and only dist shipped.
  await writePublishManifest();

  const size = (await readFile(join(DIST, 'flowkit.js'))).length;
  console.log(
    `\ndone. dist/flowkit.js ${(size / 1024).toFixed(0)} KB, viewer copied, manifest written.`,
  );
}

async function writePublishManifest() {
  const src = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8')) as {
    version: string;
    description: string;
    license: string;
    keywords: string[];
  };

  // Pin externals to the versions the repo is built and tested against —
  // gathered across every manifest, since tailwind lives on host and the rest
  // on the root and mcp-server. One source of truth, whichever file it is in.
  const versions = await pinnedVersions();
  const deps: Record<string, string> = {};
  for (const name of EXTERNAL) {
    const v = versions[name];
    if (!v) throw new Error(`external ${name} is not pinned in any workspace manifest`);
    deps[name] = v;
  }

  const manifest = {
    name: '@combycode/flowkit',
    version: src.version,
    description: src.description,
    license: src.license,
    keywords: src.keywords,
    type: 'module',
    bin: { flowkit: './flowkit.js' },
    // flowkit runs on Bun, not Node: the canvas is a Bun.serve server and the
    // bin's shebang is `#!/usr/bin/env bun`. Declared so an install on a
    // Node-only machine warns instead of failing cryptically at run time.
    engines: { bun: '>=1.3.0' },
    // The repo the provenance attestation is checked against — it must be the
    // real one, or a CI publish with --provenance is rejected.
    repository: { type: 'git', url: 'git+https://github.com/combycode/flowkit.git' },
    bugs: { url: 'https://github.com/combycode/flowkit/issues' },
    homepage: 'https://github.com/combycode/flowkit#readme',
    files: [
      'flowkit.js',
      'main.js',
      'viewer',
      'README.md',
      'CHANGELOG.md',
      'LICENSE',
      'LICENSE-FORMAT',
    ],
    dependencies: deps,
  };
  await writeFile(join(DIST, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // README, changelog and licences travel with the package.
  for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE', 'LICENSE-FORMAT']) {
    if (await exists(join(ROOT, f))) await cp(join(ROOT, f), join(DIST, f));
  }
}

/** Every dependency version declared anywhere in the workspace. A dep pinned
 *  twice at different versions is a mistake worth failing on, not smoothing
 *  over. */
async function pinnedVersions(): Promise<Record<string, string>> {
  const manifests = [
    join(ROOT, 'package.json'),
    join(ROOT, 'packages', 'core', 'package.json'),
    join(ROOT, 'packages', 'host', 'package.json'),
    join(PKG, 'package.json'),
  ];
  const out: Record<string, string> = {};
  for (const file of manifests) {
    const pkg = JSON.parse(await readFile(file, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (v.startsWith('workspace:')) continue;
      if (out[name] && out[name] !== v) {
        throw new Error(`${name} is pinned at both ${out[name]} and ${v}; make them agree`);
      }
      out[name] = v;
    }
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await readFile(p);
    return true;
  } catch {
    // a directory read fails this way too; good enough for our file checks
    return await Bun.file(p).exists();
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = Bun.spawn([cmd, ...args], { cwd, stdout: 'inherit', stderr: 'inherit' });
    child.exited.then((code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
}

await main();
process.exit(0);
