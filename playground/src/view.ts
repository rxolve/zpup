/**
 * The view the reader turns by dragging. It is an offset added to the
 * scene's own `rotate`, so the scene in the editor never changes.
 */
import type { Scene } from '@zpup/core';

/** Degrees added to the scene's `rotate.x` (tilt) and `rotate.y` (turn). */
export interface ViewOffset {
  readonly x: number;
  readonly y: number;
}

export const NO_OFFSET: ViewOffset = { x: 0, y: 0 };

/** Degrees of turn per pixel dragged. */
export const DEGREES_PER_PIXEL = 0.5;

/** Wraps an angle into [-180, 180). */
export function wrapDegrees(angle: number): number {
  const wrapped = ((((angle + 180) % 360) + 360) % 360) - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

export function isNoOffset(offset: ViewOffset): boolean {
  return offset.x === 0 && offset.y === 0;
}

/**
 * The offset after dragging by (dx, dy) screen pixels from `start`.
 * Dragging right turns the front of the scene to the right (rotate.y grows);
 * dragging down tips its top toward the viewer (rotate.x shrinks).
 * The tilt is kept so that the scene's total `rotate.x` stays within
 * [-90, 90], or within the scene's own tilt if that is already further out:
 * past straight down or straight up, dragging would turn the picture upside
 * down, which is hard to undo by hand.
 */
export function dragOffset(start: ViewOffset, dx: number, dy: number, baseTilt = 0): ViewOffset {
  const min = Math.min(-90, baseTilt);
  const max = Math.max(90, baseTilt);
  const tilt = Math.min(max, Math.max(min, baseTilt + start.x - dy * DEGREES_PER_PIXEL));
  return { x: tilt - baseTilt, y: wrapDegrees(start.y + dx * DEGREES_PER_PIXEL) };
}

/** The scene's `rotate` with the offset added. */
export function viewRotation(
  scene: Scene,
  offset: ViewOffset,
): { x: number; y: number; z: number } {
  const r = scene.rotate ?? {};
  return {
    x: (r.x ?? 0) + offset.x,
    y: wrapDegrees((r.y ?? 0) + offset.y),
    z: r.z ?? 0,
  };
}

/** The scene as seen with the offset. Returns the same object when there is no offset. */
export function applyView(scene: Scene, offset: ViewOffset): Scene {
  if (isNoOffset(offset)) return scene;
  return { ...scene, rotate: viewRotation(scene, offset) };
}

/**
 * How far a `renderSpinSvg` animation about y has turned after `elapsedMs`,
 * in degrees within [0, 360). Used to pick up a turning picture at the angle
 * it shows when the reader grabs it.
 */
export function spinAngleAt(elapsedMs: number, durationSeconds: number): number {
  const turns = elapsedMs / 1000 / durationSeconds;
  return (turns - Math.floor(turns)) * 360;
}
