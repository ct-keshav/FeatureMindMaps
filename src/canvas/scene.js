// Parses a (typically Excalidraw-exported) SVG into a flat list of draw ops that
// render.js can paint onto a <canvas>. Rendering huge whiteboards through canvas
// with viewport culling is far smoother than letting the browser re-rasterise a
// 10k×10k inline SVG on every pan/zoom frame.
//
// Supported: <g>/<a>, <path>, <rect>, <text>, <image>, <use> → <symbol>/<image>,
// transforms (translate/scale/rotate/matrix), presentation attributes and inline
// style declarations, Excalidraw label masks, embedded @font-face fonts.

const IDENTITY = [1, 0, 0, 1, 0, 0];
const FONT_STYLE_ID = 'diagram-fonts';
const ASSET_TIMEOUT_MS = 4000;
const MAX_USE_DEPTH = 8;
const SKIP_TAGS = new Set(['defs', 'mask', 'metadata', 'style', 'title', 'desc', 'clipPath', 'symbol']);
const XLINK = 'http://www.w3.org/1999/xlink';

const DEFAULT_STYLE = {
  fill: '#000',
  stroke: null,
  lw: 1,
  cap: 'butt',
  join: 'miter',
  dash: null,
  rule: 'nonzero',
  alpha: 1,
  size: 16,
  weight: '',
  family: 'sans-serif',
  anchor: 'start',
};

const STYLE_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'fill-rule',
  'opacity',
  'font-size',
  'font-weight',
  'font-family',
  'text-anchor',
];

/** Fetch, parse and prepare (fonts loaded, text measured, images decoded) a diagram. */
export async function loadScene(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`couldn't fetch ${url} (HTTP ${res.status})`);
  const scene = parseSvg(await res.text(), new URL(url, location.href).href);
  await Promise.all([loadFonts(scene), loadImages(scene)]);
  measureText(scene);
  return scene;
}

// ---------------------------------------------------------------- geometry

function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function applyTransform(attr, m) {
  for (const [, fn, args] of attr.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') m = multiply(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
    else if (fn === 'scale') m = multiply(m, [v[0], 0, 0, v.length > 1 ? v[1] : v[0], 0, 0]);
    else if (fn === 'matrix' && v.length === 6) m = multiply(m, v);
    else if (fn === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180;
      const cx = v[1] || 0;
      const cy = v[2] || 0;
      m = multiply(m, [1, 0, 0, 1, cx, cy]);
      m = multiply(m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      m = multiply(m, [1, 0, 0, 1, -cx, -cy]);
    }
  }
  return m;
}

/** Axis-aligned bounds (scene space) of a local box under transform m, padded. Unknown box → infinite. */
function transformBounds(m, box, pad) {
  if (!box) return [-Infinity, -Infinity, Infinity, Infinity];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]],
  ]) {
    const tx = m[0] * x + m[2] * y + m[4];
    const ty = m[1] * x + m[3] * y + m[5];
    x0 = Math.min(x0, tx);
    x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty);
    y1 = Math.max(y1, ty);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

/** Cheap bounds for absolute M/C/L/Z paths (what Excalidraw emits). Anything else → unknown. */
function pathBounds(d) {
  if (/[^MCLZz\d\s,.eE+-]/.test(d)) return null;
  const nums = d.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!nums || nums.length < 2) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = +nums[i];
    const y = +nums[i + 1];
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- attributes & style

function num(el, name, fallback) {
  const v = parseFloat(el.getAttribute(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Like num(), but resolves "50%" against a reference length. */
function length(el, name, ref, fallback) {
  const raw = el.getAttribute(name);
  if (raw == null) return fallback;
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return fallback;
  return raw.trim().endsWith('%') ? (v / 100) * ref : v;
}

function paint(value, inherited) {
  if (value == null) return inherited;
  value = value.trim();
  return value === 'none' || value === 'transparent' || value.startsWith('url(') ? null : value;
}

/** Presentation values for el: inline style declarations override attributes. */
function readProps(el) {
  let props = null;
  for (const name of STYLE_PROPS) {
    if (el.hasAttribute(name)) (props ??= {})[name] = el.getAttribute(name);
  }
  const style = el.getAttribute('style');
  if (style) {
    for (const decl of style.split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const name = decl.slice(0, i).trim().toLowerCase();
      if (STYLE_PROPS.includes(name)) (props ??= {})[name] = decl.slice(i + 1).replace(/!important/i, '').trim();
    }
  }
  return props;
}

function resolveStyle(el, parent) {
  const p = readProps(el);
  if (!p) return parent;
  const float = (name, fallback) => {
    const v = parseFloat(p[name]);
    return Number.isFinite(v) ? v : fallback;
  };
  const dash = p['stroke-dasharray'];
  return {
    fill: paint(p.fill, parent.fill),
    stroke: paint(p.stroke, parent.stroke),
    lw: float('stroke-width', parent.lw),
    cap: p['stroke-linecap'] || parent.cap,
    join: p['stroke-linejoin'] || parent.join,
    dash:
      dash == null
        ? parent.dash
        : dash === 'none'
          ? null
          : dash.split(/[\s,]+/).map(Number).filter(Number.isFinite),
    rule: p['fill-rule'] || parent.rule,
    alpha: parent.alpha * float('opacity', 1),
    size: float('font-size', parent.size),
    weight: p['font-weight'] && p['font-weight'] !== 'normal' ? p['font-weight'] : parent.weight,
    family: p['font-family'] || parent.family,
    anchor: p['text-anchor'] || parent.anchor,
  };
}

/** Excalidraw masks are "white rect minus black rects" (holes behind arrow labels) → even-odd clip paths. */
function collectMasks(svg) {
  const masks = {};
  for (const mask of svg.getElementsByTagName('mask')) {
    const id = mask.getAttribute('id');
    if (!id) continue;
    const path = new Path2D();
    let any = false;
    for (const rect of mask.getElementsByTagName('rect')) {
      const fill = (rect.getAttribute('fill') || '').toLowerCase();
      if (num(rect, 'opacity', 1) <= 0 || !/^(#fff|#ffffff|white|#000|#000000|black)$/.test(fill)) continue;
      path.rect(num(rect, 'x', 0), num(rect, 'y', 0), num(rect, 'width', 0), num(rect, 'height', 0));
      any = true;
    }
    if (any) masks[id] = path;
  }
  return masks;
}

// ---------------------------------------------------------------- parse

export function parseSvg(text, baseUrl = location.href) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg?.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('diagram.svg is not a valid SVG file');
  }

  const scene = { width: 1000, height: 1000, ops: [], clips: [], fontCss: '' };
  const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let m = IDENTITY;
  if (viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    [scene.width, scene.height] = [viewBox[2], viewBox[3]];
    m = [1, 0, 0, 1, -viewBox[0], -viewBox[1]];
  } else {
    scene.width = num(svg, 'width', 1000);
    scene.height = num(svg, 'height', 1000);
  }

  for (const style of svg.getElementsByTagName('style')) {
    scene.fontCss += (style.textContent.match(/@font-face\s*\{[^}]*\}/g) || []).join('\n') + '\n';
  }

  const ctx = { scene, doc, baseUrl, masks: collectMasks(svg), vw: scene.width, vh: scene.height, depth: 0 };
  walk(ctx, svg, m, DEFAULT_STYLE, -1);
  return scene;
}

function walk(ctx, parent, m, style, clip) {
  for (let el = parent.firstElementChild; el; el = el.nextElementSibling) {
    visit(ctx, el, m, style, clip);
  }
}

function visit(ctx, el, m, style, clip) {
  const tag = el.localName;
  if (SKIP_TAGS.has(tag) || el.getAttribute('display') === 'none') return;

  const em = el.hasAttribute('transform') ? applyTransform(el.getAttribute('transform'), m) : m;
  const es = resolveStyle(el, style);
  let ec = clip;
  const mask = /url\(#([^)]+)\)/.exec(el.getAttribute('mask') || '');
  if (mask && ctx.masks[mask[1]]) {
    ctx.scene.clips.push({ p: ctx.masks[mask[1]], m: em });
    ec = ctx.scene.clips.length - 1;
  }

  if (tag === 'g' || tag === 'a' || tag === 'svg') {
    walk(ctx, el, em, es, ec);
  } else if (tag === 'path') {
    const d = el.getAttribute('d') || '';
    addShape(ctx.scene, d, pathBounds(d), em, es, ec);
  } else if (tag === 'rect') {
    const x = length(el, 'x', ctx.vw, 0);
    const y = length(el, 'y', ctx.vh, 0);
    const w = length(el, 'width', ctx.vw, 0);
    const h = length(el, 'height', ctx.vh, 0);
    if (w > 0 && h > 0) addShape(ctx.scene, `M${x} ${y}H${x + w}V${y + h}H${x}Z`, [x, y, x + w, y + h], em, es, ec);
  } else if (tag === 'text') {
    addText(ctx.scene, el, em, es, ec);
  } else if (tag === 'image') {
    addImage(ctx, el, em, es, ec);
  } else if (tag === 'use') {
    addUse(ctx, el, em, es, ec);
  }
}

function href(el) {
  return el.getAttribute('href') ?? el.getAttributeNS(XLINK, 'href');
}

function addShape(scene, d, box, m, s, clip) {
  const stroke = s.lw > 0 ? s.stroke : null;
  if (!d || (!s.fill && !stroke)) return;
  scene.ops.push({
    t: 'shape',
    m,
    p: new Path2D(d),
    fill: s.fill,
    stroke,
    lw: s.lw,
    cap: s.cap,
    join: s.join,
    dash: s.dash?.length ? s.dash : null,
    rule: s.rule === 'evenodd' ? 'evenodd' : 'nonzero',
    a: s.alpha,
    clip,
    b: transformBounds(m, box, stroke ? s.lw : 0),
  });
}

function addText(scene, el, m, s, clip) {
  const text = el.textContent;
  if (!text || !text.trim() || !s.fill) return;
  scene.ops.push({
    t: 'text',
    m,
    s: text.replace(/[\t\n\r]/g, ' '),
    x: num(el, 'x', 0),
    y: num(el, 'y', 0),
    size: s.size,
    family: s.family,
    font: `${s.weight ? s.weight + ' ' : ''}${s.size}px ${s.family}`,
    align: s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left',
    fill: s.fill,
    a: s.alpha,
    clip,
    // Filled in by measureText() once fonts are ready.
    w: 0,
    x0: 0,
    b: null,
  });
}

function addImage(ctx, el, m, s, clip) {
  const src = href(el);
  const x = length(el, 'x', ctx.vw, 0);
  const y = length(el, 'y', ctx.vh, 0);
  const w = length(el, 'width', ctx.vw, 0);
  const h = length(el, 'height', ctx.vh, 0);
  if (!src || !(w > 0 && h > 0)) return;
  let url;
  try {
    url = new URL(src, ctx.baseUrl).href;
  } catch {
    return;
  }
  ctx.scene.ops.push({
    t: 'image',
    m,
    src: url,
    x,
    y,
    w,
    h,
    stretch: (el.getAttribute('preserveAspectRatio') || '').trim().startsWith('none'),
    img: null,
    a: s.alpha,
    clip,
    b: transformBounds(m, [x, y, x + w, y + h], 0),
  });
}

/** <use href="#id" x y width height>: Excalidraw uses this for embedded images (a <symbol> holding an <image>). */
function addUse(ctx, el, m, s, clip) {
  const ref = href(el);
  if (!ref?.startsWith('#') || ctx.depth >= MAX_USE_DEPTH) return;
  const id = ref.slice(1);
  const target = ctx.doc.getElementById(id) ?? ctx.doc.querySelector(`[id="${CSS.escape(id)}"]`);
  if (!target) return;

  const um = multiply(m, [1, 0, 0, 1, num(el, 'x', 0), num(el, 'y', 0)]);
  const inner = { ...ctx, depth: ctx.depth + 1 };
  if (target.localName === 'symbol') {
    // Symbol content is laid out in the <use> element's width/height (percentages resolve against it).
    inner.vw = num(el, 'width', ctx.vw);
    inner.vh = num(el, 'height', ctx.vh);
    walk(inner, target, um, s, clip);
  } else {
    visit(inner, target, um, s, clip);
  }
}

// ---------------------------------------------------------------- async assets

function withTimeout(promise) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ASSET_TIMEOUT_MS))]);
}

async function loadFonts(scene) {
  if (scene.fontCss.trim()) {
    let style = document.getElementById(FONT_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = FONT_STYLE_ID;
      document.head.appendChild(style);
    }
    style.textContent = scene.fontCss;
  }
  if (!document.fonts) return;
  const samples = new Map();
  for (const op of scene.ops) {
    if (op.t === 'text') samples.set(`${op.size}px ${op.family.split(',')[0]}`, op.s);
  }
  await withTimeout(Promise.all([...samples].map(([font, text]) => document.fonts.load(font, text).catch(() => {}))));
}

async function loadImages(scene) {
  const images = scene.ops.filter((op) => op.t === 'image');
  await withTimeout(
    Promise.all(
      images.map(async (op) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = op.src;
        try {
          await img.decode();
        } catch {
          return; // Broken/blocked image: skip it rather than failing the whole diagram.
        }
        let { x, y, w, h } = op;
        if (!op.stretch && img.naturalWidth && img.naturalHeight) {
          // Default preserveAspectRatio: xMidYMid meet.
          const k = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          x += (w - img.naturalWidth * k) / 2;
          y += (h - img.naturalHeight * k) / 2;
          w = img.naturalWidth * k;
          h = img.naturalHeight * k;
        }
        Object.assign(op, { img, dx: x, dy: y, dw: w, dh: h });
      }),
    ),
  );
}

function measureText(scene) {
  const ctx = document.createElement('canvas').getContext('2d');
  for (const op of scene.ops) {
    if (op.t !== 'text') continue;
    ctx.font = op.font;
    op.w = ctx.measureText(op.s).width;
    op.x0 = op.align === 'center' ? op.x - op.w / 2 : op.align === 'right' ? op.x - op.w : op.x;
    op.b = transformBounds(op.m, [op.x0, op.y - op.size, op.x0 + op.w, op.y + op.size * 0.4], 0);
  }
}
