import { createASRConnection, commitASR } from './asr.js';
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
  // 火山豆包的 definite 只表示某个 utterance 已确认，不代表用户说完
  // 用户说完的判断完全交给静默检测，这里不做 final 判断
  if (payload?._volcParsed) {
    return false;
  }
  // 通用格式兼容（非火山豆包的 ASR 服务）
  return Boolean(
    payload?.isFinal ||
      payload?.final ||
      payload?.sentenceEnd ||
      payload?.sentence_end ||
      payload?.type === 'final' ||
      payload?.type === 'asr_final' ||
      payload?.type === 'conversation.item.input_audio_transcription.completed' ||
      payload?.event === 'final' ||
      payload?.result?.is_final ||
      payload?.result?.final
  );
}

function extractAsrText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  // 火山豆包格式：从 payloadMsg 中解析
  if (payload?._volcParsed) {
    return payload._volcParsed?.result?.text?.trim() || '';
  }
  // 通用格式兼容
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

/**
 * 解析火山豆包 ASR 响应，将 payloadMsg JSON 字符串解析出来
 */
function parseVolcAsrResponse(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (typeof raw.payloadMsg === 'string') {
    try {
      const parsed = JSON.parse(raw.payloadMsg);
      return { ...raw, _volcParsed: parsed };
    } catch {
      return raw;
    }
  }
  return raw;
}

function createSentenceEmitter(onSentence, minLength = 12, maxLength = 60, hardMaxLength = 80) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      while (buffer.length > 0) {
        let cutIdx = -1;

        // 优先在强标点处断句（句号、问号、感叹号、换行）
        // 但要求至少积累 minLength 个字符，避免切得太碎
        const strongRegex = /[。！？\n.!?]/g;
        let strongMatch;
        while ((strongMatch = strongRegex.exec(buffer)) !== null) {
          if (strongMatch.index + 1 >= minLength) {
            cutIdx = strongMatch.index + 1;
            break;
          }
        }

        // 超过 maxLength 仍没有强标点，才在弱标点处断句
        if (cutIdx === -1 && buffer.length >= maxLength) {
          const searchFrom = buffer.slice(minLength);
          const weakMatch = searchFrom.match(/[，,；;、：:）)]/);
          if (weakMatch && weakMatch.index !== undefined) {
            cutIdx = minLength + weakMatch.index + 1;
          }
        }

        // 超过 hardMaxLength 强制断句
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
          // 太短的片段放回 buffer，等后续文本拼接
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
    partialText: '',
    partialUpdatedAt: 0,
    partialTimer: null,
    lastCommittedText: '',
    lastCommittedAt: 0,
  };

  const { ws: asrUpstream, ready: asrReady } = createASRConnection();
  console.log('[voice-session] ASR 上游连接创建中...');

  // 等待 ASR 配置完成
  asrReady.then(() => {
    console.log('[voice-session] ASR 上游已就绪');
  }).catch((err) => {
    console.error('[voice-session] ASR 上游就绪失败:', err.message);
  });

  asrUpstream.on('error', (err) => {
    console.error('[voice-session] ASR 上游连接错误:', err.message);
  });

  asrUpstream.on('close', (code, reason) => {
    console.log(`[voice-session] ASR 上游连接关闭: code=${code} reason=${reason}`);
  });
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
      console.log(`[voice-session] TTS 上游收到数据: ${upData.length} bytes, firstByte=${firstByte}, clientWs.readyState=${clientWs.readyState}`);
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
        console.log(`[voice-session] TTS 发送句子: "${sentence}" ttsTaskStarted=${ttsTaskStarted} ttsUpstream=${ttsUpstream ? 'exists' : 'null'} readyState=${ttsUpstream?.readyState}`);
        if (!ttsTaskStarted) {
          pendingSentences.push(sentence);
          return;
        }
        sendTTSText(ttsUpstream, ttsTaskId, sentence);
      });

      await ensureTTSReady(state.voiceId);
      console.log(`[voice-session] TTS 就绪，开始调用 LLM，问题: "${userQuestion}"`);
      if (myToken !== sseTurnToken) { console.log('[voice-session] turn 已被打断，跳过 LLM'); return; }

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
        await new Promise(r => setTimeout(r, 200));
        console.log(`[voice-session] 发送 finish-task 触发 TTS 合成`);
        finishTTSTask(ttsUpstream, ttsTaskId);
        // 等待 ttsTaskStarted 变为 false（bindTTSUpstream 的 message 监听器会在 task-finished 时设置）
        const waitStart = Date.now();
        while (ttsTaskStarted && Date.now() - waitStart < 15000) {
          await new Promise(r => setTimeout(r, 100));
        }
        console.log(`[voice-session] TTS 合成${ttsTaskStarted ? '超时' : '完成'}，耗时 ${Date.now() - waitStart}ms`);
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
      console.error('[voice-session] streamAssistantReply 异常:', error.message, error.stack?.slice(0, 300));
      if (myToken !== sseTurnToken) return;
      sendJson({ type: 'error', stage: 'llm', message: error.message || '语音会话处理失败' });
      state.activeTurnId = 0;
    }
  }

  // 静默检测：1.5 秒没有新识别结果，自动发 COMMIT 触发 final
  let silenceTimer = null;
  let lastAsrText = '';
  let asrPaused = false; // LLM 回复期间暂停处理 ASR 结果

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (asrPaused) return; // 暂停期间不启动静默检测
    silenceTimer = setTimeout(() => {
      if (lastAsrText && !asrPaused) {
        console.log(`[voice-session] 静默检测触发，直接使用当前文本: "${lastAsrText}"`);
        asrPaused = true; // 暂停 ASR 处理，防止后续识别结果干扰
        commitASR(asrUpstream);
        const finalText = lastAsrText;
        lastAsrText = '';
        sendJson({ type: 'asr.final', text: finalText });
        if (state.activeTurnId > 0) {
          interruptCurrentTurn();
        }
        void streamAssistantReply(finalText).finally(() => {
          // LLM + TTS 完成后恢复 ASR 处理
          asrPaused = false;
          console.log('[voice-session] LLM 回复完成，恢复 ASR 监听');
        });
      }
    }, 1500);
  }

  asrUpstream.on('open', () => {
    // open 事件由 asr.js 内部处理（发送 CONFIG_PARAM），这里不需要再发 connected
  });

  // ASR 配置完成后通知前端
  asrReady.then(() => {
    sendJson({ type: 'connected', sessionId: state.sessionId, persona: state.persona });
  }).catch(() => {
    sendJson({ type: 'error', stage: 'asr', message: 'ASR 配置失败' });
  });

  asrUpstream.on('message', (data) => {
    if (!Buffer.isBuffer(data)) return;
    let payload = null;
    try {
      payload = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }

    // 跳过 CONFIGURED 响应（已在 asr.js 中处理）
    if (payload?.type === 'CONFIGURED') return;

    // 解析火山豆包格式
    payload = parseVolcAsrResponse(payload);

    const text = extractAsrText(payload);
    if (!text) return;

    // LLM 回复期间忽略 ASR 结果
    if (asrPaused) return;

    // 调试：打印火山豆包 utterances 的 definite 状态
    if (payload?._volcParsed?.result?.utterances) {
      const utterances = payload._volcParsed.result.utterances;
      const definiteSummary = utterances.map(u => `"${u.text}":definite=${u.definite}`).join(', ');
      console.log(`[voice-session] ASR utterances: ${definiteSummary}`);
    }

    console.log(`[voice-session] ASR 识别: "${text}" final=${isAsrFinal(payload)}`);

    // 更新最后识别文本，重置静默计时器
    lastAsrText = text;
    resetSilenceTimer();

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
      // 确保 ASR 已配置完成再转发音频
      asrReady.then(() => {
        if (asrUpstream.readyState === 1) {
          asrUpstream.send(data);
        }
      }).catch(() => {});
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
