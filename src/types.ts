export type Lcc2Gaussian = { name: number; start: number; count: number };

export type Lcc2Node = {
  id: string;
  childNum: number;
  child?: Record<string, Lcc2Node>;
  data?: { '3dgs'?: Lcc2Gaussian; env?: { name: number } };
};

export type Lcc2Root = Lcc2Node & {
  splatFiles: string[];
  // root carries data.env (environment splat index) but not data['3dgs'] per the LCC2 spec
};

export type Lcc2Manifest = {
  version: string;
  splatType?: string;
  totalLevels: number;
  lodSplats: number[];
  root: Lcc2Root;
};

/** One LOD level resolved to absolute segment paths. lodIndex 0 = finest. */
export type LodLevel = {
  lodIndex: number;
  depth: number;
  segmentPaths: string[];
  expectedSplatCount: number;
};

export type ResolvedInput = {
  rootDir: string;
  manifestPath: string;
  cleanup: () => Promise<void>;
};
