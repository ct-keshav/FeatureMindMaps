// Paints a parsed scene (see scene.js) for the current view, skipping ops outside the viewport.

const NO_DASH = [];
/** Text smaller than this many screen pixels is drawn as a faint bar ("greeked") — unreadable anyway, and much faster. */
const MIN_TEXT_PX = 4;
const PAPER_BLEED = 80;

export function drawScene(ctx, scene, { s, tx, ty, vw, vh, dpr }) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  if (!scene) return;

  const k = s * dpr;
  const ox = tx * dpr;
  const oy = ty * dpr;

  // Visible region in scene coordinates, for culling.
  const left = -tx / s;
  const top = -ty / s;
  const right = (vw - tx) / s;
  const bottom = (vh - ty) / s;

  // White "paper" behind the diagram (with a drop shadow when its edge is on screen).
  const px0 = Math.max(ox, -PAPER_BLEED);
  const py0 = Math.max(oy, -PAPER_BLEED);
  const px1 = Math.min(ox + scene.width * k, W + PAPER_BLEED);
  const py1 = Math.min(oy + scene.height * k, H + PAPER_BLEED);
  if (px1 > px0 && py1 > py0) {
    ctx.save();
    if (px0 > 0 || py0 > 0 || px1 < W || py1 < H) {
      ctx.shadowColor = 'rgba(0,0,0,.28)';
      ctx.shadowBlur = 28 * dpr;
      ctx.shadowOffsetY = 8 * dpr;
    }
    ctx.fillStyle = '#fff';
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    ctx.restore();
  }

  ctx.textBaseline = 'alphabetic';
  ctx.miterLimit = 4;
  ctx.setLineDash(NO_DASH);

  let dash = null;
  let font = '';
  let clip = -1;
  const minTextSize = MIN_TEXT_PX / s;
  const hairline = 0.5 / k;

  for (const op of scene.ops) {
    const b = op.b;
    if (b[2] < left || b[0] > right || b[3] < top || b[1] > bottom) continue;

    if (op.clip !== clip) {
      if (clip >= 0) {
        ctx.restore();
        dash = undefined; // restore() reset these; force them to be re-applied.
        font = '';
      }
      clip = op.clip;
      if (clip >= 0) {
        const { p, m } = scene.clips[clip];
        ctx.save();
        ctx.setTransform(k * m[0], k * m[1], k * m[2], k * m[3], k * m[4] + ox, k * m[5] + oy);
        ctx.clip(p, 'evenodd');
      }
    }

    const m = op.m;
    ctx.setTransform(k * m[0], k * m[1], k * m[2], k * m[3], k * m[4] + ox, k * m[5] + oy);
    ctx.globalAlpha = op.a;

    if (op.t === 'shape') {
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill(op.p, op.rule);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = Math.max(op.lw, hairline);
        ctx.lineCap = op.cap;
        ctx.lineJoin = op.join;
        if (op.dash !== dash) {
          ctx.setLineDash(op.dash || NO_DASH);
          dash = op.dash;
        }
        ctx.stroke(op.p);
      }
    } else if (op.t === 'image') {
      if (op.img) ctx.drawImage(op.img, op.dx, op.dy, op.dw, op.dh);
    } else if (op.size < minTextSize) {
      ctx.globalAlpha = op.a * 0.3;
      ctx.fillStyle = op.fill;
      ctx.fillRect(op.x0, op.y - op.size * 0.62, op.w, op.size * 0.48);
    } else {
      if (op.font !== font) {
        ctx.font = op.font;
        font = op.font;
      }
      ctx.textAlign = op.align;
      ctx.fillStyle = op.fill;
      ctx.fillText(op.s, op.x, op.y);
    }
  }
  if (clip >= 0) ctx.restore();
}
