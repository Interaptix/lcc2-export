import { stat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import extract from 'extract-zip';
import type { ResolvedInput } from '../types.js';

const findManifest = async (dir: string): Promise<string> => {
  const matches: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const ent of await readdir(d, { withFileTypes: true })) {
      const p = join(d, ent.name);
      if (ent.isDirectory()) await walk(p);
      else if (ent.name.toLowerCase().endsWith('.lcc2')) matches.push(p);
    }
  };
  await walk(dir);
  if (matches.length === 0) throw new Error(`No .lcc2 manifest found under: ${dir}`);
  if (matches.length > 1) throw new Error(`Multiple .lcc2 manifests found:\n${matches.join('\n')}`);
  return matches[0];
};

/** Resolve a folder or .zip to a manifest path + root dir, extracting zips to a temp dir. */
export const resolveInput = async (inputPath: string): Promise<ResolvedInput> => {
  const abs = resolve(inputPath);
  const st = await stat(abs); // throws ENOENT if missing
  let searchRoot: string;
  let cleanup = async (): Promise<void> => {};

  if (st.isFile() && abs.toLowerCase().endsWith('.zip')) {
    const tmp = await mkdtemp(join(tmpdir(), 'lcc2-'));
    cleanup = async () => { await rm(tmp, { recursive: true, force: true }); };
    try {
      await extract(abs, { dir: tmp });
    } catch (e) {
      await cleanup();
      throw e;
    }
    searchRoot = tmp;
  } else if (st.isDirectory()) {
    searchRoot = abs;
  } else {
    throw new Error(`Input must be a folder or a .zip file: ${inputPath}`);
  }

  try {
    const manifestPath = await findManifest(searchRoot);
    return { rootDir: dirname(manifestPath), manifestPath, cleanup };
  } catch (e) {
    await cleanup();
    throw e;
  }
};
