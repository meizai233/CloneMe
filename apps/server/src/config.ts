export const config = {
  port: Number(process.env.PORT ?? 3001),
  llmProvider: process.env.LLM_PROVIDER ?? "mock",
  ttsProvider: process.env.TTS_PROVIDER ?? "mock",
  ttsApiKey: process.env.TTS_API_KEY ?? "",
  ttsApiUrl: process.env.TTS_API_URL ?? "",
  vectorProvider: process.env.VECTOR_PROVIDER ?? "mock",
  voiceCloneProviderProfilePath:
    process.env.TTS_VOICE_CLONE_PROFILE_PATH ?? "/v1/voice-clone/profiles",
  voiceCloneProviderSynthesizePath:
    process.env.TTS_VOICE_CLONE_SYNTH_PATH ?? "/v1/voice-clone/synthesize",
  voiceCloneProviderTimeoutMs: Number(process.env.TTS_PROVIDER_TIMEOUT_MS ?? 12000),
  voiceCloneMinDurationSec: Number(process.env.VOICE_CLONE_MIN_DURATION_SEC ?? 30),
  voiceCloneMinSnrDb: Number(process.env.VOICE_CLONE_MIN_SNR_DB ?? 12),
  voiceCloneMaxSilenceRatio: Number(process.env.VOICE_CLONE_MAX_SILENCE_RATIO ?? 0.35),
  voiceCloneRateLimitWindowMs: Number(process.env.VOICE_CLONE_RATE_LIMIT_WINDOW_MS ?? 60000),
  voiceCloneRateLimitMax: Number(process.env.VOICE_CLONE_RATE_LIMIT_MAX ?? 12),
  voiceCloneSensitiveTokens: (process.env.VOICE_CLONE_SENSITIVE_TOKENS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  voiceCloneLatencyTargetFirstByteMs: Number(
    process.env.VOICE_CLONE_TARGET_FIRST_BYTE_MS ?? 1500
  ),
  voiceCloneLatencyTargetTotalMs: Number(process.env.VOICE_CLONE_TARGET_TOTAL_MS ?? 5000)
};
