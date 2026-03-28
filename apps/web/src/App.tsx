import { FormEvent, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarGesture,
  type AvatarRuntime,
  type Live2DDriver
} from "./avatar/live2dAdapter";
import { createTalkingHeadAdapter } from "./avatar/talkingHeadAdapter";
import { avatarIntroScripts } from "./avatar/modeIntro.js";
import {
  uploadAudio,
  getUploadUrl,
  fetchPersonas,
  embedTexts,
  smartChat,
  type PersonaMode,
  type PersonaInfo
} from "./services/api";
import { TTSClient, SentenceBuffer } from "./services/ttsClient";
import { VoiceSessionClient } from "./services/voiceSessionClient";
import { resolveAvatarModelCapability } from "./avatar/modelCapabilities";
import pinyin from "pinyin";
import "pinyin2ipa/dist/pinyin2ipa.js";
import {
  getAvatar, updateAvatar, listVoices, createVoice,
  type VoiceInfo,
} from "./services/platform-api";


function buildOfflineReply(question: string): string {
  return "当前网络异常，建议联系人工客服 400-091-0857。问题：" + question;
}

const HARU_MODEL_URL = "/models/haru_greeter_pro_jp/runtime/haru_greeter_t05.model3.json";
const PERSONA_STORAGE_KEY = "cloneme.selectedPersona";
const AVATAR_ENGINE_STORAGE_KEY = "cloneme.avatarEngine";
const TALKINGHEAD_DEFAULT_AVATAR_URL =
  import.meta.env.VITE_TALKINGHEAD_AVATAR_URL || "/models/talkinghead/brunette.glb";
const SUPPORT_DEFAULT_VOICE_SAMPLE_AUDIO_URL =
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/9136b0768b7340e7b83c4a24a5f1ad31_voice_1774687282952.webm";
const SUPPORT_DEFAULT_VOICE_ID = "cosyvoice-v2-cloneme-b085f5e6261340ef8859f35cdee10714";
const GENERAL_DEFAULT_VOICE_SAMPLE_AUDIO_URL =
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/aa6dba6a16334fccb905776fc3fdfdfe_voice_1774593069461.webm";
const GENERAL_DEFAULT_VOICE_ID = "cosyvoice-v2-cloneme-de1186494da24f33992ab554e7ce480e";
const AFTER_SALES_DEFAULT_VOICE_SAMPLE_AUDIO_URL =
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/4cec2092568b4a7cb5e5e7cfbf7e1f85_voice_1774686592038.webm";
const AFTER_SALES_DEFAULT_VOICE_ID = "cosyvoice-v2-gmy-901211a49aee4aca921411e146b6476d";
const VOICE_NAME_OVERRIDES_BY_ID: Record<string, string> = {
  "cosyvoice-v2-cloneme-b085f5e6261340ef8859f35cdee10714": "冯婉妍",
  "cosyvoice-v2-cloneme-de1186494da24f33992ab554e7ce480e": "邓梦博",
  "cosyvoice-v2-gmy-901211a49aee4aca921411e146b6476d": "郭梦艳",
};
const VOICE_NAME_OVERRIDES_BY_AUDIO_URL: Record<string, string> = {
  "https://oho-image-cdn.51downapp.cn/ohoKiroUpload/4cec2092568b4a7cb5e5e7cfbf7e1f85_voice_1774686592038.webm": "郭梦艳",
};
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
type AvatarEngine = "live2d" | "talkinghead";
const PINYIN_TWO_LETTER_INITIALS = ["zh", "ch", "sh"];
const IPA_TO_PSEUDO_VISEME_RULES: Array<{ re: RegExp; viseme: string }> = [
  { re: /t͡ɕʰ|t͡ɕ|ʂ|ɕ|ʐ/g, viseme: "CH" },
  { re: /s|z/g, viseme: "S" },
  { re: /pʰ|p|m/g, viseme: "P" },
  { re: /f|v/g, viseme: "F" },
  { re: /kʰ|k|x|h|g/g, viseme: "K" },
  { re: /n|ŋ/g, viseme: "N" },
  { re: /l|ɹ|r/g, viseme: "R" },
  { re: /i|y/g, viseme: "I" },
  { re: /u|w|ʊ/g, viseme: "U" },
  { re: /e|ɛ|ə/g, viseme: "E" },
  { re: /o|ɔ/g, viseme: "O" },
  { re: /a|ɑ|æ/g, viseme: "A" },
  { re: /t|d/g, viseme: "D" },
  { re: /θ/g, viseme: "TH" },
];

function splitPinyinSyllable(raw: string): { initial: string; final: string } {
  const normalized = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (!normalized) return { initial: "", final: "" };
  const twoLetterInitial = PINYIN_TWO_LETTER_INITIALS.find((item) => normalized.startsWith(item));
  if (twoLetterInitial) {
    return { initial: twoLetterInitial.toUpperCase(), final: normalized.slice(twoLetterInitial.length).toUpperCase() };
  }
  const first = normalized[0];
  const validInitial = "bpmfdtnlgkhjqxrzcsyw".includes(first);
  if (!validInitial) {
    return { initial: "", final: normalized.toUpperCase() };
  }
  return { initial: first.toUpperCase(), final: normalized.slice(1).toUpperCase() };
}

function ipaToPseudoVisemes(ipaRaw: string): string[] {
  if (!ipaRaw) return [];
  const ipa = ipaRaw.toLowerCase();
  const visemes: string[] = [];
  for (const rule of IPA_TO_PSEUDO_VISEME_RULES) {
    if (rule.re.test(ipa)) {
      visemes.push(rule.viseme);
    }
    rule.re.lastIndex = 0;
  }
  return Array.from(new Set(visemes));
}

function textToPseudoVisemes(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const rows = pinyin(trimmed, { style: pinyin.STYLE_NORMAL, heteronym: false, segment: true });
  const converter = (globalThis as unknown as { pinyin2ipa?: (value: string) => string | string[] }).pinyin2ipa;
  const visemes: string[] = [];
  rows.forEach((row) => {
    const syllable = row?.[0]?.trim();
    if (!syllable) return;
    if (!/^[a-zA-Z]+$/.test(syllable)) {
      visemes.push("SIL");
      return;
    }
    const ipaResult = converter?.(syllable);
    const ipaText = Array.isArray(ipaResult) ? ipaResult.join(" ") : ipaResult;
    const ipaVisemes = ipaToPseudoVisemes(ipaText ?? "");
    if (ipaVisemes.length > 0) {
      visemes.push(...ipaVisemes);
      return;
    }
    const { initial, final } = splitPinyinSyllable(syllable);
    if (initial) visemes.push(initial);
    if (final) visemes.push(final);
  });
  return visemes;
}

const QUESTION_GUIDE_SEED: string[] = [
  "哈啰租电动车有哪些套餐，怎么选最划算？",
  "新用户第一次租车有什么优惠？",
  "如果骑行中途没电了，应该怎么处理？",
  "租车流程是怎样的，多久可以取车？",
  "押金和免押规则是什么？",
  "临时停车会不会继续计费？",
  "怎么结束订单才不会多扣费？",
  "遇到车辆故障或客服响应慢怎么投诉？",
];

function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || !right.length || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
type DropdownOption = {
  value: string;
  label: string;
};

function CustomDropdown(props: {
  value: string;
  placeholder: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const { value, placeholder, options, onChange, disabled = false, className } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((item) => item.value === value);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`custom-dropdown ${className ?? ""}`}>
      <button
        type="button"
        className={`custom-dropdown-trigger ${open ? "is-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={selected ? "custom-dropdown-value" : "custom-dropdown-placeholder"}>
          {selected?.label ?? placeholder}
        </span>
        <span className="custom-dropdown-arrow">▾</span>
      </button>
      {open && (
        <div className="custom-dropdown-menu">
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`custom-dropdown-option ${item.value === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SearchableDropdown(props: {
  value: string;
  placeholder: string;
  options: DropdownOption[];
  loading?: boolean;
  emptyText?: string;
  onInputChange: (value: string) => void;
  onSelect: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const {
    value,
    placeholder,
    options,
    loading = false,
    emptyText = "暂无匹配项",
    onInputChange,
    onSelect,
    disabled = false,
    className,
  } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.current) return;
      if (event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`custom-dropdown ${className ?? ""}`}>
      <div className={`custom-dropdown-trigger custom-dropdown-trigger-input ${open ? "is-open" : ""}`}>
        <input
          className="custom-dropdown-input"
          value={value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            onInputChange(event.target.value);
            setOpen(true);
          }}
          disabled={disabled}
        />
        <button
          type="button"
          className="custom-dropdown-arrow-button"
          onClick={() => setOpen((prev) => !prev)}
          disabled={disabled}
          aria-label="切换问题推荐列表"
        >
          <span className="custom-dropdown-arrow">▾</span>
        </button>
      </div>
      {open && (
        <div className="custom-dropdown-menu">
          {loading ? (
            <div className="custom-dropdown-empty">推荐问题加载中...</div>
          ) : options.length > 0 ? (
            options.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`custom-dropdown-option ${item.value === value ? "is-selected" : ""}`}
                onClick={() => {
                  onSelect(item.value);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            ))
          ) : (
            <div className="custom-dropdown-empty">{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}

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
  const usingTalkingHead = runtime === "talkinghead";
  const usingAvatarRuntime = usingLive2D || usingTalkingHead;
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
        className={`avatar-stage ${usingLive2D ? "avatar-stage-live2d" : ""} ${usingTalkingHead ? "avatar-stage-talkinghead" : ""} ${!usingAvatarRuntime ? "avatar-stage-loader" : ""} ${previewFullscreen ? "avatar-stage-preview-fullscreen" : ""}`}
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

        {!usingAvatarRuntime && (
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
        渲染模式：{usingLive2D ? "Live2D Runtime" : usingTalkingHead ? "TalkingHead Runtime" : "Mock Fallback"}
      </p>
      {!usingAvatarRuntime && runtimeError && <p className="avatar-runtime-error">数字人引擎错误：{runtimeError}</p>}
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
  const { id: avatarId } = useParams();
  const navigate = useNavigate();
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
  const introPlayedOnEntryRef = useRef(false);
  const autoVoicePersonaRef = useRef<string | null>(null);

  const [personas, setPersonas] = useState<PersonaInfo[]>([]);
  const [selectedPersona, setSelectedPersona] = useState<string>(() => {
    if (typeof window === "undefined") return "general";
    try {
      return window.localStorage.getItem(PERSONA_STORAGE_KEY) ?? "general";
    } catch {
      return "general";
    }
  });
  const [avatarEngine, setAvatarEngine] = useState<AvatarEngine>(() => {
    if (typeof window === "undefined") return "live2d";
    try {
      const saved = window.localStorage.getItem(AVATAR_ENGINE_STORAGE_KEY);
      return saved === "talkinghead" ? "talkinghead" : "live2d";
    } catch {
      return "live2d";
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
  const [questionHistory, setQuestionHistory] = useState<string[]>([]);
  const [questionSuggestions, setQuestionSuggestions] = useState<string[]>(() => QUESTION_GUIDE_SEED.slice(0, 5));
  const [questionSuggestLoading, setQuestionSuggestLoading] = useState(false);
  const suggestionRequestIdRef = useRef(0);
  const semanticEmbeddingCacheRef = useRef<Map<string, number[]>>(new Map());

  // 声音选择：克隆 vs 已有声音，互斥
  const [voiceMode, setVoiceMode] = useState<"clone" | "existing">("clone");
  const [existingVoices, setExistingVoices] = useState<VoiceInfo[]>([]);
  const [avatarName, setAvatarName] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  // 每次页面加载生成新的 userId，刷新页面后自动更换
  const [userId] = useState(() => {
    // crypto.randomUUID 仅在安全上下文（HTTPS/localhost）可用，降级使用 Math.random
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    return `user_${uuid}`;
  });

  const loading = chatLoading || voiceCloneLoading || realtimeLoading;

  const runTalkingHeadPseudoViseme = useCallback((text: string): boolean => {
    if (runtime !== "talkinghead") return false;
    const visemes = textToPseudoVisemes(text);
    if (visemes.length === 0) return false;
    const stepMs = Math.max(90, Math.min(210, Math.round(1800 / Math.max(6, visemes.length))));
    adapterRef.current?.runChinesePseudoVisemeSequence?.(visemes, stepMs);
    return true;
  }, [runtime]);
  const questionCandidates = useMemo(
    () => Array.from(new Set([...questionHistory, ...QUESTION_GUIDE_SEED])),
    [questionHistory]
  );

  const buildSemanticSuggestions = useCallback(async (input: string, candidates: string[]): Promise<string[]> => {
    if (!input.trim() || candidates.length === 0) return [];

    const [queryVector] = await embedTexts(input);
    if (!Array.isArray(queryVector)) return [];

    const cache = semanticEmbeddingCacheRef.current;
    const uncached = candidates.filter((item) => !cache.has(item));

    if (uncached.length > 0) {
      const vectors = await embedTexts(uncached);
      uncached.forEach((item, idx) => {
        const vector = vectors[idx];
        if (Array.isArray(vector) && vector.length > 0) {
          cache.set(item, vector);
        }
      });
    }

    return candidates
      .map((text) => ({
        text,
        score: cosineSimilarity(queryVector, cache.get(text) ?? []),
      }))
      .filter((item) => item.score > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((item) => item.text);
  }, []);
  const getVoiceDisplayName = useCallback((voice: VoiceInfo): string => {
    if (voice.voice_id && VOICE_NAME_OVERRIDES_BY_ID[voice.voice_id]) {
      return VOICE_NAME_OVERRIDES_BY_ID[voice.voice_id];
    }
    if (voice.audio_url && VOICE_NAME_OVERRIDES_BY_AUDIO_URL[voice.audio_url]) {
      return VOICE_NAME_OVERRIDES_BY_AUDIO_URL[voice.audio_url];
    }
    return voice.speaker_name || voice.voice_id;
  }, []);
  const selectableVoices: VoiceInfo[] = existingVoices;

  // 加载数字人信息和已有声音列表
  useEffect(() => {
    if (avatarId) {
      getAvatar(avatarId).then(res => {
        const a = res.avatar;
        setAvatarName(a.name);
      }).catch(() => {});
    }
    listVoices().then(res => setExistingVoices(res.voices || [])).catch(() => {});
  }, [avatarId]);

  useEffect(() => {
    const input = question.trim();
    const requestId = ++suggestionRequestIdRef.current;
    const timer = setTimeout(() => {
      const candidates = questionCandidates.filter((item) => item !== input);

      if (!input) {
        setQuestionSuggestLoading(false);
        setQuestionSuggestions(QUESTION_GUIDE_SEED.slice(0, 5));
        return;
      }

      setQuestionSuggestLoading(true);
      void buildSemanticSuggestions(input, candidates.slice(0, 40))
        .then((semantic) => {
          if (requestId !== suggestionRequestIdRef.current) return;
          setQuestionSuggestions(semantic.length > 0 ? semantic : QUESTION_GUIDE_SEED.slice(0, 6));
        })
        .catch(() => {
          if (requestId !== suggestionRequestIdRef.current) return;
          setQuestionSuggestions(QUESTION_GUIDE_SEED.slice(0, 6));
        })
        .finally(() => {
          if (requestId !== suggestionRequestIdRef.current) return;
          setQuestionSuggestLoading(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [buildSemanticSuggestions, question, questionCandidates]);

  // 保存数字人配置
  async function onSaveAvatar() {
    if (!avatarId) return;
    setSaveMsg("");
    try {
      await updateAvatar(avatarId, {
        name: avatarName || undefined,
        voice_id: voiceId || undefined,
      } as any);
      setSaveMsg("保存成功");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : "保存失败");
    }
  }

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
    async (targetMode: PersonaMode, preferredVoiceId?: string | null) => {
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
        const nextVoiceId = preferredVoiceId ?? voiceId;
        ttsClient.setVoiceId(nextVoiceId ?? undefined);
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

  const resolveDefaultVoiceIdForPersona = useCallback(
    (personaKey: string): string | null => {
      const matchedPersona = personas.find((item) => item.key === personaKey);
      const personaText = `${personaKey} ${matchedPersona?.name ?? ""}`.toLowerCase();

      if (personaKey === "general" || personaText.includes("通用") || personaText.includes("general")) {
        return GENERAL_DEFAULT_VOICE_ID;
      }

      if (
        personaKey === "after_sales" ||
        personaText.includes("售后") ||
        personaText.includes("after_sales") ||
        personaText.includes("aftersales") ||
        personaText.includes("after-sale")
      ) {
        return AFTER_SALES_DEFAULT_VOICE_ID;
      }

      if (
        personaKey === "pre_sales" ||
        personaText.includes("售前") ||
        personaText.includes("presale") ||
        personaText.includes("pre_sale") ||
        personaText.includes("support") ||
        personaText.includes("sales")
      ) {
        return SUPPORT_DEFAULT_VOICE_ID;
      }

      return null;
    },
    [personas]
  );

  const resolveCurrentAvatarModelUrl = useCallback(
    (_personaKey: string): string => (avatarEngine === "talkinghead" ? TALKINGHEAD_DEFAULT_AVATAR_URL : HARU_MODEL_URL),
    [avatarEngine]
  );

  const resolveRenderableModelUrl = useCallback(async (preferredModelUrl: string): Promise<string> => {
    if (preferredModelUrl !== HARU_MODEL_URL || typeof window === "undefined") {
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
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(AVATAR_ENGINE_STORAGE_KEY, avatarEngine);
    } catch {
      // ignore
    }
  }, [avatarEngine]);

  useEffect(() => {
    if (introPlayedOnEntryRef.current) return;
    if (!avatarReady) return;
    const introMode = resolveIntroMode(selectedPersona);
    if (!introMode) return;
    introPlayedOnEntryRef.current = true;
    const defaultVoiceId = resolveDefaultVoiceIdForPersona(selectedPersona);
    void runModeIntro(introMode, defaultVoiceId);
  }, [avatarReady, resolveDefaultVoiceIdForPersona, resolveIntroMode, runModeIntro, selectedPersona]);

  useEffect(() => {
    if (autoVoicePersonaRef.current === selectedPersona) return;
    autoVoicePersonaRef.current = selectedPersona;
    const defaultVoiceId = resolveDefaultVoiceIdForPersona(selectedPersona);
    if (!defaultVoiceId) return;
    setVoiceMode("existing");
    setVoiceId(defaultVoiceId);
    ttsClientRef.current?.setVoiceId(defaultVoiceId);
    voiceSessionRef.current?.setVoiceId(defaultVoiceId);
  }, [resolveDefaultVoiceIdForPersona, selectedPersona]);

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
    const adapter = avatarEngine === "talkinghead"
      ? createTalkingHeadAdapter({
        onStateChange(state) {
          setEmotion(state.emotion);
          setRuntime(state.runtime);
          setIsSpeaking(state.speaking);
          setMouthOpen(state.mouthOpen);
          setAvatarReady(state.initialized);
          setAvatarRuntimeError(state.runtimeError);
        }
      })
      : createLive2DAdapter({
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
  }, [avatarEngine, cleanupPlayback, stopModeIntro, stopTypewriter]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const modelUrl = resolveCurrentAvatarModelUrl(selectedPersona);
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
        const renderableModelUrl =
          avatarEngine === "live2d" ? await resolveRenderableModelUrl(modelUrl) : modelUrl;
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
  }, [avatarEngine, resolveCurrentAvatarModelUrl, resolveRenderableModelUrl, selectedPersona]);

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
        const modelCapability = resolveAvatarModelCapability(resolveCurrentAvatarModelUrl(selectedPersona));
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
    async (audioUrl: string, cues: number[], textFor3D?: string) => {
      cleanupPlayback();

      const adapter = adapterRef.current;
      if (!adapter || !audioUrl) {
        throw new Error("音频不可用");
      }

      const startedPseudo = textFor3D ? runTalkingHeadPseudoViseme(textFor3D) : false;
      if (!startedPseudo) {
        stopLipSyncRef.current = adapter.playLipSync(cues);
      }

      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onplay = () => adapter.setSpeaking(true);
      audio.onended = () => cleanupPlayback();
      audio.onerror = () => cleanupPlayback();

      await audio.play();
    },
    [cleanupPlayback, runTalkingHeadPseudoViseme]
  );

  const playFallbackLipSync = useCallback(
    (cues: number[], textFor3D?: string) => {
      const safeCues = cues.length > 0 ? cues : [0.2, 0.7, 0.35, 0.8, 0.25, 0.65];
      const startedPseudo = textFor3D ? runTalkingHeadPseudoViseme(textFor3D) : false;
      if (!startedPseudo) {
        stopLipSyncRef.current = adapterRef.current?.playLipSync(safeCues) ?? null;
      }
      adapterRef.current?.setSpeaking(true);
      fallbackTimerRef.current = setTimeout(() => {
        cleanupPlayback();
      }, Math.max(1200, safeCues.length * 120));
    },
    [cleanupPlayback, runTalkingHeadPseudoViseme]
  );

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
      // 使用带认证的平台API进行声音克隆（后端会同时克隆+存库）
      const prefix = (speakerName.trim() || "cloneme").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "cloneme";
      const data = await createVoice(safeAudioUrl, prefix, speakerName.trim() || "我的音色", targetModel.trim() || "cosyvoice-v2");
      setVoiceId(data.voiceId);
      // 刷新已有声音列表
      try {
        const voicesRes = await listVoices();
        setExistingVoices(voicesRes.voices || []);
      } catch { /* 刷新列表失败不影响主流程 */ }
      // 自动绑定到当前数字人
      if (avatarId) {
        try { await updateAvatar(avatarId, { voice_id: data.voiceId } as any); } catch { /* 忽略 */ }
      }
      setHasCustomVoiceClone(true);
      setErrorMessage(null);
      setAnswer("✅ 声音克隆成功！已自动绑定到当前数字人。");
      setReferences([]);
      adapterRef.current?.setEmotion("happy");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setErrorMessage(`❌ 声音克隆失败：${message}`);
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
        avatarModel: resolveAvatarModelCapability(resolveCurrentAvatarModelUrl(selectedPersona)),
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
    resolveCurrentAvatarModelUrl,
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
    setQuestionHistory((prev) => [safeQuestion, ...prev.filter((item) => item !== safeQuestion)].slice(0, 40));

    try {
      lastGestureRef.current = "none";
      lastGestureAtRef.current = 0;

      // 提问时按角色优先使用默认音色（售前=冯婉妍，售后=郭梦艳）
      const askVoiceId = resolveDefaultVoiceIdForPersona(selectedPersona) ?? voiceId ?? undefined;
      ttsClientRef.current?.stop();
      ttsClientRef.current?.setVoiceId(askVoiceId);
      voiceSessionRef.current?.setVoiceId(askVoiceId);

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
        avatarModel: resolveAvatarModelCapability(resolveCurrentAvatarModelUrl(selectedPersona)),
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
      const modelCapability = resolveAvatarModelCapability(resolveCurrentAvatarModelUrl(selectedPersona));
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

      const shouldUseSelectedTtsVoice = Boolean(askVoiceId);
      if (!shouldUseSelectedTtsVoice && data.audioUrl) {
        try {
          await playAnswerAudio(data.audioUrl, data.phonemeCues, data.reply);
        } catch {
          setErrorMessage("语音播放失败，已回退到离线口型演示。");
          playFallbackLipSync(data.phonemeCues, data.reply);
        }
      } else {
        playFallbackLipSync(data.phonemeCues, data.reply);
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
    resolveCurrentAvatarModelUrl,
    resolveDefaultVoiceIdForPersona,
    hasCustomVoiceClone,
    stopRealtimeSession,
    stopModeIntro,
    stopTypewriter,
    voiceId,
    voiceMode,
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
          {/* 顶部操作栏：返回 + 名称 + 保存 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <button onClick={() => navigate("/dashboard")} style={{ background: "none", border: "none", color: "#6b7ff5", cursor: "pointer", fontSize: "0.9rem", padding: 0, margin: 0 }}>← 返回</button>
            <input
              value={avatarName}
              onChange={(e) => setAvatarName(e.target.value)}
              placeholder="数字人名称"
              style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid #37457f", background: "#101632", color: "#f4f6ff", fontSize: "0.95rem" }}
            />
            <button onClick={onSaveAvatar} disabled={loading} style={{ padding: "6px 14px", borderRadius: 8, background: "#4059d4", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.85rem" }}>
              💾 保存
            </button>
          </div>
          {saveMsg && <p style={{ fontSize: "0.8rem", color: saveMsg === "保存成功" ? "#4caf50" : "#e53935", margin: "0 0 8px" }}>{saveMsg}</p>}

          <h1>CloneMe - 哈啰租电动车 AI 数字人</h1>
          <p className="subtitle">租车咨询 + 语音播报 + 2D/3D 数字形象（业务演示版）</p>
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
            <div className="model-title-row">
              <h3>数字人模型</h3>
              <div className="mode-help-tooltip">
                <span className="mode-help-trigger" role="button" tabIndex={0} aria-label="查看 2D 与 3D 模型对比">
                  ?
                </span>
                <div className="mode-help-popup">
                  <strong>2D · Haru</strong>
                  <div>优点：启动快、资源占用低、表情稳定，适合高并发演示。</div>
                  <div>不足：立体感较弱，镜头和肢体表现相对有限。</div>
                  <strong>3D · Brunette</strong>
                  <div>优点：立体感和沉浸感更强，动作扩展空间更大。</div>
                  <div>不足：初始化更慢，对设备性能和网络要求更高。</div>
                </div>
              </div>
            </div>
            <CustomDropdown
              value={avatarEngine}
              placeholder="请选择数字人渲染模式"
              options={[
                { value: "live2d", label: "2D · Haru（固定）" },
                { value: "talkinghead", label: "3D · Brunette" },
              ]}
              onChange={(nextValue) => {
                if (nextValue === "talkinghead") {
                  setAvatarEngine("talkinghead");
                  return;
                }
                setAvatarEngine("live2d");
              }}
              disabled={loading}
            />
            <p className="voice-hint">
              当前：{avatarEngine === "live2d" ? "2D Haru" : "3D Brunette"}
            </p>
          </div>

          <div className="voice-clone-box">
            <h3>声音设置</h3>
            {/* 互斥切换：克隆 vs 已有 */}
            <div className="mode-row" style={{ marginBottom: 10 }}>
              <button className={voiceMode === "clone" ? "active" : ""} onClick={() => setVoiceMode("clone")} disabled={loading}>🎙️ 克隆新声音</button>
              <button className={voiceMode === "existing" ? "active" : ""} onClick={() => setVoiceMode("existing")} disabled={loading}>📋 选择已有声音</button>
            </div>

            {voiceMode === "clone" && (
              <>
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
                  <p className="voice-hint">或直接输入音频 URL：</p>
                  <input
                    value={sampleAudioUrl}
                    onChange={(e) => setSampleAudioUrl(e.target.value)}
                    placeholder="https://example.com/sample.wav"
                  />
                </div>

                <label className="consent-row">
                  <input
                    type="checkbox"
                    checked={consentConfirmed}
                    onChange={(e) => setConsentConfirmed(e.target.checked)}
                  />
                  <span>我确认已获本人授权用于语音克隆</span>
                </label>
                <button onClick={onCreateVoiceClone} disabled={loading}>
                  {voiceCloneLoading ? "创建音色中..." : "🎵 开始克隆"}
                </button>
              </>
            )}

            {voiceMode === "existing" && (
              <div>
                {selectableVoices.length === 0 ? (
                  <p className="voice-hint">暂无已有声音，请先克隆一个</p>
                ) : (
                  <>
                    <CustomDropdown
                      value={voiceId || ""}
                      placeholder="-- 请选择声音 --"
                      options={[
                        { value: "", label: "-- 请选择声音 --" },
                        ...selectableVoices.map((v) => ({
                          value: v.voice_id,
                          label: `${getVoiceDisplayName(v)}${v.created_at ? ` (${v.created_at.slice(0, 10)})` : ""}`,
                        })),
                      ]}
                      onChange={(nextValue) => {
                        const vid = nextValue || null;
                        setVoiceId(vid);
                        ttsClientRef.current?.setVoiceId(vid ?? undefined);
                        voiceSessionRef.current?.setVoiceId(vid ?? undefined);
                        if (vid) setHasCustomVoiceClone(true);
                        if (avatarId) {
                          updateAvatar(avatarId, { voice_id: vid || "" } as any).catch(() => {});
                        }
                      }}
                      disabled={loading}
                    />
                    {/* 选中声音后显示试听按钮 */}
                    {voiceId && (() => {
                      const selected = selectableVoices.find(v => v.voice_id === voiceId);
                      return selected?.audio_url ? (
                        <button type="button" onClick={() => new Audio(selected.audio_url).play()} style={{ marginLeft: 8, marginTop: 6, fontSize: "0.8rem", padding: "4px 10px", borderRadius: 6, border: "1px solid #4059d4", background: "rgba(64,89,212,0.1)", color: "#6b7ff5", cursor: "pointer" }}>▶ 试听</button>
                      ) : null;
                    })()}
                  </>
                )}
              </div>
            )}

          </div>

          <form onSubmit={onAsk}>
            <label className="block">
              <span>问题</span>
              <SearchableDropdown
                value={question}
                placeholder="输入问题，自动推荐相似问法"
                options={questionSuggestions
                  .filter((item) => item !== question)
                  .map((item) => ({ value: item, label: item }))}
                loading={questionSuggestLoading}
                emptyText="暂无相似问题，可直接使用当前输入"
                onInputChange={setQuestion}
                onSelect={setQuestion}
                disabled={loading}
              />
            </label>
            <button type="submit" disabled={loading || realtimeActive}>
              {chatLoading ? "思考中..." : "开始提问"}
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
          key={`${selectedPersona}-${avatarEngine}`}
          speaking={isSpeaking}
          emotion={emotion}
          mouthOpen={mouthOpen}
          ready={avatarReady}
          runtime={runtime}
          runtimeError={avatarRuntimeError}
          canvasRef={avatarCanvasRef}
          modelLabel={avatarEngine === "talkinghead" ? "3D Brunette" : "2D Haru"}
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
