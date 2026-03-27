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
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 12000;

class ApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "ApiError";
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) {
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

export async function initAvatarProfile(payload: InitAvatarRequest): Promise<InitAvatarResponse> {
  return requestJson<InitAvatarResponse, InitAvatarRequest>("/api/avatar/init", payload);
}

export async function chatWithAvatar(payload: {
  userQuestion: string;
  mode: PersonaMode;
}): Promise<ChatResponse> {
  const data = await requestJson<ChatResponse, { userQuestion: string; mode: PersonaMode }>(
    "/api/chat",
    payload
  );

  return {
    ...data,
    audioUrl: joinUrl(API_BASE_URL, data.audioUrl)
  };
}
