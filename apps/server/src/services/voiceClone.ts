import { randomUUID } from "node:crypto";
import { config } from "../config.js";

type VoiceCloneStyle = {
  speed?: number;
  pitch?: number;
  emotion?: "neutral" | "happy" | "serious";
};

type ProviderProfileResponse = {
  id?: string;
  voiceId?: string;
  profileId?: string;
  data?: {
    id?: string;
    voiceId?: string;
    profileId?: string;
  };
};

type ProviderSynthesizeResponse = {
  audioUrl?: string;
  url?: string;
  audioBase64?: string;
  b64Audio?: string;
  data?: {
    audioUrl?: string;
    url?: string;
    audioBase64?: string;
    b64Audio?: string;
  };
};

export interface AudioQualityMetrics {
  durationSec: number;
  snrDb: number;
  silenceRatio: number;
}

export interface RegisterVoiceCloneInput {
  requestId: string;
  clientId: string;
  speakerName?: string;
  sampleAudioBase64: string;
}

export interface RegisterVoiceCloneResult {
  voiceId: string;
  metrics: AudioQualityMetrics;
}

export interface SynthesizeVoiceCloneInput {
  requestId: string;
  clientId: string;
  voiceId: string;
  text: string;
  style?: VoiceCloneStyle;
}

export interface SynthesizeVoiceCloneResult {
  audioUrl: string;
  latency: {
    firstByteMs: number;
    totalMs: number;
    meetsTarget: boolean;
  };
}

type ProfileEntry = {
  providerVoiceId: string;
  speakerName: string;
  createdAt: number;
  consentConfirmed: true;
  metrics: AudioQualityMetrics;
};

type RateLimitState = {
  count: number;
  windowStart: number;
};

const profileStore = new Map<string, ProfileEntry>();
const rateLimitStore = new Map<string, RateLimitState>();

const defaultSensitiveTokens = [
  "验证码",
  "银行卡",
  "身份证",
  "诈骗",
  "恐吓",
  "勒索"
];

const sensitiveTokens =
  config.voiceCloneSensitiveTokens.length > 0
    ? config.voiceCloneSensitiveTokens
    : defaultSensitiveTokens;

function nowMs(): number {
  return Date.now();
}

function parseAudioBase64(input: string): Buffer {
  const parts = input.split(",");
  const payload = parts.length > 1 ? parts[1] : parts[0];
  return Buffer.from(payload, "base64");
}

function parseWavPcm16(buffer: Buffer): { samples: Float32Array; sampleRate: number } {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("仅支持 WAV RIFF 音频样本");
  }
  if (buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("无效 WAV 文件头");
  }

  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let channels = 0;
  let dataStart = -1;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = buffer.readUInt16LE(chunkDataStart);
      channels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
      if (audioFormat !== 1) {
        throw new Error("仅支持 PCM WAV 音频样本");
      }
    }

    if (chunkId === "data") {
      dataStart = chunkDataStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkDataStart + chunkSize + (chunkSize % 2);
  }

  if (dataStart < 0 || dataSize <= 0) {
    throw new Error("WAV 音频缺少 data chunk");
  }
  if (bitsPerSample !== 16) {
    throw new Error("仅支持 16-bit PCM WAV 音频样本");
  }
  if (channels < 1 || sampleRate <= 0) {
    throw new Error("WAV 参数不完整");
  }

  const frameBytes = channels * 2;
  const totalFrames = Math.floor(dataSize / frameBytes);
  const samples = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i += 1) {
    const frameOffset = dataStart + i * frameBytes;
    let mixed = 0;
    for (let ch = 0; ch < channels; ch += 1) {
      mixed += buffer.readInt16LE(frameOffset + ch * 2) / 32768;
    }
    samples[i] = mixed / channels;
  }

  return { samples, sampleRate };
}

function estimateSNR(samples: Float32Array): number {
  const absValues = Array.from(samples, (sample) => Math.abs(sample));
  const sorted = [...absValues].sort((a, b) => a - b);
  const pivot = sorted[Math.floor(sorted.length * 0.2)] ?? 0.0001;

  let signalSum = 0;
  let signalCount = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  for (const value of absValues) {
    const power = value * value;
    if (value <= pivot) {
      noiseSum += power;
      noiseCount += 1;
    } else {
      signalSum += power;
      signalCount += 1;
    }
  }

  const signalRms = Math.sqrt(signalSum / Math.max(signalCount, 1));
  const noiseRms = Math.sqrt(noiseSum / Math.max(noiseCount, 1));
  const ratio = signalRms / Math.max(noiseRms, 1e-6);
  return 20 * Math.log10(Math.max(ratio, 1e-6));
}

function calcAudioMetrics(sampleAudioBase64: string): AudioQualityMetrics {
  const audioBuffer = parseAudioBase64(sampleAudioBase64);
  const { samples, sampleRate } = parseWavPcm16(audioBuffer);
  if (samples.length === 0) {
    throw new Error("音频样本为空");
  }

  const silenceThreshold = 0.01;
  let silenceCount = 0;
  for (const sample of samples) {
    if (Math.abs(sample) < silenceThreshold) {
      silenceCount += 1;
    }
  }

  return {
    durationSec: samples.length / sampleRate,
    snrDb: estimateSNR(samples),
    silenceRatio: silenceCount / samples.length
  };
}

function ensureAudioQuality(metrics: AudioQualityMetrics): void {
  if (metrics.durationSec < config.voiceCloneMinDurationSec) {
    throw new Error(`样本时长不足，至少需要 ${config.voiceCloneMinDurationSec} 秒`);
  }
  if (metrics.snrDb < config.voiceCloneMinSnrDb) {
    throw new Error(`音频噪声较大，SNR 需 >= ${config.voiceCloneMinSnrDb} dB`);
  }
  if (metrics.silenceRatio > config.voiceCloneMaxSilenceRatio) {
    throw new Error(
      `静音占比过高，需 <= ${(config.voiceCloneMaxSilenceRatio * 100).toFixed(0)}%`
    );
  }
}

function checkRateLimit(clientId: string): void {
  const state = rateLimitStore.get(clientId);
  const current = nowMs();
  if (!state || current - state.windowStart > config.voiceCloneRateLimitWindowMs) {
    rateLimitStore.set(clientId, {
      count: 1,
      windowStart: current
    });
    return;
  }

  if (state.count >= config.voiceCloneRateLimitMax) {
    throw new Error("请求过于频繁，请稍后重试");
  }

  state.count += 1;
}

function ensureSafeText(text: string): void {
  const lowered = text.toLowerCase();
  const matched = sensitiveTokens.find((token) => lowered.includes(token.toLowerCase()));
  if (matched) {
    throw new Error(`文本触发敏感规则：${matched}`);
  }
}

function auditLog(payload: Record<string, unknown>): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload
  });
  console.log(`[voice-clone-audit] ${line}`);
}

function getProviderProfileId(data: ProviderProfileResponse): string | null {
  return (
    data.voiceId ??
    data.profileId ??
    data.id ??
    data.data?.voiceId ??
    data.data?.profileId ??
    data.data?.id ??
    null
  );
}

function getProviderAudioResponse(data: ProviderSynthesizeResponse): string | null {
  const audioUrl = data.audioUrl ?? data.url ?? data.data?.audioUrl ?? data.data?.url;
  if (audioUrl) {
    return audioUrl;
  }
  const audioBase64 = data.audioBase64 ?? data.b64Audio ?? data.data?.audioBase64 ?? data.data?.b64Audio;
  if (audioBase64) {
    return `data:audio/wav;base64,${audioBase64}`;
  }
  return null;
}

async function callProviderJson<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  if (!config.ttsApiKey || !config.ttsApiUrl) {
    throw new Error("缺少 TTS 配置，请设置 TTS_API_KEY 与 TTS_API_URL");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.voiceCloneProviderTimeoutMs);

  try {
    const response = await fetch(`${config.ttsApiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.ttsApiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new Error(data.message ?? `第三方 TTS 请求失败: HTTP ${response.status}`);
    }
    return data as TResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("第三方 TTS 请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callProviderWithRetry<TResponse>(
  path: string,
  body: Record<string, unknown>
): Promise<TResponse> {
  try {
    return await callProviderJson<TResponse>(path, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!message.includes("超时")) {
      throw error;
    }
    return callProviderJson<TResponse>(path, body);
  }
}

export async function registerVoiceCloneProfile(
  input: RegisterVoiceCloneInput
): Promise<RegisterVoiceCloneResult> {
  const metrics = calcAudioMetrics(input.sampleAudioBase64);
  ensureAudioQuality(metrics);

  const providerResponse = await callProviderJson<ProviderProfileResponse>(
    config.voiceCloneProviderProfilePath,
    {
      name: input.speakerName ?? "CloneMe Voice",
      audioBase64: input.sampleAudioBase64
    }
  );

  const providerVoiceId = getProviderProfileId(providerResponse);
  if (!providerVoiceId) {
    throw new Error("第三方 TTS 未返回 voiceId");
  }

  const voiceId = `vc_${randomUUID()}`;
  profileStore.set(voiceId, {
    providerVoiceId,
    speakerName: input.speakerName ?? "CloneMe Voice",
    createdAt: nowMs(),
    consentConfirmed: true,
    metrics
  });

  auditLog({
    event: "profile_created",
    requestId: input.requestId,
    clientId: input.clientId,
    voiceId,
    providerVoiceId,
    metrics
  });

  return { voiceId, metrics };
}

export async function synthesizeClonedVoice(
  input: SynthesizeVoiceCloneInput
): Promise<SynthesizeVoiceCloneResult> {
  checkRateLimit(input.clientId);
  ensureSafeText(input.text);

  const profile = profileStore.get(input.voiceId);
  if (!profile) {
    throw new Error("voiceId 不存在或已过期");
  }

  const startedAt = nowMs();
  const providerResponse = await callProviderWithRetry<ProviderSynthesizeResponse>(
    config.voiceCloneProviderSynthesizePath,
    {
      voiceId: profile.providerVoiceId,
      text: input.text,
      style: input.style
    }
  );
  const firstByteMs = nowMs() - startedAt;

  const audioUrl = getProviderAudioResponse(providerResponse);
  if (!audioUrl) {
    throw new Error("第三方 TTS 未返回可播放音频");
  }

  const totalMs = nowMs() - startedAt;
  const meetsTarget =
    firstByteMs < config.voiceCloneLatencyTargetFirstByteMs &&
    totalMs < config.voiceCloneLatencyTargetTotalMs;

  auditLog({
    event: "speech_synthesized",
    requestId: input.requestId,
    clientId: input.clientId,
    voiceId: input.voiceId,
    textLength: input.text.length,
    latency: {
      firstByteMs,
      totalMs,
      meetsTarget
    }
  });

  return {
    audioUrl,
    latency: {
      firstByteMs,
      totalMs,
      meetsTarget
    }
  };
}
