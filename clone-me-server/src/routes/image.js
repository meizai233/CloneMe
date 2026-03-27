/**
 * 图片生成路由
 * POST /api/image/generate - 文生图
 */
import { Router } from 'express';
import { generateImage } from '../services/image.js';

const router = Router();

router.post('/generate', async (req, res) => {
  try {
    const { prompt, size } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt 不能为空' });
    }
    const result = await generateImage(prompt, { size });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
