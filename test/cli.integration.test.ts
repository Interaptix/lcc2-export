import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, getInputFormat, DataTable } from '@playcanvas/splat-transform';
import { NodeReadFileSystem } from '../src/vendor/node-file-system.js';
import { defaultOptions } from '../src/splat/options.js';
import { main } from '../src/cli.js';

const SAMPLE = 'output_lcc2.zip';
const have = existsSync(SAMPLE);

const countSplats = async (filename: string) => {
  const tables = await readFile({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  return tables.reduce((n: number, t: DataTable) => n + t.numRows, 0);
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
