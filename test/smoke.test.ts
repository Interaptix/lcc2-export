import { describe, it, expect } from 'vitest';
import { readFile, writeFile, combine, getInputFormat, getOutputFormat } from '@playcanvas/splat-transform';
import { defaultOptions } from '../src/splat/options.js';

describe('environment', () => {
  it('splat-transform exposes the API we depend on', () => {
    expect(typeof readFile).toBe('function');
    expect(typeof writeFile).toBe('function');
    expect(typeof combine).toBe('function');
    expect(getInputFormat('a.sog')).toBe('sog');
    expect(getOutputFormat('a.sog', defaultOptions())).toBe('sog-bundle');
  });
});
