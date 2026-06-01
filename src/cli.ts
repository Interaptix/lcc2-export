import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
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

  let wanted: Set<number> | null = null;
  if (values.levels) {
    const parsed = values.levels.split(',').map(s => parseInt(s.trim(), 10));
    if (parsed.some(n => Number.isNaN(n))) {
      throw new Error(`--levels must be a comma-separated list of integers, got: ${values.levels}`);
    }
    wanted = new Set(parsed);
  }

  const input = await resolveInput(inputPath);
  try {
    const manifest = parseManifest(input.manifestPath);
    const { levels, envFileIndex } = planLods(manifest, input.rootDir);

    const outDir = resolveOutputDir(inputPath, outputArg);
    await mkdir(outDir, { recursive: true });

    for (const lvl of levels) {
      if (wanted && !wanted.has(lvl.lodIndex)) continue;
      const outPath = lodFileName(outDir, lvl.lodIndex);
      process.stdout.write(`LOD ${lvl.lodIndex} (depth ${lvl.depth}): merging ${lvl.segmentPaths.length} segment(s)\n`);
      const written = await mergeSegmentsToSog(lvl.segmentPaths, outPath, createDevice);
      if (written !== lvl.expectedSplatCount) {
        process.stderr.write(`  WARNING: LOD ${lvl.lodIndex} expected ${lvl.expectedSplatCount} splats but wrote ${written}\n`);
      }
      process.stdout.write(`  -> ${outPath} (${written} splats)\n`);
    }

    if (envFileIndex != null) {
      const envPath = resolve(input.rootDir, manifest.root.splatFiles[envFileIndex]);
      await copyEnv(envPath, outDir);
      process.stdout.write(`  -> ${join(outDir, 'env.sog')} (copied)\n`);
    }

    process.stdout.write(`Done. Output: ${outDir}\n`);
  } finally {
    await input.cleanup();
  }
};
