import type { CV, Mat } from './opencv';
import type { Point, Quad, Segment } from './types';

const WIDTH_DIVISIONS = 8;

/**
 * Computes the perspective grid overlay for the current quad, in image
 * pixel coordinates.
 *
 * The homography is built with OpenCV from the rectified plane — the
 * rectangle (0,0), (1,0), (1,aspect), (0,aspect), i.e. the known width
 * normalised to 1 — onto the four image pins. Evenly spaced grid lines on
 * that flat plane are then mapped through it with cv.perspectiveTransform,
 * which is what makes the overlay converge correctly toward the vanishing
 * points.
 */
export function perspectiveGridSegments(cv: CV, quad: Quad, aspect: number): Segment[] {
  const heightDivisions = Math.min(24, Math.max(1, Math.round(WIDTH_DIVISIONS * aspect)));

  // Rectified-plane endpoints of every interior grid line: (x, y) pairs.
  const planePoints: number[] = [];
  for (let i = 1; i < WIDTH_DIVISIONS; i++) {
    const x = i / WIDTH_DIVISIONS;
    planePoints.push(x, 0, x, aspect);
  }
  for (let j = 1; j < heightDivisions; j++) {
    const y = (j / heightDivisions) * aspect;
    planePoints.push(0, y, 1, y);
  }
  if (planePoints.length === 0) {
    return [];
  }

  const mats: Mat[] = [];
  try {
    const src = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1, 0, 1, aspect, 0, aspect]);
    mats.push(src);
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
      quad.tl.x, quad.tl.y,
      quad.tr.x, quad.tr.y,
      quad.br.x, quad.br.y,
      quad.bl.x, quad.bl.y,
    ]);
    mats.push(dst);

    const homography = cv.getPerspectiveTransform(src, dst);
    mats.push(homography);

    const pointCount = planePoints.length / 2;
    const planeMat = cv.matFromArray(pointCount, 1, cv.CV_32FC2, planePoints);
    mats.push(planeMat);
    const imageMat = new cv.Mat();
    mats.push(imageMat);
    cv.perspectiveTransform(planeMat, imageMat, homography);

    const data = imageMat.data32F;
    const segments: Segment[] = [];
    for (let i = 0; i + 3 < data.length; i += 4) {
      const a: Point = { x: data[i] ?? 0, y: data[i + 1] ?? 0 };
      const b: Point = { x: data[i + 2] ?? 0, y: data[i + 3] ?? 0 };
      segments.push([a, b]);
    }
    return segments;
  } finally {
    for (const mat of mats) {
      mat.delete();
    }
  }
}
