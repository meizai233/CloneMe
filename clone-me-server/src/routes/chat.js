/**
 * 对话路由 - 数字人人格化对话
 * POST /api/chat       - 对话（返回 reply + emotion + audioUrl + phonemeCues）
 * POST /api/chat/stream - 流式对话（SSE）
 */
import { Router } from 'express';
import { chat, chatStream } from '../services/llm.js';

const router = Router();

// 人设 prompt 模板
const PERSONA_PROMPTS = {
  teacher: '你是一位知识博主的AI数字分身，以老师的身份回答问题。说话风格专业严谨但通俗易懂，善于用类比和举例帮助理解。回答要有条理，分点阐述。',
  friend: '你是一位知识博主的AI数字分身，以朋友的身份聊天。说话风格轻松幽默，像朋友间聊天一样自然，偶尔开个玩笑，但内容要有干货。',
  support: '你是一位知识博主的AI数字分身，以客服的身份提供帮助。说话风格耐心细致，先理解用户问题，再给出清晰的解决方案，必要时追问细节。',
};

// 知识库上下文（由 /api/avatar/init 注入）
let knowledgeContext = [];

/**
 * 设置知识库上下文（供 app.js 中的 init 路由调用）
 */
export function setKnowledgeContext(docs) {
  knowledgeContext = docs || [];
}

/**
 * 根据回复内容推断情绪
 */
function inferEmotion(reply) {
  if (/[！!😊🎉👍太好了|恭喜|不错|很棒|开心]/.test(reply)) return 'happy';
  if (/[思考|分析|让我想想|这个问题|首先|其次]/.test(reply)) return 'thinking';
  return 'neutral';
}

/**
 * 生成模拟的口型数据（基于文本长度）
 */
function generatePhonemeCues(text) {
  const len = Math.min(text.length, 60);
  return Array.from({ length: len }, (_, i) => {
    // 模拟说话时嘴巴开合的节奏
    return (Math.sin(i * 0.8) + 1) * 0.35 + Math.random() * 0.3;
  });
}

// 非流式对话（匹配前端 chatWithAvatar 的接口格式）
router.post('/', async (req, res) => {
  try {
    const { userQuestion, mode = 'teacher', voiceId } = req.body;
    if (!userQuestion) {
      return res.status(400).json({ message: 'userQuestion 不能为空' });
    }

    // 构建消息列表
    const systemPrompt = PERSONA_PROMPTS[mode] || PERSONA_PROMPTS.teacher;
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // 注入知识库上下文
    if (knowledgeContext.length > 0) {
      messages.push({
        role: 'system',
        content: `以下是你的知识库内容，回答时优先参考：\n${knowledgeContext.join('\n')}`,
      });
    }

    messages.push({ role: 'user', content: userQuestion });

    // 调用 LLM
    const result = await chat(messages, { temperature: 0.8 });
    const reply = result.choices?.[0]?.message?.content || '抱歉，我暂时无法回答这个问题。';

    // 推断情绪
    const emotion = inferEmotion(reply);

    // 生成口型数据
    const phonemeCues = generatePhonemeCues(reply);

    // 从知识库中提取相关引用
    const references = knowledgeContext.length > 0
      ? knowledgeContext.filter((doc) => {
          const keywords = userQuestion.split(/\s+/).filter((w) => w.length > 1);
          return keywords.some((kw) => doc.includes(kw));
        }).slice(0, 3)
      : [];

    res.json({
      reply,
      references,
      emotion,
      audioUrl: '', // TTS 音频由前端通过 WebSocket 获取，这里留空
      phonemeCues,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
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

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const upstream = await chatStream(fullMessages, { temperature });

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
