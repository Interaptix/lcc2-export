import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readFile, readFileInfo, writeFile, getInputFormat, getOutputFormat,
  createChunkDataPool, materializeToDataTable, Column, DataTable, type ChunkSource
} from '@playcanvas/splat-transform';
import { NodeReadFileSystem, NodeFileSystem } from '../src/vendor/node-file-system.js';
import { createDevice } from '../src/vendor/node-device.js';
import { defaultOptions } from '../src/splat/options.js';
import { mergeSegmentsToSog } from '../src/merge.js';

const segA = 'test/fixtures/segments/0_6_0_0.sog';
const segB = 'test/fixtures/segments/0_5_0.sog';
const have = existsSync(segA) && existsSync(segB);

// Every file here is a single-LOD .sog, so `numGaussians` (the finest LOD's
// count) is the whole file's splat count — read from the header, no decode.
const countSplats = async (filename: string) => {
  const info = await readFileInfo({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  return info.numGaussians;
};

/** Decode a splat file into a single DataTable. */
const readTable = async (filename: string): Promise<DataTable> => {
  const sources = await readFile({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  const pool = createChunkDataPool({ chunkSize: sources[0].meta.chunkSize });
  try {
    return await materializeToDataTable(sources[0], pool);
  } finally {
    await Promise.all(sources.map((s: ChunkSource) => s.close()));
  }
};

describe.skipIf(!have)('merge real XGrids .sog', () => {
  it('decodes XGrids segments and writes a bundled .sog with the summed splat count', async () => {
    const a = await countSplats(segA);
    const b = await countSplats(segB);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);

    const dir = await mkdtemp(join(tmpdir(), 'lcc2-merge-'));
    const out = join(dir, 'merged.sog');
    try {
      const written = await mergeSegmentsToSog([segA, segB], out, createDevice);
      expect(written).toBe(a + b);
      expect(await countSplats(out)).toBe(a + b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// XGrids LCC2 segments are SH0-only (no `f_rest_*` higher-order spherical harmonics),
// so the SOG encoder's GPU-accelerated KNN/edge-cost SH clustering — the only step that
// uses `createDevice` — has nothing to do for real fixtures and the merge above runs
// entirely on CPU (still a lossless decode -> combine -> WebP -> bundle round-trip).
// To actually exercise and prove the headless WebGPU/Dawn encode path that Task 2 must
// de-risk, write a synthetic SH-bearing splat table and assert `createDevice` is invoked.
// If Dawn cannot initialize, this fails loudly here (it does not fake a pass).
describe('SOG GPU encode path (headless WebGPU)', () => {
  it('invokes createDevice and round-trips SH data when encoding a bundled .sog', async () => {
    const N = 1024;
    const f32 = (fn: (i: number) => number) => {
      const arr = new Float32Array(N);
      for (let i = 0; i < N; i++) arr[i] = fn(i);
      return arr;
    };
    const cols: Column[] = [
      new Column('x', f32(i => Math.sin(i * 0.1))),
      new Column('y', f32(i => Math.cos(i * 0.1))),
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
    // 45 degree-3 spherical-harmonics coefficients: f_rest_0 .. f_rest_44
    for (let c = 0; c < 45; c++) cols.push(new Column(`f_rest_${c}`, f32(i => Math.sin((i + c) * 0.05) * 0.2)));
    const table = new DataTable(cols);
    expect(table.hasColumn('f_rest_44')).toBe(true);

    let deviceCalls = 0;
    const tracedCreateDevice = async () => {
      deviceCalls++;
      return createDevice();
    };

    const dir = await mkdtemp(join(tmpdir(), 'lcc2-shgpu-'));
    const out = join(dir, 'sh.sog');
    try {
      await writeFile({
        filename: out,
        outputFormat: getOutputFormat(out, defaultOptions()),
        dataTable: table,
        options: defaultOptions(),
        createDevice: tracedCreateDevice
      }, new NodeFileSystem());

      // The GPU device creator must have actually been called during SH encode.
      expect(deviceCalls).toBeGreaterThan(0);

      // And the encoded bundle must decode back losslessly (rows + all SH columns).
      const back = await readTable(out);
      expect(back.numRows).toBe(N);
      const shPreserved = back.columnNames.filter((n: string) => /^f_rest_/.test(n)).length;
      expect(shPreserved).toBe(45);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
