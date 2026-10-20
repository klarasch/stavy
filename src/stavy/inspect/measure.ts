/**
 * Figma-style redlines between two boxes: with one element pinned and
 * another hovered, the distances between them. Pure geometry in host
 * viewport pixels; labels are converted back to the prototype's own CSS
 * pixels with `k` (the frame's rendered scale), so a 16px gap reads 16 even
 * when the frame is scaled to fit beside the panel or sits on a zoomed canvas.
 */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** One redline: horizontal (`y` fixed, from `x1` to `x2`) or vertical (`x` fixed, from `y1` to `y2`). */
export interface Redline {
  dir: "h" | "v"
  x1: number
  y1: number
  x2: number
  y2: number
  /** Distance in the prototype's CSS px */
  value: number
}

interface Edges {
  l: number
  r: number
  t: number
  b: number
}

const edges = (b: Box): Edges => ({ l: b.left, r: b.left + b.width, t: b.top, b: b.top + b.height })
const EPS = 0.5

function overlap(a0: number, a1: number, b0: number, b1: number): [number, number] | null {
  const lo = Math.max(a0, b0)
  const hi = Math.min(a1, b1)
  return hi > lo ? [lo, hi] : null
}

function contains(o: Edges, i: Edges): boolean {
  return i.l >= o.l - EPS && i.r <= o.r + EPS && i.t >= o.t - EPS && i.b <= o.b + EPS
}

/** Distances from `a` (the pinned box) to `b` (the hovered one), as redlines. */
export function redlines(a: Box, b: Box, k = 1): Redline[] {
  const A = edges(a)
  const B = edges(b)
  const scale = k > 0 ? k : 1
  const out: Redline[] = []
  const h = (y: number, x1: number, x2: number) => out.push({ dir: "h", x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: y, y2: y, value: Math.abs(x2 - x1) / scale })
  const v = (x: number, y1: number, y2: number) => out.push({ dir: "v", y1: Math.min(y1, y2), y2: Math.max(y1, y2), x1: x, x2: x, value: Math.abs(y2 - y1) / scale })

  if (contains(A, B) || contains(B, A)) {
    // One inside the other: inner edges to outer edges, on all four sides.
    const [o, i] = contains(A, B) ? [A, B] : [B, A]
    const cx = (i.l + i.r) / 2
    const cy = (i.t + i.b) / 2
    v(cx, o.t, i.t)
    v(cx, i.b, o.b)
    h(cy, o.l, i.l)
    h(cy, i.r, o.r)
  } else {
    const oy = overlap(A.t, A.b, B.t, B.b)
    const ox = overlap(A.l, A.r, B.l, B.r)
    const y = oy ? (oy[0] + oy[1]) / 2 : (B.t + B.b) / 2
    const x = ox ? (ox[0] + ox[1]) / 2 : (B.l + B.r) / 2
    if (B.l >= A.r) h(y, A.r, B.l)
    else if (B.r <= A.l) h(y, B.r, A.l)
    if (B.t >= A.b) v(x, A.b, B.t)
    else if (B.b <= A.t) v(x, B.b, A.t)
    if (out.length === 0 && ox && oy) {
      // Partial overlap: how far the corresponding edges are apart.
      h((oy[0] + oy[1]) / 2, A.l, B.l)
      v((ox[0] + ox[1]) / 2, A.t, B.t)
    }
  }
  return out.filter((r) => r.value >= EPS).map((r) => ({ ...r, value: Math.round(r.value * 10) / 10 }))
}
