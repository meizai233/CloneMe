/**
 * 视频生成服务 - 图生视频（阿里百炼直连）
 * 异步任务模式：提交任务 → 轮询结果
 */
import { DASHSCOPE_BASE_URL, API_KEYS } from '../config.js';

/**
 * 提交图生视频任务
 * @param {string} imageUrl - 首帧图片 URL
 * @param {string} prompt - 视频描述
 * @returns {Promise<object>} - 包含 task_id 的响应
 */
export async function createVideoTask(imageUrl, prompt) {
  const res = await fetch(`${DASHSCOPE_BASE_URL}/services/aigc/video-generation/generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEYS.video}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify({
      model: 'wan2.6-i2v-flash',
      input: { image_url: imageUrl, prompt },
      parameters: { resolution: '720p' },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`视频生成任务提交失败: ${res.status} ${err}`);
  }
  return res.json();
}

/**
 * 查询视频生成任务结果
 * @param {string} taskId - 任务 ID
 * @returns {Promise<object>} - 任务状态和结果
 */
export async function getVideoTaskResult(taskId) {
  const res = await fetch(`${DASHSCOPE_BASE_URL}/tasks/${taskId}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${API_KEYS.video}` },
  });

  if (!res.ok) {
    throw new Error(`查询视频任务失败: ${res.status}`);
  }
  return res.json();
}
