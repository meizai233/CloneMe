/**
 * 文件上传路由
 * POST /api/upload/audio - 上传音频，自动传到 OSS 返回公网 URL
 */
import { Router } from 'express';
import { uploadBufferToOSS } from '../services/oss-upload.js';

const router = Router();

// 接收 base64 编码的音频数据，上传到 OSS
router.post('/audio', async (req, res) => {
  try {
    const { audioData, filename } = req.body;
    if (!audioData) {
      return res.status(400).json({ error: 'audioData 不能为空' });
    }

    // audioData 格式: "data:audio/webm;base64,xxxxx" 或纯 base64
    const base64Data = audioData.includes(',') ? audioData.split(',')[1] : audioData;
    const buffer = Buffer.from(base64Data, 'base64');

    // OSS 网关不支持 audio/webm，统一用 audio/mpeg 上传
    const contentType = 'audio/mpeg';
    const safeName = (filename || `voice_${Date.now()}.mp3`).replace(/[^a-zA-Z0-9._-]/g, '_');

    // 上传到 OSS，获取公网 URL
    const ossUrl = await uploadBufferToOSS(buffer, safeName, contentType);

    res.json({ audioUrl: ossUrl, filename: safeName, size: buffer.length });
  } catch (err) {
    console.error('音频上传失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
