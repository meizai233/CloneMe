/**
 * 声音克隆路由
 * POST   /api/voice/create     - 创建克隆声音
 * GET    /api/voice/list        - 查询声音列表
 * GET    /api/voice/:voiceId    - 查询声音状态
 * DELETE /api/voice/:voiceId    - 删除声音
 */
import { Router } from 'express';
import { createClonedVoice, listClonedVoices, queryClonedVoice, deleteClonedVoice } from '../services/voice-clone.js';

const router = Router();

/**
 * CosyVoice 错误码 → 友好提示
 */
const VOICE_ERROR_MAP = {
  'Audio.AudioShortError': '录音时长太短，请录制 10~20 秒的语音样本后重试。',
  'Audio.DecoderError': '音频格式无法识别，请使用 WAV 或 MP3 格式的音频文件。',
  'Audio.AudioLongError': '录音时长过长，请控制在 30 秒以内。',
  'InvalidParameter': '参数错误，请检查输入后重试。',
  'Throttling': '请求过于频繁，请稍后再试。',
};

function friendlyVoiceError(rawError) {
  try {
    const parsed = JSON.parse(rawError.match(/\{.*\}/s)?.[0] || '{}');
    const code = parsed.code || '';
    return VOICE_ERROR_MAP[code] || `声音克隆失败：${parsed.message || rawError}`;
  } catch {
    return `声音克隆失败：${rawError}`;
  }
}

// 创建克隆声音
router.post('/create', async (req, res) => {
  try {
    const { audioUrl, prefix: rawPrefix, targetModel } = req.body;
    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl 不能为空' });
    }
    // prefix 只允许英文字母和数字，最多 10 字符
    const prefix = (rawPrefix || 'cloneme').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 'cloneme';
    const result = await createClonedVoice(audioUrl, prefix, targetModel);
    res.json(result);
  } catch (err) {
    const friendly = friendlyVoiceError(err.message);
    res.status(400).json({ error: friendly });
  }
});

// 查询声音列表
router.get('/list', async (req, res) => {
  try {
    const result = await listClonedVoices(req.query.prefix);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 查询单个声音状态
router.get('/:voiceId', async (req, res) => {
  try {
    const result = await queryClonedVoice(req.params.voiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除声音
router.delete('/:voiceId', async (req, res) => {
  try {
    const result = await deleteClonedVoice(req.params.voiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
