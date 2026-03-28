/**
 * ASR 语音识别服务 - WebSocket 代理
 * 支持火山豆包双向流式 ASR，需先发 CONFIG_PARAM 再发音频二进制
 */
import WebSocket from 'ws';
import { ASR_WS_URL, API_KEYS, MODELS } from '../config.js';

/** ASR 配置参数（火山豆包 Bigasr-Sauc-Duration） */
const ASR_CONFIG = {
  type: 'CONFIG_PARAM',
  parameters: {
    user: { uid: 'cloneme-server' },
    audio: {
      format: 'pcm',
      rate: 16000,
      bits: 16,
      channel: 1,
      language: 'zh-CN',
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
    },
  },
};

/**
 * 创建 ASR WebSocket 连接
 * 连接建立后自动发送 CONFIG_PARAM，等待 CONFIGURED 确认
 * @returns {{ ws: WebSocket, ready: Promise<void> }}
 */
export function createASRConnection() {
  const ws = new WebSocket(ASR_WS_URL, {
    headers: {
      'Authorization': `Bearer ${API_KEYS.asr}`,
      'modelName': MODELS.asr,
    },
  });

  // ready promise：在收到 CONFIGURED 后 resolve
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  ws.on('open', () => {
    console.log('[ASR] 连接已建立，发送 CONFIG_PARAM...');
    ws.send(JSON.stringify(ASR_CONFIG));
  });

  // 监听 CONFIGURED 响应
  const onConfigured = (data) => {
    if (!Buffer.isBuffer(data)) return;
    try {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.type === 'CONFIGURED') {
        console.log('[ASR] 配置确认，可以开始发送音频');
        resolveReady();
        // 移除此监听器，后续消息由调用方处理
        ws.removeListener('message', onConfigured);
      }
    } catch {
      // 非 JSON 数据忽略
    }
  };
  ws.on('message', onConfigured);

  ws.on('error', (err) => {
    console.error('[ASR] 连接错误:', err.message);
    rejectReady(err);
  });

  ws.on('close', () => {
    rejectReady(new Error('ASR 连接关闭'));
  });

  // 5 秒超时
  setTimeout(() => rejectReady(new Error('ASR CONFIG_PARAM 超时')), 5000);

  return { ws, ready };
}

/**
 * 发送音频结束标记
 */
export function commitASR(ws) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'COMMIT' }));
  }
}

/**
 * 停止 ASR
 */
export function stopASR(ws) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'STOP' }));
  }
}
