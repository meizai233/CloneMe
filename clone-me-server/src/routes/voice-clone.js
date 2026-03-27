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

// 创建克隆声音
router.post('/create', async (req, res) => {
  try {
    const { audioUrl, prefix, targetModel } = req.body;
    if (!audioUrl) {
      return res.status(400).json({ error: 'audioUrl 不能为空' });
    }
    const result = await createClonedVoice(audioUrl, prefix, targetModel);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
