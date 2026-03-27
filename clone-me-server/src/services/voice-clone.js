/**
 * CosyVoice 声音克隆服务
 * 通过阿里百炼 API 实现语音克隆：上传音频 → 获得 voice_id → 用克隆声音合成语音
 */
import { API_KEYS, DASHSCOPE_BASE_URL } from '../config.js';

const CLONE_API_URL = `${DASHSCOPE_BASE_URL}/services/audio/tts/customization`;

/**
 * 创建克隆声音
 * @param {string} audioUrl - 公网可访问的音频文件 URL（10-20 秒）
 * @param {string} prefix - 声音名称前缀（字母数字，最多 10 字符）
 * @param {string} targetModel - 目标合成模型
 */
export async function createClonedVoice(audioUrl, prefix = 'cloneme', targetModel = 'cosyvoice-v2') {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voice-enrollment',
      input: {
        action: 'create_voice',
        target_model: targetModel,
        prefix,
        url: audioUrl,
        language_hints: ['zh'],
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`声音克隆失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { voiceId: data.output?.voice_id, requestId: data.request_id };
}

/**
 * 查询已创建的克隆声音列表
 */
export async function listClonedVoices(prefix, pageIndex = 0, pageSize = 20) {
  const input = { action: 'list_voice', page_index: pageIndex, page_size: pageSize };
  if (prefix) input.prefix = prefix;

  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voice-enrollment', input }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`查询声音列表失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { voices: data.output?.voice_list ?? [], requestId: data.request_id };
}

/**
 * 查询单个克隆声音状态
 */
export async function queryClonedVoice(voiceId) {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voice-enrollment',
      input: { action: 'query_voice', voice_id: voiceId },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`查询声音失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { voice: data.output, requestId: data.request_id };
}

/**
 * 删除克隆声音
 */
export async function deleteClonedVoice(voiceId) {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEYS.video}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voice-enrollment',
      input: { action: 'delete_voice', voice_id: voiceId },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`删除声音失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return { requestId: data.request_id };
}
