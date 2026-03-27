/**
 * CosyVoice 声音克隆服务
 * 通过阿里百炼 API 实现语音克隆：上传音频 → 获得 voice_id → 用克隆声音合成语音
 */

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY ?? 'sk-2b544e6943b34787ae9bdbd95a994c9c';
const CLONE_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';

interface VoiceInfo {
  voice_id: string;
  status: string;
  target_model?: string;
  gmt_create?: string;
  gmt_modified?: string;
}

/**
 * 创建克隆声音
 * @param audioUrl - 公网可访问的音频文件 URL（10-20 秒）
 * @param prefix - 声音名称前缀（字母数字，最多 10 字符）
 * @param targetModel - 目标合成模型，后续 TTS 必须用同一个模型
 */
export async function createClonedVoice(
  audioUrl: string,
  prefix: string = 'cloneme',
  targetModel: string = 'cosyvoice-v2'
): Promise<{ voiceId: string; requestId: string }> {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
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
  return {
    voiceId: data.output?.voice_id,
    requestId: data.request_id,
  };
}

/**
 * 查询已创建的克隆声音列表
 */
export async function listClonedVoices(
  prefix?: string,
  pageIndex: number = 0,
  pageSize: number = 20
): Promise<{ voices: VoiceInfo[]; requestId: string }> {
  const input: Record<string, unknown> = {
    action: 'list_voice',
    page_index: pageIndex,
    page_size: pageSize,
  };
  if (prefix) {
    input.prefix = prefix;
  }

  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voice-enrollment', input }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`查询声音列表失败: ${res.status} ${err}`);
  }

  const data = await res.json();
  return {
    voices: data.output?.voice_list ?? [],
    requestId: data.request_id,
  };
}

/**
 * 查询单个克隆声音状态
 */
export async function queryClonedVoice(
  voiceId: string
): Promise<{ voice: VoiceInfo; requestId: string }> {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
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
  return {
    voice: data.output,
    requestId: data.request_id,
  };
}

/**
 * 删除克隆声音
 */
export async function deleteClonedVoice(
  voiceId: string
): Promise<{ requestId: string }> {
  const res = await fetch(CLONE_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
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
