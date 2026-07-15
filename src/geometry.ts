import type { Corner, Point, Quad, ViewTransform } from './types';
import { CORNERS } from './types';

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Recovers the height/width aspect ratio of a physical rectangle from its
 * four projected corners (Zhang & He, "Whiteboard scanning and image
 * enhancement", 2004).
 *
 * A 4-point homography alone cannot yield the rectangle's height — the
 * destination rectangle would have to be known in advance. Instead, assuming
 * square pixels and the principal point at the image centre, the four
 * corners determine the camera focal length and the rectangle's aspect
 * ratio up to that calibration:
 *
 *   With M1=(0,0), M2=(w,0), M3=(0,h), M4=(w,h) and image projections
 *   m1..m4 (homogeneous, principal point subtracted), the coefficients
 *   k2, k3 solve  k4·m4 = k2·m2 + k3·m3 − m1.  Then
 *   n2 = k2·m2 − m1  ∝ K·r1·w   and   n3 = k3·m3 − m1  ∝ K·r2·h,
 *   so r1 ⊥ r2 gives f², and  w/h = ‖K⁻¹n2‖ / ‖K⁻¹n3‖.
 *
 * Returns height/width, or null when the configuration is degenerate.
 */
export function estimateAspect(quad: Quad, imageWidth: number, imageHeight: number): number | null {
  const cx = imageWidth / 2;
  const cy = imageHeight / 2;
  const toVec = (p: Point): Vec3 => ({ x: p.x - cx, y: p.y - cy, z: 1 });

  const m1 = toVec(quad.tl); // M1 = (0, 0)
  const m2 = toVec(quad.tr); // M2 = (w, 0)
  const m3 = toVec(quad.bl); // M3 = (0, h)
  const m4 = toVec(quad.br); // M4 = (w, h)

  const k2Den = dot(cross(m2, m4), m3);
  const k3Den = dot(cross(m3, m4), m2);
  if (k2Den === 0 || k3Den === 0) {
    return null;
  }
  const k2 = dot(cross(m1, m4), m3) / k2Den;
  const k3 = dot(cross(m1, m4), m2) / k3Den;

  const n2: Vec3 = { x: k2 * m2.x - m1.x, y: k2 * m2.y - m1.y, z: k2 - 1 };
  const n3: Vec3 = { x: k3 * m3.x - m1.x, y: k3 * m3.y - m1.y, z: k3 - 1 };

  const fSquared = -(n2.x * n3.x + n2.y * n3.y) / (n2.z * n3.z);

  let widthOverHeight: number;
  if (Number.isFinite(fSquared) && fSquared > 0) {
    const w2 = (n2.x * n2.x + n2.y * n2.y) / fSquared + n2.z * n2.z;
    const h2 = (n3.x * n3.x + n3.y * n3.y) / fSquared + n3.z * n3.z;
    widthOverHeight = Math.sqrt(w2 / h2);
  } else {
    // Degenerate (near-parallelogram / fronto-parallel) case: perspective
    // vanishes and f is unobservable, but so is foreshortening — the ratio
    // of projected side lengths is then the physical ratio.
    widthOverHeight = Math.hypot(n2.x, n2.y) / Math.hypot(n3.x, n3.y);
  }

  const aspect = 1 / widthOverHeight;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : null;
}

/** Default pin placement for a freshly loaded image: an inset trapezoid. */
export function defaultQuad(imageWidth: number, imageHeight: number): Quad {
  const mx = imageWidth * 0.22;
  const my = imageHeight * 0.22;
  return {
    tl: { x: mx, y: my },
    tr: { x: imageWidth - mx, y: my },
    br: { x: imageWidth - mx, y: imageHeight - my },
    bl: { x: mx, y: imageHeight - my },
  };
}

/** Scale-to-fit transform centring the image inside the viewport. */
export function fitTransform(
  imageWidth: number,
  imageHeight: number,
  viewWidth: number,
  viewHeight: number,
): ViewTransform {
  const scale = Math.min(viewWidth / imageWidth, viewHeight / imageHeight);
  return {
    scale,
    offsetX: (viewWidth - imageWidth * scale) / 2,
    offsetY: (viewHeight - imageHeight * scale) / 2,
  };
}

export function imageToCanvas(view: ViewTransform, p: Point): Point {
  return { x: p.x * view.scale + view.offsetX, y: p.y * view.scale + view.offsetY };
}

export function canvasToImage(view: ViewTransform, p: Point): Point {
  return { x: (p.x - view.offsetX) / view.scale, y: (p.y - view.offsetY) / view.scale };
}

export function clampToImage(p: Point, imageWidth: number, imageHeight: number): Point {
  return {
    x: Math.min(Math.max(p.x, 0), imageWidth),
    y: Math.min(Math.max(p.y, 0), imageHeight),
  };
}

/** Returns a copy of the quad with one corner replaced. */
export function withCorner(quad: Quad, corner: Corner, point: Point): Quad {
  return {
    tl: corner === 'tl' ? point : quad.tl,
    tr: corner === 'tr' ? point : quad.tr,
    br: corner === 'br' ? point : quad.br,
    bl: corner === 'bl' ? point : quad.bl,
  };
}

/** Returns the corner whose handle contains the canvas-space point, if any. */
export function hitTestHandle(
  quad: Quad,
  view: ViewTransform,
  canvasPoint: Point,
  radius: number,
): Corner | null {
  let best: Corner | null = null;
  let bestDistance = radius;
  for (const corner of CORNERS) {
    const handle = imageToCanvas(view, quad[corner]);
    const distance = Math.hypot(handle.x - canvasPoint.x, handle.y - canvasPoint.y);
    if (distance <= bestDistance) {
      best = corner;
      bestDistance = distance;
    }
  }
  return best;
}
