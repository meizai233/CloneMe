/**
 * TTS 语音合成服务 - CosyVoice (DashScope WebSocket)
 * 支持克隆声音合成
 */
import WebSocket from 'ws';
import { API_KEYS } from '../config.js';

const DASHSCOPE_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

/**
 * 创建 CosyVoice TTS 连接
 */
export function createTTSConnection() {
  const ws = new WebSocket(DASHSCOPE_WS_URL, {
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`,
    },
  });
  const taskId = 'tts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  return { ws, taskId };
}

/**
 * 启动 TTS 任务
 */
export function startTTSTask(ws, taskId, voice = 'cosyvoice-v2') {
  const parts = voice.split('-');
  const model = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : 'cosyvoice-v2';
  console.log('[TTS] startTask model:', model, 'voice:', voice);

  try {
    ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model,
        parameters: { voice, format: 'mp3', sample_rate: 22050 },
        input: {},
      },
    }));
  } catch (err) {
    console.error('[TTS] startTask send error:', err.message);
  }
}

/**
 * 发送文本到 TTS
 */
export function sendTTSText(ws, taskId, text) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  }));
}

/**
 * 结束 TTS 任务
 */
export function finishTTSTask(ws, taskId) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  }));
}
