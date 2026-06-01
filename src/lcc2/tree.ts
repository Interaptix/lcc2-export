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
  walk(manifest.root, 0);

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxDepth = depths.length ? Math.max(...depths) : 0;

  const levels: LodLevel[] = depths.map((depth) => {
    const e = byDepth.get(depth)!;
    const segmentPaths = [...e.files]
      .sort((a, b) => a - b)
      .map(i => resolve(rootDir, manifest.root.splatFiles[i]));
    return { lodIndex: maxDepth - depth, depth, segmentPaths, expectedSplatCount: e.count };
  }).sort((a, b) => a.lodIndex - b.lodIndex);

  const envFileIndex = manifest.root.data?.env?.name ?? null;
  return { levels, envFileIndex };
};
