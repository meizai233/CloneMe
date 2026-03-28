export type LipSyncSource = "viseme" | "word" | "blendshape" | "heuristic" | "amplitude";

export interface VisemeTimeline {
  source: "viseme";
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
}

export interface WordTimeline {
  source: "word" | "heuristic";
  words: string[];
  wtimes: number[];
  wdurations: number[];
}

export interface BlendshapeTimeline {
  source: "blendshape";
  anims: Array<{
    name: string;
    dt: number[];
    vs: Record<string, number[]>;
  }>;
}

export type LipSyncTimeline = VisemeTimeline | WordTimeline | BlendshapeTimeline;

export interface LipSyncDebugMeta {
  source: LipSyncSource;
  turnId?: number;
  preview?: string;
}
