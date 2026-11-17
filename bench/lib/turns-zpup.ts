/**
 * The zpup side of the turn-error check (see turns.ts): a scene's pieces as
 * painted primitives, in the order zpup's still renderer paints them.
 */
import { depthOrder } from '../../src/depth.ts';
import type { Vec3 } from '../../src/math.ts';
import {
  compilePieces,
  depthShapes,
  type Piece,
  paintedColor,
  visiblePieces,
} from '../../src/pieces.ts';
import type { NormalizedScene } from '../../src/validate.ts';
import {
  checkView,
  GRID_STEP,
  type Primitive,
  summarizeViews,
  TURN_OFFSETS_DEG,
  type TurnErrors,
} from './turns.ts';

/**
 * The primitives of one view, back to front. The order is the one
 * `compileNormalized` paints (the same pieces, the same `depthOrder` call);
 * joining consecutive pieces into one path, which it also does, does not
 * change what is painted over what.
 */
export function zpupPrimitives(s: NormalizedScene, rotate: Vec3 = s.rotate): Primitive[] {
  const pieces = visiblePieces(compilePieces(s, rotate));
  const order = depthOrder(depthShapes(pieces));
  return order.map((i) => toPrimitive(pieces[i] as Piece));
}

function toPrimitive(p: Piece): Primitive {
  const color = paintedColor(p);
  const points = p.points;
  // A face of a solid: its area only. Touching solids overlap by their
  // rounded edges on purpose, so those edges are left out.
  if (p.solid !== undefined) {
    return {
      color,
      fill: p.surface ? { rings: [points], solid: p.surface } : { rings: [points] },
    };
  }
  const closed = p.geometry.closed && points.length > 2;
  return {
    color,
    ...(p.fill && points.length >= 3 ? { fill: { rings: [points] } } : {}),
    ...(p.stroke > 0
      ? {
          stroke: {
            radius: p.stroke / 2,
            lines: [closed ? [...points, points[0] as Vec3] : points],
          },
        }
      : {}),
  };
}

/** Checks a valid scene at its own view and at every turn in `TURN_OFFSETS_DEG`. */
export function zpupTurnErrors(s: NormalizedScene): TurnErrors | undefined {
  return summarizeViews(
    TURN_OFFSETS_DEG.map((offsetDeg) => {
      const rotate = { ...s.rotate, y: s.rotate.y + offsetDeg };
      return {
        offsetDeg,
        count: checkView(zpupPrimitives(s, rotate), s, GRID_STEP),
        excluded: 0,
      };
    }),
  );
}
