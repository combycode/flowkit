/* Thin orchestrator: get the project, hold the render context, render the
 * toolbar and the canvas. No layout logic, no rendering logic.
 *
 * The same component serves the local studio and an exported snapshot — see
 * `sourceOf`. A snapshot is read-only because there is nothing behind it to
 * write to, not because it is a different application. */

import type { ProjectDoc, RenderContext } from '@flowkit/core';
import { useEffect, useMemo, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './controls/Toolbar';
import { useSelections } from './project/useSelections';

type Ground = 'dark' | 'light';
const GROUND_KEY = 'flowkit:ground';
const storedGround: Ground = ((): Ground => {
  try {
    return localStorage.getItem(GROUND_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
})();

import { Notices } from './notices/Notices';
import { sourceOf } from './project/source';
import { useProject } from './project/useProject';

const SOURCE = sourceOf();

export function App() {
  // Hooks cannot be called conditionally, so the fetch runs either way and is
  // told to do nothing when the document is already here.
  const fetched = useProject(SOURCE.kind === 'server' ? SOURCE.url : null);
  const state = SOURCE.kind === 'embedded' ? ready(SOURCE.doc) : fetched;

  /* Up here with the others, before anything can return early. A shared
   * snapshot has no server to ask, so it passes nothing and polls nothing. */
  const selections = useSelections(SOURCE.kind === 'server' ? SOURCE.project : undefined);

  const [ctx, setCtx] = useState<RenderContext | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [ground, setGround] = useState<Ground>(storedGround);

  /* Remembered, because this is a preference about eyes rather than about the
   * document — and a board that resets to dark on every reload is a board
   * somebody has to switch again every time. */
  useEffect(() => {
    try {
      localStorage.setItem(GROUND_KEY, ground);
    } catch {
      // A browser with storage refused still gets a working canvas.
    }
  }, [ground]);

  // The document names its own defaults, so the first context comes from it
  // rather than from constants that could drift out of step with the kit.
  const effectiveCtx = useMemo<RenderContext | null>(() => {
    if (state.status !== 'ready') return null;
    return (
      ctx ?? {
        theme: state.doc.kit.defaultTheme,
        locale: state.doc.strings.defaultLocale,
        viewport: state.doc.viewports[0]?.id ?? 'mobile',
      }
    );
  }, [state, ctx]);

  if (state.status === 'loading') return <Splash>Loading project…</Splash>;
  if (state.status === 'error') {
    return (
      <Splash>
        Could not load {SOURCE.kind === 'server' ? SOURCE.url : 'the embedded project'}
        <br />
        <small>{state.message}</small>
        {SOURCE.kind === 'server' ? (
          <>
            <br />
            <small>Run: bun run tools/import-straiw.ts</small>
          </>
        ) : null}
      </Splash>
    );
  }
  if (!effectiveCtx) return <Splash>Preparing…</Splash>;

  const readOnly = SOURCE.kind === 'embedded';
  const total = Object.keys(state.doc.flow.nodes).length;
  const shown =
    group === null
      ? total
      : Object.values(state.doc.flow.nodes).filter((n) => (n.groups ?? []).includes(group)).length;

  return (
    <div className="app">
      <Toolbar
        doc={state.doc}
        ctx={effectiveCtx}
        onCtx={setCtx}
        group={group}
        onGroup={setGroup}
        counts={{ shown, total }}
        selections={selections}
        ground={ground}
        onGround={setGround}
        readOnly={readOnly}
      />
      <main className="app__canvas" data-ground={ground}>
        <Canvas
          ground={ground}
          project={SOURCE.project}
          doc={state.doc}
          ctx={effectiveCtx}
          group={group}
          readOnly={readOnly}
        />
      </main>
      <Notices />
    </div>
  );
}

const ready = (doc: ProjectDoc) => ({ status: 'ready' as const, doc, revision: 0 });

function Splash({ children }: { children: React.ReactNode }) {
  return <div className="splash">{children}</div>;
}
