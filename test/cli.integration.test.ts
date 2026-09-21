import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileInfo, getInputFormat } from '@playcanvas/splat-transform';
import { NodeReadFileSystem } from '../src/vendor/node-file-system.js';
import { defaultOptions } from '../src/splat/options.js';
import { main } from '../src/cli.js';

const SAMPLE = 'output_lcc2.zip';
const have = existsSync(SAMPLE);

// Each exported file is a single-LOD .sog, so `numGaussians` (the finest LOD's
// count) is the whole file's splat count — read from the header, no decode.
const countSplats = async (filename: string) => {
  const info = await readFileInfo({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  return info.numGaussians;
};

describe.skipIf(!have)('cli end-to-end on sample', () => {
  it('exports the coarsest LOD + env from the sample zip', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'lcc2-e2e-'));
    try {
      // Coarsest level in the sample is lodIndex 5 (depth 1, 305,075 splats).
      await main([SAMPLE, outDir, '--levels', '5']);
      const lod5 = join(outDir, 'lod5.sog');
      const env = join(outDir, 'env.sog');
      expect(existsSync(lod5)).toBe(true);
      expect(existsSync(env)).toBe(true);
      expect(await countSplats(lod5)).toBe(305075);
      // env.sog is copied byte-for-byte (12,308-splat environment).
      expect(await countSplats(env)).toBe(12308);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
