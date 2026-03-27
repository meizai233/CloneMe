export type PersonaMode = "teacher" | "friend" | "support";

export interface CreatorProfile {
  creatorName: string;
  domain: string;
  toneHints: string;
  knowledge: string[];
}

export interface ChatRequestPayload {
  userQuestion: string;
  mode: PersonaMode;
  voiceId?: string;
}

export interface ChatResponsePayload {
  reply: string;
  references: string[];
  emotion: "neutral" | "happy" | "thinking";
  audioUrl: string;
  phonemeCues: number[];
  latency?: {
    firstByteMs: number;
    totalMs: number;
    meetsTarget: boolean;
  };
}

export interface VoiceCloneProfilePayload {
  voiceId: string;
  metrics: {
    durationSec: number;
    snrDb: number;
    silenceRatio: number;
  };
}
