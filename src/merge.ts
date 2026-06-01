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
