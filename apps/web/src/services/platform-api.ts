/**
 * SaaS 平台 API 层
 * 认证、数字人管理、模型管理
 */

const envApiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE = envApiBase || `${window.location.protocol}//${window.location.hostname}:3001`;

function getToken(): string | null {
  return localStorage.getItem("cloneme_token");
}

export function setToken(token: string) {
  localStorage.setItem("cloneme_token", token);
}

export function clearToken() {
  localStorage.removeItem("cloneme_token");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "请求失败");
  return data as T;
}

// ========== 认证 ==========

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

export async function register(email: string, password: string, name: string) {
  const data = await request<{ token: string; user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  setToken(data.token);
  return data;
}

export async function login(email: string, password: string) {
  const data = await request<{ token: string; user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function getMe() {
  return request<{ user: User; tenant: { name: string; plan: string } }>("/api/auth/me");
}

export function logout() {
  clearToken();
}

// ========== 数字人 ==========

export interface Avatar {
  id: string;
  name: string;
  description: string;
  greeting: string;
  persona_prompt: string;
  llm_model: string;
  temperature: number;
  voice_id: string;
  voice_name?: string;
  voice_model: string;
  live2d_model_id: string;
  model_name?: string;
  model_thumbnail?: string;
  model_url?: string;
  status: string;
  docCount?: number;
}

export async function listAvatars() {
  return request<{ avatars: Avatar[] }>("/api/avatars");
}

export async function getAvatar(id: string) {
  return request<{ avatar: Avatar }>(`/api/avatars/${id}`);
}

export async function createAvatar(data: Partial<Avatar>) {
  return request<{ id: string }>("/api/avatars", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateAvatar(id: string, data: Partial<Avatar>) {
  return request<{ message: string }>(`/api/avatars/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteAvatar(id: string) {
  return request<{ message: string }>(`/api/avatars/${id}`, { method: "DELETE" });
}

// ========== 模型 ==========

export interface Live2DModel {
  id: string;
  name: string;
  description: string;
  thumbnail_url: string;
  model_url: string;
  category: string;
  price: number;
  is_free: number;
  status: string;
}

export async function listAvailableModels() {
  return request<{ models: Live2DModel[] }>("/api/models/available");
}

export async function listAllModels() {
  return request<{ models: Live2DModel[] }>("/api/models");
}


// ========== 管理员模型管理 ==========

export async function listAdminModels() {
  return request<{ models: Live2DModel[] }>("/api/models/admin/all");
}

export async function createModel(data: Partial<Live2DModel>) {
  return request<{ id: string; message: string }>("/api/models/admin", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateModel(id: string, data: Partial<Live2DModel>) {
  return request<{ message: string }>(`/api/models/admin/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function setModelStatus(id: string, status: "active" | "disabled") {
  return request<{ message: string }>(`/api/models/admin/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function deleteModel(id: string) {
  return request<{ message: string }>(`/api/models/admin/${id}`, { method: "DELETE" });
}

// ========== 声音管理 ==========

export interface VoiceInfo {
  id: string;
  voice_id: string;
  speaker_name: string;
  audio_url: string;
  status: string;
  created_at?: string;
}

export async function listVoices(prefix?: string) {
  const qs = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
  return request<{ voices: VoiceInfo[] }>(`/api/voice/list${qs}`);
}

export async function createVoice(audioUrl: string, prefix: string, speakerName: string, targetModel?: string) {
  return request<{ voiceId: string }>("/api/voice/create", {
    method: "POST",
    body: JSON.stringify({ audioUrl, prefix, speakerName, targetModel }),
  });
}

export async function deleteVoice(voiceId: string) {
  return request<{ message: string }>(`/api/voice/${voiceId}`, { method: "DELETE" });
}

export async function uploadAudioFile(base64Data: string, fileName: string) {
  return request<{ audioUrl: string }>("/api/upload/audio", {
    method: "POST",
    body: JSON.stringify({ audioData: base64Data, fileName }),
  });
}

export function getFullUploadUrl(path: string): string {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}
