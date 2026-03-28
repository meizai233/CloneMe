import { createASRConnection } from './asr.js';
import { chat, chatStream } from './llm.js';
import { getSystemPrompt, getDefaultPersonaKey } from './persona.js';
import { getHistory, appendRound, searchRelevantMemories } from './memory.js';
import { retrieve } from './rag.js';
import { createTTSConnection, startTTSTask, sendTTSText, finishTTSTask } from './tts.js';

const TTS_DEBUG = process.env.TTS_DEBUG === '1';

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

function firstAllowed(list, candidates, fallback) {
  for (const item of candidates) {
    if (list.includes(item)) return item;
  }
  return fallback;
}

function buildRuleBasedAvatarPlan({ userQuestion, reply, allowedEmotions, allowedGestures }) {
  const q = (userQuestion || '').toLowerCase();
  const r = (reply || '').toLowerCase();
  const merged = `${q}\n${r}`;
  const hasNegative = /(生气|投诉|不满|差评|退款|故障|失败|问题|抱歉|很遗憾|焦虑|担心)/.test(merged);
  const hasThinking = /(分析|原因|步骤|首先|其次|建议|排查|方案|解释|如何)/.test(merged);
  const hasPromo = /(推荐|套餐|优惠|折扣|活动|划算|价格|方案)/.test(merged);
  const hasPositive = /(太好了|恭喜|成功|完成|没问题|放心|可以|赞|开心)/.test(merged);

  const fallbackEmotion = allowedEmotions[0] || 'neutral';
  const emotion = hasNegative
    ? firstAllowed(allowedEmotions, ['serious', 'warm', 'thinking', 'neutral'], fallbackEmotion)
    : hasPromo
      ? firstAllowed(allowedEmotions, ['confident', 'excited', 'happy', 'neutral'], fallbackEmotion)
      : hasThinking
        ? firstAllowed(allowedEmotions, ['thinking', 'neutral'], fallbackEmotion)
        : hasPositive
          ? firstAllowed(allowedEmotions, ['happy', 'warm', 'neutral'], fallbackEmotion)
          : firstAllowed(allowedEmotions, ['neutral', 'warm', 'happy'], fallbackEmotion);

  const gesturePool = [];
  if (hasNegative) gesturePool.push('comfortExplain', 'emphasis');
  if (hasPromo) gesturePool.push('discountHighlight', 'promoPitch', 'emphasis');
  if (hasThinking) gesturePool.push('thinking', 'nod');
  if (hasPositive) gesturePool.push('clap', 'openArms', 'nod');
  gesturePool.push('nod', 'none');

  const gestures = [];
  for (const candidate of gesturePool) {
    if (!allowedGestures.includes(candidate)) continue;
    if (candidate === 'none' && gestures.length > 0) continue;
    if (!gestures.includes(candidate)) gestures.push(candidate);
    if (gestures.length >= 2) break;
  }

  return {
    emotion,
    gestures: gestures.length > 0 ? gestures : ['none'],
    reason: 'rule-based fallback',
  };
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
    if (!jsonString) {
      return buildRuleBasedAvatarPlan({ userQuestion, reply, allowedEmotions, allowedGestures });
    }
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
    return buildRuleBasedAvatarPlan({ userQuestion, reply, allowedEmotions, allowedGestures });
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

function estimateSentenceDurationMs(sentence) {
  const content = (sentence || '').trim();
  if (!content) return 220;
  const noSpaceLength = content.replace(/\s+/g, '').length;
  const punctuationCount = (content.match(/[，。！？、,.!?;；:：]/g) || []).length;
  const base = noSpaceLength * 130 + punctuationCount * 80;
  return Math.max(260, Math.min(4200, base));
}

function buildWordTimelineFromSentence(sentence, offsetMs = 0) {
  const cleaned = (sentence || '')
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
      durationMs: 0,
    };
  }
  const estimatedDuration = estimateSentenceDurationMs(sentence);
  const totalWeight = words.reduce((sum, word) => sum + Math.max(1, word.length), 0);
  const minWordMs = 85;
  let cursor = 0;
  const wtimes = [];
  const wdurations = [];
  words.forEach((word, index) => {
    const weight = Math.max(1, word.length);
    const remaining = Math.max(0, estimatedDuration - cursor);
    const proportional =
      index === words.length - 1 ? remaining : (estimatedDuration * weight) / Math.max(1, totalWeight);
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
    durationMs: Math.round(cursor),
  };
}

function asNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return [];
}

function extractProviderLipSyncTimeline(message) {
  const visemesRaw = firstNonEmpty(
    message?.visemes,
    message?.result?.visemes,
    message?.payload?.result?.visemes,
    message?.payload?.output?.visemes,
    message?.output?.visemes
  );
  const visemes = asStringArray(visemesRaw);
  if (visemes.length > 0) {
    const vtimes = asNumberArray(
      firstNonEmpty(
        message?.vtimes,
        message?.timestamps,
        message?.result?.vtimes,
        message?.result?.timestamps,
        message?.payload?.result?.vtimes,
        message?.payload?.result?.timestamps,
        message?.payload?.output?.vtimes,
        message?.payload?.output?.timestamps,
        message?.output?.vtimes,
        message?.output?.timestamps
      )
    );
    const vdurationsRaw = asNumberArray(
      firstNonEmpty(
        message?.vdurations,
        message?.durations,
        message?.result?.vdurations,
        message?.result?.durations,
        message?.payload?.result?.vdurations,
        message?.payload?.result?.durations,
        message?.payload?.output?.vdurations,
        message?.payload?.output?.durations,
        message?.output?.vdurations,
        message?.output?.durations
      )
    );
    const alignedTimes = vtimes.length === visemes.length ? vtimes : visemes.map((_, index) => index * 80);
    const alignedDurations =
      vdurationsRaw.length === visemes.length ? vdurationsRaw : visemes.map(() => 80);
    return {
      source: 'viseme',
      visemes,
      vtimes: alignedTimes,
      vdurations: alignedDurations,
    };
  }

  const words = asStringArray(
    firstNonEmpty(
      message?.words,
      message?.result?.words,
      message?.payload?.result?.words,
      message?.payload?.output?.words,
      message?.output?.words
    )
  );
  if (words.length > 0) {
    const wtimes = asNumberArray(
      firstNonEmpty(
        message?.wtimes,
        message?.result?.wtimes,
        message?.payload?.result?.wtimes,
        message?.payload?.output?.wtimes,
        message?.output?.wtimes
      )
    );
    const wdurations = asNumberArray(
      firstNonEmpty(
        message?.wdurations,
        message?.result?.wdurations,
        message?.payload?.result?.wdurations,
        message?.payload?.output?.wdurations,
        message?.output?.wdurations
      )
    );
    if (wtimes.length === words.length && wdurations.length === words.length) {
      return {
        source: 'word',
        words,
        wtimes,
        wdurations,
      };
    }
  }
  return null;
}

function debugTTSPayload(message, providerTimeline) {
  if (!TTS_DEBUG || !message || typeof message !== 'object') return;
  const payload = message;
  const headerEvent = payload?.header?.event;
  const timelineSummary = providerTimeline
    ? providerTimeline.source === 'viseme'
      ? {
          source: 'viseme',
          visemeCount: providerTimeline.visemes?.length ?? 0,
          hasVtimes: Array.isArray(providerTimeline.vtimes),
          hasVdurations: Array.isArray(providerTimeline.vdurations),
        }
      : {
          source: 'word',
          wordCount: providerTimeline.words?.length ?? 0,
          hasWtimes: Array.isArray(providerTimeline.wtimes),
          hasWdurations: Array.isArray(providerTimeline.wdurations),
        }
    : null;
  const directFields = {
    hasPhonemes: Array.isArray(payload?.phonemes),
    hasVisemes: Array.isArray(payload?.visemes),
    hasWords: Array.isArray(payload?.words),
    hasVtimes: Array.isArray(payload?.vtimes) || Array.isArray(payload?.timestamps),
    hasWtimes: Array.isArray(payload?.wtimes),
  };
  console.log('[TTS_DEBUG] upstream json', {
    headerEvent: headerEvent || null,
    keys: Object.keys(payload).slice(0, 20),
    directFields,
    timelineSummary,
  });
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
    partialText: '',
    partialUpdatedAt: 0,
    partialTimer: null,
    lastCommittedText: '',
    lastCommittedAt: 0,
  };

  const asrUpstream = createASRConnection();
  let ttsUpstream = null;
  let ttsTaskId = null;
  let ttsTaskStarted = false;
  let ttsCurrentVoice = null;
  let ttsReadyResolvers = [];
  let pendingSentences = [];
  let ttsTimelineCursorMs = 0;
  let lastProviderLipSyncKey = '';
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
    ttsTimelineCursorMs = 0;
    lastProviderLipSyncKey = '';
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
          const providerTimeline = extractProviderLipSyncTimeline(msg);
          debugTTSPayload(msg, providerTimeline);
          if (providerTimeline && state.activeTurnId > 0) {
            const signature = JSON.stringify(providerTimeline).slice(0, 600);
            if (signature !== lastProviderLipSyncKey) {
              lastProviderLipSyncKey = signature;
              sendJson({
                type: 'tts.lipsync',
                turnId: state.activeTurnId,
                ...providerTimeline,
              });
            }
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
    const previousTurnId = state.activeTurnId;
    sseTurnToken += 1;
    state.activeTurnId = 0;
    resetTTSConnection();
    sendJson({ type: 'turn.interrupted', turnId: previousTurnId });
  }

  function pushTTSLipSyncSentence(sentence, turnId) {
    const timeline = buildWordTimelineFromSentence(sentence, ttsTimelineCursorMs);
    ttsTimelineCursorMs += timeline.durationMs;
    sendJson({
      type: 'tts.lipsync',
      turnId,
      source: timeline.source,
      words: timeline.words,
      wtimes: timeline.wtimes,
      wdurations: timeline.wdurations,
      text: sentence,
    });
  }

  function clearPartialTimer() {
    if (state.partialTimer) {
      clearTimeout(state.partialTimer);
      state.partialTimer = null;
    }
  }

  function shouldSkipDuplicateCommit(text) {
    const now = Date.now();
    if (!state.lastCommittedText) return false;
    return state.lastCommittedText === text && now - state.lastCommittedAt < 1500;
  }

  function commitRecognizedText(text, source = 'asr.final') {
    const safeText = (text || '').trim();
    if (!safeText) return;
    if (shouldSkipDuplicateCommit(safeText)) return;

    state.lastCommittedText = safeText;
    state.lastCommittedAt = Date.now();
    state.partialText = '';
    state.partialUpdatedAt = 0;
    clearPartialTimer();

    sendJson({ type: 'asr.final', text: safeText, source });
    interruptCurrentTurn();
    void streamAssistantReply(safeText);
  }

  function schedulePartialCommit() {
    clearPartialTimer();
    state.partialTimer = setTimeout(() => {
      const idleMs = Date.now() - state.partialUpdatedAt;
      if (!state.partialText) {
        clearPartialTimer();
        return;
      }
      if (idleMs < 900) {
        schedulePartialCommit();
        return;
      }
      commitRecognizedText(state.partialText, 'vad.timeout');
    }, 320);
  }

  async function streamAssistantReply(userQuestion) {
    state.turnId += 1;
    const currentTurnId = state.turnId;
    state.activeTurnId = currentTurnId;
    ttsTimelineCursorMs = 0;
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
        pushTTSLipSyncSentence(sentence, currentTurnId);
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
      commitRecognizedText(text, 'asr.final');
      return;
    }
    state.partialText = text;
    state.partialUpdatedAt = Date.now();
    sendJson({ type: 'asr.partial', text });
    schedulePartialCommit();
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
        commitRecognizedText(msg.text.trim(), 'text.input');
        return;
      }
    } catch {
      // ignore invalid control payload
    }
  });

  clientWs.on('close', () => {
    state.destroyed = true;
    clearPartialTimer();
    interruptCurrentTurn();
    if (asrUpstream.readyState === 1) {
      asrUpstream.close();
    }
    resetTTSConnection();
  });
}
