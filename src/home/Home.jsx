import { useEffect, useState } from 'react';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

// Generated at build time (and served live by `npm run dev`) from the folders in features/.
const MANIFEST_URL = './features.json';

export function Home() {
  const [state, setState] = useState({ features: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then(
        (data) => !cancelled && setState({ features: data.features ?? [], error: null }),
        (err) => !cancelled && setState({ features: null, error: err.message || String(err) }),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const { features, error } = state;

  return (
    <div className="home">
      <header className="toolbar">
        <div className="brand">
          <span className="name">Feature Mind Maps</span>
          <span className="hint">Architecture whiteboards &amp; open blockers, one canvas per feature</span>
        </div>
        <div className="spacer" />
        {features && (
          <span className="count">
            {features.length} {features.length === 1 ? 'feature' : 'features'}
          </span>
        )}
        <ThemeToggle />
      </header>

      <main className="home-main">
        {error && <p className="empty">Couldn’t load the feature list ({error}).</p>}
        {!error && !features && <p className="empty">Loading…</p>}
        {features?.length === 0 && (
          <div className="empty-state">
            <h2>No features yet</h2>
            <p>
              Run <code>npm run new-feature -- MyFeature</code>, then drop your <code>diagram.svg</code> and{' '}
              <code>tracker.json</code> into <code>features/MyFeature/</code>.
            </p>
          </div>
        )}
        {features?.length > 0 && (
          <ul className="feature-grid">
            {features.map((f) => (
              <li key={f.slug}>
                <a className="feature-card" href={`./${encodeURIComponent(f.slug)}/`}>
                  <div className="card-head">
                    <h2>{f.title}</h2>
                    <span className="card-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </div>
                  {f.subtitle && <p className="card-sub">{f.subtitle}</p>}
                  {f.description && <p className="card-desc">{f.description}</p>}
                  {f.panels.length > 0 && (
                    <div className="card-panels">
                      {f.panels.map((p) => (
                        <span key={p.id} className={`panelchip tone-${p.tone}`}>
                          <span className="dot" aria-hidden="true" />
                          {p.label}
                          <span className="badge" title="Open items">
                            {p.open}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="card-slug">/{f.slug}/</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
