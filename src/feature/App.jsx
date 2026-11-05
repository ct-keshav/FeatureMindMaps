import { useEffect, useRef, useState } from 'react';
import { Viewer } from '../canvas/Viewer.js';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { TrackerDrawer } from '../components/TrackerDrawer.jsx';
import { isOpen, itemsFor, resolvePanels } from '../lib/tracker.js';

// Every feature page lives at /<FeatureFolder>/ next to these three files (see features/README.md).
const DIAGRAM_URL = './diagram.svg';
const TRACKER_URL = './tracker.json';
const FEATURE_URL = './feature.json';
const HOME_URL = '../';

/** Fetch JSON; a 404 resolves to `missing` instead of throwing when one is given. */
async function fetchJson(url, missing) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (res.status === 404 && missing !== undefined) return missing;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function App() {
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const drawerRef = useRef(null);
  const zoomRef = useRef(null);

  const [diagramError, setDiagramError] = useState(null);
  const [ready, setReady] = useState(false);
  // feature.json is optional; the build bakes its title into <title>, so start from that.
  const [config, setConfig] = useState(null);
  const [tracker, setTracker] = useState({ data: null, error: null });
  const [panel, setPanel] = useState({ id: null, open: false });

  const title = config?.title || document.title;
  const subtitle = config?.subtitle ?? '';
  const panels = config ? resolvePanels(config, tracker.data) : [];
  const active = panels.find((p) => p.id === panel.id) ?? panels[0];
  const itemsOf = (id) => (tracker.data ? itemsFor(tracker.data, id) : null);

  const close = () => setPanel((p) => ({ ...p, open: false }));
  const toggle = (id) => setPanel((p) => (p.open && p.id === id ? { ...p, open: false } : { id, open: true }));
  const command = (fn) => () => viewerRef.current?.scene && fn(viewerRef.current);

  // Diagram canvas.
  useEffect(() => {
    let cancelled = false;
    const viewer = new Viewer(viewportRef.current, canvasRef.current, {
      onZoom: (zoom) => zoomRef.current && (zoomRef.current.textContent = `${zoom}%`),
    });
    viewerRef.current = viewer;
    viewer.load(DIAGRAM_URL).then(
      () => !cancelled && setReady(true),
      (err) => {
        console.error(err);
        if (!cancelled) setDiagramError(err.message || String(err));
      },
    );
    return () => {
      cancelled = true;
      viewer.destroy();
    };
  }, []);

  // feature.json + tracker.json.
  useEffect(() => {
    let cancelled = false;
    fetchJson(FEATURE_URL, {}).then(
      (data) => !cancelled && setConfig(data && typeof data === 'object' ? data : {}),
      (err) => {
        console.error('feature.json:', err);
        if (!cancelled) setConfig({});
      },
    );
    fetchJson(TRACKER_URL).then(
      (data) => !cancelled && setTracker({ data, error: null }),
      (err) => !cancelled && setTracker({ data: null, error: err.message || String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (config?.title) document.title = config.title;
  }, [config]);

  // Focus the drawer when it opens; Esc closes it.
  useEffect(() => {
    if (!panel.open) return;
    drawerRef.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel.open, panel.id]);

  return (
    <div className="app">
      <header className="toolbar">
        <a className="iconbtn homelink" href={HOME_URL} aria-label="All features" title="All features">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
          </svg>
        </a>
        <div className="brand">
          <span className="name">{title}</span>
          {subtitle && <span className="hint">{subtitle}</span>}
        </div>

        {panels.length > 0 && (
          <>
            <div className="sep" />
            <nav className="panelgroup" aria-label="Tracker">
              {panels.map((p) => {
                const items = itemsOf(p.id);
                return (
                  <button
                    key={p.id}
                    className={`panelbtn tone-${p.tone}`}
                    aria-expanded={panel.open && active?.id === p.id}
                    aria-controls="drawer"
                    onClick={() => toggle(p.id)}
                  >
                    <span className="dot" aria-hidden="true" />
                    {p.label}
                    {items && (
                      <span className="badge" title="Open items">
                        {items.filter(isOpen).length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </>
        )}

        <div className="sep" />
        <div className="zoomgroup" role="group" aria-label="Zoom controls">
          <button onClick={command((v) => v.zoomBy(1 / 1.5))} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <span className="zoom-readout" ref={zoomRef}>
            100%
          </span>
          <button onClick={command((v) => v.zoomBy(1.5))} title="Zoom in" aria-label="Zoom in">
            +
          </button>
        </div>
        <button className="pillbtn" onClick={command((v) => v.fitWidth())}>
          Fit width
        </button>
        <button className="pillbtn" onClick={command((v) => v.fitPage())}>
          Fit page
        </button>
        <button className="pillbtn primary" onClick={command((v) => v.zoomTo(1))}>
          100%
        </button>
        <div className="spacer" />
        <span className="kbd-hint">
          Drag or scroll to pan · Pinch or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+scroll to zoom
        </span>
        <a className="origlink" href={DIAGRAM_URL} target="_blank" rel="noopener noreferrer">
          Open raw SVG ↗
        </a>
        <ThemeToggle />
      </header>

      <div className="stage">
        <main
          className="viewport"
          ref={viewportRef}
          tabIndex={0}
          aria-label="Diagram canvas. Drag or scroll to pan, pinch or use the zoom controls to zoom."
        >
          <canvas ref={canvasRef} role="img" aria-label={subtitle ? `${title}: ${subtitle}` : title} />
          {!ready && (
            <div className="overlay">
              {diagramError ? (
                <span>
                  The diagram didn’t load ({diagramError}). Check that <code>diagram.svg</code> sits next to{' '}
                  <code>index.html</code>, then reload, or{' '}
                  <a href={DIAGRAM_URL} target="_blank" rel="noopener noreferrer">
                    open the raw SVG
                  </a>
                  .
                </span>
              ) : (
                <>
                  <div className="spin" />
                  Loading diagram…
                </>
              )}
            </div>
          )}
        </main>
        {active && (
          <TrackerDrawer
            ref={drawerRef}
            open={panel.open}
            panel={active}
            items={itemsOf(active.id)}
            error={tracker.error}
            onClose={close}
          />
        )}
      </div>
    </div>
  );
}
