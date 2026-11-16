/**
 * Builds turning SVGs off the main thread: `renderSpinSvg` depth-sorts the
 * scene at 720 angles, which takes from a few milliseconds to a couple of
 * seconds, and the editor should stay responsive meanwhile.
 *
 * Import maps do not apply inside workers, so the library is loaded by a
 * URL relative to this file instead of by its package name.
 */
import type { Scene, SpinOptions } from '@zpup/core';

export interface SpinRequest {
  readonly id: number;
  readonly scene: Scene;
  readonly options: SpinOptions;
}

export type SpinResponse =
  | { readonly id: number; readonly svg: string; readonly ms: number }
  | { readonly id: number; readonly error: string };

type Zpup = typeof import('@zpup/core');
const zpup: Promise<Zpup> = import(new URL('./lib/index.js', import.meta.url).href);

self.addEventListener('message', async (event: MessageEvent<SpinRequest>) => {
  const { id, scene, options } = event.data;
  let response: SpinResponse;
  try {
    const { renderSpinSvg } = await zpup;
    const start = performance.now();
    const svg = renderSpinSvg(scene, options);
    response = { id, svg, ms: performance.now() - start };
  } catch (e) {
    response = { id, error: e instanceof Error ? e.message : String(e) };
  }
  self.postMessage(response);
});
