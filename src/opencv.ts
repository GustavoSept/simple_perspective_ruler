import { Observable, defer, from, map, shareReplay } from 'rxjs';

/**
 * Minimal typed surface of the OpenCV.js runtime — only what this app uses.
 * The script is loaded by index.html (vendored copy with CDN fallback);
 * this module waits for it to initialise.
 */
export interface Mat {
  delete(): void;
  readonly data32F: Float32Array;
}

export interface CV {
  readonly CV_32FC2: number;
  readonly Mat: new () => Mat;
  matFromArray(rows: number, cols: number, type: number, array: readonly number[]): Mat;
  getPerspectiveTransform(src: Mat, dst: Mat): Mat;
  perspectiveTransform(src: Mat, dst: Mat, m: Mat): void;
}

/**
 * Before Emscripten finishes booting, `cv` exposes lifecycle hooks. Newer
 * builds make the module itself *thenable*; older ones fire
 * onRuntimeInitialized.
 */
interface CVPending {
  onRuntimeInitialized?: () => void;
  then?: unknown;
}

type CVModule = CVPending & Partial<CV>;

declare global {
  interface Window {
    cv?: CVModule;
  }
}

interface Thenable {
  then(onFulfilled: (value: CVModule) => void, onRejected: (reason: unknown) => void): void;
}

function isThenable(value: CVModule): value is CVModule & Thenable {
  return typeof value.then === 'function';
}

/**
 * Emscripten modules are self-resolving thenables (emscripten issue #5820):
 * `module.then(cb)` calls `cb(module)` — with `module` itself still
 * thenable. Using such a module as a Promise resolution value makes the
 * Promise machinery adopt it over and over in an infinite microtask loop,
 * freezing the page. So the module's own `then` is removed once it has
 * resolved, and the wait promise resolves a *box* around it, never the
 * module itself.
 */
function stripThen(module: CVModule): CV {
  if (Object.prototype.hasOwnProperty.call(module, 'then')) {
    delete module.then;
  }
  return module as CV;
}

interface CVBox {
  readonly cv: CV;
}

function waitForOpenCV(timeoutMs: number): Promise<CVBox> {
  return new Promise<CVBox>((resolve, reject) => {
    let settled = false;
    const succeed = (cv: CV): void => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve({ cv });
      }
    };
    const fail = (error: Error): void => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      }
    };
    const timer = window.setTimeout(
      () => fail(new Error(`OpenCV.js did not load within ${timeoutMs / 1000}s`)),
      timeoutMs,
    );

    const poll = (): void => {
      if (settled) {
        return;
      }
      const cv = window.cv;
      if (cv === undefined) {
        window.setTimeout(poll, 100);
        return;
      }
      if (isThenable(cv)) {
        cv.then(
          (module) => succeed(stripThen(module)),
          () => fail(new Error('OpenCV.js failed to initialize')),
        );
      } else if (typeof cv.getPerspectiveTransform === 'function') {
        succeed(stripThen(cv));
      } else {
        cv.onRuntimeInitialized = (): void => succeed(stripThen(cv));
      }
    };
    poll();
  });
}

/** Emits the ready OpenCV runtime once; shared by all subscribers. */
export const cv$: Observable<CV> = defer(() => from(waitForOpenCV(30_000))).pipe(
  map((box) => box.cv),
  shareReplay({ bufferSize: 1, refCount: false }),
);
