/**
 * 图片生成服务 - 数字人形象生成
 */
import { LLM_BASE_URL, API_KEYS, MODELS } from '../config.js';

/**
 * 文生图
 * @param {string} prompt - 图片描述
 * @param {object} options - 可选参数
 * @returns {Promise<object>} - 图片生成结果
 */
export async function generateImage(prompt, options = {}) {
  const { size = '1920x1920', n = 1 } = options;

  const res = await fetch(`${LLM_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEYS.imageGen}`,
    },
    body: JSON.stringify({ model: MODELS.imageGen, prompt, n, size }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`图片生成失败: ${res.status} ${err}`);
  }
  return res.json();
}
