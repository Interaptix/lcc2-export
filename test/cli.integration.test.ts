import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile as writeTextFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readFileInfo, writeFile, getInputFormat, getOutputFormat, Column, DataTable
} from '@playcanvas/splat-transform';
import { NodeReadFileSystem, NodeFileSystem } from '../src/vendor/node-file-system.js';
import { createDevice } from '../src/vendor/node-device.js';
import { defaultOptions } from '../src/splat/options.js';
import { main } from '../src/cli.js';
import type { Lcc2Manifest } from '../src/types.js';

// Wrap the real Dawn device creator in a spy so the tests below can count how
// many GPU devices a `main()` run actually creates.
vi.mock('../src/vendor/node-device.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/vendor/node-device.js')>();
  return { ...mod, createDevice: vi.fn(mod.createDevice) };
});

const SAMPLE = 'output_lcc2.zip';
const have = existsSync(SAMPLE);

// Each exported file is a single-LOD .sog, so `numGaussians` (the finest LOD's
// count) is the whole file's splat count — read from the header, no decode.
const fileInfo = async (filename: string) => readFileInfo({
  filename, inputFormat: getInputFormat(filename),
  options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
});
const countSplats = async (filename: string) => (await fileInfo(filename)).numGaussians;

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

/** Synthetic degree-3 SH splat table (45 `f_rest_*` columns) of `n` rows. */
const makeSh3Table = (n: number, seed: number): DataTable => {
  const f32 = (fn: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => fn(i));
  const cols: Column[] = [
    new Column('x', f32(i => Math.sin((i + seed) * 0.1))),
    new Column('y', f32(i => Math.cos((i + seed) * 0.1))),
    new Column('z', f32(i => (i % 16) * 0.05)),
    new Column('scale_0', f32(() => -3)),
    new Column('scale_1', f32(() => -3)),
    new Column('scale_2', f32(() => -3)),
    new Column('rot_0', f32(() => 1)),
    new Column('rot_1', f32(() => 0)),
    new Column('rot_2', f32(() => 0)),
    new Column('rot_3', f32(() => 0)),
    new Column('f_dc_0', f32(i => (i % 7) * 0.1)),
    new Column('f_dc_1', f32(i => (i % 5) * 0.1)),
    new Column('f_dc_2', f32(i => (i % 3) * 0.1)),
    new Column('opacity', f32(() => 2))
  ];
  for (let c = 0; c < 45; c++) cols.push(new Column(`f_rest_${c}`, f32(i => Math.sin((i + c + seed) * 0.05) * 0.2)));
  return new DataTable(cols);
};

/**
 * Write a two-level LCC2 folder whose segments both carry SH3, so every level's
 * SOG encode goes through the GPU k-means path. Segments are encoded here on the
 * CPU (no `createDevice`) so fixture creation doesn't count as a device use.
 */
const writeSh3Lcc2 = async (root: string, counts: { fine: number; coarse: number }) => {
  const segDir = join(root, 'data', '3dgs');
  await mkdir(segDir, { recursive: true });
  const seg = async (name: string, n: number, seed: number) => {
    const filename = join(segDir, name);
    await writeFile({
      filename, outputFormat: getOutputFormat(filename, defaultOptions()),
      dataTable: makeSh3Table(n, seed), options: defaultOptions()
    }, new NodeFileSystem());
  };
  await seg('coarse.sog', counts.coarse, 0);
  await seg('fine.sog', counts.fine, 1000);

  const manifest: Lcc2Manifest = {
    version: '0.0.3', splatType: '.sog', totalLevels: 2,
    // lodIndex 0 = finest = deepest node.
    lodSplats: [counts.fine, counts.coarse],
    root: {
      id: '0', childNum: 1, splatFiles: ['data/3dgs/coarse.sog', 'data/3dgs/fine.sog'],
      child: {
        '0': {
          id: '0_0', childNum: 1, data: { '3dgs': { name: 0, start: 0, count: counts.coarse } },
          child: { '0': { id: '0_0_0', childNum: 0, data: { '3dgs': { name: 1, start: 0, count: counts.fine } } } }
        }
      }
    }
  };
  await writeTextFile(join(root, 'scene.lcc2'), JSON.stringify(manifest));
};

// Regression: splat-transform's SOG writer calls `createDevice()` on every write
// that carries SH bands. Handing it the raw creator meant a fresh Dawn instance
// per LOD, and the second one segfaulted the process mid-write (no JS error, an
// orphaned `.lodN.sog.*.tmp` left behind). `main()` must share one device across
// all levels. Needs a working WebGPU adapter, like the GPU test in merge.integration.
describe('cli shares one GPU device across SH-bearing LOD levels', () => {
  it('creates a single device for a multi-level SH3 export and keeps SH3 in every output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lcc2-shdev-'));
    const inDir = join(dir, 'in');
    const outDir = join(dir, 'out');
    try {
      await writeSh3Lcc2(inDir, { fine: 2048, coarse: 1024 });
      vi.mocked(createDevice).mockClear();

      await main([inDir, outDir]);

      expect(createDevice).toHaveBeenCalledTimes(1);
      const lod0 = await fileInfo(join(outDir, 'lod0.sog'));
      const lod1 = await fileInfo(join(outDir, 'lod1.sog'));
      expect(lod0.numGaussians).toBe(2048);
      expect(lod1.numGaussians).toBe(1024);
      expect(lod0.shBands).toBe(3);
      expect(lod1.shBands).toBe(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
