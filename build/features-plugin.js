// Vite plugin that turns every folder in features/ into its own page.
//
//   features/<Name>/diagram.svg      (required)
//   features/<Name>/tracker.json     (optional)
//   features/<Name>/feature.json     (optional)
//
// Build output (dist/):
//   index.html, assets/…              landing page + shared JS/CSS
//   features.json                     manifest the landing page reads
//   <Name>/index.html                 feature.html with the feature's <title>, asset paths re-pointed to ../assets/
//   <Name>/diagram.svg …              copied verbatim (features/ is Vite's publicDir)
//
// Dev server: serves /<Name>/ with the feature shell and /features.json live, so edits show up on reload.

import fs from 'node:fs';
import path from 'node:path';
import { humanize, isOpen, itemsFor, resolvePanels } from '../src/lib/tracker.js';

const SHELL = 'feature.html';
const MANIFEST = 'features.json';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const withTitle = (html, title) => html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);

function readJson(file, label) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
}

/** Folders in features/ that contain a diagram.svg (folders starting with "." or "_" are ignored). */
function featureSlugs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !/^[._]/.test(d.name))
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(dir, slug, 'diagram.svg')));
}

function readFeature(dir, slug, warn) {
  const rel = (file) => `features/${slug}/${file}`;
  const config = readJson(path.join(dir, slug, 'feature.json'), rel('feature.json')) ?? {};
  const tracker = readJson(path.join(dir, slug, 'tracker.json'), rel('tracker.json'));
  const panels = resolvePanels(config, tracker);

  if (tracker) {
    for (const p of panels) {
      if (!Array.isArray(tracker[p.id])) warn(`${rel('feature.json')}: panel "${p.id}" has no matching array in tracker.json`);
    }
  } else if (Array.isArray(config.panels) && config.panels.length) {
    warn(`${rel('feature.json')} declares panels but ${rel('tracker.json')} is missing`);
  }

  return {
    slug,
    title: config.title || humanize(slug),
    subtitle: config.subtitle || '',
    description: config.description || '',
    order: Number.isFinite(config.order) ? config.order : null,
    panels: panels.map((p) => {
      const items = itemsFor(tracker, p.id);
      return { id: p.id, label: p.label, tone: p.tone, open: items.filter(isOpen).length, total: items.length };
    }),
  };
}

function buildManifest(dir, warn = console.warn) {
  const features = featureSlugs(dir)
    .map((slug) => readFeature(dir, slug, warn))
    // Explicit `order` first (ascending), then alphabetical by title.
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.title.localeCompare(b.title));
  return { generatedAt: new Date().toISOString(), features };
}

export function featuresPlugin({ dir = 'features' } = {}) {
  let featuresDir;
  let outDir;
  let rootDir;

  return {
    name: 'feature-mind-maps',

    configResolved(config) {
      rootDir = config.root;
      featuresDir = path.resolve(config.root, dir);
      outDir = path.resolve(config.root, config.build.outDir);
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const { pathname, search } = new URL(req.url, 'http://localhost');

          if (pathname === `/${MANIFEST}`) {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Cache-Control', 'no-cache');
            return res.end(JSON.stringify(buildManifest(featuresDir, (m) => server.config.logger.warn(m)), null, 2));
          }

          const match = /^\/([^/]+)(\/(?:index\.html)?)?$/.exec(pathname);
          const slug = match && decodeURIComponent(match[1]);
          if (!slug || !featureSlugs(featuresDir).includes(slug)) return next();

          // Relative URLs (./diagram.svg) need the trailing slash.
          if (!match[2]) {
            res.statusCode = 301;
            res.setHeader('Location', `/${match[1]}/${search}`);
            return res.end();
          }

          const { title } = readFeature(featuresDir, slug, () => {});
          const shell = withTitle(fs.readFileSync(path.join(rootDir, SHELL), 'utf8'), title);
          const html = await server.transformIndexHtml(pathname, shell, req.originalUrl);
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },

    // `vite preview`: redirect /<Name> → /<Name>/ like GitHub Pages does, so relative URLs resolve.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const { pathname, search } = new URL(req.url, 'http://localhost');
        const match = /^\/([^/.]+)$/.exec(pathname);
        if (!match || !fs.existsSync(path.join(outDir, decodeURIComponent(match[1]), 'index.html'))) return next();
        res.statusCode = 301;
        res.setHeader('Location', `/${match[1]}/${search}`);
        res.end();
      });
    },

    generateBundle() {
      let manifest;
      try {
        manifest = buildManifest(featuresDir, (m) => this.warn(m));
      } catch (err) {
        this.error(err.message);
      }
      if (!manifest.features.length) this.warn(`No features found in ${dir}/ (each needs a diagram.svg).`);
      this.emitFile({ type: 'asset', fileName: MANIFEST, source: JSON.stringify(manifest, null, 2) });
    },

    writeBundle() {
      const shellPath = path.join(outDir, SHELL);
      // Drop the "this is a template" comment from published pages.
      const shell = fs.readFileSync(shellPath, 'utf8').replace(/<!--[\s\S]*?-->\s*/, '');
      const { features } = JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), 'utf8'));

      for (const { slug, title } of features) {
        // The shell was built for dist/; one level deeper, ./assets/ becomes ../assets/.
        const html = withTitle(shell, title).replace(/(\b(?:src|href)=["'])\.\/assets\//g, '$1../assets/');
        fs.mkdirSync(path.join(outDir, slug), { recursive: true });
        fs.writeFileSync(path.join(outDir, slug, 'index.html'), html);
      }
      fs.rmSync(shellPath);
    },
  };
}
