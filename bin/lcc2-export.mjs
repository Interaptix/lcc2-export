#!/usr/bin/env node
import { main } from '../dist/cli.js';

// Dawn (the `webgpu` package) keeps the event loop alive for as long as its GPU
// instance exists, so a run that encoded SH bands would otherwise never exit.
// Flush stdout/stderr, then force the exit — the same workaround splat-transform's
// own CLI uses.
const exit = (code) => {
  process.stdout.write('', () => process.stderr.write('', () => process.exit(code)));
};

main().then(
  () => exit(0),
  (err) => {
    console.error(`lcc2-export: ${err?.message ?? err}`);
    exit(1);
  }
);
