import { describe, it, expect } from 'vitest';
import { planLods } from '../src/lcc2/tree.js';
import type { Lcc2Manifest } from '../src/types.js';

const manifest: Lcc2Manifest = {
  version: '0.0.3', totalLevels: 3,
  // lodSplats is finest->coarsest: [depth3=1, depth2=3, depth1=5]
  lodSplats: [1, 3, 5], splatType: '.sog',
  root: {
    id: '0', childNum: 1, splatFiles: ['f0.sog', 'f1.sog', 'f2.sog', 'env.sog'],
    data: { env: { name: 3 } },
    child: {
      '0': {
        id: '0_0', childNum: 2, data: { '3dgs': { name: 0, start: 0, count: 5 } },
        child: {
          '0': {
            id: '0_0_0', childNum: 1, data: { '3dgs': { name: 1, start: 0, count: 2 } },
            child: { '0': { id: '0_0_0_0', childNum: 0, data: { '3dgs': { name: 2, start: 0, count: 1 } } } }
          },
          '1': { id: '0_0_1', childNum: 0, data: { '3dgs': { name: 1, start: 2, count: 1 } } }
        }
      }
    }
  }
};

describe('planLods', () => {
  it('groups segments by depth with lodIndex 0 = finest, and resolves paths', () => {
    const { levels, envFileIndex } = planLods(manifest, '/root');
    expect(envFileIndex).toBe(3);
    expect(levels.map(l => l.lodIndex)).toEqual([0, 1, 2]);

    const byLod = Object.fromEntries(levels.map(l => [l.lodIndex, l]));
    // lod0 = deepest depth 3 = file 2, count 1
    expect(byLod[0].depth).toBe(3);
    expect(byLod[0].segmentPaths).toEqual(['/root/f2.sog']);
    expect(byLod[0].expectedSplatCount).toBe(1);
    // lod1 = depth 2 = file 1, counts 2+1 = 3
    expect(byLod[1].segmentPaths).toEqual(['/root/f1.sog']);
    expect(byLod[1].expectedSplatCount).toBe(3);
    // lod2 = depth 1 = file 0, count 5
    expect(byLod[2].segmentPaths).toEqual(['/root/f0.sog']);
    expect(byLod[2].expectedSplatCount).toBe(5);
  });

  it('per-level counts equal lodSplats[lodIndex]', () => {
    const { levels } = planLods(manifest, '/root');
    for (const l of levels) expect(l.expectedSplatCount).toBe(manifest.lodSplats[l.lodIndex]);
  });

  it('returns no levels for a tree with no 3dgs nodes', () => {
    const empty: Lcc2Manifest = {
      version: '0.0.3', totalLevels: 0, lodSplats: [], splatType: '.sog',
      root: { id: '0', childNum: 0, splatFiles: ['env.sog'], data: { env: { name: 0 } } }
    };
    const { levels, envFileIndex } = planLods(empty, '/root');
    expect(levels).toEqual([]);
    expect(envFileIndex).toBe(0);
  });

  it('throws a named error when a 3dgs segment index is out of range of splatFiles', () => {
    const badSeg: Lcc2Manifest = {
      version: '0.0.3', totalLevels: 1, lodSplats: [5], splatType: '.sog',
      root: {
        id: '0', childNum: 1, splatFiles: ['f0.sog'],
        child: { '0': { id: '0_0', childNum: 0, data: { '3dgs': { name: 9, start: 0, count: 5 } } } }
      }
    };
    expect(() => planLods(badSeg, '/root')).toThrow(/segment file index 9 .* out of range/);
  });

  it('throws a named error when the env index is out of range of splatFiles', () => {
    const badEnv: Lcc2Manifest = {
      version: '0.0.3', totalLevels: 1, lodSplats: [5], splatType: '.sog',
      root: {
        id: '0', childNum: 1, splatFiles: ['f0.sog'], data: { env: { name: 7 } },
        child: { '0': { id: '0_0', childNum: 0, data: { '3dgs': { name: 0, start: 0, count: 5 } } } }
      }
    };
    expect(() => planLods(badEnv, '/root')).toThrow(/env splat index 7 .* out of range/);
  });

  it('throws when a level splat sum disagrees with lodSplats (manifest sanity check)', () => {
    const mismatch: Lcc2Manifest = {
      version: '0.0.3', totalLevels: 1, lodSplats: [99], splatType: '.sog',
      root: {
        id: '0', childNum: 1, splatFiles: ['f0.sog'],
        child: { '0': { id: '0_0', childNum: 0, data: { '3dgs': { name: 0, start: 0, count: 5 } } } }
      }
    };
    expect(() => planLods(mismatch, '/root')).toThrow(/inconsistency/);
  });
});
