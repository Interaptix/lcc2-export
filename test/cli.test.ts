import { describe, it, expect } from 'vitest';
import { main } from '../src/cli.js';

describe('cli arg validation', () => {
  it('rejects non-integer --levels before touching the filesystem', async () => {
    await expect(main(['dummy-input', 'dummy-out', '--levels', 'foo'])).rejects.toThrow(/--levels must be/);
  });

  it('rejects a partially non-integer --levels list', async () => {
    await expect(main(['dummy-input', '--levels', '0,foo,2'])).rejects.toThrow(/--levels must be/);
  });
});
