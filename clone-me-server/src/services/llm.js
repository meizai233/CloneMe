/**
 * LLM 对话服务 - 人格化对话核心
 * 支持流式和非流式输出
 */
import { LLM_BASE_URL, API_KEYS, MODELS } from '../config.js';

async function postChatCompletions(body) {
  const request = async (payload) =>
    fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEYS.llm}`,
      },
      body: JSON.stringify(payload),
    });

  let res = await request(body);
  // 某些平台不支持 enable_thinking 参数，自动降级重试一次。
  if (!res.ok && body.enable_thinking === false && res.status === 400) {
    const { enable_thinking, ...fallbackBody } = body;
    res = await request(fallbackBody);
  }
  return res;
}

/**
 * 非流式对话
 * @param {Array} messages - 对话消息列表
 * @param {object} options - 可选参数
 * @returns {Promise<object>} - LLM 响应
 */
export async function chat(messages, options = {}) {
  const { model = MODELS.chat, temperature = 0.2, max_tokens = 100 } = options;

  const body = { model, messages, temperature, max_tokens, stream: false, enable_thinking: false };
  if (max_tokens) body.max_tokens = max_tokens;

  const res = await postChatCompletions(body);

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
  const { model = MODELS.chat, temperature = 0.2, max_tokens = 100 } = options;
  const body = { model, messages, temperature, max_tokens, stream: true, enable_thinking: false };
  if (max_tokens) body.max_tokens = max_tokens;

  const res = await postChatCompletions(body);

  if (!res.ok) {
    throw new Error(`LLM 流式请求失败: ${res.status} ${res.statusText}`);
  }
  return res;
}
