# Simple Perspective Ruler

DISCLAIMER: 100% coded by AI. Not representative of my skills.

A 100% local, single-page web app that measures a physical height (ceiling,
wall, door…) from a photo. You drag four pins onto the corners of a
real-world rectangle lying on a plane in the photo, enter the rectangle's
known horizontal width, and the app computes the physical height down that
plane.

Built with **strict TypeScript**, **RxJS** for all reactivity, raw
**HTML5 + CSS**, and **OpenCV.js** for the homography math. No frameworks.

## Running

```sh
npm install        # rxjs + dev tools (typescript, esbuild)
npm run build      # bundles src/ -> dist/app.js
npm run serve      # http://localhost:8080  (any static server works)
```

`npm run watch` rebuilds on change. `npm run typecheck` runs `tsc --noEmit`.

OpenCV.js (~11 MB) is vendored in `vendor/opencv.js` so the app runs fully
offline; if that file is missing, `index.html` falls back to the CDN build at
`https://docs.opencv.org/4.x/opencv.js`. Note: it can take a few seconds to
compile the WASM on first load — the status line in the header tracks it.

## How the measurement works

A homography from 4 point correspondences cannot by itself reveal the
rectangle's height — you would need to know the destination rectangle in
advance. Instead the app uses metric rectification (Zhang & He, *Whiteboard
scanning and image enhancement*, 2004):

1. The four pins are the projected corners of a physical rectangle.
   Assuming square pixels and the principal point at the image centre, the
   corners determine the camera focal length and the rectangle's
   **height/width aspect ratio** (`src/geometry.ts: estimateAspect`).
2. `height = knownWidth × aspect` — this drives the "Calculated height"
   read-out. On the rectified plane, the top edge spans `(0,0) → (W,0)` and
   the bottom boundary sits at `y = height`.
3. OpenCV builds the homography from that rectified rectangle onto the four
   pins (`cv.getPerspectiveTransform`) and maps evenly spaced grid lines
   through it (`cv.perspectiveTransform`), producing the perspective grid
   overlay that converges toward the vanishing points (`src/grid.ts`).

The math is unit-tested against synthetic pinhole-camera projections with
known ground truth (tilted, yawed, and fronto-parallel cases).

Accuracy tips: pick a rectangle that spans a good portion of the frame,
place pins precisely on its corners, and avoid photos with heavy lens
distortion (the model assumes an ideal pinhole camera).

## Reactivity architecture

Everything is RxJS streams (`src/main.ts`):

- **Inputs** — `fromEvent` streams for the file input, the width field, and
  the unit selector.
- **Drag** — `pointerdown` on the canvas is hit-tested against the handles,
  then `switchMap`s into `pointermove` (with `takeUntil(pointerup)`),
  updating a `BehaviorSubject<Quad>` of pin positions in image coordinates.
- **Pipeline** — `combineLatest({ cvState, image, quad, knownWidth, unit,
  viewport, activeCorner })`, audited to animation frames, is the single
  subscription that runs the OpenCV homography, redraws the canvas, and
  updates the height read-out.
- **OpenCV lifecycle** — `cv$` (`src/opencv.ts`) waits for the CDN/vendored
  script to initialise (handling both the promise-style and
  `onRuntimeInitialized`-style builds) and `shareReplay`s the runtime.

## Layout

```
index.html         page shell; loads vendor/opencv.js + dist/app.js
styles.css         raw CSS, dark theme
src/types.ts       shared domain types
src/geometry.ts    metric rectification, view transforms, hit-testing
src/opencv.ts      typed OpenCV.js surface + loader observable
src/grid.ts        perspective grid via cv.getPerspectiveTransform
src/image.ts       file -> image decoding, downscaled to <= 1920x1080
src/render.ts      canvas drawing (image, grid, edges, handles, labels)
src/main.ts        stream wiring and the render/calculation pipeline
```
