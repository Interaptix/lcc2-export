// Vendored verbatim from @playcanvas/splat-transform src/cli/node-device.ts
// (Dawn/WebGPU device creation for headless SOG encode; not part of public exports).
import { GraphicsDevice, WebgpuGraphicsDevice } from 'playcanvas';
import { create, globals } from 'webgpu';

import { logger } from '@playcanvas/splat-transform';

const initializeGlobals = () => {
  Object.assign(globalThis, globals);
  (globalThis as any).window = { navigator: { userAgent: 'node.js' } };
  (globalThis as any).document = {
    createElement: (type: string) => {
      if (type === 'canvas') {
        return {
          getContext: (): null => null,
          getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150, right: 300, bottom: 150 }),
          width: 300,
          height: 150
        };
      }
    }
  };
};

initializeGlobals();

const getDawnAdapterNames = async (): Promise<string[]> => {
  try {
    const gpu = create(['adapter=__list_adapters__']);
    await gpu.requestAdapter();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const names: string[] = [];
    for (const line of message.split('\n')) {
      const match = line.match(/name:\s*'([^']+)'/);
      if (match) names.push(match[1]);
    }
    return names;
  }
  logger.warn('Expected adapter enumeration to throw an error, but it did not.');
  return [];
};

let cachedAdapters: Array<{ index: number; name: string }> | null = null;

const enumerateAdapters = async () => {
  if (cachedAdapters) return cachedAdapters;
  try {
    logger.info('Detecting GPU adapters...');
    const dawnAdapterNames = await getDawnAdapterNames();
    cachedAdapters = dawnAdapterNames.map((name, index) => ({ index, name }));
    return cachedAdapters;
  } catch (e) {
    logger.error('Failed to enumerate adapters. Error:', e);
    return [];
  }
};

const createDevice = async (adapterName?: string): Promise<GraphicsDevice> => {
  const dawnOptions = adapterName ? [`adapter=${adapterName}`] : [];
  // @ts-ignore
  window.navigator.gpu = create(dawnOptions);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const graphicsDevice = new WebgpuGraphicsDevice(canvas, { antialias: false, depth: false, stencil: false });
  await graphicsDevice.createDevice();
  // @ts-ignore
  (graphicsDevice.wgpu as any)?.lost?.then((info: any) => {
    if (info?.reason === 'destroyed') return;
    logger.error(`WebGPU device was lost: reason=${info.reason || 'unknown'}, message=${info.message || '(none)'}`);
  });
  return graphicsDevice;
};

export { createDevice, enumerateAdapters };
