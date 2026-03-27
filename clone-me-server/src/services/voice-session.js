import { createASRConnection } from './asr.js';
import { chat, chatStream } from './llm.js';
import { getSystemPrompt, getDefaultPersonaKey } from './persona.js';
import { getHistory, appendRound, searchRelevantMemories } from './memory.js';
import { retrieve } from './rag.js';
import { createTTSConnection, startTTSTask, sendTTSText, finishTTSTask } from './tts.js';

function inferEmotion(reply) {
  if (/[！!😊🎉👍太好了|恭喜|不错|很棒|开心]/.test(reply)) return 'happy';
  if (/[思考|分析|让我想想|这个问题|首先|其次]/.test(reply)) return 'thinking';
  return 'neutral';
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
      content: '你是数字人导演，任务是给当前回复挑选最合适的表情和动作。只允许输出 JSON，不要输出 markdown，不要解释。',
    },
    {
      role: 'system',
      content: `当前模型: ${safeModelLabel} (${safeModelKey})\n可用表情: ${allowedEmotions.join(', ')}\n可用动作: ${allowedGestures.join(', ')}\n动作提示: ${JSON.stringify(
        gestureHints
      )}\n规则:\n1) emotion 必须来自可用表情\n2) gestures 最多 2 个，且必须来自可用动作\n3) 投诉/生气场景优先 serious 或 thinking，再配 emphasis/comfortExplain（若可用）\n4) 若不需要动作，可输出 gestures: ["none"]\n输出格式: {"emotion":"...","gestures":["..."],"reason":"不超过20字"}`,
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
    console.warn('[voice-session] avatar-plan 规划失败:', error.message);
    return null;
  }
}

function isAsrFinal(payload) {
  return Boolean(
    payload?.isFinal ||
      payload?.final ||
      payload?.sentenceEnd ||
      payload?.sentence_end ||
      payload?.type === 'final' ||
      payload?.type === 'asr_final' ||
      payload?.event === 'final' ||
      payload?.result?.is_final ||
      payload?.result?.final
  );
}

function extractAsrText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload.text,
    payload.transcript,
    payload.content,
    payload.result?.text,
    payload.result?.transcript,
    payload.payload?.text,
    payload.payload?.result?.text,
  ];
  for (const item of candidates) {
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function createSentenceEmitter(onSentence, minLength = 6, maxLength = 40, hardMaxLength = 60) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      while (buffer.length > 0) {
        let cutIdx = -1;
        const strongMatch = buffer.match(/[。！？\n.!?]/);
        if (strongMatch && strongMatch.index !== undefined) {
          cutIdx = strongMatch.index + 1;
        }
        if (cutIdx === -1 && buffer.length >= maxLength) {
          const searchFrom = buffer.slice(minLength);
          const weakMatch = searchFrom.match(/[，,；;、：:）)]/);
          if (weakMatch && weakMatch.index !== undefined) {
            cutIdx = minLength + weakMatch.index + 1;
          }
        }
        if (cutIdx === -1 && buffer.length >= hardMaxLength) {
          const nearCut = buffer.slice(0, hardMaxLength);
          const lastWeak = Math.max(
            nearCut.lastIndexOf('，'),
            nearCut.lastIndexOf(','),
            nearCut.lastIndexOf('。'),
            nearCut.lastIndexOf('；'),
            nearCut.lastIndexOf('、'),
            nearCut.lastIndexOf('：'),
            nearCut.lastIndexOf(' ')
          );
          cutIdx = lastWeak > minLength ? lastWeak + 1 : maxLength;
        }
        if (cutIdx === -1) break;
        const sentence = buffer.slice(0, cutIdx).trim();
        buffer = buffer.slice(cutIdx);
        if (sentence.length < minLength) {
          buffer = sentence + buffer;
          break;
        }
        onSentence(sentence);
      }
    },
    flush() {
      const remaining = buffer.trim();
      if (remaining) onSentence(remaining);
      buffer = '';
    },
  };
}

function parseSSEChunk(sseBuffer, chunkText, onEvent) {
  let buffer = sseBuffer + chunkText;
  const events = buffer.split('\n\n');
  buffer = events.pop() || '';
  for (const event of events) {
    const lines = event.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') continue;
      try {
        onEvent(JSON.parse(jsonStr));
      } catch {
        // ignore bad json
      }
    }
  }
  return buffer;
}

export function attachVoiceSession(clientWs) {
  const state = {
    sessionId: `voice_${Date.now()}`,
    userId: undefined,
    persona: getDefaultPersonaKey(),
    voiceId: undefined,
    avatarModel: undefined,
    turnId: 0,
    activeTurnId: 0,
    destroyed: false,
  };

  const asrUpstream = createASRConnection();
  let ttsUpstream = null;
  let ttsTaskId = null;
  let ttsTaskStarted = false;
  let ttsCurrentVoice = null;
  let ttsReadyResolvers = [];
  let pendingSentences = [];
  let sseTurnToken = 0;

  function sendJson(payload) {
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify(payload));
    }
  }

  function resolveTTSReady() {
    const pending = ttsReadyResolvers;
    ttsReadyResolvers = [];
    for (const resolve of pending) resolve();
  }

  function resetTTSConnection() {
    pendingSentences = [];
    ttsReadyResolvers = [];
    if (ttsUpstream && ttsUpstream.readyState === 1) {
      try {
        if (ttsTaskStarted) finishTTSTask(ttsUpstream, ttsTaskId);
      } catch {
        // ignore
      }
      ttsUpstream.close();
    }
    ttsUpstream = null;
    ttsTaskId = null;
    ttsTaskStarted = false;
    ttsCurrentVoice = null;
  }

  function bindTTSUpstream(voice) {
    const conn = createTTSConnection();
    ttsUpstream = conn.ws;
    ttsTaskId = conn.taskId;
    ttsTaskStarted = false;
    ttsCurrentVoice = voice;

    ttsUpstream.on('open', () => {
      startTTSTask(ttsUpstream, ttsTaskId, voice || 'cherry');
    });

    ttsUpstream.on('message', (upData) => {
      if (!Buffer.isBuffer(upData)) return;
      const firstByte = upData[0];
      if (firstByte === 123) {
        try {
          const msg = JSON.parse(upData.toString('utf8'));
          const event = msg?.header?.event;
          if (event === 'task-started') {
            ttsTaskStarted = true;
            resolveTTSReady();
            const queued = pendingSentences;
            pendingSentences = [];
            for (const sentence of queued) {
              sendTTSText(ttsUpstream, ttsTaskId, sentence);
            }
            sendJson({ type: 'tts.started', turnId: state.activeTurnId });
            return;
          }
          if (event === 'task-finished') {
            ttsTaskStarted = false;
            sendJson({ type: 'tts.done', turnId: state.activeTurnId });
            return;
          }
        } catch {
          // parse failed, fallback to binary forwarding
        }
      }
      if (clientWs.readyState === 1) {
        clientWs.send(upData);
      }
    });

    ttsUpstream.on('error', () => {
      ttsTaskStarted = false;
    });

    ttsUpstream.on('close', () => {
      ttsTaskStarted = false;
      if (!state.destroyed) {
        ttsUpstream = null;
      }
    });
  }

  async function ensureTTSReady(voice) {
    if (
      ttsUpstream &&
      ttsUpstream.readyState === 1 &&
      ttsTaskStarted &&
      ttsCurrentVoice === (voice || 'cherry')
    ) {
      return;
    }

    if (!ttsUpstream || ttsUpstream.readyState !== 1 || ttsCurrentVoice !== (voice || 'cherry')) {
      resetTTSConnection();
      bindTTSUpstream(voice || 'cherry');
    }

    if (ttsTaskStarted) return;
    await new Promise((resolve, reject) => {
      ttsReadyResolvers.push(resolve);
      setTimeout(() => reject(new Error('TTS task 启动超时')), 6000);
    });
  }

  function interruptCurrentTurn() {
    sseTurnToken += 1;
    state.activeTurnId = 0;
    resetTTSConnection();
    sendJson({ type: 'turn.interrupted' });
  }

  async function streamAssistantReply(userQuestion) {
    state.turnId += 1;
    const currentTurnId = state.turnId;
    state.activeTurnId = currentTurnId;
    const myToken = ++sseTurnToken;

    sendJson({ type: 'turn.started', turnId: currentTurnId });

    try {
      const systemPrompt = getSystemPrompt(state.persona) || getSystemPrompt(getDefaultPersonaKey()) || '你是一个有帮助的数字人助手。';
      const ragResults = await retrieve(userQuestion);
      const history = getHistory(state.sessionId);
      let memoryContext = '';
      if (state.userId) {
        const memories = await searchRelevantMemories(state.userId, userQuestion, 3);
        if (memories.length > 0) {
          memoryContext = memories
            .filter((m) => m.content)
            .map((m) => m.content)
            .join('\n');
        }
      }

      const messages = [{ role: 'system', content: systemPrompt }];
      if (ragResults.length > 0) {
        messages.push({
          role: 'system',
          content: `以下是从知识库中检索到的相关内容，回答时优先参考：\n${ragResults.map((r) => r.content).join('\n')}`,
        });
      }
      if (memoryContext) {
        messages.push({
          role: 'system',
          content: `以下是与用户历史对话中检索到的相关记忆，可作为回答补充参考：\n${memoryContext}`,
        });
      }
      messages.push(...history);
      messages.push({ role: 'user', content: userQuestion });

      const upstream = await chatStream(messages, { temperature: 0.7 });
      let fullReply = '';
      const decoder = new TextDecoder();
      let sseBuffer = '';
      const sentenceEmitter = createSentenceEmitter((sentence) => {
        if (myToken !== sseTurnToken) return;
        if (!sentence) return;
        if (!ttsTaskStarted) {
          pendingSentences.push(sentence);
          return;
        }
        sendTTSText(ttsUpstream, ttsTaskId, sentence);
      });

      await ensureTTSReady(state.voiceId);
      if (myToken !== sseTurnToken) return;

      for await (const chunk of upstream.body) {
        if (myToken !== sseTurnToken) return;
        const text = decoder.decode(chunk, { stream: true });
        sseBuffer = parseSSEChunk(sseBuffer, text, (parsed) => {
          const delta = parsed?.choices?.[0]?.delta;
          if (delta?.content) {
            fullReply += delta.content;
            sentenceEmitter.push(delta.content);
            sendJson({ type: 'llm.delta', turnId: currentTurnId, text: delta.content });
          } else if (delta?.reasoning_content) {
            sendJson({ type: 'llm.thinking', turnId: currentTurnId });
          }
        });
      }

      sentenceEmitter.flush();
      if (ttsUpstream && ttsTaskStarted) {
        finishTTSTask(ttsUpstream, ttsTaskId);
      }

      appendRound(state.sessionId, userQuestion, fullReply, state.userId);

      const avatarPlan =
        (await planAvatarBehavior({
          userQuestion,
          reply: fullReply,
          personaKey: state.persona,
          avatarModel: state.avatarModel,
        })) || {
          emotion: inferEmotion(fullReply),
          gestures: ['none'],
          reason: 'fallback',
        };

      if (myToken !== sseTurnToken) return;

      sendJson({
        type: 'llm.done',
        turnId: currentTurnId,
        reply: fullReply,
        references: ragResults.map((r) => r.content).slice(0, 3),
        emotion: inferEmotion(fullReply),
        avatarPlan,
        sessionId: state.sessionId,
        persona: state.persona,
      });
      state.activeTurnId = 0;
    } catch (error) {
      if (myToken !== sseTurnToken) return;
      sendJson({ type: 'error', stage: 'llm', message: error.message || '语音会话处理失败' });
      state.activeTurnId = 0;
    }
  }

  asrUpstream.on('open', () => {
    sendJson({ type: 'connected', sessionId: state.sessionId, persona: state.persona });
  });

  asrUpstream.on('message', (data) => {
    if (!Buffer.isBuffer(data)) return;
    let payload = null;
    try {
      payload = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }

    const text = extractAsrText(payload);
    if (!text) return;

    if (isAsrFinal(payload)) {
      sendJson({ type: 'asr.final', text });
      interruptCurrentTurn();
      void streamAssistantReply(text);
      return;
    }
    sendJson({ type: 'asr.partial', text });
  });

  asrUpstream.on('error', (err) => {
    sendJson({ type: 'error', stage: 'asr', message: err.message || 'ASR 连接失败' });
  });

  asrUpstream.on('close', () => {
    if (clientWs.readyState === 1) {
      clientWs.close();
    }
  });

  clientWs.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      if (asrUpstream.readyState === 1) {
        asrUpstream.send(data);
      }
      return;
    }

    try {
      const msg = JSON.parse(data.toString());
      const action = msg.type || msg.action;

      if (msg.sessionId) state.sessionId = String(msg.sessionId);
      if (msg.userId) state.userId = String(msg.userId);
      if (msg.persona) state.persona = String(msg.persona);
      if (typeof msg.voiceId === 'string') state.voiceId = msg.voiceId || undefined;
      if (msg.avatarModel && typeof msg.avatarModel === 'object') state.avatarModel = msg.avatarModel;

      if (action === 'interrupt') {
        interruptCurrentTurn();
        return;
      }

      if (action === 'start') {
        sendJson({
          type: 'session.ready',
          sessionId: state.sessionId,
          persona: state.persona,
          voiceId: state.voiceId || 'cherry',
        });
        return;
      }

      if (action === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
        interruptCurrentTurn();
        sendJson({ type: 'asr.final', text: msg.text.trim(), mock: true });
        void streamAssistantReply(msg.text.trim());
        return;
      }
    } catch {
      // ignore invalid control payload
    }
  });

  clientWs.on('close', () => {
    state.destroyed = true;
    interruptCurrentTurn();
    if (asrUpstream.readyState === 1) {
      asrUpstream.close();
    }
    resetTTSConnection();
  });
}
