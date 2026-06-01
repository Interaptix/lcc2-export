import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseManifest } from '../src/lcc2/manifest.js';

const writeManifest = async (obj: unknown) => {
  const dir = await mkdtemp(join(tmpdir(), 'lcc2-man-'));
  const p = join(dir, 'scene.lcc2');
  await writeFile(p, JSON.stringify(obj));
  return { dir, p };
};

describe('parseManifest', () => {
  it('parses a valid manifest', async () => {
    const { dir, p } = await writeManifest({
      version: '0.0.3', totalLevels: 1, lodSplats: [3], splatType: '.sog',
      root: { id: '0', childNum: 0, splatFiles: ['data/3dgs/0_0.sog'], data: { env: { name: 0 } } }
    });
    try {
      const m = parseManifest(p);
      expect(m.totalLevels).toBe(1);
      expect(m.root.splatFiles[0]).toBe('data/3dgs/0_0.sog');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('throws when root.splatFiles is missing', async () => {
    const { dir, p } = await writeManifest({ version: '0.0.3', totalLevels: 1, lodSplats: [], root: { id: '0', childNum: 0 } });
    try {
      expect(() => parseManifest(p)).toThrow(/splatFiles/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('throws when root is missing', async () => {
    const { dir, p } = await writeManifest({ version: '0.0.3', totalLevels: 1, lodSplats: [] });
    try {
      expect(() => parseManifest(p)).toThrow(/missing "root"/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('throws when lodSplats is not an array', async () => {
    const { dir, p } = await writeManifest({
      version: '0.0.3', totalLevels: 1,
      root: { id: '0', childNum: 0, splatFiles: [] }
    });
    try {
      expect(() => parseManifest(p)).toThrow(/missing "lodSplats"/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
