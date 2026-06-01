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
