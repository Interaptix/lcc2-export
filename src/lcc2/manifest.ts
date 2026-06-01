import { readFileSync } from 'node:fs';
import type { Lcc2Manifest } from '../types.js';

/** Read + parse an LCC2 manifest. Accepts any `version`; ignores unknown fields (per spec). */
export const parseManifest = (manifestPath: string): Lcc2Manifest => {
  const raw = readFileSync(manifestPath, 'utf8');
  const m = JSON.parse(raw) as Partial<Lcc2Manifest>;
  if (!m.root || typeof m.root !== 'object') {
    throw new Error(`Invalid LCC2 manifest (missing "root"): ${manifestPath}`);
  }
  if (!Array.isArray(m.root.splatFiles)) {
    throw new Error(`Invalid LCC2 manifest (missing "root.splatFiles"): ${manifestPath}`);
  }
  if (!Array.isArray(m.lodSplats)) {
    throw new Error(`Invalid LCC2 manifest (missing "lodSplats"): ${manifestPath}`);
  }
  return m as Lcc2Manifest;
};
