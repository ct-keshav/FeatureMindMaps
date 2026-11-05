// Pan/zoom controller for the diagram canvas: mouse, trackpad, touch (pinch), Safari gestures and keyboard.

import { drawScene } from './render.js';
import { loadScene } from './scene.js';

const MAX_SCALE = 8;
/** Cap on backing-store pixels so huge/HiDPI viewports don't blow past canvas memory limits. */
const MAX_CANVAS_PIXELS = 16e6;
const FIT_MARGIN = 24;
const ANIM_MS = 240;

export class Viewer {
  s = 1;
  tx = 0;
  ty = 0;
  vw = 0;
  vh = 0;
  dpr = 1;
  dprRaw = 1;
  scene = null;
  anim = null;
  frame = 0;
  lastZoom = null;
  pointers = new Map();
  gestureScale = 1;
  /** While true, resizes re-fit the width; any user interaction turns it off. */
  autoFit = true;

  constructor(viewport, canvas, { onZoom } = {}) {
    this.viewport = viewport;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onZoom = onZoom;
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.events = new AbortController();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.sizeCanvas();
    this.bindInput();
  }

  async load(url) {
    const scene = await loadScene(url);
    if (this.events.signal.aborted) return;
    this.scene = scene;
    this.fitWidth(false);
  }

  destroy() {
    this.events.abort();
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------ commands

  zoomBy(factor) {
    this.zoomAt(this.s * factor, null, null, true);
  }

  zoomTo(scale) {
    this.zoomAt(scale, null, null, true);
  }

  fitWidth(animate = true) {
    const s = this.clampScale((this.vw - 2 * FIT_MARGIN) / this.scene.width);
    this.moveTo(s, (this.vw - this.scene.width * s) / 2, FIT_MARGIN, animate);
  }

  fitPage() {
    const s = this.clampScale(this.pageScale());
    this.moveTo(s, (this.vw - this.scene.width * s) / 2, (this.vh - this.scene.height * s) / 2, true);
  }

  // ------------------------------------------------------------ rendering

  schedule() {
    this.frame ||= requestAnimationFrame(this.render);
  }

  render = (now = performance.now()) => {
    this.frame = 0;
    if ((window.devicePixelRatio || 1) !== this.dprRaw) this.sizeCanvas();
    if (this.anim) this.stepAnim(now);
    drawScene(this.ctx, this.scene, this);
    const zoom = Math.round(this.s * 100);
    if (this.scene && zoom !== this.lastZoom) {
      this.lastZoom = zoom;
      this.onZoom?.(zoom);
    }
    if (this.anim) this.schedule();
  };

  sizeCanvas() {
    const rect = this.viewport.getBoundingClientRect();
    this.dprRaw = window.devicePixelRatio || 1;
    this.dpr = Math.min(this.dprRaw, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, rect.width * rect.height)));
    if (this.scene && !this.autoFit && this.vw && this.vh) {
      // Keep the same point centred when the viewport changes size.
      this.tx += (rect.width - this.vw) / 2;
      this.ty += (rect.height - this.vh) / 2;
    }
    this.vw = rect.width;
    this.vh = rect.height;
    this.canvas.width = Math.max(1, Math.round(this.vw * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.vh * this.dpr));
  }

  resize() {
    this.sizeCanvas();
    if (this.scene) {
      if (this.autoFit) this.fitWidth(false);
      else this.clampView();
    }
    cancelAnimationFrame(this.frame);
    this.render();
  }

  // ------------------------------------------------------------ view math

  pageScale() {
    return Math.min((this.vw - 2 * FIT_MARGIN) / this.scene.width, (this.vh - 2 * FIT_MARGIN) / this.scene.height);
  }

  clampScale(s) {
    return Math.max(Math.min(0.02, this.pageScale() * 0.6), Math.min(MAX_SCALE, s));
  }

  /** Keep at least half the viewport covered by the diagram (or the diagram centred when it's smaller). */
  clampView() {
    const clamp = (t, size, view) =>
      Math.max(Math.min(view / 2 - size, (view - size) / 2), Math.min(Math.max(view / 2, (view - size) / 2), t));
    this.tx = clamp(this.tx, this.scene.width * this.s, this.vw);
    this.ty = clamp(this.ty, this.scene.height * this.s, this.vh);
  }

  zoomAt(scale, x, y, animate) {
    if (!this.scene) return;
    const s1 = this.clampScale(scale);
    x ??= this.vw / 2;
    y ??= this.vh / 2;
    const wx = (x - this.tx) / this.s;
    const wy = (y - this.ty) / this.s;
    if (animate) return this.startAnim({ s1, ax: x, ay: y, wx, wy });
    this.anim = null;
    this.autoFit = false;
    this.s = s1;
    this.tx = x - wx * s1;
    this.ty = y - wy * s1;
    this.clampView();
    this.schedule();
  }

  moveTo(s, tx, ty, animate) {
    if (!animate) {
      this.anim = null;
      Object.assign(this, { s, tx, ty });
      this.clampView();
      return this.schedule();
    }
    const { vw, vh } = this;
    this.startAnim({
      s1: s,
      c0x: (vw / 2 - this.tx) / this.s,
      c0y: (vh / 2 - this.ty) / this.s,
      c1x: (vw / 2 - tx) / s,
      c1y: (vh / 2 - ty) / s,
    });
  }

  startAnim(target) {
    this.autoFit = false;
    this.anim = { ...target, t0: performance.now(), d: this.reduceMotion.matches ? 0 : ANIM_MS, s0: this.s };
    this.schedule();
  }

  stepAnim(now) {
    const a = this.anim;
    const t = a.d ? Math.min(1, (now - a.t0) / a.d) : 1;
    const e = 1 - (1 - t) ** 3; // ease-out cubic
    this.s = a.s0 * (a.s1 / a.s0) ** e; // geometric zoom interpolation feels uniform
    if (a.ax == null) {
      this.tx = this.vw / 2 - (a.c0x + (a.c1x - a.c0x) * e) * this.s;
      this.ty = this.vh / 2 - (a.c0y + (a.c1y - a.c0y) * e) * this.s;
    } else {
      this.tx = a.ax - a.wx * this.s;
      this.ty = a.ay - a.wy * this.s;
    }
    this.clampView();
    if (t >= 1) this.anim = null;
  }

  pan(dx, dy) {
    this.autoFit = false;
    this.tx += dx;
    this.ty += dy;
    this.clampView();
    this.schedule();
  }

  local(event) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  // ------------------------------------------------------------ input

  bindInput() {
    const el = this.viewport;
    const signal = this.events.signal;
    const on = (target, type, handler, options) => target.addEventListener(type, handler, { signal, ...options });

    on(
      el,
      'wheel',
      (e) => {
        e.preventDefault();
        if (!this.scene) return;
        this.anim = null;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
        let dx = e.deltaX * unit;
        let dy = e.deltaY * unit;
        if (e.ctrlKey || e.metaKey) {
          // Trackpad pinch arrives as ctrl+wheel.
          const p = this.local(e);
          const d = Math.max(-25, Math.min(25, dy));
          this.zoomAt(this.s * Math.exp(-d * 0.012), p.x, p.y);
        } else {
          if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
          this.pan(-dx, -dy);
        }
      },
      { passive: false },
    );

    // Safari trackpad pinch.
    on(el, 'gesturestart', (e) => {
      e.preventDefault();
      this.gestureScale = 1;
    });
    on(el, 'gesturechange', (e) => {
      e.preventDefault();
      if (!this.scene || this.pointers.size >= 2) return;
      const p = this.local(e);
      this.zoomAt((this.s * e.scale) / this.gestureScale, p.x, p.y);
      this.gestureScale = e.scale;
    });
    on(el, 'gestureend', (e) => e.preventDefault());

    // Drag to pan; two pointers to pinch-zoom.
    on(el, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
      if (e.button === 1) e.preventDefault();
      this.anim = null;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      this.pointers.set(e.pointerId, this.local(e));
      el.classList.add('dragging');
      if (document.activeElement !== el) el.focus({ preventScroll: true });
    });
    on(el, 'pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || !this.scene) return;
      const cur = this.local(e);
      this.pointers.set(e.pointerId, cur);
      if (this.pointers.size === 1) return this.pan(cur.x - prev.x, cur.y - prev.y);

      const other = [...this.pointers].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      const s1 = d0 > 0 ? this.clampScale((this.s * d1) / d0) : this.s;
      this.autoFit = false;
      const wx = ((prev.x + other.x) / 2 - this.tx) / this.s;
      const wy = ((prev.y + other.y) / 2 - this.ty) / this.s;
      this.s = s1;
      this.tx = (cur.x + other.x) / 2 - wx * s1;
      this.ty = (cur.y + other.y) / 2 - wy * s1;
      this.clampView();
      this.schedule();
    });
    const release = (e) => {
      this.pointers.delete(e.pointerId);
      if (!this.pointers.size) el.classList.remove('dragging');
    };
    on(el, 'pointerup', release);
    on(el, 'pointercancel', release);
    on(el, 'lostpointercapture', release);

    on(el, 'dblclick', (e) => {
      const p = this.local(e);
      this.zoomAt(e.shiftKey ? this.s / 2 : this.s * 2, p.x, p.y, true);
    });

    on(window, 'keydown', (e) => {
      if (!this.scene || e.ctrlKey || e.metaKey || e.altKey) return;
      // Leave keys alone in form fields and in regions that handle their own keys (the tracker drawer).
      if (e.target.closest?.('input, textarea, select, [contenteditable], [data-own-keys]')) return;
      const step = e.shiftKey ? 400 : 80;
      const actions = {
        '+': () => this.zoomBy(1.5),
        '=': () => this.zoomBy(1.5),
        '-': () => this.zoomBy(1 / 1.5),
        _: () => this.zoomBy(1 / 1.5),
        0: () => this.zoomTo(1),
        ArrowLeft: () => this.pan(step, 0),
        ArrowRight: () => this.pan(-step, 0),
        ArrowUp: () => this.pan(0, step),
        ArrowDown: () => this.pan(0, -step),
      };
      if (actions[e.key]) {
        e.preventDefault();
        actions[e.key]();
      }
    });

    on(this.canvas, 'contextrestored', () => this.schedule());
  }
}
