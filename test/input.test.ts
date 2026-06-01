import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
});
