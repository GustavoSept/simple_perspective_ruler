/** Shared domain types for the perspective ruler. */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Corner = 'tl' | 'tr' | 'br' | 'bl';

export const CORNERS: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];

/** The four draggable pins, stored in *image pixel* coordinates. */
export interface Quad {
  readonly tl: Point;
  readonly tr: Point;
  readonly br: Point;
  readonly bl: Point;
}

/** A decoded image, possibly downscaled to fit within Full HD. */
export interface LoadedImage {
  readonly source: HTMLImageElement | HTMLCanvasElement;
  readonly width: number;
  readonly height: number;
  readonly fileName: string;
}

/** Affine mapping from image pixel space to canvas (CSS pixel) space. */
export interface ViewTransform {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Current size of the canvas element in CSS pixels + device pixel ratio. */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export type Unit = 'm' | 'ft';

export type Segment = readonly [Point, Point];

export function isUnit(value: string): value is Unit {
  return value === 'm' || value === 'ft';
}
