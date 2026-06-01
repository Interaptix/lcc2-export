#!/usr/bin/env node
import { main } from '../dist/cli.js';
main().catch((err) => {
  console.error(`lcc2-export: ${err?.message ?? err}`);
  process.exit(1);
});
