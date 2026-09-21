# lcc2-export

Convert an XGRIDS **LCC2** (Lixel CyberColor 2) photogrammetry export into PlayCanvas **SOG** Gaussian-splat files — one bundled `.sog` per level-of-detail (LoD), plus the environment splat copied through as `env.sog`.

## Requirements

- **Node.js ≥ 20** — check with `node --version`
- On the first install, the `webgpu` dependency builds/downloads a native **Dawn** (WebGPU) binary for your platform.

## Install

A clone ships neither dependencies nor build output, so installation is a clone + install + build:

```bash
git clone https://github.com/Interaptix/lcc2-export.git
cd lcc2-export
npm install      # dependencies, incl. the native WebGPU/Dawn build
npm run build    # compiles src/ -> dist/ (the CLI entry imports dist/)
```

Optionally register a global `lcc2-export` command:

```bash
npm link         # or: npm install -g .
```

## Usage

```
lcc2-export <input.zip | input-folder> [output-folder] [--levels 0,2,5]
```

| Argument / option | Meaning |
| --- | --- |
| `input` | An LCC2 folder, or a `.zip` of one (required) |
| `output` | Output folder (optional; defaults to `<input>_sog` next to the input) |
| `--levels` | Comma-separated LoD indices to export (`0` = finest). Default: all |
| `-h`, `--help` | Show help |

If you didn't `npm link`, invoke the binary directly:

```bash
node bin/lcc2-export.mjs <input.zip | input-folder> [output-folder] [--levels 0,2,5]
```

### Examples

```bash
# Every LoD + env, into the default sibling folder ./output_lcc2_sog
lcc2-export ./output_lcc2.zip

# Only the coarsest two levels, into a chosen folder
lcc2-export ./capture/ ./out --levels 4,5
```

## Output

One bundled SOG per LoD level — named by LoD index, where `lod0` is the finest — plus the environment splat:

```
output_lcc2_sog/
├── lod0.sog
├── lod1.sog
├── ...
├── lod5.sog
└── env.sog
```

Each `.sog` is a valid PlayCanvas bundled SOG (a ZIP container). Splat counts for the reference capture:

| LoD | tree depth | splats |
| ---: | ---: | ---: |
| 0 | 6 | 9,922,900 |
| 1 | 5 | 4,946,159 |
| 2 | 4 | 2,468,652 |
| 3 | 3 | 1,231,082 |
| 4 | 2 | 613,179 |
| 5 | 1 | 305,075 |

## How it works

LCC2 stores splats in an N-ary LoD tree where **tree depth = LoD level**. The tool parses the `.lcc2` manifest, groups all `3dgs` segment files by depth, merges each level's segments into one bundled SOG via [`@playcanvas/splat-transform`](https://www.npmjs.com/package/@playcanvas/splat-transform), and copies the root `env` splat through unchanged. XGRIDS captures are SH0-only, so the merge is a lossless decode → combine → WebP → bundle round-trip.

## Development

```bash
npm test                 # unit tests
npm run test:integration # integration tests (need local sample/fixtures)
npm run typecheck        # tsc over src + tests
```

Integration tests that depend on proprietary XGRIDS sample data auto-skip when those files are absent, so a fresh clone stays green.

## A note on data

XGRIDS sample captures, the whitepaper PDF, and the `.sog` test fixtures are XGRIDS proprietary. They are gitignored and never committed; keep them locally to run the integration tests.

## License

MIT — see [LICENSE](LICENSE). `src/vendor/` contains files copied from [@playcanvas/splat-transform](https://github.com/playcanvas/splat-transform) (MIT, PlayCanvas Ltd.).
