import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveInput } from '../src/lcc2/input.js';

describe('resolveInput', () => {
  it('finds a .lcc2 manifest nested in a subdirectory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcc2-in-'));
    const nested = join(root, 'output', 'lcc2-result');
    await mkdir(nested, { recursive: true });
    const manifestPath = join(nested, 'scene.lcc2');
    await writeFile(manifestPath, '{}');
    try {
      const r = await resolveInput(root);
      expect(r.manifestPath).toBe(manifestPath);
      expect(r.rootDir).toBe(nested);
      await r.cleanup();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('throws a clear error when no manifest exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcc2-in-'));
    try {
      await expect(resolveInput(root)).rejects.toThrow(/No \.lcc2 manifest/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('cleans up the temp dir when extracting a corrupt zip fails', async () => {
    // mkdtemp uses prefix 'lcc2-' for extraction dirs -> basename 'lcc2-XXXXXX' (no 2nd hyphen).
    // Test/helper dirs use 'lcc2-<word>-XXXXXX'. This regex isolates extraction dirs only.
    const isExtractionDir = (n: string) => /^lcc2-[^-]+$/.test(n);
    const listExtractionDirs = async () =>
      (await readdir(tmpdir())).filter(isExtractionDir);

    const work = await mkdtemp(join(tmpdir(), 'lcc2-badzip-'));
    const badZip = join(work, 'broken.zip');
    await writeFile(badZip, Buffer.from('this is not a valid zip archive'));
    const before = new Set(await listExtractionDirs());
    try {
      await expect(resolveInput(badZip)).rejects.toThrow();
      const leaked = (await listExtractionDirs()).filter(n => !before.has(n));
      expect(leaked).toEqual([]);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
