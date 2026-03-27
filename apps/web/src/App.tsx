import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarRuntime,
  type Live2DDriver
} from "./avatar/live2dAdapter";
import {
  chatWithAvatar,
  createVoiceClone,
  initAvatarProfile,
  uploadAudio,
  getUploadUrl,
  type PersonaMode
} from "./services/api";
import { TTSClient, SentenceBuffer } from "./services/ttsClient";

const modeLabels: Record<PersonaMode, string> = {
  teacher: "老师模式",
  friend: "朋友模式",
  support: "客服模式"
};

function buildOfflineReply(question: string, mode: PersonaMode): string {
  const modePrefix: Record<PersonaMode, string> = {
    teacher: "老师模式建议",
    friend: "朋友模式建议",
    support: "客服模式建议"
  };
  return `${modePrefix[mode]}：当前网络异常，先给你一版离线演示回答。关于“${question}”，建议先拆成学习目标、周计划和复盘机制三步推进。`;
}

function Avatar2D(props: {
  speaking: boolean;
  emotion: AvatarEmotion;
  mouthOpen: number;
  ready: boolean;
  runtime: AvatarRuntime;
  runtimeError: string | null;
}) {
  const { speaking, emotion, mouthOpen, ready, runtime, runtimeError } = props;
  const emotionClass = `emotion-${emotion}`;
  const usingLive2D = runtime === "live2d";

  return (
    <div className={`avatar-card ${emotionClass}`}>
      <div className="avatar-stage">
        <canvas id="avatar-canvas" className={`avatar-canvas ${usingLive2D ? "visible" : ""}`} />

        {!usingLive2D && (
          <div className="avatar-face">
            <div className="eyes">
              <span />
              <span />
            </div>
            <div
              className={`mouth ${speaking ? "speaking" : ""}`}
              style={{ transform: `scaleY(${0.65 + mouthOpen * 0.85})` }}
            />
          </div>
        )}
      </div>

      <p className="avatar-runtime">
        渲染模式：{usingLive2D ? "Live2D Runtime" : "Mock Fallback"}
      </p>
      {!usingLive2D && runtimeError && <p className="avatar-runtime-error">Live2D 错误：{runtimeError}</p>}
      <p className="avatar-status">
        状态：{ready ? "模型已就绪" : "模型加载中"} /{" "}
        {emotion === "thinking" ? "思考中" : emotion === "happy" ? "愉快" : "自然"} /{" "}
        {speaking ? "播报中" : "待机"}
      </p>
    </div>
  );
}

export default function App() {
  const adapterRef = useRef<Live2DDriver | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopLipSyncRef = useRef<(() => void) | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionRef = useRef<(() => Promise<void>) | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);

  const [mode, setMode] = useState<PersonaMode>("teacher");
  const [docsInput, setDocsInput] = useState(
    "React 性能优化优先做拆分、memo、减少无意义重渲染。\nTypeScript 项目中优先给 API 返回体建立显式类型。"
  );
  const [question, setQuestion] = useState("怎么系统学习前端工程化？");
  const [answer, setAnswer] = useState("欢迎使用 CloneMe。先上传内容，再开始提问。");
  const [references, setReferences] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [runtime, setRuntime] = useState<AvatarRuntime>("mock");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [initLoading, setInitLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarRuntimeError, setAvatarRuntimeError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [speakerName, setSpeakerName] = useState("我的音色");
  const [sampleAudioUrl, setSampleAudioUrl] = useState("");
  const [targetModel, setTargetModel] = useState("cosyvoice-v2");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadedAudioUrl, setUploadedAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [voiceLatency, setVoiceLatency] = useState<{
    firstByteMs: number;
    totalMs: number;
    meetsTarget: boolean;
  } | null>(null);
  const [voiceCloneLoading, setVoiceCloneLoading] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  const loading = initLoading || chatLoading || voiceCloneLoading;
  const statusLabel = initLoading ? "初始化中" : chatLoading ? "思考中" : isSpeaking ? "播报中" : "待机";

  const docs = useMemo(
    () =>
      docsInput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    [docsInput]
  );

  const cleanupPlayback = useCallback(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (audioRef.current) {
      audioRef.current.onplay = null;
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (stopLipSyncRef.current) {
      stopLipSyncRef.current();
      stopLipSyncRef.current = null;
    }

    adapterRef.current?.setSpeaking(false);
  }, []);

  useEffect(() => {
    const adapter = createLive2DAdapter({
      onStateChange(state) {
        setEmotion(state.emotion);
        setRuntime(state.runtime);
        setIsSpeaking(state.speaking);
        setMouthOpen(state.mouthOpen);
        setAvatarReady(state.initialized);
        setAvatarRuntimeError(state.runtimeError);
      }
    });

    adapterRef.current = adapter;
    // 延迟初始化，确保 canvas DOM 已完全挂载
    const initTimer = setTimeout(() => {
      void adapter.init("avatar-canvas");
    }, 100);

    return () => {
      clearTimeout(initTimer);
      cleanupPlayback();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [cleanupPlayback]);

  // 初始化 TTS 客户端
  useEffect(() => {
    const ttsClient = new TTSClient({
      voiceId: voiceId ?? undefined,
      onSpeakingChange: (speaking) => {
        adapterRef.current?.setSpeaking(speaking);
        setIsSpeaking(speaking);
      },
      onMouthOpen: (value) => {
        setMouthOpen(value);
        // 同步到 Live2D 模型
        const model = adapterRef.current;
        if (model) {
          (model as unknown as { setMouthOpen?: (v: number) => void }).setMouthOpen?.(value);
        }
      },
    });
    ttsClientRef.current = ttsClient;

    // 预连接 TTS WebSocket
    ttsClient.connect().catch(() => {
      console.warn("[TTS] WebSocket 预连接失败，将在首次使用时重试");
    });

    return () => {
      ttsClient.disconnect();
      ttsClientRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // voiceId 变化时更新 TTS 客户端
  useEffect(() => {
    ttsClientRef.current?.setVoiceId(voiceId ?? undefined);
  }, [voiceId]);

  const playAnswerAudio = useCallback(
    async (audioUrl: string, cues: number[]) => {
      cleanupPlayback();

      const adapter = adapterRef.current;
      if (!adapter || !audioUrl) {
        throw new Error("音频不可用");
      }

      stopLipSyncRef.current = adapter.playLipSync(cues);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onplay = () => adapter.setSpeaking(true);
      audio.onended = () => cleanupPlayback();
      audio.onerror = () => cleanupPlayback();

      await audio.play();
    },
    [cleanupPlayback]
  );

  const playFallbackLipSync = useCallback(
    (cues: number[]) => {
      const safeCues = cues.length > 0 ? cues : [0.2, 0.7, 0.35, 0.8, 0.25, 0.65];
      stopLipSyncRef.current = adapterRef.current?.playLipSync(safeCues) ?? null;
      adapterRef.current?.setSpeaking(true);
      fallbackTimerRef.current = setTimeout(() => {
        cleanupPlayback();
      }, Math.max(1200, safeCues.length * 120));
    },
    [cleanupPlayback]
  );

  const runInitAvatar = useCallback(async () => {
    setInitLoading(true);
    setErrorMessage(null);
    try {
      await initAvatarProfile({
        creatorName: "CloneMe Demo 博主",
        domain: "前端工程",
        docs
      });
      setAnswer("分身初始化完成。现在可以提问，我会按你选的模式回答。");
      setReferences([]);
      adapterRef.current?.setEmotion("happy");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
      setAnswer(`初始化失败：${message}`);
      setReferences(["离线演示可继续：直接点击开始提问"]);
    } finally {
      setInitLoading(false);
    }
  }, [docs]);

  async function initAvatar() {
    lastActionRef.current = runInitAvatar;
    await runInitAvatar();
  }

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }

        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        // 转 base64 上传
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result as string;
          try {
            const result = await uploadAudio(base64, `voice_${Date.now()}.webm`);
            const fullUrl = getUploadUrl(result.audioUrl);
            setUploadedAudioUrl(fullUrl);
            setSampleAudioUrl(fullUrl);
            setErrorMessage(null);
          } catch (err) {
            setErrorMessage(`上传录音失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      setErrorMessage(`无法访问麦克风: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const runCreateVoiceClone = useCallback(async () => {
    setVoiceCloneLoading(true);
    setErrorMessage(null);
    setVoiceLatency(null);

    if (!consentConfirmed) {
      setVoiceCloneLoading(false);
      setErrorMessage("请先确认已获本人授权，再创建音色。");
      return;
    }
    const safeAudioUrl = sampleAudioUrl.trim();
    if (!safeAudioUrl) {
      setVoiceCloneLoading(false);
      setErrorMessage("请先填写可公网访问的音频 URL。");
      return;
    }
    try {
      // Validate URL format before sending request to backend.
      new URL(safeAudioUrl);
    } catch {
      setVoiceCloneLoading(false);
      setErrorMessage("音频 URL 格式不正确，请输入完整链接（http/https）。");
      return;
    }

    try {
      const data = await createVoiceClone({
        audioUrl: safeAudioUrl,
        prefix: (speakerName.trim() || "cloneme").slice(0, 10),
        targetModel: targetModel.trim() || "cosyvoice-v2"
      });
      setVoiceId(data.voiceId);
      setAnswer("音色创建完成。现在提问时将优先使用克隆语音播报。");
      setReferences([]);
      adapterRef.current?.setEmotion("happy");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    } finally {
      setVoiceCloneLoading(false);
    }
  }, [consentConfirmed, sampleAudioUrl, speakerName, targetModel]);

  async function onCreateVoiceClone() {
    lastActionRef.current = runCreateVoiceClone;
    await runCreateVoiceClone();
  }

  const runAsk = useCallback(async () => {
    setChatLoading(true);
    setErrorMessage(null);
    cleanupPlayback();

    const safeQuestion = question.trim();
    if (!safeQuestion) {
      setChatLoading(false);
      setErrorMessage("请输入问题后再提问");
      return;
    }

    try {
      // 停止之前的 TTS 播放
      ttsClientRef.current?.stop();

      // 确保 TTS 连接就绪
      try {
        await ttsClientRef.current?.connect();
      } catch {
        // TTS 连接失败不阻塞对话
      }

      // 创建句子缓冲器，每凑满一句就发送到 TTS
      const sentenceBuffer = new SentenceBuffer((sentence) => {
        ttsClientRef.current?.sendText(sentence);
      });
      sentenceBufferRef.current = sentenceBuffer;

      const data = await chatWithAvatar({
        userQuestion: safeQuestion,
        mode,
        voiceId: voiceId ?? undefined,
        onDelta: (partialReply) => {
          setAnswer(partialReply);
        },
        onDeltaIncrement: (increment) => {
          // 增量文本送入句子缓冲器，凑满一句就发 TTS
          sentenceBuffer.push(increment);
        },
      });

      // 刷新句子缓冲器中剩余的文本
      sentenceBuffer.flush();
      sentenceBufferRef.current = null;

      setAnswer(data.reply);
      setReferences(data.references);
      adapterRef.current?.setEmotion(data.emotion);
      setVoiceLatency(data.latency ?? null);

      if (data.audioUrl) {
        try {
          await playAnswerAudio(data.audioUrl, data.phonemeCues);
        } catch {
          setErrorMessage("语音播放失败，已回退到离线口型演示。");
          playFallbackLipSync(data.phonemeCues);
        }
      } else {
        if (voiceId) {
          setErrorMessage("语音服务降级为文本回复，已使用口型演示兜底。");
        }
        playFallbackLipSync(data.phonemeCues);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`${message}，已启用离线演示回答。`);
      setAnswer(buildOfflineReply(safeQuestion, mode));
      setReferences(["离线演示兜底回答"]);
      adapterRef.current?.setEmotion("thinking");
      playFallbackLipSync([0.2, 0.7, 0.35, 0.8, 0.25, 0.65]);
      setTimeout(() => {
        adapterRef.current?.setEmotion("neutral");
      }, 1500);
    } finally {
      setChatLoading(false);
    }
  }, [mode, playAnswerAudio, playFallbackLipSync, question, voiceId]);

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    lastActionRef.current = runAsk;
    await runAsk();
  }

  async function retryLastAction() {
    if (!lastActionRef.current) return;
    await lastActionRef.current();
  }

  return (
    <main className={`layout layout-with-floating-avatar ${leftPanelCollapsed ? "left-panel-collapsed" : ""}`}>
      <section className={`panel panel-main ${leftPanelCollapsed ? "is-collapsed" : ""}`}>
        <button
          type="button"
          className="panel-collapse-toggle"
          onClick={() => setLeftPanelCollapsed((prev) => !prev)}
          aria-label={leftPanelCollapsed ? "展开左侧面板" : "收起左侧面板"}
          title={leftPanelCollapsed ? "展开左侧面板" : "收起左侧面板"}
        >
          {leftPanelCollapsed ? "›" : "‹"}
        </button>
        <div className="panel-main-content">
          <h1>CloneMe - 知识博主 AI 分身</h1>
          <p className="subtitle">聊天 + 语音驱动口型 + 2D 数字形象（最小可演示版）</p>
          <p className="status-chip">当前阶段：{statusLabel}</p>

          <label className="block">
            <span>知识库输入（每行一条）</span>
            <textarea value={docsInput} onChange={(e) => setDocsInput(e.target.value)} rows={5} />
          </label>

          <button onClick={initAvatar} disabled={loading}>
            {initLoading ? "初始化中..." : "1) 初始化分身"}
          </button>

          <div className="mode-row">
            {(Object.keys(modeLabels) as PersonaMode[]).map((item) => (
              <button
                key={item}
                className={item === mode ? "active" : ""}
                onClick={() => setMode(item)}
                disabled={loading}
              >
                {modeLabels[item]}
              </button>
            ))}
          </div>

          <div className="voice-clone-box">
            <h3>语音克隆</h3>
            <label className="block">
              <span>音色名称</span>
              <input
                value={speakerName}
                onChange={(e) => setSpeakerName(e.target.value)}
                placeholder="例如：我的播客音色"
              />
            </label>

            <div className="recording-section">
              <span>录制语音样本（建议 10~20 秒）</span>
              <div className="recording-prompt-tooltip">
                <span className="recording-prompt-trigger">📖 查看参考朗读文本</span>
                <div className="recording-prompt-popup">
                  各位观众朋友大家好，欢迎收看本期节目。今天我们将深入探讨人工智能技术在日常生活中的应用与发展趋势。从智能语音助手到自动驾驶，从医疗诊断到金融风控，AI 正在以前所未有的速度改变着我们的世界。接下来，让我们一起走进这个充满无限可能的科技新时代。
                </div>
              </div>
              <div className="recording-controls">
                {!isRecording ? (
                  <button onClick={startRecording} disabled={loading} type="button">
                    🎙️ 开始录音
                  </button>
                ) : (
                  <button onClick={stopRecording} type="button" className="recording-active">
                    ⏹️ 停止录音 ({recordingDuration}s)
                  </button>
                )}
                {uploadedAudioUrl && (
                  <span className="upload-status">✅ 录音已上传</span>
                )}
              </div>
              <p className="voice-hint">
                或直接输入音频 URL：
              </p>
              <input
                value={sampleAudioUrl}
                onChange={(e) => setSampleAudioUrl(e.target.value)}
                placeholder="https://example.com/sample.wav"
              />
            </div>

            <label className="block">
              <span>目标模型</span>
              <input
                value={targetModel}
                onChange={(e) => setTargetModel(e.target.value)}
                placeholder="cosyvoice-v2"
              />
            </label>
            <label className="consent-row">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
              />
              <span>我确认已获本人授权用于语音克隆</span>
            </label>
            <button onClick={onCreateVoiceClone} disabled={loading}>
              {voiceCloneLoading ? "创建音色中..." : "2) 创建克隆音色"}
            </button>
            {voiceId && (
              <button
                type="button"
                onClick={() => {
                  setVoiceId(null);
                  setVoiceLatency(null);
                }}
                disabled={loading}
              >
                清除音色
              </button>
            )}
            <p className="voice-hint">
              {voiceId
                ? `音色已就绪：${voiceId}`
                : "未创建音色：创建时将调用后端 /api/voice/create"}
            </p>
            {voiceLatency && (
              <p className="voice-metrics">
                合成延迟：首包 {voiceLatency.firstByteMs}ms / 全量 {voiceLatency.totalMs}ms /{" "}
                {voiceLatency.meetsTarget ? "达标" : "未达标"}
              </p>
            )}
          </div>

          <form onSubmit={onAsk}>
            <label className="block">
              <span>问题</span>
              <input value={question} onChange={(e) => setQuestion(e.target.value)} />
            </label>
            <button type="submit" disabled={loading}>
              {chatLoading ? "思考中..." : "3) 开始提问"}
            </button>
          </form>

          {errorMessage && (
            <div className="error-box">
              <p>{errorMessage}</p>
              <button onClick={retryLastAction} disabled={loading}>
                重试上一步
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="panel panel-avatar panel-avatar-floating">
        <Avatar2D
          speaking={isSpeaking}
          emotion={emotion}
          mouthOpen={mouthOpen}
          ready={avatarReady}
          runtime={runtime}
          runtimeError={avatarRuntimeError}
        />
        <div className="chat-dialog">
          <div className="chat-dialog-header">
            <span>💬 分身回复</span>
            {chatLoading && <span className="chat-typing">输入中...</span>}
          </div>
          <div className="chat-dialog-body">
            <p>{answer}</p>
          </div>
          {references.length > 0 && (
            <div className="chat-dialog-refs">
              <h4>参考知识</h4>
              <ul>
                {references.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
