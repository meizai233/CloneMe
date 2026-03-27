/**
 * TTS 语音合成服务 - CosyVoice (DashScope WebSocket)
 * 支持克隆声音合成
 */
import WebSocket from 'ws';
import { API_KEYS } from '../config.js';

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/**
 * 创建 CosyVoice TTS 连接
 * @returns {{ ws: WebSocket, taskId: string }}
 */
export function createTTSConnection() {
  const ws = new WebSocket(DASHSCOPE_WS_URL, {
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`, // 阿里百炼 key
    },
  });
  const taskId = 'tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  return { ws, taskId };
}

/**
 * 启动 TTS 任务（发送 run-task 指令）
 */
export function startTTSTask(ws, taskId, voice = 'cosyvoice-v2-cloneme-dd0db46b2684401c8e555db6cf04e424') {
  // 模型名固定为 cosyvoice-v2（从 voiceId 前两段提取）
  const parts = voice.split('-');
  const model = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'cosyvoice-v2';
  console.log('[TTS] startTask model:', model, 'voice:', voice, 'taskId:', taskId);

  ws.send(JSON.stringify({
    header: {
      action: 'run-task',
      task_id: taskId,
      streaming: 'duplex',
    },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model,
      parameters: { voice, format: 'mp3', sample_rate: 22050 },
      input: {},
    },
  }));
}

/**
 * 发送文本到 TTS
 */
export function sendTTSText(ws, taskId, text) {
  ws.send(JSON.stringify({
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  }));
}

/**
 * 结束 TTS 任务
 */
export function finishTTSTask(ws, taskId) {
  ws.send(JSON.stringify({
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }));
}
