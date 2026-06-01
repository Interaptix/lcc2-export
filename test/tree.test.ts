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
});
