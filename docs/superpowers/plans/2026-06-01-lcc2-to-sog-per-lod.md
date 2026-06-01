# lcc2-export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Node/TS CLI `lcc2-export <input.zip|folder> [output]` that merges each LCC2 LOD level's `.sog` segments into one bundled `.sog` per level and copies `env.sog` through.

**Architecture:** Thin orchestrator over `@playcanvas/splat-transform`. Pure LCC2 domain logic (input resolution, manifest parse, depth→LOD grouping) feeds the splat library's `readFile`→`combine`→`writeFile` for SOG decode/merge/encode. The library's Node filesystem + WebGPU device helpers aren't exported, so we vendor 1:1 copies.

**Tech Stack:** Node ≥ 20 (ESM), TypeScript, `@playcanvas/splat-transform` v2.4.0, `playcanvas` (peer), `webgpu` (Dawn, for GPU SOG encode), `extract-zip`, `vitest`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-06-01-lcc2-to-sog-per-lod-design.md`

**Verified facts the code relies on:**
- LCC2 manifest is JSON. LOD level = node depth in `root` tree. Each `.sog` belongs to exactly one level (verified: 0 files span levels). Per-level splat sums equal `lodSplats` (which is ordered **finest→coarsest**, so `lodSplats[0]` = finest = deepest depth).
- `splatFiles[]` paths are relative to the manifest's directory. Env segment index = `root.data.env.name`.
- splat-transform public API: `readFile(opts): Promise<DataTable[]>`, `combine(tables): DataTable`, `writeFile(opts, fs)`, `getInputFormat`, `getOutputFormat` (`.sog`→`'sog-bundle'`, single file). `DataTable` has `.numRows`. `Options.iterations` default 10. `DeviceCreator = () => Promise<GraphicsDevice>`. Local FS + device are in `src/cli/` (not exported) → vendored.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `vitest.config.ts` | project + build + test config |
| `bin/lcc2-export.mjs` | executable shim → `dist/cli.js` |
| `src/types.ts` | domain types: `Lcc2Manifest`, `Lcc2Node`, `LodLevel`, `ResolvedInput` |
| `src/splat/options.ts` | `defaultOptions()` (valid `Options` object) |
| `src/vendor/node-file-system.ts` | `NodeReadFileSystem`, `NodeFileSystem` (verbatim from splat-transform CLI) |
| `src/vendor/node-device.ts` | `createDevice` (verbatim from splat-transform CLI) |
| `src/merge.ts` | `mergeSegmentsToSog(paths, outPath, createDevice): Promise<number>` |
| `src/lcc2/manifest.ts` | `parseManifest(path): Lcc2Manifest` |
| `src/lcc2/tree.ts` | `planLods(manifest, rootDir): { levels: LodLevel[]; envFileIndex: number \| null }` |
| `src/lcc2/input.ts` | `resolveInput(inputPath): Promise<ResolvedInput>` |
| `src/output.ts` | `resolveOutputDir`, `lodFileName`, `copyEnv` |
| `src/cli.ts` | `main(argv)` — arg parse + orchestration |
| `test/**` | unit (`*.test.ts`) + integration (`*.integration.test.ts`) |

Integration tests use the real sample at the repo root `output_lcc2.zip` and **skip** if it's absent, so unit runs stay fast and portable.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/splat/options.ts`, `test/smoke.test.ts`

- [ ] **Step 1: Init git + write `package.json`**

```bash
cd /Users/daelee/Projects/aptixar/lcc2-export
git init
```

`package.json`:
```json
{
  "name": "lcc2-export",
  "version": "0.1.0",
  "type": "module",
  "bin": { "lcc2-export": "bin/lcc2-export.mjs" },
  "files": ["dist", "bin"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "tsx src/cli.ts",
    "test": "vitest run --exclude '**/*.integration.test.ts'",
    "test:integration": "vitest run '**/*.integration.test.ts'",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@playcanvas/splat-transform": "2.4.0",
    "playcanvas": "^2.0.0",
    "webgpu": "0.4.0",
    "extract-zip": "^2.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`, `vitest.config.ts`, `.gitignore`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000, // GPU encode of large levels is slow
    hookTimeout: 120_000
  }
});
```

`.gitignore`:
```
node_modules
dist
*_sog/
/tmp
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/@playcanvas/splat-transform` and `node_modules/webgpu` present.

- [ ] **Step 4: Write `src/splat/options.ts`**

```ts
import type { Options } from '@playcanvas/splat-transform';

/** Minimal valid Options object for read/write. iterations=10 matches the splat-transform CLI default. */
export const defaultOptions = (): Options => ({
  iterations: 10,
  lodSelect: [],
  unbundled: false,
  lodChunkCount: 512,
  lodChunkExtent: 16
});
```

- [ ] **Step 5: Write smoke test `test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { readFile, writeFile, combine, getInputFormat, getOutputFormat } from '@playcanvas/splat-transform';
import { defaultOptions } from '../src/splat/options.js';

describe('environment', () => {
  it('splat-transform exposes the API we depend on', () => {
    expect(typeof readFile).toBe('function');
    expect(typeof writeFile).toBe('function');
    expect(typeof combine).toBe('function');
    expect(getInputFormat('a.sog')).toBe('sog');
    expect(getOutputFormat('a.sog', defaultOptions())).toBe('sog-bundle');
  });
});
```

- [ ] **Step 6: Run smoke test**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/splat/options.ts test/smoke.test.ts
git commit -m "chore: scaffold lcc2-export project"
```

---

## Task 2: Vendor Node FS + device, and `merge.ts` (retires GPU/decode risk)

This task proves the whole splat-transform integration on **real XGrids `.sog`** before any domain logic is built.

**Files:**
- Create: `src/vendor/node-file-system.ts`, `src/vendor/node-device.ts`, `src/merge.ts`, `test/merge.integration.test.ts`, `test/fixtures/segments/.gitkeep`

- [ ] **Step 1: Vendor `src/vendor/node-file-system.ts`**

Copy verbatim from splat-transform `src/cli/node-file-system.ts`, changing only the import path from `'../lib'` to the package entry. Header comment notes the source.

```ts
// Vendored verbatim from @playcanvas/splat-transform src/cli/node-file-system.ts
// (these Node FS adapters are needed but not part of the package's public exports).
import { randomBytes } from 'crypto';
import { FileHandle, mkdir, open, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  BufferedReadStream,
  ReadStream,
  type FileSystem,
  type ProgressCallback,
  type ReadFileSystem,
  type ReadSource,
  type Writer
} from '@playcanvas/splat-transform';

class NodeReadStream extends ReadStream {
  private fileHandle: FileHandle;
  private position: number;
  private end: number;
  private closed = false;
  private progress: ProgressCallback | undefined;
  private totalSize: number | undefined;

  constructor(fileHandle: FileHandle, start: number, end: number, progress?: ProgressCallback, totalSize?: number) {
    super(end - start);
    this.fileHandle = fileHandle;
    this.position = start;
    this.end = end;
    this.progress = progress;
    this.totalSize = totalSize;
  }

  async pull(target: Uint8Array): Promise<number> {
    if (this.closed) return 0;
    const remaining = this.end - this.position;
    if (remaining <= 0) return 0;
    const bytesToRead = Math.min(target.length, remaining);
    const { bytesRead } = await this.fileHandle.read(target, 0, bytesToRead, this.position);
    this.position += bytesRead;
    this.bytesRead += bytesRead;
    if (this.progress) this.progress(this.bytesRead, this.totalSize);
    return bytesRead;
  }

  close(): void { this.closed = true; }
}

class NodeReadSource implements ReadSource {
  readonly size: number;
  readonly seekable = true;
  private fileHandle: FileHandle;
  private closed = false;
  private progress: ProgressCallback | undefined;

  constructor(fileHandle: FileHandle, size: number, progress?: ProgressCallback) {
    this.fileHandle = fileHandle;
    this.size = size;
    this.progress = progress;
  }

  read(start = 0, end: number = this.size): ReadStream {
    if (this.closed) throw new Error('Source has been closed');
    const clampedStart = Math.max(0, Math.min(start, this.size));
    const clampedEnd = Math.max(clampedStart, Math.min(end, this.size));
    const raw = new NodeReadStream(this.fileHandle, clampedStart, clampedEnd, this.progress, this.size);
    return new BufferedReadStream(raw, 4 * 1024 * 1024);
  }

  close(): void { this.closed = true; this.fileHandle.close(); }
}

class NodeReadFileSystem implements ReadFileSystem {
  async createSource(filename: string, progress?: ProgressCallback): Promise<ReadSource> {
    const fileStats = await stat(filename);
    const fileHandle = await open(filename, 'r');
    progress?.(0, fileStats.size);
    return new NodeReadSource(fileHandle, fileStats.size, progress);
  }
}

class FileWriter implements Writer {
  bytesWritten = 0;
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;

  constructor(fileHandle: FileHandle, filename: string, tmpFilename: string) {
    this.write = async (data: Uint8Array) => {
      let offset = 0;
      while (offset < data.byteLength) {
        const { bytesWritten } = await fileHandle.write(data, offset, data.byteLength - offset);
        if (bytesWritten === 0) throw new Error('Failed to write all data to file.');
        offset += bytesWritten;
        this.bytesWritten += bytesWritten;
      }
    };
    this.close = async () => {
      await fileHandle.sync();
      await fileHandle.close();
      await rename(tmpFilename, filename);
    };
  }
}

class NodeFileSystem implements FileSystem {
  async createWriter(filename: string): Promise<Writer> {
    const tmpFilename = `.${basename(filename)}.${process.pid}.${Date.now()}.${randomBytes(6).toString('hex')}.tmp`;
    const tmpPathname = join(dirname(filename), tmpFilename);
    const fileHandle = await open(tmpPathname, 'wx');
    return new FileWriter(fileHandle, filename, tmpPathname);
  }

  async mkdir(path: string): Promise<void> { await mkdir(path, { recursive: true }); }
}

export { NodeReadFileSystem, NodeFileSystem };
```

- [ ] **Step 2: Vendor `src/vendor/node-device.ts`**

Copy verbatim from splat-transform `src/cli/node-device.ts`, changing `'../lib'` import to `'@playcanvas/splat-transform'`.

```ts
// Vendored verbatim from @playcanvas/splat-transform src/cli/node-device.ts
// (Dawn/WebGPU device creation for headless SOG encode; not part of public exports).
import { GraphicsDevice, WebgpuGraphicsDevice } from 'playcanvas';
import { create, globals } from 'webgpu';

import { logger } from '@playcanvas/splat-transform';

const initializeGlobals = () => {
  Object.assign(globalThis, globals);
  (globalThis as any).window = { navigator: { userAgent: 'node.js' } };
  (globalThis as any).document = {
    createElement: (type: string) => {
      if (type === 'canvas') {
        return {
          getContext: (): null => null,
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 }),
          width: 300,
          height: 150
        };
      }
    }
  };
};

initializeGlobals();

const getDawnAdapterNames = async (): Promise<string[]> => {
  try {
    const gpu = create(['adapter=__list_adapters__']);
    await gpu.requestAdapter();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const names: string[] = [];
    for (const line of message.split('\n')) {
      const match = line.match(/name:\s*'([^']+)'/);
      if (match) names.push(match[1]);
    }
    return names;
  }
  logger.warn('Expected adapter enumeration to throw an error, but it did not.');
  return [];
};

let cachedAdapters: Array<{ index: number; name: string }> | null = null;

const enumerateAdapters = async () => {
  if (cachedAdapters) return cachedAdapters;
  try {
    logger.info('Detecting GPU adapters...');
    const dawnAdapterNames = await getDawnAdapterNames();
    cachedAdapters = dawnAdapterNames.map((name, index) => ({ index, name }));
    return cachedAdapters;
  } catch (e) {
    logger.error('Failed to enumerate adapters. Error:', e);
    return [];
  }
};

const createDevice = async (adapterName?: string): Promise<GraphicsDevice> => {
  const dawnOptions = adapterName ? [`adapter=${adapterName}`] : [];
  // @ts-ignore
  window.navigator.gpu = create(dawnOptions);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const graphicsDevice = new WebgpuGraphicsDevice(canvas, { antialias: false, depth: false, stencil: false });
  await graphicsDevice.createDevice();
  // @ts-ignore
  (graphicsDevice.wgpu as any)?.lost?.then((info: any) => {
    if (info?.reason === 'destroyed') return;
    logger.error(`WebGPU device was lost: reason=${info.reason || 'unknown'}, message=${info.message || '(none)'}`);
  });
  return graphicsDevice;
};

export { createDevice, enumerateAdapters };
```

- [ ] **Step 3: Write `src/merge.ts`**

```ts
import { readFile, writeFile, combine, getInputFormat, getOutputFormat, type DataTable } from '@playcanvas/splat-transform';
import { NodeReadFileSystem, NodeFileSystem } from './vendor/node-file-system.js';
import { defaultOptions } from './splat/options.js';

/**
 * Decode every segment, merge into one DataTable, and write a single bundled .sog.
 * Returns the number of splats written.
 */
export const mergeSegmentsToSog = async (
  segmentPaths: string[],
  outPath: string,
  createDevice: () => Promise<import('playcanvas').GraphicsDevice>
): Promise<number> => {
  const fileSystem = new NodeReadFileSystem();
  const tables: DataTable[] = [];
  for (const filename of segmentPaths) {
    const result = await readFile({
      filename,
      inputFormat: getInputFormat(filename),
      options: defaultOptions(),
      params: [],
      fileSystem
    });
    tables.push(...result);
  }
  const merged = combine(tables);
  await writeFile({
    filename: outPath,
    outputFormat: getOutputFormat(outPath, defaultOptions()),
    dataTable: merged,
    options: defaultOptions(),
    createDevice
  }, new NodeFileSystem());
  return merged.numRows;
};
```

- [ ] **Step 4: Populate fixtures from the real sample (one-time)**

Extract two small real segments to use as deterministic fixtures.

```bash
mkdir -p test/fixtures/segments
unzip -j -o output_lcc2.zip \
  "output_lcc2/lcc2-result/data/3dgs/0_6_0_0.sog" \
  "output_lcc2/lcc2-result/data/3dgs/0_5_0.sog" \
  -d test/fixtures/segments
ls -la test/fixtures/segments
```
Expected: `0_6_0_0.sog` (~500 KB) and `0_5_0.sog` (~1.3 MB) present.

- [ ] **Step 5: Write integration spike `test/merge.integration.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, getInputFormat } from '@playcanvas/splat-transform';
import { NodeReadFileSystem } from '../src/vendor/node-file-system.js';
import { createDevice } from '../src/vendor/node-device.js';
import { defaultOptions } from '../src/splat/options.js';
import { mergeSegmentsToSog } from '../src/merge.js';

const segA = 'test/fixtures/segments/0_6_0_0.sog';
const segB = 'test/fixtures/segments/0_5_0.sog';
const have = existsSync(segA) && existsSync(segB);

const countSplats = async (filename: string) => {
  const tables = await readFile({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  return tables.reduce((n, t) => n + t.numRows, 0);
};

describe.skipIf(!have)('merge real XGrids .sog', () => {
  it('decodes XGrids segments and writes a bundled .sog with the summed splat count', async () => {
    const a = await countSplats(segA);
    const b = await countSplats(segB);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);

    const dir = await mkdtemp(join(tmpdir(), 'lcc2-merge-'));
    const out = join(dir, 'merged.sog');
    try {
      const written = await mergeSegmentsToSog([segA, segB], out, createDevice);
      expect(written).toBe(a + b);
      expect(await countSplats(out)).toBe(a + b);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Run the integration spike**

Run: `npm run test:integration`
Expected: PASS (decodes XGrids `.sog`, GPU-encodes a bundled `.sog`, round-trip count matches). If WebGPU/Dawn fails to initialize, stop and resolve the GPU environment before continuing — SOG encode requires it.

- [ ] **Step 7: Commit**

```bash
git add src/vendor src/merge.ts test/merge.integration.test.ts test/fixtures/segments
git commit -m "feat: SOG merge via splat-transform (vendored node FS + device)"
```

---

## Task 3: Manifest types + parser

**Files:**
- Create: `src/types.ts`, `src/lcc2/manifest.ts`, `test/manifest.test.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type Lcc2Gaussian = { name: number; start: number; count: number };

export type Lcc2Node = {
  id: string;
  childNum: number;
  child?: Record<string, Lcc2Node>;
  data?: { '3dgs'?: Lcc2Gaussian; env?: { name: number } };
};

export type Lcc2Root = Lcc2Node & {
  splatFiles: string[];
  data?: { env?: { name: number } };
};

export type Lcc2Manifest = {
  version: string;
  splatType?: string;
  totalLevels: number;
  lodSplats: number[];
  root: Lcc2Root;
};

/** One LOD level resolved to absolute segment paths. lodIndex 0 = finest. */
export type LodLevel = {
  lodIndex: number;
  depth: number;
  segmentPaths: string[];
  expectedSplatCount: number;
};

export type ResolvedInput = {
  rootDir: string;
  manifestPath: string;
  cleanup: () => Promise<void>;
};
```

- [ ] **Step 2: Write failing test `test/manifest.test.ts`**

```ts
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
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/manifest.test.ts`
Expected: FAIL ("Cannot find module '../src/lcc2/manifest.js'").

- [ ] **Step 4: Write `src/lcc2/manifest.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/manifest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lcc2/manifest.ts test/manifest.test.ts
git commit -m "feat: LCC2 manifest types and parser"
```

---

## Task 4: Depth→LOD grouping (`planLods`)

**Files:**
- Create: `src/lcc2/tree.ts`, `test/tree.test.ts`

- [ ] **Step 1: Write failing test `test/tree.test.ts`**

A synthetic 3-depth tree. Depth 1 → file 0 (count 5); depth 2 → file 1 (count 3) shared by two nodes (counts 2+1); depth 3 → file 2 (count 1). Env → file 3. Expect lodIndex 0 = deepest (depth 3).

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tree.test.ts`
Expected: FAIL ("Cannot find module '../src/lcc2/tree.js'").

- [ ] **Step 3: Write `src/lcc2/tree.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tree.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lcc2/tree.ts test/tree.test.ts
git commit -m "feat: group LCC2 segments into LOD levels by tree depth"
```

---

## Task 5: Input resolution (folder / nested / zip)

**Files:**
- Create: `src/lcc2/input.ts`, `test/input.test.ts`

- [ ] **Step 1: Write failing test `test/input.test.ts`**

Covers: a nested folder layout (manifest in a subdir), and the missing-manifest error. (Zip path is exercised end-to-end in Task 7's integration test against the real sample.)

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/input.test.ts`
Expected: FAIL ("Cannot find module '../src/lcc2/input.js'").

- [ ] **Step 3: Write `src/lcc2/input.ts`**

```ts
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
    await extract(abs, { dir: tmp });
    searchRoot = tmp;
    cleanup = async () => { await rm(tmp, { recursive: true, force: true }); };
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/input.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lcc2/input.ts test/input.test.ts
git commit -m "feat: resolve LCC2 input from folder or zip"
```

---

## Task 6: Output helpers

**Files:**
- Create: `src/output.ts`, `test/output.test.ts`

- [ ] **Step 1: Write failing test `test/output.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveOutputDir, lodFileName, copyEnv } from '../src/output.js';

describe('output helpers', () => {
  it('defaults output dir to a sibling _sog folder', () => {
    expect(resolveOutputDir('/data/output_lcc2.zip', undefined)).toBe('/data/output_lcc2_sog');
    expect(resolveOutputDir('/data/lcc2-result/', undefined)).toBe('/data/lcc2-result_sog');
  });

  it('honors an explicit output arg', () => {
    expect(resolveOutputDir('/data/x.zip', '/out/here')).toBe('/out/here');
  });

  it('names lod files by index', () => {
    expect(lodFileName('/out', 0)).toBe('/out/lod0.sog');
    expect(lodFileName('/out', 3)).toBe('/out/lod3.sog');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/output.test.ts`
Expected: FAIL ("Cannot find module '../src/output.js'").

- [ ] **Step 3: Write `src/output.ts`**

```ts
import { copyFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Default output dir: sibling `<inputBaseName>_sog/` next to the input. */
export const resolveOutputDir = (inputPath: string, outputArg: string | undefined): string => {
  if (outputArg) return resolve(outputArg);
  const abs = resolve(inputPath);
  const base = abs.toLowerCase().endsWith('.zip') ? abs.slice(0, -4) : abs;
  return `${base}_sog`;
};

export const lodFileName = (outDir: string, lodIndex: number): string =>
  join(outDir, `lod${lodIndex}.sog`);

/** Copy the environment segment through unchanged as `<outDir>/env.sog`. */
export const copyEnv = async (envPath: string, outDir: string): Promise<void> => {
  await mkdir(outDir, { recursive: true });
  await copyFile(envPath, join(outDir, 'env.sog'));
};
```

Note: `resolve('/data/lcc2-result/')` strips the trailing slash, so the `.zip` branch isn't needed for folders.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/output.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/output.ts test/output.test.ts
git commit -m "feat: output dir resolution, lod naming, env copy"
```

---

## Task 7: CLI wiring + end-to-end

**Files:**
- Create: `src/cli.ts`, `bin/lcc2-export.mjs`, `test/cli.integration.test.ts`

- [ ] **Step 1: Write `src/cli.ts`**

```ts
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveInput } from './lcc2/input.js';
import { parseManifest } from './lcc2/manifest.js';
import { planLods } from './lcc2/tree.js';
import { resolveOutputDir, lodFileName, copyEnv } from './output.js';
import { mergeSegmentsToSog } from './merge.js';
import { createDevice } from './vendor/node-device.js';

const USAGE = `lcc2-export — export each LCC2 LOD level to a single SOG file

Usage:
  lcc2-export <input.zip | input-folder> [output-folder] [--levels 0,2,5]

Arguments:
  input         An LCC2 folder or a .zip of one (required)
  output        Output folder (optional; default: <input>_sog next to the input)

Options:
  --levels      Comma-separated lodIndex list to export (0 = finest). Default: all
  -h, --help    Show this help
`;

export const main = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { levels: { type: 'string' }, help: { type: 'boolean', short: 'h' } }
  });

  if (values.help || positionals.length < 1) {
    process.stdout.write(USAGE);
    return;
  }

  const [inputPath, outputArg] = positionals;
  const input = await resolveInput(inputPath);
  try {
    const manifest = parseManifest(input.manifestPath);
    const { levels, envFileIndex } = planLods(manifest, input.rootDir);

    const outDir = resolveOutputDir(inputPath, outputArg);
    await mkdir(outDir, { recursive: true });

    const wanted = values.levels
      ? new Set(values.levels.split(',').map(s => parseInt(s.trim(), 10)))
      : null;

    for (const lvl of levels) {
      if (wanted && !wanted.has(lvl.lodIndex)) continue;
      const outPath = lodFileName(outDir, lvl.lodIndex);
      process.stdout.write(`LOD ${lvl.lodIndex} (depth ${lvl.depth}): merging ${lvl.segmentPaths.length} segment(s)\n`);
      const written = await mergeSegmentsToSog(lvl.segmentPaths, outPath, createDevice);
      process.stdout.write(`  -> ${outPath} (${written} splats)\n`);
    }

    if (envFileIndex != null) {
      const envPath = resolve(input.rootDir, manifest.root.splatFiles[envFileIndex]);
      await copyEnv(envPath, outDir);
      process.stdout.write(`  -> ${outDir}/env.sog (copied)\n`);
    }

    process.stdout.write(`Done. Output: ${outDir}\n`);
  } finally {
    await input.cleanup();
  }
};
```

- [ ] **Step 2: Write `bin/lcc2-export.mjs`**

```js
#!/usr/bin/env node
import { main } from '../dist/cli.js';
main().catch((err) => {
  console.error(`lcc2-export: ${err?.message ?? err}`);
  process.exit(1);
});
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: no errors; `dist/cli.js` exists.

- [ ] **Step 4: Write end-to-end test `test/cli.integration.test.ts`**

Runs the real pipeline on the sample zip for the **coarsest** level only (1 segment, ~305k splats — the cheapest end-to-end check), and verifies env passthrough.

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, readFile as fsReadFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, getInputFormat } from '@playcanvas/splat-transform';
import { NodeReadFileSystem } from '../src/vendor/node-file-system.js';
import { defaultOptions } from '../src/splat/options.js';
import { main } from '../src/cli.js';

const SAMPLE = 'output_lcc2.zip';
const have = existsSync(SAMPLE);

const countSplats = async (filename: string) => {
  const tables = await readFile({
    filename, inputFormat: getInputFormat(filename),
    options: defaultOptions(), params: [], fileSystem: new NodeReadFileSystem()
  });
  return tables.reduce((n, t) => n + t.numRows, 0);
};

describe.skipIf(!have)('cli end-to-end on sample', () => {
  it('exports the coarsest LOD + env from the sample zip', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'lcc2-e2e-'));
    try {
      // Coarsest level in the sample is lodIndex 5 (depth 1, 305,075 splats).
      await main([SAMPLE, outDir, '--levels', '5']);
      const lod5 = join(outDir, 'lod5.sog');
      const env = join(outDir, 'env.sog');
      expect(existsSync(lod5)).toBe(true);
      expect(existsSync(env)).toBe(true);
      expect(await countSplats(lod5)).toBe(305075);
      // env.sog is copied byte-for-byte (12,308-splat environment).
      expect((await fsReadFile(env)).byteLength).toBeGreaterThan(0);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 5: Run the end-to-end test**

Run: `npm run test:integration`
Expected: PASS — `lod5.sog` decodes to 305,075 splats and `env.sog` is present. (Extracts the 272 MB sample to temp, so this takes a bit.)

- [ ] **Step 6: Manual smoke run (real output for inspection)**

Run: `npm run build && node bin/lcc2-export.mjs output_lcc2.zip --levels 5`
Expected: creates `./output_lcc2_sog/lod5.sog` and `./output_lcc2_sog/env.sog`; logs splat counts. Optionally drag `lod5.sog` into a SOG viewer (SuperSplat) to confirm it renders.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts bin/lcc2-export.mjs test/cli.integration.test.ts
git commit -m "feat: lcc2-export CLI end-to-end"
```

---

## Self-Review

**Spec coverage:**
- Folder or zip input → Task 5 (`resolveInput`) + Task 7 e2e. ✓
- One `.sog` per level, merging same-level segments → Task 2 (`mergeSegmentsToSog`) + Task 4 grouping + Task 7 loop. ✓
- Per-level / literal (not cumulative) → Task 4 groups strictly by depth; no accumulation. ✓
- `env.sog` copied through separately → Task 6 (`copyEnv`) + Task 7. ✓
- Output optional, default sibling `_sog` → Task 6 (`resolveOutputDir`). ✓
- `--levels` subset → Task 7. ✓
- Naming lod0 = finest → Task 4 (`maxDepth - depth`) + Task 6 (`lodFileName`) + Task 7 e2e asserts lod5 = coarsest 305,075. ✓
- Accept any `version`, ignore unknown fields → Task 3 parser. ✓
- Format-agnostic input (uses `getInputFormat`), always bundled `.sog` output (`getOutputFormat`→`sog-bundle`) → Task 2. ✓
- Error handling: missing input (fs.stat throws), no/multiple manifest (Task 5), missing/invalid manifest fields (Task 3). A segment path missing on disk surfaces as readFile's own ENOENT in Task 2/7. ✓
- Testing: unit (manifest, tree, input, output) + integration (merge spike, e2e) with counts asserted against `lodSplats`. ✓
- Risk retirement (XGrids `.sog` decode, GPU encode, API shape) → front-loaded in Task 2. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `LodLevel { lodIndex, depth, segmentPaths, expectedSplatCount }`, `ResolvedInput { rootDir, manifestPath, cleanup }`, `mergeSegmentsToSog(paths, outPath, createDevice)`, `planLods(manifest, rootDir)`, `resolveInput`, `parseManifest`, `resolveOutputDir`/`lodFileName`/`copyEnv` — names/signatures match across tasks and the smoke/spike tests. `defaultOptions()` shared by read + write. ✓
