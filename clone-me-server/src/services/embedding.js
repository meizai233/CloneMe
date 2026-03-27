/**
 * Embedding 向量化服务 - 知识库检索基础
 */
import { LLM_BASE_URL, API_KEYS, MODELS } from '../config.js';

/**
 * 文本向量化
 * @param {string|string[]} input - 待向量化的文本
 * @returns {Promise<object>} - 向量化结果
 */
export async function embed(input) {
  const res = await fetch(`${LLM_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEYS.embedding}`,
    },
    body: JSON.stringify({ model: MODELS.embedding, input }),
  });

  if (!res.ok) {
    throw new Error(`Embedding 请求失败: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
