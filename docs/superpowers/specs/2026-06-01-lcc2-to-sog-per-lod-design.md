# lcc2-export — LCC2 → per-LOD SOG CLI

- **Date:** 2026-06-01
- **Status:** Approved design, ready for implementation planning
- **Owner:** dae.lee@interaptix.com

## 1. Problem & goal

XGRIDS LCC2 stores a 3D Gaussian-splat scene as a JSON manifest plus a flat folder of
already-encoded `.sog` segments, organized as an N-ary Level-of-Detail (LoD) tree. We want a
small CLI — shaped like PlayCanvas `splat-transform` — that takes one LCC2 folder or `.zip`
and emits **one bundled `.sog` file per LOD level**, merging all segments that belong to the
same level into a single file.

```
lcc2-export <input.zip | input-folder> [output-folder]
```

- `output-folder` is optional; defaults to a sibling folder next to the input.
- Output: `lod0.sog … lodN.sog` (one per level) plus `env.sog` copied through.

### Goals
- Single command, input + optional output, like `splat-transform`.
- Accept either an LCC2 folder or a `.zip` of one.
- Combine all segments in the same LOD level into one `.sog` per level (per-level / literal).
- Copy the environment splat (`env.sog`) through unchanged as its own file.

### Non-goals
- Mesh / BVH (`data/mesh/*`, `.btree`, `.ply`) — ignored.
- Cumulative LOD bundles (level K = levels 1..K). Per-level only for v1.
- Re-implementing the SOG codec — delegated to `@playcanvas/splat-transform`.
- Spherical-harmonics-specific handling — passed through transparently by the library.

## 2. Background (verified against a real sample)

Verified against `output_lcc2.zip` → `output_lcc2/lcc2-result/`.

### 2.1 LCC2 layout
```
<root>/
  XXX.lcc2            # JSON manifest (ASCII, CRLF)
  data/3dgs/*.sog     # splat segments (required)
  data/mesh/*         # PLY + .btree (optional, out of scope)
```

### 2.2 Manifest (`XXX.lcc2`) — relevant fields
Top level: `version`, `name`, `description`, `epsg`, `guid`, `source`, `dataType`,
`offset`, `shift`, `scale`, `fileType` (`"portable"` = no SH, `"quality"` = with SH),
`totalSplats`, `lodSplats` (array, **ordered finest → coarsest**), `totalLevels`,
`virtualLoD`, `splatType` (e.g. `".sog"`), `env` `{ type, splatsCount, boundingBox }`,
`splatExtraAttributes`, `root`, `renderingHints`.

`root` node adds: `splatFiles: string[]` (paths relative to the manifest dir, e.g.
`data/3dgs/0_0.sog`), `meshFiles`, `bvhFiles`, and `data.env.name` (index into
`splatFiles` for the environment splat).

Every node:
```
Node {
  id,                         // hierarchical, e.g. "0_0_0_0_0_0_0"
  boundingBox: { min:[x,y,z], max:[x,y,z] },
  childNum,                   // 0 = leaf
  child: { "0": Node, ... },  // recursive
  data: { "3dgs": { name, start, count }, mesh?, bvh? }
}
// name  = index into root.splatFiles
// start = first splat index of this node within that (merged) file
// count = number of splats for this node
```

### 2.3 The load-bearing invariant: LOD level = tree depth
The whitepaper states "adjacent nodes at the same level are merged and stored as the same
file." Verified on the sample by walking the tree and recording, per node, its depth and its
`data.3dgs.name`:

| Depth (LOD) | nodes | distinct `.sog` files | splats | matches `lodSplats` |
|---|---|---|---|---|
| 1 (coarsest) | 20 | 1  | 305,075   | `lodSplats[5]` |
| 2 | 20 | 2  | 613,179   | `lodSplats[4]` |
| 3 | 26 | 3  | 1,231,082 | `lodSplats[3]` |
| 4 | 34 | 5  | 2,468,652 | `lodSplats[2]` |
| 5 | 50 | 9  | 4,946,159 | `lodSplats[1]` |
| 6 (finest) | 69 | 17 | 9,922,900 | `lodSplats[0]` |

- **0 files span more than one level** → grouping segments by level is unambiguous.
- 37 segment files across 6 levels + 1 `env.sog` (referenced by `root.data.env.name`) = 38
  `splatFiles` entries. Per-level splat sums equal `lodSplats` exactly; total = `totalSplats`
  = 19,487,047.
- `lodSplats[0]` is the **finest** (deepest tree depth, most splats).

### 2.4 `@playcanvas/splat-transform` (v2.4.0)
- ESM (`type: module`). Library entry `dist/index.mjs`; exports include `readFile`,
  `writeFile`, `processDataTable` (plus `./lib/*` for direct module access). Also ships a
  `splat-transform` bin.
- Deps: `@adobe/spz`, `webgpu`; **peer dep `playcanvas ^2.0.0`**. SOG encode is
  GPU-accelerated and runs in Node via the `webgpu` package.
- Reads SOG (bundled + unbundled `meta.json`), PLY, compressed PLY, SPZ, LCC**1**, KSPLAT,
  SPLAT, MJS. Writes SOG (bundled `.sog` or unbundled `meta.json` + `.webp`), and others.
- **Merges multiple inputs into one output** — this is the per-level merge primitive.
- Does **not** read LCC2 (only LCC1). The LCC2 manifest parsing + LOD grouping is the gap this
  tool fills; the SOG decode/merge/encode is delegated.

## 3. Design

Approach: a thin Node/TS orchestrator that does the LCC2-specific work, then calls the
`splat-transform` library to merge each level's segments into one bundled `.sog`.

### 3.1 Modules (each one job)

| Module | Responsibility | Depends on |
|---|---|---|
| `src/cli.ts` | parse args, orchestrate the pipeline, progress + error output | all below |
| `src/lcc2/input.ts` | resolve folder vs `.zip`; if zip, extract to a temp dir; locate the `*.lcc2` manifest (recursively); return `{ manifestPath, rootDir, cleanup() }` | unzip lib |
| `src/lcc2/manifest.ts` | read + typed-parse the manifest JSON; expose types | — |
| `src/lcc2/tree.ts` | walk the node tree, compute depth per node, group `splatFiles` indices by LOD level, resolve to absolute paths, identify the env segment | `manifest` |
| `src/merge.ts` | for one level: `readFile` each segment → concat into one DataTable → `writeFile` a single bundled `.sog` | `@playcanvas/splat-transform` |
| `src/output.ts` | resolve output dir, file naming, copy `env.sog` through | — |

Rationale: `input`/`manifest`/`tree` are pure LCC2 domain logic, unit-testable without GPU or
splat-transform. `merge` is the only module touching the splat library. `cli`/`output` are thin.

### 3.2 Data flow
1. `cli` parses `<input>` and optional `[output]` (+ `--levels`).
2. `input` → `{ rootDir, manifestPath, cleanup }` (extracts zip to temp if needed).
3. `manifest` parses the JSON into a typed object.
4. `tree` walks `root`, builds `Map<level → segmentPath[]>` ordered **finest → coarsest**, plus
   the env segment path. Asserts the per-level splat sums equal `lodSplats` (sanity check).
5. For each requested level, `merge` reads its segments, concatenates, writes `lodN.sog`.
6. `output` copies `env.sog` through and finalizes the output folder.
7. `cleanup()` removes the temp dir (zip case).

### 3.3 Naming & ordering
- `lod0.sog` = **finest** (deepest depth, most splats) … `lodN.sog` = coarsest. This matches the
  manifest's own `lodSplats[0] = finest` indexing and the convention that LOD 0 is highest detail.
- `env.sog` copied through with its name.
- (Ordering is a single mapping function; trivially flippable to `lod1 = coarsest` by tree depth
  if preferred.)

### 3.4 Output location
- If `[output]` given: use it (created if absent).
- Else: sibling folder `<inputBaseName>_sog/` next to the input (e.g. `output_lcc2.zip` →
  `./output_lcc2_sog/`; a folder `…/lcc2-result` → `…/lcc2-result_sog/`).

### 3.5 CLI options (minimal)
- positional `<input>` — `.zip` or folder (required)
- positional `[output]` — output folder (optional)
- `--levels <list>` — export only some levels, e.g. `--levels 0,2,5` (the finest level alone is
  ~9.9M splats; skipping it is a common, cheap win). Mirrors `splat-transform --lod-select`.

### 3.6 Error handling
- Input path missing, no `*.lcc2` found, or multiple manifests (error, list them).
- A `splatFiles` segment referenced by the tree but missing on disk (error, name the file/level).
- Per the spec: accept any `version`; ignore unrecognized manifest fields.
- `splatType` is normally `.sog`. Since splat-transform also reads `.ply`/`.spz`, input stays
  format-agnostic (read whatever `splatFiles` point to); **output is always bundled `.sog`**.

## 4. Key technical details / risks to retire first
1. **Does `readFile` decode an XGRIDS `.sog`?** Very likely (both follow the PlayCanvas SOG
   spec), but confirm on one real segment before building out. This is also the first
   integration test.
2. **Exact DataTable concat/merge call.** The CLI merges multiple inputs; confirm the precise
   library call (e.g. a DataTable concat / `processDataTable`) against `dist/lib/index.d.ts`,
   and that `writeFile` emits a single bundled `.sog`.
3. **WebGPU in Node.** The `webgpu` dep provides it; confirm SOG encode runs headless on the
   target machine.
4. **Memory.** Finest level ≈ 9.9M splats across 17 segments decoded at once. Acceptable, but
   note peak memory; `--levels` is the escape hatch.

## 5. Testing strategy
- **Unit:** manifest parse (fixture JSON); `tree` grouping — assert per-level file sets and that
  summed `count` per level equals `lodSplats`; input resolution for folder, zip, and the nested
  `output_lcc2/lcc2-result/` layout.
- **Integration:** build a small 2-level slice from real segments in `output_lcc2.zip`, run
  end-to-end, decode the outputs and assert each `lodN.sog` splat count equals the sum of its
  input segments; assert `env.sog` is present and unchanged. The first integration test doubles
  as risk #1's spike.

## 6. Future work (out of scope for v1)
- Cumulative LOD bundles (independently viewable progressive-detail files).
- Folding `env` into the coarsest level on request.
- Optional `index.json` describing outputs (level → splat count → source segments).
- Mesh export.
