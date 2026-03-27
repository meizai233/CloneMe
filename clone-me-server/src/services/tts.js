/**
 * TTS 语音合成服务 - WebSocket 代理
 * 前端通过后端 WebSocket 中转，避免暴露 API Key
 */
import WebSocket from 'ws';
import { TTS_WS_URL, API_KEYS, MODELS } from '../config.js';

/**
 * 创建 TTS WebSocket 连接（供路由层使用）
 * @param {string} voice - 音色名称
 * @returns {WebSocket} - 上游 TTS WebSocket 连接
 */
export function createTTSConnection(voice = 'cherry') {
  const ws = new WebSocket(TTS_WS_URL, {
    headers: {
      'Authorization': `Bearer ${API_KEYS.tts}`,
      'modelName': MODELS.tts,
    },
  });
  return ws;
}

/**
 * 发送文本到 TTS 并获取音频
 * @param {WebSocket} ws - TTS WebSocket 连接
 * @param {string} text - 要合成的文本
 * @param {object} options - 可选参数
 */
export function sendTTSText(ws, text, options = {}) {
  const { responseFormat = 'mp3', voice = 'cherry' } = options;
  ws.send(JSON.stringify({ inputText: text, responseFormat, voice }));
}
