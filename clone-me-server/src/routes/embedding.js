/**
 * Embedding 路由
 * POST /api/embedding - 文本向量化
 */
import { Router } from 'express';
import { embed } from '../services/embedding.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ error: 'input 不能为空' });
    }
    const result = await embed(input);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
