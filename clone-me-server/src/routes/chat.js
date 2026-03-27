/**
 * 对话路由 - 数字人人格化对话
 * POST /api/chat       - 非流式对话
 * POST /api/chat/stream - 流式对话（SSE）
 */
import { Router } from 'express';
import { chat, chatStream } from '../services/llm.js';

const router = Router();

// 非流式对话
router.post('/', async (req, res) => {
  try {
    const { messages, persona, temperature } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }

    // 如果提供了人设，注入 system 消息
    const fullMessages = persona
      ? [{ role: 'system', content: persona }, ...messages]
      : messages;

    const result = await chat(fullMessages, { temperature });
    const content = result.choices?.[0]?.message?.content || '';
    res.json({ content, usage: result.usage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 流式对话（SSE）
router.post('/stream', async (req, res) => {
  try {
    const { messages, persona, temperature } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 必须是数组' });
    }

    const fullMessages = persona
      ? [{ role: 'system', content: persona }, ...messages]
      : messages;

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const upstream = await chatStream(fullMessages, { temperature });

    // 将上游流式响应透传给前端
    upstream.body.on('data', (chunk) => {
      res.write(chunk);
    });

    upstream.body.on('end', () => {
      res.end();
    });

    upstream.body.on('error', (err) => {
      res.write(`data: {"error": "${err.message}"}\n\n`);
      res.end();
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
