import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarRuntime,
  type Live2DDriver
} from "./avatar/live2dAdapter";
import {
  chatWithAvatar,
  createVoiceCloneProfile,
  initAvatarProfile,
  type PersonaMode
} from "./services/api";

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

  const [mode, setMode] = useState<PersonaMode>("teacher");
  const [docsInput, setDocsInput] = useState(
    "React 性能优化优先做拆分、memo、减少无意义重渲染。\nTypeScript 项目中优先给 API 返回体建立显式类型。"
  );
  const [question, setQuestion] = useState("怎么系统学习前端工程化？");
  const [answer, setAnswer] = useState("欢迎使用 CloneMe。先上传内容，再开始提问。");
  const [references, setReferences] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<AvatarEmotion>("neutral");
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
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [voiceMetrics, setVoiceMetrics] = useState<{
    durationSec: number;
    snrDb: number;
    silenceRatio: number;
  } | null>(null);
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
    void adapter.init("avatar-canvas");

    return () => {
      cleanupPlayback();
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [cleanupPlayback]);

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

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
          reject(new Error("音频读取失败"));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(new Error("音频读取失败"));
      reader.readAsDataURL(file);
    });
  }, []);

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

  const runCreateVoiceClone = useCallback(async () => {
    setVoiceCloneLoading(true);
    setErrorMessage(null);
    setVoiceLatency(null);

    if (!consentConfirmed) {
      setVoiceCloneLoading(false);
      setErrorMessage("请先确认已获本人授权，再创建音色。");
      return;
    }
    if (!sampleFile) {
      setVoiceCloneLoading(false);
      setErrorMessage("请先上传 30 秒以上 WAV 音频样本。");
      return;
    }
    if (!sampleFile.name.toLowerCase().endsWith(".wav")) {
      setVoiceCloneLoading(false);
      setErrorMessage("当前仅支持 WAV 样本，请重新上传。");
      return;
    }

    try {
      const sampleAudioBase64 = await fileToBase64(sampleFile);
      const data = await createVoiceCloneProfile({
        speakerName: speakerName.trim() || "我的音色",
        consentConfirmed: true,
        sampleAudioBase64
      });
      setVoiceId(data.voiceId);
      setVoiceMetrics(data.metrics);
      setAnswer("音色创建完成。现在提问时将优先使用克隆语音播报。");
      setReferences([]);
      adapterRef.current?.setEmotion("happy");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(message);
    } finally {
      setVoiceCloneLoading(false);
    }
  }, [consentConfirmed, fileToBase64, sampleFile, speakerName]);

  async function createVoiceClone() {
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
      const data = await chatWithAvatar({
        userQuestion: safeQuestion,
        mode,
        voiceId: voiceId ?? undefined
      });

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
            <h3>语音克隆（第三方 TTS）</h3>
            <label className="block">
              <span>音色名称</span>
              <input
                value={speakerName}
                onChange={(e) => setSpeakerName(e.target.value)}
                placeholder="例如：我的播客音色"
              />
            </label>
            <label className="block">
              <span>上传语音样本（WAV，建议 30s~3min）</span>
              <input
                type="file"
                accept=".wav,audio/wav"
                onChange={(e) => setSampleFile(e.target.files?.[0] ?? null)}
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
            <button onClick={createVoiceClone} disabled={loading}>
              {voiceCloneLoading ? "创建音色中..." : "2) 创建克隆音色"}
            </button>
            {voiceId && (
              <button
                type="button"
                onClick={() => {
                  setVoiceId(null);
                  setVoiceMetrics(null);
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
                : "未创建音色：提问时将使用默认语音占位或口型兜底"}
            </p>
            {voiceMetrics && (
              <p className="voice-metrics">
                质量指标：时长 {voiceMetrics.durationSec.toFixed(1)}s / SNR{" "}
                {voiceMetrics.snrDb.toFixed(1)}dB / 静音 {(voiceMetrics.silenceRatio * 100).toFixed(1)}%
              </p>
            )}
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
        <details className="answer-box">
          <summary>分身回复（点击展开）</summary>
          <p>{answer}</p>
          {references.length > 0 && (
            <>
              <h4>参考知识</h4>
              <ul>
                {references.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
        </details>
      </section>
    </main>
  );
}
