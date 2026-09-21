import {
  readFile, writeFile, combine, getInputFormat, getOutputFormat,
  createChunkDataPool, materializeToDataTable, type DataTable
} from '@playcanvas/splat-transform';
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
    // splat-transform >= 3 returns lazy ChunkSources; materialize each to the
    // columnar DataTable that `combine` / `writeFile` still take.
    const sources = await readFile({
      filename,
      inputFormat: getInputFormat(filename),
      options: defaultOptions(),
      params: [],
      fileSystem
    });
    for (const source of sources) {
      // materializeToDataTable requires pool.chunkSize >= the source's.
      const pool = createChunkDataPool({ chunkSize: source.meta.chunkSize });
      try {
        tables.push(await materializeToDataTable(source, pool));
      } finally {
        await source.close();
      }
    }
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
