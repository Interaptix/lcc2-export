// Copyright (c) 2011-2026 PlayCanvas Ltd. Licensed under the MIT License.
// Source: https://github.com/playcanvas/splat-transform (see src/vendor/LICENSE-playcanvas).
// Vendored verbatim from @playcanvas/splat-transform src/cli/node-file-system.ts
// (these Node FS adapters are needed but not part of the package's public exports).
import { randomBytes } from 'crypto';
import { FileHandle, mkdir, open, rename, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  BufferedReadStream,
  ReadStream as ReadStreamImported,
  type FileSystem,
  type ProgressCallback,
  type ReadFileSystem,
  type ReadSource,
  type Writer
} from '@playcanvas/splat-transform';

// The published package re-exports `ReadStream` through barrel files
// (index.d.ts -> io/read/index.d.ts -> io/read/file-system.d.ts). TypeScript does not
// surface a re-exported base class's instance fields to a subclass when the class is
// reached through such a re-export hop, so `extends ReadStream` would lose visibility of
// the public `bytesRead` / `expectedSize` members (verified: importing the declaring file
// directly works, importing the barrel does not). PlayCanvas's own CLI compiles against
// the internal source tree where the import resolves directly, which is why this only bites
// external consumers. We re-type the constructor structurally so the verbatim subclass
// bodies below type-check; the runtime value is the genuine `ReadStream` class unchanged.
interface ReadStreamShape {
  readonly expectedSize: number | undefined;
  bytesRead: number;
  pull(target: Uint8Array): Promise<number>;
  readAll(): Promise<Uint8Array>;
  close(): void;
}
const ReadStream = ReadStreamImported as unknown as { new (expectedSize?: number): ReadStreamShape };
// Keep the type meaning of `ReadStream` (used as a return-type annotation below) pointing at
// the genuine class type, so only the *value* (base-class) binding above is the re-typed one.
type ReadStream = ReadStreamImported;

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
