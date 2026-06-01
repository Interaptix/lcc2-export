import { resolve } from 'node:path';
import type { Lcc2Manifest, Lcc2Node, LodLevel } from '../types.js';

/** Group splat segments by tree depth (= LOD level). lodIndex 0 = finest (deepest). */
export const planLods = (
  manifest: Lcc2Manifest,
  rootDir: string
): { levels: LodLevel[]; envFileIndex: number | null } => {
  const byDepth = new Map<number, { files: Set<number>; count: number }>();

  const walk = (node: Lcc2Node, depth: number): void => {
    const g = node.data?.['3dgs'];
    if (g && typeof g.name === 'number') {
      let e = byDepth.get(depth);
      if (!e) { e = { files: new Set(), count: 0 }; byDepth.set(depth, e); }
      e.files.add(g.name);
      e.count += g.count ?? 0;
    }
    if (node.child) for (const c of Object.values(node.child)) walk(c, depth + 1);
  };
  // Root carries data.env but never data['3dgs'] (LCC2 spec), so depth 0 is absent from output; a tree with no 3dgs nodes yields zero levels.
  walk(manifest.root, 0);

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxDepth = depths.length ? Math.max(...depths) : 0;

  const splatFiles = manifest.root.splatFiles;
  const resolveIndex = (i: number, noun: string, ctx = ''): string => {
    const rel = splatFiles[i];
    if (rel == null) {
      throw new Error(`LCC2 manifest: ${noun} index ${i}${ctx} is out of range of splatFiles (length ${splatFiles.length})`);
    }
    return resolve(rootDir, rel);
  };

  const levels: LodLevel[] = depths.map((depth) => {
    const e = byDepth.get(depth)!;
    const segmentPaths = [...e.files]
      .sort((a, b) => a - b)
      .map(i => resolveIndex(i, 'segment file', ` (LOD depth ${depth})`));
    return { lodIndex: maxDepth - depth, depth, segmentPaths, expectedSplatCount: e.count };
  }).sort((a, b) => a.lodIndex - b.lodIndex);

  // Sanity check (spec §3.2): each level's summed splat count must match the manifest's
  // advertised lodSplats[lodIndex]. Lenient when lodSplats lacks an entry (version drift).
  for (const lvl of levels) {
    const advertised = manifest.lodSplats[lvl.lodIndex];
    if (typeof advertised === 'number' && advertised !== lvl.expectedSplatCount) {
      throw new Error(`LCC2 manifest inconsistency: LOD ${lvl.lodIndex} (depth ${lvl.depth}) sums to ${lvl.expectedSplatCount} splats but lodSplats[${lvl.lodIndex}] = ${advertised}`);
    }
  }

  const envFileIndex = manifest.root.data?.env?.name ?? null;
  if (envFileIndex != null) resolveIndex(envFileIndex, 'env splat');
  return { levels, envFileIndex };
};
