import type { Options } from '@playcanvas/splat-transform';

/** Minimal valid Options object for read/write. iterations=10 matches the splat-transform CLI default. */
export const defaultOptions = (): Options => ({
  iterations: 10,
  lodSelect: [],
  unbundled: false,
  lodChunkCount: 512,
  lodChunkExtent: 16
});
