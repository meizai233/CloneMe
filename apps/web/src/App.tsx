import { FormEvent, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarGesture,
  type AvatarRuntime,
  type Live2DDriver
} from "./avatar/live2dAdapter";
import { avatarIntroScripts } from "./avatar/modeIntro.js";
import {
  createVoiceClone,
  initAvatarProfile,
  uploadAudio,
  getUploadUrl,
  fetchPersonas,
  smartChat,
  type PersonaMode,
  type PersonaInfo
} from "./services/api";
import { TTSClient, SentenceBuffer } from "./services/ttsClient";
import { VoiceSessionClient } from "./services/voiceSessionClient";
import { resolveAvatarModelCapability } from "./avatar/modelCapabilities";


function buildOfflineReply(question: string): string {
  return "当前网络异常，建议联系人工客服 400-091-0857。问题：" + question;
}

const INTERNAL_KNOWLEDGE_DOCS = [
  "React 性能优化优先做拆分、memo、减少无意义重渲染。",
  "TypeScript 项目中优先给 API 返回体建立显式类型。"
];

const HARU_MODEL_URL = "/models/haru_greeter_pro_jp/runtime/haru_greeter_t05.model3.json";
const NATORI_MODEL_URL = "/models/natori_pro_zh/runtime/natori_pro_t06.model3.json";
const PERSONA_STORAGE_KEY = "cloneme.selectedPersona";
const SUPPORT_DEFAULT_VOICE_SAMPLE_AUDIO_URL =
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/beaee4f1bcf44d2aa0381a885c5adc02_voice_1774599906915.webm";
const SUPPORT_DEFAULT_VOICE_ID = "cosyvoice-v2-wanyan-81856f33a9854efe9146c08b67612297";
const GENERAL_DEFAULT_VOICE_SAMPLE_AUDIO_URL =
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/aa6dba6a16334fccb905776fc3fdfdfe_voice_1774593069461.webm";
const GENERAL_DEFAULT_VOICE_ID = "cosyvoice-v2-cloneme-de1186494da24f33992ab554e7ce480e";
const ALL_AVATAR_EMOTIONS: AvatarEmotion[] = [
  "neutral",
  "happy",
  "thinking",
  "excited",
  "confident",
  "warm",
  "serious",
  "surprised",
];
const ALL_AVATAR_GESTURES: AvatarGesture[] = [
  "none",
  "nod",
  "emphasis",
  "thinking",
  "clap",
  "openArms",
  "promoPitch",
  "discountHighlight",
  "comfortExplain",
];
const EMOTION_LABELS: Record<AvatarEmotion, string> = {
  neutral: "自然",
  happy: "愉快",
  thinking: "思考中",
  excited: "兴奋",
  confident: "自信",
  warm: "温和",
  serious: "严肃",
  surprised: "惊讶",
};
const GESTURE_LABELS: Record<AvatarGesture, string> = {
  none: "无",
  nod: "点头",
  emphasis: "强调",
  thinking: "思考手势",
  clap: "拍手",
  openArms: "张开双臂",
  promoPitch: "讲解推荐",
  discountHighlight: "优惠强调",
  comfortExplain: "安抚解释",
};

function Avatar2D(props: {
  speaking: boolean;
  emotion: AvatarEmotion;
  mouthOpen: number;
  ready: boolean;
  runtime: AvatarRuntime;
  runtimeError: string | null;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  modelLabel: string;
  currentGesture: AvatarGesture;
}) {
  const { speaking, emotion, mouthOpen, ready, runtime, runtimeError, canvasRef, modelLabel, currentGesture } = props;
  const emotionClass = `emotion-${emotion}`;
  const usingLive2D = runtime === "live2d";
  const showLoader = !ready;
  const [emotionUpdatedAt, setEmotionUpdatedAt] = useState(() => Date.now());
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);

  useEffect(() => {
    function syncFullscreenState() {
      setPreviewFullscreen(document.fullscreenElement === stageRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    syncFullscreenState();
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    setEmotionUpdatedAt(Date.now());
  }, [emotion]);

  const togglePreviewFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else {
        await stage.requestFullscreen();
      }
    } catch {
      // 浏览器或环境限制时静默失败，避免打断主流程。
    }
  }, []);

  return (
    <div className={`avatar-card ${emotionClass}`}>
      <div
        ref={stageRef}
        className={`avatar-stage ${usingLive2D ? "avatar-stage-live2d" : "avatar-stage-loader"} ${previewFullscreen ? "avatar-stage-preview-fullscreen" : ""}`}
      >
        <button
          type="button"
          className="avatar-preview-toggle"
          onClick={() => {
            void togglePreviewFullscreen();
          }}
          aria-label={previewFullscreen ? "退出全屏预览" : "全屏预览形象"}
          title={previewFullscreen ? "退出全屏预览（Esc）" : "全屏预览"}
        >
          {previewFullscreen ? "退出全屏" : "全屏预览"}
        </button>

        <canvas ref={canvasRef} id="avatar-canvas" className={`avatar-canvas ${usingLive2D ? "visible" : ""}`} />

        {!usingLive2D && (
          <div className={`avatar-loader-shell ${speaking ? "is-speaking" : ""}`}>
            <div className="avatar-loader-core" style={{ transform: `scale(${1 + mouthOpen * 0.18})` }} />
            <div className="avatar-loader-ring avatar-loader-ring-a" />
            <div className="avatar-loader-ring avatar-loader-ring-b" />
            <div className="avatar-loader-ring avatar-loader-ring-c" />
            <div className="avatar-loader-grid" />
            <div className="avatar-loader-text">
              <strong>{showLoader ? "Live2D 载入中" : "Live2D 回退模式"}</strong>
              <span>{showLoader ? "正在启动渲染核心..." : "模型暂不可用，已启用动态特效"}</span>
            </div>
          </div>
        )}
      </div>

      <p className="avatar-runtime">
        渲染模式：{usingLive2D ? "Live2D Runtime" : "Mock Fallback"}
      </p>
      {!usingLive2D && runtimeError && <p className="avatar-runtime-error">Live2D 错误：{runtimeError}</p>}
      <p className="avatar-status">
        状态：{ready ? "模型已就绪" : "模型加载中"} / 模型：{modelLabel} / 情绪：{EMOTION_LABELS[emotion]} / 动作：
        {GESTURE_LABELS[currentGesture]} / 口型：{Math.round(mouthOpen * 100)}% / 语音：
        {speaking ? "播报中" : "待机"}
      </p>
      <p className="avatar-emotion-live" aria-live="polite">
        实时情绪：<strong>{EMOTION_LABELS[emotion]}</strong>
        <span className="avatar-emotion-meta">({emotion})</span>
        <span className="avatar-emotion-meta">
          更新于 {new Date(emotionUpdatedAt).toLocaleTimeString("zh-CN", { hour12: false })}
        </span>
      </p>
    </div>
  );
}

export default function App() {
  const adapterRef = useRef<Live2DDriver | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopLipSyncRef = useRef<(() => void) | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActionRef = useRef<(() => Promise<void>) | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const voiceSessionRef = useRef<VoiceSessionClient | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);
  const typingQueueRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGestureRef = useRef<AvatarGesture>("none");
  const lastGestureAtRef = useRef(0);
  const gestureResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string>(() => {
    if (typeof window === "undefined") return "general";
    try {
      return window.localStorage.getItem(PERSONA_STORAGE_KEY) ?? "general";
    } catch {
      return "general";
    }
  });
  const [sessionId] = useState<string>(() => `session_${Date.now()}`);
  const [question, setQuestion] = useState("哈啰租电动车有哪些套餐，怎么选最划算？");
  const [answer, setAnswer] = useState("欢迎使用 CloneMe。先上传内容，再开始提问。");
  const [references, setReferences] = useState<string[]>([]);
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [runtime, setRuntime] = useState<AvatarRuntime>("mock");
  const [activeModelUrl, setActiveModelUrl] = useState(HARU_MODEL_URL);
  const [activeGesture, setActiveGesture] = useState<AvatarGesture>("none");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [initLoading, setInitLoading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [avatarReady, setAvatarReady] = useState(false);
  const [avatarRuntimeError, setAvatarRuntimeError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [hasCustomVoiceClone, setHasCustomVoiceClone] = useState(false);
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
  const introStopLipSyncRef = useRef<(() => void) | null>(null);
  const introTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const introRunIdRef = useRef(0);
  const [voiceLatency, setVoiceLatency] = useState<{
    firstByteMs: number;
    totalMs: number;
    meetsTarget: boolean;
  } | null>(null);
  const [voiceCloneLoading, setVoiceCloneLoading] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [chatPhase, setChatPhase] = useState<"idle" | "thinking" | "typing">("idle");
  const [thinkingDots, setThinkingDots] = useState("");
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [realtimePartialText, setRealtimePartialText] = useState("");
  const [realtimeFinalText, setRealtimeFinalText] = useState("");
  const [realtimeLoading, setRealtimeLoading] = useState(false);

  // 每次页面加载生成新的 userId，刷新页面后自动更换
  const [userId] = useState(() => {
    // crypto.randomUUID 仅在安全上下文（HTTPS/localhost）可用，降级使用 Math.random
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    return `user_${uuid}`;
  });

  const loading = initLoading || chatLoading || voiceCloneLoading || realtimeLoading;

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

  const stopTypewriter = useCallback(() => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingQueueRef.current = "";
  }, []);

  const clearIntroTimers = useCallback(() => {
    introTimeoutsRef.current.forEach((timer) => clearTimeout(timer));
    introTimeoutsRef.current = [];
  }, []);

  const waitWithIntroTimer = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          introTimeoutsRef.current = introTimeoutsRef.current.filter((item) => item !== timer);
          resolve();
        }, ms);
        introTimeoutsRef.current.push(timer);
      }),
    []
  );

  const stopModeIntroSpeech = useCallback(() => {
    introStopLipSyncRef.current?.();
    introStopLipSyncRef.current = null;
    ttsClientRef.current?.stop();
    adapterRef.current?.setSpeaking(false);
  }, []);

  const stopModeIntro = useCallback(() => {
    introRunIdRef.current += 1;
    clearIntroTimers();
    stopModeIntroSpeech();
    setActiveGesture("none");
  }, [clearIntroTimers, stopModeIntroSpeech]);

  const markGesture = useCallback((gesture: AvatarGesture) => {
    if (gestureResetTimerRef.current) {
      clearTimeout(gestureResetTimerRef.current);
      gestureResetTimerRef.current = null;
    }
    if (gesture === "none") {
      setActiveGesture("none");
      return;
    }
    setActiveGesture(gesture);
    gestureResetTimerRef.current = setTimeout(() => {
      setActiveGesture("none");
      gestureResetTimerRef.current = null;
    }, 2200);
  }, []);

  const runModeIntro = useCallback(
    async (targetMode: PersonaMode) => {
      if (!avatarReady) return;
      const script = avatarIntroScripts[targetMode];
      if (!script) return;

      stopModeIntro();
      const runId = ++introRunIdRef.current;
      setErrorMessage(null);
      setReferences([]);
      setAnswer(`虚拟形象名称：${script.avatarName}`);
      const ttsClient = ttsClientRef.current;
      if (ttsClient) {
        const introVoiceId =
          targetMode === "support" && !hasCustomVoiceClone
            ? SUPPORT_DEFAULT_VOICE_ID
            : (voiceId ?? undefined);
        ttsClient.setVoiceId(introVoiceId);
        try {
          await ttsClient.connect();
        } catch {
          // TTS 连接失败时仍保留口型驱动和文案展示。
        }
      }
      await waitWithIntroTimer(500);
      if (runId !== introRunIdRef.current) return;

      for (const item of script.segments) {
        if (runId !== introRunIdRef.current) return;
        adapterRef.current?.setEmotion(item.emotion);
        adapterRef.current?.playGesture(item.gesture);
        markGesture(item.gesture);
        setAnswer((prev) => `${prev}\n${item.text}`);
        stopModeIntroSpeech();
        introStopLipSyncRef.current = adapterRef.current?.playLipSync(item.cues) ?? null;
        adapterRef.current?.setSpeaking(true);
        const narration = item.text.replace(/（[^）]*）/g, "").trim();
        if (narration) {
          ttsClient?.sendText(narration);
        }
        await waitWithIntroTimer(item.durationMs);
        if (runId !== introRunIdRef.current) return;
        stopModeIntroSpeech();
        await waitWithIntroTimer(320);
      }

      ttsClient?.finishCurrentTask();

      if (runId === introRunIdRef.current) {
        adapterRef.current?.setEmotion("happy");
      }
    },
    [
      avatarReady,
      hasCustomVoiceClone,
      markGesture,
      stopModeIntro,
      stopModeIntroSpeech,
      voiceId,
      waitWithIntroTimer
    ]
  );

  const pushTypewriterText = useCallback((chunkText: string) => {
    if (!chunkText) return;
    typingQueueRef.current += chunkText;
    if (typingTimerRef.current) return;

    typingTimerRef.current = setInterval(() => {
      const queue = typingQueueRef.current;
      if (!queue) {
        if (typingTimerRef.current) {
          clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        return;
      }
      const segment = queue.slice(0, 2);
      typingQueueRef.current = queue.slice(2);
      setAnswer((prev) => prev + segment);
    }, 22);
  }, []);

  // 启动时从后端加载角色列表
  useEffect(() => {
    fetchPersonas()
      .then((data) => {
        setPersonas(data.personas);
        const cachedPersona = (() => {
          try {
            return window.localStorage.getItem(PERSONA_STORAGE_KEY);
          } catch {
            return null;
          }
        })();
        const hasCachedPersona = cachedPersona
          ? data.personas.some((persona) => persona.key === cachedPersona)
          : false;
        setSelectedPersona(hasCachedPersona ? (cachedPersona as string) : data.defaultPersona);
      })
      .catch(() => {
        // 加载失败使用默认空列表
      });
  }, []);

  useEffect(() => {
    if (!selectedPersona) return;
    try {
      window.localStorage.setItem(PERSONA_STORAGE_KEY, selectedPersona);
    } catch {
      // localStorage 不可用时忽略，不影响页面交互。
    }
  }, [selectedPersona]);

  const resolveIntroMode = useCallback(
    (personaKey: string): PersonaMode | null => {
      if (personaKey in avatarIntroScripts) {
        return personaKey as PersonaMode;
      }

      // 后端角色 key 可能不是 support，这里对“售前客服”做兜底映射。
      const matchedPersona = personas.find((item) => item.key === personaKey);
      const personaText = `${personaKey} ${matchedPersona?.name ?? ""}`.toLowerCase();
      if (
        personaText.includes("售前") ||
        personaText.includes("presale") ||
        personaText.includes("pre_sale") ||
        personaText.includes("sales")
      ) {
        return "support";
      }

      return null;
    },
    [personas]
  );

  const resolveDefaultVoiceProfile = useCallback(
    (personaKey: string): { voiceId: string; sampleAudioUrl: string; label: string } | null => {
      const matchedPersona = personas.find((item) => item.key === personaKey);
      const personaText = `${personaKey} ${matchedPersona?.name ?? ""}`.toLowerCase();

      if (personaKey === "general" || personaText.includes("通用") || personaText.includes("general")) {
        return {
          voiceId: GENERAL_DEFAULT_VOICE_ID,
          sampleAudioUrl: GENERAL_DEFAULT_VOICE_SAMPLE_AUDIO_URL,
          label: "通用助手默认"
        };
      }

      if (resolveIntroMode(personaKey) === "support") {
        return {
          voiceId: SUPPORT_DEFAULT_VOICE_ID,
          sampleAudioUrl: SUPPORT_DEFAULT_VOICE_SAMPLE_AUDIO_URL,
          label: "售前客服默认"
        };
      }

      return null;
    },
    [personas, resolveIntroMode]
  );

  useEffect(() => {
    const defaultVoiceProfile = resolveDefaultVoiceProfile(selectedPersona);
    if (defaultVoiceProfile && !hasCustomVoiceClone) {
      if (voiceId !== defaultVoiceProfile.voiceId) {
        setVoiceId(defaultVoiceProfile.voiceId);
      }
      const canOverwriteSample =
        !sampleAudioUrl.trim() ||
        sampleAudioUrl === SUPPORT_DEFAULT_VOICE_SAMPLE_AUDIO_URL ||
        sampleAudioUrl === GENERAL_DEFAULT_VOICE_SAMPLE_AUDIO_URL;
      if (canOverwriteSample && sampleAudioUrl !== defaultVoiceProfile.sampleAudioUrl) {
        setSampleAudioUrl(defaultVoiceProfile.sampleAudioUrl);
      }
      return;
    }

    if (
      !defaultVoiceProfile &&
      !hasCustomVoiceClone &&
      (voiceId === SUPPORT_DEFAULT_VOICE_ID || voiceId === GENERAL_DEFAULT_VOICE_ID)
    ) {
      setVoiceId(null);
    }
  }, [hasCustomVoiceClone, resolveDefaultVoiceProfile, sampleAudioUrl, selectedPersona, voiceId]);

  const resolveLive2DModelUrl = useCallback(
    (personaKey: string): string => {
      const matchedPersona = personas.find((item) => item.key === personaKey);
      const personaText = `${personaKey} ${matchedPersona?.name ?? ""}`.toLowerCase();

      if (personaKey === "general" || personaText.includes("通用") || personaText.includes("general")) {
        return NATORI_MODEL_URL;
      }

      if (
        personaKey === "pre_sales" ||
        personaKey === "after_sales" ||
        personaText.includes("售前") ||
        personaText.includes("售后") ||
        personaText.includes("support") ||
        personaText.includes("sales")
      ) {
        return HARU_MODEL_URL;
      }

      return HARU_MODEL_URL;
    },
    [personas]
  );

  const resolveRenderableModelUrl = useCallback(async (preferredModelUrl: string): Promise<string> => {
    if (preferredModelUrl !== NATORI_MODEL_URL || typeof window === "undefined") {
      return preferredModelUrl;
    }

    try {
      const modelUrl = new URL(preferredModelUrl, window.location.origin);
      const modelResponse = await fetch(modelUrl.toString(), { cache: "no-store" });
      if (!modelResponse.ok) {
        return HARU_MODEL_URL;
      }

      const modelJson = (await modelResponse.json()) as {
        FileReferences?: { Moc?: string };
      };
      const mocRelativePath = modelJson.FileReferences?.Moc;
      if (!mocRelativePath) {
        return HARU_MODEL_URL;
      }

      const mocUrl = new URL(mocRelativePath, modelUrl);
      const mocResponse = await fetch(mocUrl.toString(), { cache: "no-store" });
      if (!mocResponse.ok) {
        return HARU_MODEL_URL;
      }

      return preferredModelUrl;
    } catch {
      return HARU_MODEL_URL;
    }
  }, []);

  useEffect(() => {
    const introMode = resolveIntroMode(selectedPersona);
    if (introMode) {
      void runModeIntro(introMode);
    }
  }, [avatarReady, resolveIntroMode, runModeIntro, selectedPersona]);

  useEffect(() => {
    if (!(chatLoading && chatPhase === "thinking")) {
      setThinkingDots("");
      return;
    }
    const timer = setInterval(() => {
      setThinkingDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
    }, 380);
    return () => clearInterval(timer);
  }, [chatLoading, chatPhase]);

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

    return () => {
      stopModeIntro();
      cleanupPlayback();
      stopTypewriter();
      if (gestureResetTimerRef.current) {
        clearTimeout(gestureResetTimerRef.current);
        gestureResetTimerRef.current = null;
      }
      adapter.destroy();
      adapterRef.current = null;
    };
  }, [cleanupPlayback, stopModeIntro, stopTypewriter]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const modelUrl = resolveLive2DModelUrl(selectedPersona);
    let cancelled = false;

    // 角色切换时触发一次模型重载。
    setAvatarReady(false);
    setAvatarRuntimeError(null);
    const initTimer = setTimeout(() => {
      void (async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        if (cancelled) return;
        const renderableModelUrl = await resolveRenderableModelUrl(modelUrl);
        if (cancelled) return;
        setActiveModelUrl(renderableModelUrl);
        setActiveGesture("none");
        await adapter.init(avatarCanvasRef.current ?? "avatar-canvas", renderableModelUrl);
      })();
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(initTimer);
    };
  }, [resolveLive2DModelUrl, resolveRenderableModelUrl, selectedPersona]);

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
        adapterRef.current?.setMouthOpen(value);
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
    voiceSessionRef.current?.setVoiceId(voiceId ?? undefined);
  }, [voiceId]);

  useEffect(() => {
    const voiceSession = new VoiceSessionClient({
      voiceId: voiceId ?? undefined,
      onSpeakingChange: (speaking) => {
        adapterRef.current?.setSpeaking(speaking);
        setIsSpeaking(speaking);
      },
      onMouthOpen: (value) => {
        setMouthOpen(value);
        adapterRef.current?.setMouthOpen(value);
      },
      onAsrPartial: (text) => {
        setRealtimePartialText(text);
      },
      onAsrFinal: (text) => {
        setRealtimePartialText("");
        setRealtimeFinalText(text);
        setAnswer("");
        setReferences([]);
        setChatPhase("thinking");
        setChatLoading(true);
      },
      onLlmDelta: (text) => {
        setChatPhase("typing");
        setAnswer((prev) => prev + text);
      },
      onLlmDone: (event) => {
        const modelCapability = resolveAvatarModelCapability(resolveLive2DModelUrl(selectedPersona));
        const planEmotion = normalizeEmotion(event.avatarPlan?.emotion);
        const chosenEmotion = modelCapability.allowedEmotions.includes(planEmotion)
          ? planEmotion
          : normalizeEmotion(event.emotion);
        adapterRef.current?.setEmotion(chosenEmotion);
        const candidateGestures = (event.avatarPlan?.gestures ?? [])
          .map((item) => normalizeGesture(item))
          .filter((item) => item !== "none");
        const chosenGesture =
          candidateGestures.find((item) => modelCapability.allowedGestures.includes(item)) ?? "none";
        if (chosenGesture !== "none") {
          adapterRef.current?.playGesture(chosenGesture);
          markGesture(chosenGesture);
        }
        setAnswer(event.reply);
        setReferences(event.references);
        setChatPhase("idle");
        setChatLoading(false);
      }
    });
    voiceSessionRef.current = voiceSession;
    void voiceSession.connect().catch(() => {
      // 首次连接失败不阻塞主流程，启动实时模式时会重试
    });

    return () => {
      voiceSession.disconnect();
      voiceSessionRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        docs: INTERNAL_KNOWLEDGE_DOCS
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
  }, []);

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
      setHasCustomVoiceClone(true);
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

  const normalizeEmotion = useCallback((value: string | undefined): AvatarEmotion => {
    if (!value) return "neutral";
    return (ALL_AVATAR_EMOTIONS as string[]).includes(value) ? (value as AvatarEmotion) : "neutral";
  }, []);

  const normalizeGesture = useCallback((value: string | undefined): AvatarGesture => {
    if (!value) return "none";
    return (ALL_AVATAR_GESTURES as string[]).includes(value) ? (value as AvatarGesture) : "none";
  }, []);

  const stopRealtimeSession = useCallback(() => {
    voiceSessionRef.current?.interrupt();
    voiceSessionRef.current?.stopRecording();
    setRealtimeActive(false);
    setRealtimeLoading(false);
    setRealtimePartialText("");
    setChatPhase("idle");
    setChatLoading(false);
  }, []);

  const startRealtimeSession = useCallback(async () => {
    stopModeIntro();
    cleanupPlayback();
    stopTypewriter();
    setErrorMessage(null);
    setRealtimeLoading(true);
    setRealtimePartialText("");
    setRealtimeFinalText("");
    setAnswer("实时语音已启动，请开始说话...");
    setReferences([]);

    try {
      const client = voiceSessionRef.current;
      if (!client) {
        throw new Error("实时语音客户端未初始化");
      }
      await client.connect();
      client.startSession({
        sessionId,
        userId,
        persona: selectedPersona,
        voiceId: voiceId ?? undefined,
        avatarModel: resolveAvatarModelCapability(resolveLive2DModelUrl(selectedPersona)),
      });
      await client.startRecording();
      setRealtimeActive(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`实时语音启动失败: ${message}`);
      setRealtimeActive(false);
    } finally {
      setRealtimeLoading(false);
    }
  }, [
    cleanupPlayback,
    resolveLive2DModelUrl,
    selectedPersona,
    sessionId,
    stopModeIntro,
    stopTypewriter,
    userId,
    voiceId,
  ]);

  const runAsk = useCallback(async () => {
    stopRealtimeSession();
    // 提问优先级最高：先硬中断当前自动播报/口型，再进入新一轮问答。
    ttsClientRef.current?.stop();
    sentenceBufferRef.current?.reset();
    sentenceBufferRef.current = null;
    stopModeIntro();
    setChatLoading(true);
    setChatPhase("thinking");
    setAnswer("");
    setReferences([]);
    setErrorMessage(null);
    cleanupPlayback();
    stopTypewriter();

    const safeQuestion = question.trim();
    if (!safeQuestion) {
      setChatLoading(false);
      setErrorMessage("请输入问题后再提问");
      return;
    }

    // 提问后清空输入框
    setQuestion("");

    try {
      lastGestureRef.current = "none";
      lastGestureAtRef.current = 0;

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

      const data = await smartChat({
        userQuestion: safeQuestion,
        persona: selectedPersona,
        sessionId,
        userId,
        avatarModel: resolveAvatarModelCapability(resolveLive2DModelUrl(selectedPersona)),
        onThinking: () => {
          setChatPhase("thinking");
        },
        onDelta: () => {
          setChatPhase("typing");
        },
        onDeltaIncrement: (increment) => {
          setChatPhase("typing");
          pushTypewriterText(increment);
          sentenceBuffer.push(increment);
        },
      });

      // smartChat 是非流式，直接设置结果
      // 刷新句子缓冲器中剩余的文本
      sentenceBuffer.flush();
      sentenceBufferRef.current = null;

      // 通知 TTS 所有文本已发完，可以 finish task
      ttsClientRef.current?.finishCurrentTask();

      stopTypewriter();

      setAnswer(data.reply);
      setReferences(data.references);
      const modelCapability = resolveAvatarModelCapability(resolveLive2DModelUrl(selectedPersona));
      const planEmotion = normalizeEmotion(data.avatarPlan?.emotion);
      const chosenEmotion = modelCapability.allowedEmotions.includes(planEmotion)
        ? planEmotion
        : normalizeEmotion(data.emotion);
      adapterRef.current?.setEmotion(chosenEmotion);

      const candidateGestures = (data.avatarPlan?.gestures ?? [])
        .map((item) => normalizeGesture(item))
        .filter((item) => item !== "none");
      const chosenGesture =
        candidateGestures.find((item) => modelCapability.allowedGestures.includes(item)) ?? "none";
      if (chosenGesture !== "none") {
        adapterRef.current?.playGesture(chosenGesture);
        markGesture(chosenGesture);
      }

      if (data.audioUrl) {
        try {
          await playAnswerAudio(data.audioUrl, data.phonemeCues);
        } catch {
          setErrorMessage("语音播放失败，已回退到离线口型演示。");
          playFallbackLipSync(data.phonemeCues);
        }
      } else {
        playFallbackLipSync(data.phonemeCues);
      }
    } catch (error) {
      stopTypewriter();
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`${message}，已启用离线演示回答。`);
      setAnswer(buildOfflineReply(safeQuestion));
      setReferences(["离线演示兜底回答"]);
      adapterRef.current?.setEmotion("thinking");
      playFallbackLipSync([0.2, 0.7, 0.35, 0.8, 0.25, 0.65]);
      setTimeout(() => {
        adapterRef.current?.setEmotion("neutral");
      }, 1500);
    } finally {
      setChatPhase("idle");
      setChatLoading(false);
    }
  }, [
    cleanupPlayback,
    normalizeEmotion,
    normalizeGesture,
    markGesture,
    selectedPersona,
    sessionId,
    userId,
    playAnswerAudio,
    playFallbackLipSync,
    question,
    resolveLive2DModelUrl,
    stopRealtimeSession,
    stopModeIntro,
    stopTypewriter
  ]);

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
          <button onClick={initAvatar} disabled={loading}>
            {initLoading ? "初始化中..." : "1) 初始化分身"}
          </button>

          <div className="question-guide-box">
            <h3>引导提问（预留）</h3>
            <p>这里会放常见问题引导，帮助用户快速开始提问。</p>
            <p className="question-guide-placeholder">
              示例：如何开始 / 套餐怎么选 / 租车流程是什么 / 我现在很生气，要投诉你们客服怎么处理（暂未开放）
            </p>
          </div>

          <div className="mode-row">
            {personas.map((p) => (
              <button
                key={p.key}
                className={p.key === selectedPersona ? "active" : ""}
                onClick={() => setSelectedPersona(p.key)}
                disabled={loading}
                title={p.description}
              >
                {p.name}
              </button>
            ))}
            {personas.length === 0 && <span>角色加载中...</span>}
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
                  setHasCustomVoiceClone(false);
                  setVoiceLatency(null);
                }}
                disabled={loading}
              >
                清除音色
              </button>
            )}
            <p className="voice-hint">
              {(() => {
                if (!voiceId) return "未创建音色：创建时将调用后端 /api/voice/create";
                const defaultVoiceProfile = resolveDefaultVoiceProfile(selectedPersona);
                if (!hasCustomVoiceClone && defaultVoiceProfile && voiceId === defaultVoiceProfile.voiceId) {
                  return `音色已就绪：${voiceId}（${defaultVoiceProfile.label}）`;
                }
                return `音色已就绪：${voiceId}`;
              })()}
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
            <button type="submit" disabled={loading || realtimeActive}>
              {chatLoading ? "思考中..." : "3) 开始提问"}
            </button>
          </form>

          <div className="voice-clone-box">
            <h3>实时语音对话</h3>
            <p className="voice-hint">
              当前模式：{realtimeActive ? "通话中（可插话打断）" : "待机"}
            </p>
            <div className="recording-controls">
              {!realtimeActive ? (
                <button type="button" onClick={startRealtimeSession} disabled={loading}>
                  开始实时对话
                </button>
              ) : (
                <button type="button" onClick={stopRealtimeSession} className="recording-active">
                  停止实时对话
                </button>
              )}
            </div>
            {realtimeFinalText && (
              <p className="voice-hint">最近识别：{realtimeFinalText}</p>
            )}
            {realtimePartialText && (
              <p className="voice-hint">正在识别：{realtimePartialText}</p>
            )}
          </div>

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
          key={selectedPersona}
          speaking={isSpeaking}
          emotion={emotion}
          mouthOpen={mouthOpen}
          ready={avatarReady}
          runtime={runtime}
          runtimeError={avatarRuntimeError}
          canvasRef={avatarCanvasRef}
          modelLabel={resolveAvatarModelCapability(activeModelUrl).modelLabel}
          currentGesture={activeGesture}
        />
        <div className="chat-dialog">
          <div className="chat-dialog-header">
            <span>💬 分身回复</span>
            <div className="chat-dialog-header-right">
              {chatLoading && (
                <span className="chat-typing">
                  {chatPhase === "thinking" ? `思考中${thinkingDots}` : "输出中..."}
                </span>
              )}
              {isSpeaking && (
                <button
                  type="button"
                  className="stop-audio-btn"
                  onClick={() => {
                    ttsClientRef.current?.stop();
                    adapterRef.current?.setSpeaking(false);
                    setIsSpeaking(false);
                  }}
                  title="停止语音播放"
                >
                  ⏹
                </button>
              )}
            </div>
          </div>
          <div className="chat-dialog-body">
            <p>{chatLoading && chatPhase === "thinking" && !answer ? `🤔 正在思考${thinkingDots}` : answer}</p>
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
