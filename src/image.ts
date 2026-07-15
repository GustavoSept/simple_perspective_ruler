import { Observable } from 'rxjs';
import type { LoadedImage } from './types';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

/**
 * Decodes an image file, downscaling to fit within Full HD if necessary.
 * Emits one LoadedImage and completes; errors if the file cannot be decoded.
 */
export function loadImageFromFile(file: File): Observable<LoadedImage> {
  return new Observable<LoadedImage>((subscriber) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = (): void => {
      const scale = Math.min(1, MAX_WIDTH / img.naturalWidth, MAX_HEIGHT / img.naturalHeight);
      if (scale < 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const ctx = canvas.getContext('2d');
        if (ctx === null) {
          subscriber.error(new Error('Could not create a 2D context to downscale the image'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        subscriber.next({
          source: canvas,
          width: canvas.width,
          height: canvas.height,
          fileName: file.name,
        });
      } else {
        subscriber.next({
          source: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
          fileName: file.name,
        });
      }
      subscriber.complete();
    };

    img.onerror = (): void => {
      subscriber.error(new Error(`Could not decode "${file.name}" as an image`));
    };

    img.src = url;
    return (): void => URL.revokeObjectURL(url);
  });
}
