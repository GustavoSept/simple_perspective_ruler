import {
  BehaviorSubject,
  EMPTY,
  Observable,
  animationFrameScheduler,
  auditTime,
  catchError,
  combineLatest,
  distinctUntilChanged,
  filter,
  finalize,
  fromEvent,
  map,
  merge,
  of,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  withLatestFrom,
} from 'rxjs';

import {
  canvasToImage,
  clampToImage,
  defaultQuad,
  estimateAspect,
  fitTransform,
  hitTestHandle,
  withCorner,
} from './geometry';
import { perspectiveGridSegments } from './grid';
import { loadImageFromFile } from './image';
import { cv$ } from './opencv';
import type { CV } from './opencv';
import { drawScene } from './render';
import type { Corner, LoadedImage, Point, Quad, Segment, Unit, ViewportSize } from './types';
import { isUnit } from './types';

const HIT_RADIUS = 18;

type CvState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly cv: CV }
  | { readonly kind: 'error'; readonly message: string };

interface DragStart {
  readonly event: PointerEvent;
  readonly corner: Corner;
  readonly image: LoadedImage;
}

interface DragMove {
  readonly corner: Corner;
  readonly point: Point;
}

function requireElement<T extends HTMLElement>(id: string, type: new () => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Expected #${id} to be a ${type.name}`);
  }
  return element;
}

function eventToCanvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Emits the element's CSS-pixel size (plus DPR) on every resize. */
function observeSize(element: Element): Observable<ViewportSize> {
  return new Observable<ViewportSize>((subscriber) => {
    const emit = (): void => {
      const rect = element.getBoundingClientRect();
      subscriber.next({
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        dpr: window.devicePixelRatio || 1,
      });
    };
    const observer = new ResizeObserver(emit);
    observer.observe(element);
    emit();
    return (): void => observer.disconnect();
  });
}

function formatLength(value: number): string {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function main(): void {
  const fileInput = requireElement('file-input', HTMLInputElement);
  const widthInput = requireElement('width-input', HTMLInputElement);
  const unitSelect = requireElement('unit-select', HTMLSelectElement);
  const heightOutput = requireElement('height-output', HTMLOutputElement);
  const statusEl = requireElement('status', HTMLSpanElement);
  const viewportEl = requireElement('viewport', HTMLElement);
  const canvas = requireElement('canvas', HTMLCanvasElement);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Canvas 2D is not supported in this browser');
  }

  // ---- OpenCV lifecycle -------------------------------------------------
  const cvState$: Observable<CvState> = cv$.pipe(
    map((cv): CvState => ({ kind: 'ready', cv })),
    startWith<CvState>({ kind: 'loading' }),
    catchError((error: unknown) =>
      of<CvState>({
        kind: 'error',
        message: error instanceof Error ? error.message : 'OpenCV.js failed to load',
      }),
    ),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  // ---- Input streams ----------------------------------------------------
  const imageError$ = new BehaviorSubject<string | null>(null);

  const image$: Observable<LoadedImage | null> = fromEvent(fileInput, 'change').pipe(
    map(() => fileInput.files?.[0] ?? null),
    filter((file): file is File => file !== null),
    switchMap((file) =>
      loadImageFromFile(file).pipe(
        catchError((error: unknown) => {
          imageError$.next(error instanceof Error ? error.message : 'Could not load the image');
          return EMPTY;
        }),
      ),
    ),
    startWith(null),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  const knownWidth$: Observable<number | null> = fromEvent(widthInput, 'input').pipe(
    map(() => widthInput.valueAsNumber),
    startWith(widthInput.valueAsNumber),
    map((value) => (Number.isFinite(value) && value > 0 ? value : null)),
    distinctUntilChanged(),
  );

  const unit$: Observable<Unit> = fromEvent(unitSelect, 'change').pipe(
    map(() => unitSelect.value),
    startWith(unitSelect.value),
    filter(isUnit),
    distinctUntilChanged(),
  );

  const viewport$ = observeSize(viewportEl).pipe(
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  // ---- Pin state: reset to a default trapezoid whenever an image loads --
  const quad$ = new BehaviorSubject<Quad | null>(null);
  image$
    .pipe(filter((image): image is LoadedImage => image !== null))
    .subscribe((image) => {
      imageError$.next(null);
      quad$.next(defaultQuad(image.width, image.height));
    });

  // ---- Drag stream: pointerdown → switchMap(move) → takeUntil(up) -------
  const pointerDown$ = fromEvent<PointerEvent>(canvas, 'pointerdown');
  const pointerMove$ = fromEvent<PointerEvent>(window, 'pointermove');
  const pointerEnd$ = merge(
    fromEvent<PointerEvent>(window, 'pointerup'),
    fromEvent<PointerEvent>(window, 'pointercancel'),
  );

  const dragCorner$ = new BehaviorSubject<Corner | null>(null);

  const drag$: Observable<DragMove> = pointerDown$.pipe(
    withLatestFrom(image$, quad$, viewport$),
    map(([event, image, quad, viewport]): DragStart | null => {
      if (image === null || quad === null) {
        return null;
      }
      const view = fitTransform(image.width, image.height, viewport.width, viewport.height);
      const corner = hitTestHandle(quad, view, eventToCanvasPoint(event, canvas), HIT_RADIUS);
      return corner === null ? null : { event, corner, image };
    }),
    filter((start): start is DragStart => start !== null),
    switchMap(({ event, corner, image }) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      dragCorner$.next(corner);
      return pointerMove$.pipe(
        startWith(event),
        withLatestFrom(viewport$),
        map(([move, viewport]): DragMove => {
          const view = fitTransform(image.width, image.height, viewport.width, viewport.height);
          const point = canvasToImage(view, eventToCanvasPoint(move, canvas));
          return { corner, point: clampToImage(point, image.width, image.height) };
        }),
        takeUntil(pointerEnd$),
        finalize(() => dragCorner$.next(null)),
      );
    }),
  );

  drag$.subscribe(({ corner, point }) => {
    const quad = quad$.getValue();
    if (quad !== null) {
      quad$.next(withCorner(quad, corner, point));
    }
  });

  // ---- Hover feedback ----------------------------------------------------
  const hoverCorner$: Observable<Corner | null> = fromEvent<PointerEvent>(canvas, 'pointermove').pipe(
    withLatestFrom(dragCorner$, image$, quad$, viewport$),
    map(([event, dragging, image, quad, viewport]) => {
      if (dragging !== null) {
        return dragging;
      }
      if (image === null || quad === null) {
        return null;
      }
      const view = fitTransform(image.width, image.height, viewport.width, viewport.height);
      return hitTestHandle(quad, view, eventToCanvasPoint(event, canvas), HIT_RADIUS);
    }),
    startWith<Corner | null>(null),
  );

  const activeCorner$: Observable<Corner | null> = combineLatest([dragCorner$, hoverCorner$]).pipe(
    map(([dragging, hovering]) => dragging ?? hovering),
    distinctUntilChanged(),
  );

  combineLatest([dragCorner$, activeCorner$]).subscribe(([dragging, active]) => {
    canvas.style.cursor = dragging !== null ? 'grabbing' : active !== null ? 'grab' : 'crosshair';
  });

  // ---- Status line -------------------------------------------------------
  combineLatest([cvState$, imageError$]).subscribe(([cvState, imageError]) => {
    if (imageError !== null) {
      statusEl.textContent = imageError;
      statusEl.dataset['tone'] = 'error';
    } else if (cvState.kind === 'loading') {
      statusEl.textContent = 'Loading OpenCV.js…';
      statusEl.dataset['tone'] = 'info';
    } else if (cvState.kind === 'error') {
      statusEl.textContent = cvState.message;
      statusEl.dataset['tone'] = 'error';
    } else {
      statusEl.textContent = 'OpenCV.js ready';
      statusEl.dataset['tone'] = 'ok';
    }
  });

  // ---- Calculation + render pipeline --------------------------------------
  // combineLatest over every input, audited to animation frames: each frame
  // recomputes the homography/grid via OpenCV, redraws the canvas, and
  // updates the height read-out.
  combineLatest({
    cvState: cvState$,
    image: image$,
    quad: quad$,
    knownWidth: knownWidth$,
    unit: unit$,
    viewport: viewport$,
    activeCorner: activeCorner$,
  })
    .pipe(auditTime(0, animationFrameScheduler))
    .subscribe(({ cvState, image, quad, knownWidth, unit, viewport, activeCorner }) => {
      let gridSegments: readonly Segment[] = [];
      let height: number | null = null;

      if (image !== null && quad !== null) {
        const aspect = estimateAspect(quad, image.width, image.height);
        if (aspect !== null) {
          if (knownWidth !== null) {
            height = knownWidth * aspect;
          }
          if (cvState.kind === 'ready') {
            gridSegments = perspectiveGridSegments(cvState.cv, quad, aspect);
          }
        }
      }

      drawScene(ctx, viewport, { image, quad, gridSegments, knownWidth, unit, activeCorner });
      heightOutput.textContent = height === null ? '—' : `${formatLength(height)} ${unit}`;
    });
}

main();
