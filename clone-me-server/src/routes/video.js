/**
 * 视频生成路由
 * POST /api/video/create   - 提交图生视频任务
 * GET  /api/video/task/:id  - 查询任务结果
 */
import { Router } from 'express';
import { createVideoTask, getVideoTaskResult } from '../services/video.js';

const router = Router();

router.post('/create', async (req, res) => {
  try {
    const { imageUrl, prompt } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'imageUrl 不能为空' });
    }
    const result = await createVideoTask(imageUrl, prompt || '一个人正在微笑着说话');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/task/:id', async (req, res) => {
  try {
    const result = await getVideoTaskResult(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
