# Feature Mind Maps

One pan/zoom architecture canvas per feature, each with toolbar panels that track open blockers.
The site is built to `dist/` and published to GitHub Pages.

```
https://ct-keshav.github.io/FeatureMindMaps/                                       ← landing page (all features)
https://ct-keshav.github.io/FeatureMindMaps/PluggableModuleIntegrationInCoupons/   ← one feature canvas
```

## Add or update a feature

Each feature is a folder in `features/`. **The folder name is the URL.** You only edit data files. No code changes are needed.

```
features/
  PluggableModuleIntegrationInCoupons/
    diagram.svg     required: the whiteboard (Excalidraw → Export image → SVG)
    tracker.json    optional: blockers / open items shown in the toolbar panels
    feature.json    optional: title, subtitle, card description, panel labels & colours
```

```bash
npm run new-feature -- MyNewFeature "My New Feature"   # scaffolds features/MyNewFeature/ from templates/feature/
```

Then replace `diagram.svg`, fill in `tracker.json`, and push to `main`.

### `tracker.json`

Every top-level key is a list of items. Each list is one toolbar panel.

```json
{
  "blockers_on_engage": [
    {
      "title": "Support for Bulk Send Comm Api",
      "status": "Open",
      "owner": "Engage",
      "discussedSolution": "Aligned with X and Y; planned for OND'26"
    }
  ],
  "blockers_on_product": [
    { "title": "Handling POC delivery settings", "status": "Open", "issue": "…", "context": ["line 1", "line 2"] }
  ]
}
```

| Field | Rendering |
| --- | --- |
| `title` | Item heading |
| `status` | Chip. `Resolved`, `Closed`, `Done`, `Fixed`, `Won't fix` and `N/A` are greyed out and **not counted** in the badge. Anything else counts as open. |
| `owner` | Shown next to the status chip |
| *any other key* | Labelled field. `discussedSolution` becomes "Discussed solution". Use any keys you like. |

- A string array is joined into lines.
- Text that is multi-line or longer than 280 characters collapses behind a toggle.
- Lines containing box-drawing characters (`┌ ─ │ ┼ └`) render as a monospace table.

### `feature.json`

```json
{
  "title": "Coupons × PM Canvas",
  "subtitle": "Original architecture whiteboard",
  "description": "Shown on the landing page card.",
  "order": 1,
  "panels": [
    { "id": "blockers_on_engage", "label": "Engage open blockers", "tone": "critical", "empty": "No open Engage blockers." },
    { "id": "blockers_on_product", "label": "Product open blockers", "tone": "warning" }
  ]
}
```

- **`panels` is optional.** Without it, every list in `tracker.json` becomes a panel in file order, labelled from its key (`blockers_on_engage` → "Blockers on engage"). With it, you choose which lists show, their order, labels and colours.
- `id` must match a key in `tracker.json`. The build warns if it doesn't.
- `tone` can be `critical` (red), `warning` (amber), `info` (blue), `success` (green) or `neutral` (grey).
- Without a `title`, the title comes from the folder name. `order` sorts landing-page cards; cards without one are sorted by title.

### Diagrams

The canvas renderer is tuned for Excalidraw SVG exports, including the embedded Excalifont, arrow-label masks and embedded images. It also handles plain SVG paths, rects, text and images with presentation attributes or inline styles. For huge boards it is much smoother than an `<img>`. "Open raw SVG ↗" in the toolbar always opens the original file.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173/: edits under features/ show up on reload
npm run build      # → dist/
npm run preview    # serve dist/ exactly as Pages will
```

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` runs `npm ci && npm run build` on every push to `main` and publishes `dist/` to Pages.

One-time setup: **repo Settings → Pages → Build and deployment → Source: GitHub Actions**.

> GitHub Pages on a **private** repository needs a paid plan (Pro/Team/Enterprise). On a free account, make the repo public. The published site is public either way, unless you're on Enterprise with private Pages.

## How it fits together

```
index.html / src/home/          landing page; reads features.json
feature.html / src/feature/     canvas page shell; loads ./diagram.svg, ./tracker.json, ./feature.json at runtime
src/canvas/                     SVG → canvas renderer + pan/zoom (mouse, trackpad, touch, keyboard)
src/lib/tracker.js              panel/status logic shared by the app and the build
build/features-plugin.js        Vite plugin: per-feature pages, features.json manifest, dev-server routing
templates/feature/              files copied by `npm run new-feature`
```

`dist/` after a build:

```
dist/index.html, assets/*, features.json
dist/<Feature>/index.html, diagram.svg, tracker.json, feature.json
```

Data is fetched at runtime, so in an emergency you can hot-fix `diagram.svg` or `tracker.json` inside an already built `dist/<Feature>/` without rebuilding.
