export type AvatarEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "thinking";

export type AvatarRuntime = "three-vrm" | "live2d" | "mock";

export interface AvatarState {
  emotion: AvatarEmotion;
  speaking: boolean;
  mouthOpen: number;
  initialized: boolean;
  runtime: AvatarRuntime;
  runtimeError: string | null;
}

export interface AvatarDriver {
  init(canvasId?: string): Promise<void>;
  resize?(): void;
  render?(deltaMs?: number): void;
  setEmotion(emotion: AvatarEmotion): void;
  setSpeaking(speaking: boolean): void;
  playLipSync(cues: number[]): () => void;
  destroy(): void;
}
