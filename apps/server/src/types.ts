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
}

export interface ChatResponsePayload {
  reply: string;
  references: string[];
  emotion: "neutral" | "happy" | "thinking";
  audioUrl: string;
  phonemeCues: number[];
}
