/**
 * LLM 对话服务 - 人格化对话核心
 * 支持流式和非流式输出
 */
import { LLM_BASE_URL, API_KEYS, MODELS } from '../config.js';

/**
 * 非流式对话
 * @param {Array} messages - 对话消息列表
 * @param {object} options - 可选参数
 * @returns {Promise<object>} - LLM 响应
 */
export async function chat(messages, options = {}) {
  const { model = MODELS.chat, temperature = 0.8 } = options;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEYS.llm}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: false }),
  });

  if (!res.ok) {
    throw new Error(`LLM 请求失败: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * 流式对话 - 返回 ReadableStream
 * @param {Array} messages - 对话消息列表
 * @param {object} options - 可选参数
 * @returns {Promise<Response>} - 原始 fetch Response（流式）
 */
export async function chatStream(messages, options = {}) {
  const { model = MODELS.chat, temperature = 0.8 } = options;

  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEYS.llm}`,
    },
    body: JSON.stringify({ model, messages, temperature, stream: true }),
  });

  if (!res.ok) {
    throw new Error(`LLM 流式请求失败: ${res.status} ${res.statusText}`);
  }
  return res;
}
