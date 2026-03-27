/**
 * 智能对话路由 - 整合角色系统提示词 + Memory + RAG
 * POST /api/chat/smart - 非流式智能对话
 * GET  /api/personas    - 获取可用角色列表
 * POST /api/personas    - 运行时新增/更新角色
 */
import { Router } from 'express';
import { chat, chatStream } from '../services/llm.js';
import { getSystemPrompt, listPersonas, getDefaultPersonaKey, upsertPersona } from '../services/persona.js';
import { getHistory, appendRound, clearSession, searchRelevantMemories } from '../services/memory.js';
import { retrieve } from '../services/rag.js';

const router = Router();

/** 根据回复内容推断情绪 */
function inferEmotion(reply) {
  if (/[！!😊🎉👍太好了|恭喜|不错|很棒|开心]/.test(reply)) return 'happy';
  if (/[思考|分析|让我想想|这个问题|首先|其次]/.test(reply)) return 'thinking';
  return 'neutral';
}

/** 生成模拟口型数据 */
function generatePhonemeCues(text) {
  const len = Math.min(text.length, 60);
  return Array.from({ length: len }, (_, i) => {
    return (Math.sin(i * 0.8) + 1) * 0.35 + Math.random() * 0.3;
  });
}

/**
 * POST /api/chat/smart
 * 请求体: { userQuestion, persona?, sessionId?, voiceId? }
 */
router.post('/smart', async (req, res) => {
  try {
    const {
      userQuestion,
      persona: personaKey,
      sessionId = 'default',
      userId,
    } = req.body;

    if (!userQuestion) {
      return res.status(400).json({ message: 'userQuestion 不能为空' });
    }

    // 1. 获取角色系统提示词
    const systemPrompt = getSystemPrompt(personaKey);
    if (!systemPrompt) {
      return res.status(400).json({
        message: `角色 "${personaKey}" 不存在，可用: ${listPersonas().map(p => p.key).join(', ')}`,
      });
    }

    // 2. RAG 检索（预留，当前返回空）
    const ragResults = await retrieve(userQuestion);
    let ragContext = '';
    if (ragResults.length > 0) {
      ragContext = ragResults.map(r => r.content).join('\n');
    }

    // 2.5 记忆库语义检索（基于用户历史对话记忆）
    let memoryContext = '';
    if (userId) {
      const memories = await searchRelevantMemories(userId, userQuestion, 3);
      if (memories.length > 0) {
        memoryContext = memories
          .filter(m => m.content)
          .map(m => m.content)
          .join('\n');
      }
    }

    // 3. 获取会话历史（Memory）
    const history = getHistory(sessionId);

    // 4. 组装 messages
    const messages = [{ role: 'system', content: systemPrompt }];
    if (ragContext) {
      messages.push({
        role: 'system',
        content: `以下是从知识库中检索到的相关内容，回答时优先参考：\n${ragContext}`,
      });
    }
    if (memoryContext) {
      messages.push({
        role: 'system',
        content: `以下是与用户历史对话中检索到的相关记忆，可作为回答的补充参考：\n${memoryContext}`,
      });
    }
    messages.push(...history);
    messages.push({ role: 'user', content: userQuestion });

    // 5. 流式调用 LLM
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const upstream = await chatStream(messages, { temperature: 0.7 });
    let fullReply = '';
    const decoder = new TextDecoder();
    let sseBuffer = '';

    for await (const chunk of upstream.body) {
      const text = decoder.decode(chunk, { stream: true });
      sseBuffer += text;

      const events = sseBuffer.split('\n\n');
      sseBuffer = events.pop() || '';

      for (const event of events) {
        const lines = event.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]' || !jsonStr) continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullReply += delta.content;
              res.write(`data: ${JSON.stringify({ type: 'delta', content: delta.content })}\n\n`);
            } else if (delta?.reasoning_content) {
              res.write(`data: ${JSON.stringify({ type: 'thinking' })}\n\n`);
            }
          } catch { /* 跳过 */ }
        }
      }
    }

    // 处理 buffer 剩余
    if (sseBuffer.trim()) {
      for (const line of sseBuffer.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === '[DONE]' || !jsonStr) continue;
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed.choices?.[0]?.delta?.content) {
            fullReply += parsed.choices[0].delta.content;
            res.write(`data: ${JSON.stringify({ type: 'delta', content: parsed.choices[0].delta.content })}\n\n`);
          }
        } catch { /* 跳过 */ }
      }
    }

    // 6. 写入 Memory
    appendRound(sessionId, userQuestion, fullReply, userId);

    // 7. 发送完成事件
    res.write(`data: ${JSON.stringify({
      type: 'done',
      reply: fullReply,
      references: ragResults.map(r => r.content).slice(0, 3),
      emotion: inferEmotion(fullReply),
      audioUrl: '',
      phonemeCues: generatePhonemeCues(fullReply),
      sessionId,
      persona: personaKey || getDefaultPersonaKey(),
    })}\n\n`);
    res.end();
  } catch (err) {
    console.error('智能对话异常:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ message: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
      res.end();
    }
  }
});

/** DELETE /api/chat/smart/session/:sessionId - 清除会话 */
router.delete('/smart/session/:sessionId', (req, res) => {
  clearSession(req.params.sessionId);
  res.json({ message: '会话已清除' });
});

/** GET /api/personas - 获取角色列表 */
router.get('/personas', (req, res) => {
  res.json({ personas: listPersonas(), defaultPersona: getDefaultPersonaKey() });
});

/** POST /api/personas - 新增/更新角色 */
router.post('/personas', (req, res) => {
  try {
    const { key, name, description, systemPrompt } = req.body;
    if (!key || !systemPrompt) {
      return res.status(400).json({ message: 'key 和 systemPrompt 不能为空' });
    }
    upsertPersona(key, { name, description, systemPrompt });
    res.json({ message: `角色 "${key}" 已保存`, persona: { key, name, description } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
