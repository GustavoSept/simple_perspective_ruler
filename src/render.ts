import { fitTransform, imageToCanvas } from './geometry';
import type { Corner, LoadedImage, Point, Quad, Segment, Unit, ViewTransform, ViewportSize } from './types';
import { CORNERS } from './types';

export interface Scene {
  readonly image: LoadedImage | null;
  readonly quad: Quad | null;
  readonly gridSegments: readonly Segment[];
  readonly knownWidth: number | null;
  readonly unit: Unit;
  readonly activeCorner: Corner | null;
}

const COLORS = {
  edge: '#4f8ff7',
  topEdge: '#f7b84f',
  grid: 'rgba(79, 143, 247, 0.45)',
  handleFill: '#ffffff',
  handleActive: '#f7b84f',
  label: '#0d1420',
  labelBg: 'rgba(247, 184, 79, 0.92)',
  emptyText: 'rgba(226, 232, 240, 0.55)',
} as const;

const HANDLE_RADIUS = 7;

/** Computes the image→canvas transform for the current scene, if any. */
export function sceneTransform(scene: Scene, viewport: ViewportSize): ViewTransform | null {
  if (scene.image === null) {
    return null;
  }
  return fitTransform(scene.image.width, scene.image.height, viewport.width, viewport.height);
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  viewport: ViewportSize,
  scene: Scene,
): void {
  const canvas = ctx.canvas;
  const backingWidth = Math.max(1, Math.round(viewport.width * viewport.dpr));
  const backingHeight = Math.max(1, Math.round(viewport.height * viewport.dpr));
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  if (scene.image === null || scene.quad === null) {
    drawEmptyState(ctx, viewport);
    return;
  }
  const view = sceneTransform(scene, viewport);
  if (view === null) {
    return;
  }

  ctx.drawImage(
    scene.image.source,
    view.offsetX,
    view.offsetY,
    scene.image.width * view.scale,
    scene.image.height * view.scale,
  );

  drawGrid(ctx, view, scene.gridSegments);
  drawQuad(ctx, view, scene.quad);
  drawWidthLabel(ctx, view, scene.quad, scene.knownWidth, scene.unit);
  drawHandles(ctx, view, scene.quad, scene.activeCorner);
}

function drawEmptyState(ctx: CanvasRenderingContext2D, viewport: ViewportSize): void {
  ctx.fillStyle = COLORS.emptyText;
  ctx.font = '16px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Upload a photo, then drag the four pins onto a rectangle', viewport.width / 2, viewport.height / 2);
  ctx.fillText('whose real horizontal width you know.', viewport.width / 2, viewport.height / 2 + 24);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  segments: readonly Segment[],
): void {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of segments) {
    const ca = imageToCanvas(view, a);
    const cb = imageToCanvas(view, b);
    ctx.moveTo(ca.x, ca.y);
    ctx.lineTo(cb.x, cb.y);
  }
  ctx.stroke();
}

function drawQuad(ctx: CanvasRenderingContext2D, view: ViewTransform, quad: Quad): void {
  const [tl, tr, br, bl] = [quad.tl, quad.tr, quad.br, quad.bl].map((p) => imageToCanvas(view, p));
  if (tl === undefined || tr === undefined || br === undefined || bl === undefined) {
    return;
  }

  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.lineTo(tl.x, tl.y);
  ctx.stroke();

  // The top edge carries the known width — highlight it.
  ctx.strokeStyle = COLORS.topEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.stroke();
}

function drawWidthLabel(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  quad: Quad,
  knownWidth: number | null,
  unit: Unit,
): void {
  const tl = imageToCanvas(view, quad.tl);
  const tr = imageToCanvas(view, quad.tr);
  const mid: Point = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const text = knownWidth === null ? 'width?' : `${knownWidth} ${unit}`;

  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const padX = 6;
  const boxWidth = metrics.width + padX * 2;
  const boxHeight = 18;
  ctx.fillStyle = COLORS.labelBg;
  ctx.fillRect(mid.x - boxWidth / 2, mid.y - boxHeight / 2, boxWidth, boxHeight);
  ctx.fillStyle = COLORS.label;
  ctx.fillText(text, mid.x, mid.y + 1);
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  view: ViewTransform,
  quad: Quad,
  activeCorner: Corner | null,
): void {
  for (const corner of CORNERS) {
    const p = imageToCanvas(view, quad[corner]);
    const active = corner === activeCorner;
    ctx.beginPath();
    ctx.arc(p.x, p.y, active ? HANDLE_RADIUS + 2 : HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = active ? COLORS.handleActive : COLORS.handleFill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = corner === 'tl' || corner === 'tr' ? COLORS.topEdge : COLORS.edge;
    ctx.stroke();
  }
}
