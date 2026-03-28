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

function estimateSentenceDurationMs(sentence) {
  const content = (sentence || '').trim();
  if (!content) return 220;
  const noSpaceLength = content.replace(/\s+/g, '').length;
  const punctuationCount = (content.match(/[，。！？、,.!?;；:：]/g) || []).length;
  const base = noSpaceLength * 130 + punctuationCount * 80;
  return Math.max(260, Math.min(4200, base));
}

function buildWordTimelineFromText(text, offsetMs = 0) {
  const cleaned = (text || '')
    .replace(/[，。！？、,.!?;；:："'`“”‘’()[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned ? cleaned.split(' ') : [];
  if (words.length === 0) {
    return {
      source: 'word',
      words: [],
      wtimes: [],
      wdurations: [],
    };
  }
  const durationMs = estimateSentenceDurationMs(text);
  const totalWeight = words.reduce((sum, word) => sum + Math.max(1, word.length), 0);
  const minWordMs = 85;
  let cursor = 0;
  const wtimes = [];
  const wdurations = [];
  words.forEach((word, index) => {
    const weight = Math.max(1, word.length);
    const remaining = Math.max(0, durationMs - cursor);
    const proportional =
      index === words.length - 1 ? remaining : (durationMs * weight) / Math.max(1, totalWeight);
    const duration = Math.max(minWordMs, Math.min(remaining || minWordMs, proportional));
    wtimes.push(Math.round(offsetMs + cursor));
    wdurations.push(Math.round(duration));
    cursor += duration;
  });
  return {
    source: 'word',
    words,
    wtimes,
    wdurations,
  };
}

const DEFAULT_AVATAR_EMOTIONS = ['neutral', 'happy', 'thinking', 'serious', 'warm', 'confident'];
const DEFAULT_AVATAR_GESTURES = ['none', 'nod', 'emphasis', 'thinking'];

function normalizeStringList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const list = value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
  if (list.length === 0) return fallback;
  return Array.from(new Set(list));
}

function extractFirstJsonObject(text) {
  if (!text || typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

async function planAvatarBehavior({ userQuestion, reply, personaKey, avatarModel }) {
  if (!avatarModel || typeof avatarModel !== 'object') return null;
  const allowedEmotions = normalizeStringList(avatarModel.allowedEmotions, DEFAULT_AVATAR_EMOTIONS);
  const allowedGestures = normalizeStringList(avatarModel.allowedGestures, DEFAULT_AVATAR_GESTURES);
  const safeModelKey = avatarModel.modelKey || 'generic_live2d';
  const safeModelLabel = avatarModel.modelLabel || safeModelKey;
  const gestureHints =
    avatarModel.gestureHints && typeof avatarModel.gestureHints === 'object'
      ? avatarModel.gestureHints
      : {};

  const plannerMessages = [
    {
      role: 'system',
      content:
        '你是数字人导演，任务是给当前回复挑选最合适的表情和动作。只允许输出 JSON，不要输出 markdown，不要解释。',
    },
    {
      role: 'system',
      content: `当前模型: ${safeModelLabel} (${safeModelKey})\n可用表情: ${allowedEmotions.join(', ')}\n可用动作: ${allowedGestures.join(', ')}\n动作提示: ${JSON.stringify(
        gestureHints
      )}\n输出要求:\n1) 必须输出单个 JSON 对象，不要 markdown，不要代码块\n2) emotion 只能从可用表情中选 1 个\n3) gestures 只能从可用动作中选，最多 2 个；若无需动作必须输出 ["none"]\n4) 投诉/生气优先 serious 或 thinking，并优先 comfortExplain/emphasis\n5) 推荐/优惠优先 confident 或 happy，并优先 promoPitch/discountHighlight\n6) reason 使用简短中文，<= 20 字\n请严格按以下格式输出：{"emotion":"neutral","gestures":["none"],"reason":"简短原因"}`,
    },
    {
      role: 'user',
      content: `用户问题: ${userQuestion}\n角色: ${personaKey}\nAI回复: ${reply}`,
    },
  ];

  try {
    const planning = await chat(plannerMessages, { temperature: 0.2, max_tokens: 200 });
    const content = planning?.choices?.[0]?.message?.content || '';
    const jsonString = extractFirstJsonObject(content);
    if (!jsonString) return null;
    const parsed = JSON.parse(jsonString);
    const emotion = allowedEmotions.includes(parsed.emotion) ? parsed.emotion : allowedEmotions[0];
    const gesturesRaw = Array.isArray(parsed.gestures) ? parsed.gestures : [];
    const gestures = Array.from(
      new Set(
        gesturesRaw
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => allowedGestures.includes(item))
      )
    ).slice(0, 2);
    return {
      emotion,
      gestures: gestures.length > 0 ? gestures : ['none'],
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 30) : '',
    };
  } catch (error) {
    console.warn('[avatar-plan] 规划失败，回退默认策略:', error.message);
    return null;
  }
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
      avatarModel,
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

    // 6.5 让 LLM 根据模型能力挑选表情/动作
    const avatarPlan =
      (await planAvatarBehavior({
        userQuestion,
        reply: fullReply,
        personaKey: personaKey || getDefaultPersonaKey(),
        avatarModel,
      })) || {
        emotion: inferEmotion(fullReply),
        gestures: ['none'],
        reason: 'fallback',
      };

    // 7. 发送完成事件
    res.write(`data: ${JSON.stringify({
      type: 'done',
      reply: fullReply,
      references: ragResults.map(r => r.content).slice(0, 3),
      emotion: inferEmotion(fullReply),
      avatarPlan,
      audioUrl: '',
      phonemeCues: generatePhonemeCues(fullReply),
      lipSyncTimeline: buildWordTimelineFromText(fullReply),
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
