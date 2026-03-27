import type { AvatarEmotion } from "../avatar/live2dAdapter";

export type PersonaMode = "teacher" | "friend" | "support";

interface InitAvatarRequest {
  creatorName: string;
  domain: string;
  docs: string[];
}

interface InitAvatarResponse {
  message: string;
}

export interface ChatResponse {
  reply: string;
  references: string[];
  emotion: AvatarEmotion;
  audioUrl: string;
  phonemeCues: number[];
  latency?: {
    firstByteMs: number;
    totalMs: number;
    meetsTarget: boolean;
  };
}

export interface VoiceCloneCreateResponse {
  voiceId: string;
  requestId: string;
}

export interface VoiceCloneInfo {
  voice_id: string;
  status: string;
  target_model?: string;
  gmt_create?: string;
  gmt_modified?: string;
}

export interface VoiceCloneListResponse {
  voices: VoiceCloneInfo[];
  requestId: string;
}

export interface VoiceCloneQueryResponse {
  voice: VoiceCloneInfo;
  requestId: string;
}

export interface VoiceCloneDeleteResponse {
  requestId: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 300000;

class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

function joinUrl(base: string, path: string): string {
  if (!path) {
    return "";
  }
  if (/^(https?:\/\/|data:)/.test(path)) {
    return path;
  }
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJson<TResponse, TRequest>(path: string, body: TRequest): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(joinUrl(API_BASE_URL, path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new ApiError(data.message ?? "请求失败", response.status);
    }

    return data as TResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("请求超时，请稍后重试");
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("网络异常，请检查服务是否启动");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestWithoutBody<TResponse>(path: string, method: "GET" | "DELETE"): Promise<TResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(joinUrl(API_BASE_URL, path), {
      method,
      signal: controller.signal
    });

    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      throw new ApiError(data.message ?? "请求失败", response.status);
    }

    return data as TResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("请求超时，请稍后重试");
    }
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError("网络异常，请检查服务是否启动");
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function initAvatarProfile(payload: InitAvatarRequest): Promise<InitAvatarResponse> {
  return requestJson<InitAvatarResponse, InitAvatarRequest>("/api/avatar/init", payload);
}

export async function chatWithAvatar(payload: {
  userQuestion: string;
  mode: PersonaMode;
  voiceId?: string;
  onDelta?: (fullText: string) => void;
  onDeltaIncrement?: (increment: string) => void;
  onThinking?: () => void;
}): Promise<ChatResponse> {
  const { onDelta, onDeltaIncrement, onThinking, ...body } = payload;

  const response = await fetch(joinUrl(API_BASE_URL, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({})) as { message?: string };
    throw new ApiError(err.message ?? "请求失败", response.status);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("无法读取流式响应");

  const decoder = new TextDecoder();
  let fullReply = "";
  let result: ChatResponse | null = null;
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    sseBuffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr) continue;
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed.type === "delta" && parsed.content) {
          fullReply += parsed.content;
          onDelta?.(fullReply);
          onDeltaIncrement?.(parsed.content);
        } else if (parsed.type === "thinking") {
          onThinking?.();
        } else if (parsed.type === "done") {
          result = {
            reply: parsed.reply,
            references: parsed.references ?? [],
            emotion: parsed.emotion ?? "neutral",
            audioUrl: joinUrl(API_BASE_URL, parsed.audioUrl ?? ""),
            phonemeCues: parsed.phonemeCues ?? [],
          };
        } else if (parsed.type === "error") {
          throw new ApiError(parsed.message ?? "流式响应错误");
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        // JSON 解析失败跳过
      }
    }

    if (done) break;
  }

  if (!result) {
    // fallback：如果没收到 done 事件，用累积的内容构造结果
    result = {
      reply: fullReply || "抱歉，回复异常",
      references: [],
      emotion: "neutral" as AvatarEmotion,
      audioUrl: "",
      phonemeCues: [],
    };
  }

  return result;
}

export async function createVoiceClone(payload: {
  audioUrl: string;
  prefix?: string;
  targetModel?: string;
}): Promise<VoiceCloneCreateResponse> {
  return requestJson<VoiceCloneCreateResponse, typeof payload>("/api/voice/create", payload);
}

export async function listVoiceClones(prefix?: string): Promise<VoiceCloneListResponse> {
  const search = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return requestWithoutBody<VoiceCloneListResponse>(`/api/voice/list${search}`, "GET");
}

export async function queryVoiceClone(voiceId: string): Promise<VoiceCloneQueryResponse> {
  return requestWithoutBody<VoiceCloneQueryResponse>(`/api/voice/${encodeURIComponent(voiceId)}`, "GET");
}

export async function deleteVoiceClone(voiceId: string): Promise<VoiceCloneDeleteResponse> {
  return requestWithoutBody<VoiceCloneDeleteResponse>(
    `/api/voice/${encodeURIComponent(voiceId)}`,
    "DELETE"
  );
}

export interface UploadAudioResponse {
  audioUrl: string;
  filename: string;
  size: number;
}

/**
 * 上传录音文件到后端，返回可访问的 URL
 */
export async function uploadAudio(audioData: string, filename?: string): Promise<UploadAudioResponse> {
  return requestJson<UploadAudioResponse, { audioData: string; filename?: string }>(
    "/api/upload/audio",
    { audioData, filename }
  );
}

/**
 * 获取完整的上传文件 URL
 */
export function getUploadUrl(path: string): string {
  return joinUrl(API_BASE_URL, path);
}
