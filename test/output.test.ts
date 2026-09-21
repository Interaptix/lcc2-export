import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveOutputDir, lodFileName, copyEnv } from '../src/output.js';

// Expectations go through `resolve`/`join` so they hold on both POSIX and
// Windows, where the helpers' own `resolve`/`join` yield `D:\...` separators.
describe('output helpers', () => {
  it('defaults output dir to a sibling _sog folder', () => {
    expect(resolveOutputDir('/data/output_lcc2.zip', undefined)).toBe(resolve('/data/output_lcc2_sog'));
    expect(resolveOutputDir('/data/lcc2-result/', undefined)).toBe(resolve('/data/lcc2-result_sog'));
  });

  it('honors an explicit output arg', () => {
    expect(resolveOutputDir('/data/x.zip', '/out/here')).toBe(resolve('/out/here'));
  });

  it('names lod files by index', () => {
    expect(lodFileName('/out', 0)).toBe(join('/out', 'lod0.sog'));
    expect(lodFileName('/out', 3)).toBe(join('/out', 'lod3.sog'));
  });

  it('copies env.sog byte-for-byte', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lcc2-out-'));
    const src = join(dir, 'env.sog');
    const outDir = join(dir, 'out');
    await writeFile(src, Buffer.from([1, 2, 3, 4]));
    try {
      await copyEnv(src, outDir);
      expect([...await readFile(join(outDir, 'env.sog'))]).toEqual([1, 2, 3, 4]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
