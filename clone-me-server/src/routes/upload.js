/**
 * 文件上传路由
 * POST /api/upload/audio - 上传音频文件，返回可访问的 URL
 */
import { Router } from 'express';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, '../../uploads');

// 确保上传目录存在
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 接收 base64 编码的音频数据
router.post('/audio', (req, res) => {
  try {
    const { audioData, filename } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: 'audioData 不能为空' });
    }

    // audioData 格式: "data:audio/wav;base64,xxxxx" 或纯 base64
    const base64Data = audioData.includes(',') ? audioData.split(',')[1] : audioData;
    const buffer = Buffer.from(base64Data, 'base64');

    const safeName = (filename || `recording_${Date.now()}.wav`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = join(UPLOAD_DIR, safeName);
    writeFileSync(filePath, buffer);

    // 返回可通过后端访问的 URL
    const audioUrl = `/uploads/${safeName}`;
    res.json({ audioUrl, filename: safeName, size: buffer.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
