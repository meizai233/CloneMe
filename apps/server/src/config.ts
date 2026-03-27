export const config = {
  port: Number(process.env.PORT ?? 3001),
  llmProvider: process.env.LLM_PROVIDER ?? "mock",
  ttsProvider: process.env.TTS_PROVIDER ?? "mock",
  vectorProvider: process.env.VECTOR_PROVIDER ?? "mock"
};
