/**
 * ASR 语音识别服务 - WebSocket 代理
 * 前端通过后端 WebSocket 中转，避免暴露 API Key
 */
import WebSocket from 'ws';
import { ASR_WS_URL, API_KEYS, MODELS } from '../config.js';

/**
 * 创建 ASR WebSocket 连接（供路由层使用）
 * @returns {WebSocket} - 上游 ASR WebSocket 连接
 */
export function createASRConnection() {
  const ws = new WebSocket(ASR_WS_URL, {
    headers: {
      'Authorization': `Bearer ${API_KEYS.asr}`,
      'modelName': MODELS.asr,
    },
  });
  return ws;
}
