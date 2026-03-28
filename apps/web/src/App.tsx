import { FormEvent, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarGesture,
  type AvatarRuntime,
  type Live2DDriver
} from "./avatar/live2dAdapter";
import { createTalkingHeadAdapter, TALKINGHEAD_MOUTH_CHANNELS } from "./avatar/talkingHeadAdapter";
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
import type { LipSyncSource, LipSyncTimeline } from "./avatar/lipSyncTimeline";
import pinyin from "pinyin";
import "pinyin2ipa/dist/pinyin2ipa.js";


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
const SUPPORT_DEFAULT_VOICE_ID = "cosyvoice-v2-cloneme-fffdfccb3d3a4b2087a1bf426a64a99f";
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
const PREFERRED_AVATAR_RUNTIME: "live2d" | "talkinghead" =
  String(import.meta.env.VITE_AVATAR_RUNTIME ?? "live2d").toLowerCase() === "talkinghead"
    ? "talkinghead"
    : "live2d";
const TALKINGHEAD_DEFAULT_AVATAR_URL =
  "/models/talkinghead/brunette.glb";
const TALKINGHEAD_SUPPORT_AVATAR_URL =
  import.meta.env.VITE_TALKINGHEAD_SUPPORT_AVATAR_URL || TALKINGHEAD_DEFAULT_AVATAR_URL;
const TALKINGHEAD_GENERAL_AVATAR_URL =
  import.meta.env.VITE_TALKINGHEAD_GENERAL_AVATAR_URL || TALKINGHEAD_DEFAULT_AVATAR_URL;
const CHINESE_PSEUDO_VISEME_DEMO_TEXT = "你好，欢迎来到哈啰租车服务中心，今天我来帮你快速找到最划算的套餐方案。";
const CHINESE_PSEUDO_VISEME_SPEED = 1.5;

function summarizeLipSyncTimeline(timeline?: LipSyncTimeline): { source: LipSyncSource; info: string } | null {
  if (!timeline) return null;
  if (timeline.source === "viseme") {
    const preview = timeline.visemes.slice(0, 8).join(" ");
    return {
      source: "viseme",
      info: `viseme ${timeline.visemes.length} 项${preview ? `：${preview}` : ""}`,
    };
  }
  if (timeline.source === "blendshape") {
    const shapeNames = Array.from(
      new Set(
        timeline.anims.flatMap((anim) => Object.keys(anim.vs)).filter((name) => name)
      )
    );
    return {
      source: "blendshape",
      info: `blendshape ${timeline.anims.length} 段 / 通道 ${shapeNames.slice(0, 6).join(", ") || "-"}`,
    };
  }
  const preview = timeline.words.slice(0, 6).join(" ");
  return {
    source: timeline.source,
    info: `${timeline.source} ${timeline.words.length} 词${preview ? `：${preview}` : ""}`,
  };
}

function normalizePinyinSyllable(raw: string): string {
  return raw.toLowerCase().replace(/\d/g, "").replace("ü", "v");
}

const PINYIN_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"];
const INITIAL_TO_TOKEN: Record<string, string> = {
  b: "B",
  p: "P",
  m: "M",
  f: "F",
  d: "D",
  t: "T",
  n: "N",
  l: "L",
  g: "G",
  k: "K",
  h: "H",
  j: "J",
  q: "Q",
  x: "X",
  zh: "ZH",
  ch: "CH",
  sh: "SH",
  r: "R",
  z: "Z",
  c: "C",
  s: "S",
};
const IPA_INITIAL_RULES: Array<{ re: RegExp; token: string }> = [
  { re: /^pʰ/, token: "P" },
  { re: /^p/, token: "B" },
  { re: /^m/, token: "M" },
  { re: /^f/, token: "F" },
  { re: /^tʰ/, token: "T" },
  { re: /^t/, token: "D" },
  { re: /^n/, token: "N" },
  { re: /^l/, token: "L" },
  { re: /^kʰ/, token: "K" },
  { re: /^k/, token: "G" },
  { re: /^x/, token: "H" },
  { re: /^tɕʰ/, token: "Q" },
  { re: /^tɕ/, token: "J" },
  { re: /^ɕ/, token: "X" },
  { re: /^ʈʂʰ/, token: "CH" },
  { re: /^ʈʂ/, token: "ZH" },
  { re: /^ʂ/, token: "SH" },
  { re: /^ɻ/, token: "R" },
  { re: /^tsʰ/, token: "C" },
  { re: /^ts/, token: "Z" },
  { re: /^s/, token: "S" },
];
const FINAL_TOKEN_RULES: Array<[RegExp, string]> = [
  [/^iong$/, "IONG"],
  [/^iang$/, "IANG"],
  [/^uang$/, "UANG"],
  [/^ueng$/, "UENG"],
  [/^iao$/, "IAO"],
  [/^ian$/, "IAN"],
  [/^ing$/, "ING"],
  [/^ang$/, "ANG"],
  [/^eng$/, "ENG"],
  [/^ong$/, "ONG"],
  [/^uai$/, "UAI"],
  [/^uan$/, "UAN"],
  [/^van$/, "VAN"],
  [/^iao$/, "IAO"],
  [/^iu$/, "IU"],
  [/^ie$/, "IE"],
  [/^ia$/, "IA"],
  [/^in$/, "IN"],
  [/^un$/, "UN"],
  [/^ui$/, "UI"],
  [/^uo$/, "UO"],
  [/^ua$/, "UA"],
  [/^ve$/, "VE"],
  [/^vn$/, "VN"],
  [/^er$/, "ER"],
  [/^ai$/, "AI"],
  [/^ei$/, "EI"],
  [/^ao$/, "AO"],
  [/^ou$/, "OU"],
  [/^an$/, "AN"],
  [/^en$/, "EN"],
  [/^a$/, "A"],
  [/^o$/, "O"],
  [/^e$/, "E"],
  [/^i$/, "I"],
  [/^u$/, "U"],
  [/^v$/, "V"],
];
const HOLDABLE_FINALS = new Set([
  "A", "O", "E", "I", "U", "V",
  "AI", "EI", "AO", "OU",
  "AN", "EN", "ANG", "ENG", "ONG",
  "IA", "IE", "IAO", "IU",
  "IAN", "IN", "IANG", "ING", "IONG",
  "UA", "UO", "UAI", "UI", "UAN", "UN", "UANG", "UENG",
  "VE", "VAN", "VN", "ER",
]);

function splitPinyinSyllable(py: string): { initialToken: string | null; final: string } {
  const matchedInitial = PINYIN_INITIALS.find((item) => py.startsWith(item));
  if (!matchedInitial) return { initialToken: null, final: py };
  return {
    initialToken: INITIAL_TO_TOKEN[matchedInitial] ?? null,
    final: py.slice(matchedInitial.length),
  };
}

function inferFinalToken(finalPart: string): string {
  if (!finalPart) return "E";
  for (const [rule, token] of FINAL_TOKEN_RULES) {
    if (rule.test(finalPart)) return token;
  }
  return "E";
}

function normalizeIpaSyllable(raw: string): string {
  return raw
    .replace(/[0-9¹²³⁴⁵˥˧˨˩˦]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function callPinyin2ipa(input: string): string {
  if (typeof window === "undefined") return "";
  const converter = (window as unknown as { pinyin2ipa?: (value: string, options?: Record<string, unknown>) => string }).pinyin2ipa;
  if (typeof converter !== "function") return "";
  try {
    return String(
      converter(input, {
        method: "sophisticated",
        toneMarker: "number",
        filterUnknown: true,
      })
    );
  } catch {
    return "";
  }
}

function pinyinSyllableToIpa(py: string): string {
  const out = callPinyin2ipa(py);
  const first = out.split(/\s+/).find((item) => item.trim());
  return normalizeIpaSyllable(first ?? "");
}

function splitIpaSyllable(ipa: string): { initialToken: string | null; finalPart: string } {
  for (const rule of IPA_INITIAL_RULES) {
    if (rule.re.test(ipa)) {
      return {
        initialToken: rule.token,
        finalPart: ipa.replace(rule.re, ""),
      };
    }
  }
  return { initialToken: null, finalPart: ipa };
}

function inferFinalTokenFromIpa(ipaFinal: string): string | null {
  if (!ipaFinal) return null;
  if (/ɑ|a/.test(ipaFinal)) return "A";
  if (/y|ɥ|u/.test(ipaFinal)) return "U";
  if (/o|ɔ|ʊ/.test(ipaFinal)) return "O";
  if (/ɚ|ɤ|ə|e|i/.test(ipaFinal)) return "E";
  return null;
}

function buildChinesePseudoVisemePlan(text: string): { timeline: string[]; breakdown: string[] } {
  const raw = pinyin(text, { style: pinyin.STYLE_NORMAL }) as string[][];
  const timeline: string[] = ["SIL"];
  const breakdown: string[] = [];
  for (const token of raw) {
    const syllableRaw = token?.[0] ?? "";
    if (!/[a-zA-Z]/.test(syllableRaw)) {
      if (timeline[timeline.length - 1] !== "SIL") timeline.push("SIL");
      continue;
    }
    const py = normalizePinyinSyllable(syllableRaw);
    const ipa = pinyinSyllableToIpa(py);
    const ipaSplit = splitIpaSyllable(ipa);
    const pySplit = splitPinyinSyllable(py);
    const initialToken = ipaSplit.initialToken ?? pySplit.initialToken;
    const finalToken = inferFinalTokenFromIpa(ipaSplit.finalPart) ?? inferFinalToken(pySplit.final);
    const steps: string[] = [];
    if (initialToken) timeline.push(initialToken);
    if (initialToken) steps.push(initialToken);
    timeline.push(finalToken);
    steps.push(finalToken);
    // Keep finals longer so pinyin mouth shape is perceivable.
    if (HOLDABLE_FINALS.has(finalToken)) {
      timeline.push(finalToken);
      steps.push(`${finalToken}(hold)`);
    }
    if (/(n|ng)$/.test(pySplit.final) && finalToken !== "N") {
      timeline.push("N");
      steps.push("N");
    }
    if (/r$/.test(pySplit.final) && finalToken !== "ER" && finalToken !== "R") {
      timeline.push("R");
      steps.push("R");
    }
    breakdown.push(`${py}${ipa ? `/${ipa}` : ""} -> ${steps.join(" + ")}`);
  }
  if (timeline[timeline.length - 1] !== "SIL") timeline.push("SIL");
  return { timeline, breakdown };
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
  lipSyncSource: LipSyncSource;
  lipSyncTimelineInfo: string;
}) {
  const { speaking, emotion, mouthOpen, ready, runtime, runtimeError, canvasRef, modelLabel, currentGesture, lipSyncSource, lipSyncTimelineInfo } = props;
  const emotionClass = `emotion-${emotion}`;
  const usingLive2D = runtime === "live2d";
  const usingTalkingHead = runtime === "talkinghead";
  const usingAvatarRuntime = usingLive2D || usingTalkingHead;
  const showLoader = !ready;
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

      <p className="avatar-runtime">渲染模式：{usingLive2D ? "Live2D Runtime" : usingTalkingHead ? "TalkingHead Runtime" : "Mock Fallback"}</p>
      {!usingAvatarRuntime && runtimeError && <p className="avatar-runtime-error">数字人引擎错误：{runtimeError}</p>}
      <p className="avatar-status">
        状态：{ready ? "模型已就绪" : "模型加载中"} / 模型：{modelLabel} / 动作：{GESTURE_LABELS[currentGesture]} / 语音：
        {speaking ? "播报中" : "待机"}
      </p>
      <p className="avatar-emotion-live" aria-live="polite">
        {usingTalkingHead ? "GLB 口型入参" : "口型入参"}：
        <strong>{lipSyncSource}</strong>
        <span className="avatar-emotion-meta">jawOpen={mouthOpen.toFixed(2)}</span>
        <span className="avatar-emotion-meta">{lipSyncTimelineInfo}</span>
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
  const realtimeSentenceBufferRef = useRef<SentenceBuffer | null>(null);
  const typingQueueRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGestureRef = useRef<AvatarGesture>("none");
  const lastGestureAtRef = useRef(0);
  const gestureResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pseudoVisemeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pseudoVisemeSessionRef = useRef(0);

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
  const [talkingHeadMouthChannels, setTalkingHeadMouthChannels] = useState<Record<string, number>>(() =>
    Object.fromEntries(TALKINGHEAD_MOUTH_CHANNELS.map((item) => [item, 0]))
  );
  const [activeMouthChannel, setActiveMouthChannel] = useState("-");
  const [pinyinPseudoBreakdown, setPinyinPseudoBreakdown] = useState("-");
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
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lipSyncSource, setLipSyncSource] = useState<LipSyncSource>("amplitude");
  const [lipSyncTimelineInfo, setLipSyncTimelineInfo] = useState("音频振幅");
  const [avatarPlanDebug, setAvatarPlanDebug] = useState({
    requestedEmotion: "-",
    appliedEmotion: "-",
    requestedGestures: "-",
    appliedGesture: "-",
    reason: "-",
  });
  const [avatarDebugFlow, setAvatarDebugFlow] = useState({
    lastEvent: "init",
    lastTurnId: 0,
    llmDoneCount: 0,
    lipSyncEventCount: 0,
  });

  // 每次页面加载生成新的 userId，刷新页面后自动更换
  const [userId] = useState(() => {
    // crypto.randomUUID 仅在安全上下文（HTTPS/localhost）可用，降级使用 Math.random
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
    return `user_${uuid}`;
  });

  const loading = initLoading || chatLoading || voiceCloneLoading || realtimeLoading;

  useEffect(() => {
    if (answer.trim() && avatarPlanDebug.requestedEmotion === "-" && avatarDebugFlow.llmDoneCount === 0) {
      setAvatarPlanDebug({
        requestedEmotion: emotion,
        appliedEmotion: emotion,
        requestedGestures: activeGesture,
        appliedGesture: activeGesture,
        reason: "未收到 llm.done，使用当前状态兜底",
      });
      setAvatarDebugFlow((prev) => ({
        ...prev,
        lastEvent: "fallback.from.answer",
      }));
    }
  }, [activeGesture, answer, avatarDebugFlow.llmDoneCount, avatarPlanDebug.requestedEmotion, emotion]);

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

    adapterRef.current?.interruptSpeech?.();
    adapterRef.current?.setSpeaking(false);
  }, []);

  const stopTypewriter = useCallback(() => {
    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    typingQueueRef.current = "";
  }, []);

  const stopPseudoVisemeQueue = useCallback(() => {
    pseudoVisemeSessionRef.current += 1;
    pseudoVisemeQueueRef.current = Promise.resolve();
    adapterRef.current?.interruptSpeech?.();
    adapterRef.current?.setSpeaking(false);
  }, []);

  const enqueuePseudoVisemeText = useCallback((text: string, fallbackCues?: number[]) => {
    const cleaned = text.replace(/（[^）]*）/g, "").trim();
    if (!cleaned) return;
    const runToken = pseudoVisemeSessionRef.current;
    const plan = buildChinesePseudoVisemePlan(cleaned);
    const visemes = plan.timeline;
    const stepMs = Math.max(70, Math.round(185 / CHINESE_PSEUDO_VISEME_SPEED));
    const expectedMs = visemes.length * stepMs + 100;

    pseudoVisemeQueueRef.current = pseudoVisemeQueueRef.current.then(async () => {
      if (runToken !== pseudoVisemeSessionRef.current) return;
      const driver = adapterRef.current;
      if (!driver) return;

      if (visemes.length > 0 && driver.runChinesePseudoVisemeSequence) {
        driver.runChinesePseudoVisemeSequence(visemes, stepMs);
        setLipSyncSource("viseme");
        setLipSyncTimelineInfo(
          `文本口型(${CHINESE_PSEUDO_VISEME_SPEED}x)：${visemes.slice(0, 10).join(" ")}${visemes.length > 10 ? " ..." : ""}`
        );
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), expectedMs);
        });
        return;
      }

      if (fallbackCues && fallbackCues.length > 0) {
        stopLipSyncRef.current = driver.playLipSync(fallbackCues);
        driver.setSpeaking(true);
        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), Math.max(900, fallbackCues.length * 120));
        });
      }
    });
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
    stopPseudoVisemeQueue();
  }, [stopPseudoVisemeQueue]);

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
        const narration = item.text.replace(/（[^）]*）/g, "").trim();
        enqueuePseudoVisemeText(narration, item.cues);
        introStopLipSyncRef.current = () => {
          stopPseudoVisemeQueue();
        };
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
      enqueuePseudoVisemeText,
      hasCustomVoiceClone,
      markGesture,
      stopModeIntro,
      stopModeIntroSpeech,
      stopPseudoVisemeQueue,
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

  const resolveTalkingHeadModelUrl = useCallback(
    (personaKey: string): string => {
      const matchedPersona = personas.find((item) => item.key === personaKey);
      const personaText = `${personaKey} ${matchedPersona?.name ?? ""}`.toLowerCase();
      if (personaKey === "general" || personaText.includes("通用") || personaText.includes("general")) {
        return TALKINGHEAD_GENERAL_AVATAR_URL;
      }
      return TALKINGHEAD_SUPPORT_AVATAR_URL;
    },
    [personas]
  );

  const resolveCurrentAvatarModelUrl = useCallback(
    (personaKey: string): string =>
      PREFERRED_AVATAR_RUNTIME === "talkinghead"
        ? resolveTalkingHeadModelUrl(personaKey)
        : resolveLive2DModelUrl(personaKey),
    [resolveLive2DModelUrl, resolveTalkingHeadModelUrl]
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
    const adapter =
      PREFERRED_AVATAR_RUNTIME === "talkinghead"
        ? createTalkingHeadAdapter({
            onStateChange(state) {
              setEmotion(state.emotion);
              setRuntime(state.runtime);
              setIsSpeaking(state.speaking);
              setMouthOpen(state.mouthOpen);
              setTalkingHeadMouthChannels(state.mouthChannels);
              const activeEntry = Object.entries(state.mouthChannels).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
              if (activeEntry && Math.abs(activeEntry[1]) > 0.01) {
                setActiveMouthChannel(`${activeEntry[0]}=${activeEntry[1].toFixed(2)}`);
              } else {
                setActiveMouthChannel("-");
              }
              setAvatarReady(state.initialized);
              setAvatarRuntimeError(state.runtimeError);
            },
          })
        : createLive2DAdapter({
            onStateChange(state) {
              setEmotion(state.emotion);
              setRuntime(state.runtime);
              setIsSpeaking(state.speaking);
              setMouthOpen(state.mouthOpen);
              setTalkingHeadMouthChannels(Object.fromEntries(TALKINGHEAD_MOUTH_CHANNELS.map((item) => [item, 0])));
              setActiveMouthChannel("-");
              setAvatarReady(state.initialized);
              setAvatarRuntimeError(state.runtimeError);
            },
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
    const preferredModelUrl =
      PREFERRED_AVATAR_RUNTIME === "talkinghead"
        ? resolveTalkingHeadModelUrl(selectedPersona)
        : resolveLive2DModelUrl(selectedPersona);
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
          PREFERRED_AVATAR_RUNTIME === "talkinghead"
            ? preferredModelUrl
            : await resolveRenderableModelUrl(preferredModelUrl);
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
  }, [resolveLive2DModelUrl, resolveRenderableModelUrl, resolveTalkingHeadModelUrl, selectedPersona]);

  // 初始化 TTS 客户端
  useEffect(() => {
    const ttsClient = new TTSClient({
      voiceId: voiceId ?? undefined,
      onSpeakingChange: (speaking) => {
        adapterRef.current?.setSpeaking(speaking);
        setIsSpeaking(speaking);
      },
      onMouthOpen: (value) => {
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
        realtimeSentenceBufferRef.current = new SentenceBuffer((sentence) => {
          enqueuePseudoVisemeText(sentence);
        });
        setAvatarPlanDebug({
          requestedEmotion: "规划中...",
          appliedEmotion: emotion,
          requestedGestures: "规划中...",
          appliedGesture: activeGesture,
          reason: "等待 llm.done",
        });
        setAvatarDebugFlow((prev) => ({
          ...prev,
          lastEvent: "asr.final",
        }));
      },
      onLlmDelta: (text) => {
        setChatPhase("typing");
        setAnswer((prev) => prev + text);
        realtimeSentenceBufferRef.current?.push(text);
      },
      onLlmDone: (event) => {
        const modelCapability = resolveAvatarModelCapability(
          resolveCurrentAvatarModelUrl(selectedPersona)
        );
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
        setAvatarPlanDebug({
          requestedEmotion: event.avatarPlan?.emotion ?? event.emotion ?? "neutral",
          appliedEmotion: chosenEmotion,
          requestedGestures: (event.avatarPlan?.gestures ?? []).join(", ") || "none",
          appliedGesture: chosenGesture,
          reason: event.avatarPlan?.reason ?? "fallback",
        });
        setAvatarDebugFlow((prev) => ({
          lastEvent: "voice.llm.done",
          lastTurnId: event.turnId,
          llmDoneCount: prev.llmDoneCount + 1,
          lipSyncEventCount: prev.lipSyncEventCount,
        }));
        setAnswer(event.reply);
        setReferences(event.references);
        realtimeSentenceBufferRef.current?.flush();
        realtimeSentenceBufferRef.current = null;
        setChatPhase("idle");
        setChatLoading(false);
      },
      onConnectionChange: (connected) => {
        setRealtimeConnected(connected);
      },
      onLipSyncTimeline: (event) => {
        const summary = summarizeLipSyncTimeline(event.timeline);
        if (summary) {
          setLipSyncSource(summary.source);
          setLipSyncTimelineInfo(summary.info);
        }
        setAvatarDebugFlow((prev) => ({
          ...prev,
          lastEvent: "voice.tts.lipsync",
          lipSyncEventCount: prev.lipSyncEventCount + 1,
        }));
      },
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enqueuePseudoVisemeText]);

  const playAnswerAudio = useCallback(
    async (audioUrl: string, cues: number[], timeline?: LipSyncTimeline) => {
      cleanupPlayback();

      const adapter = adapterRef.current;
      if (!adapter || !audioUrl) {
        throw new Error("音频不可用");
      }

      const summary = summarizeLipSyncTimeline(timeline);
      if (summary) {
        setLipSyncSource(summary.source);
        setLipSyncTimelineInfo(summary.info);
      } else {
        setLipSyncSource("amplitude");
        setLipSyncTimelineInfo(`cues ${cues.length} 项`);
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
    (cues: number[], timeline?: LipSyncTimeline) => {
      const safeCues = cues.length > 0 ? cues : [0.2, 0.7, 0.35, 0.8, 0.25, 0.65];
      const summary = summarizeLipSyncTimeline(timeline);
      if (summary) {
        setLipSyncSource(summary.source);
        setLipSyncTimelineInfo(summary.info);
      } else {
        setLipSyncSource("amplitude");
        setLipSyncTimelineInfo(`fallback cues ${safeCues.length} 项`);
      }
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
    realtimeSentenceBufferRef.current?.reset();
    realtimeSentenceBufferRef.current = null;
    stopPseudoVisemeQueue();
    setRealtimeActive(false);
    setRealtimeLoading(false);
    setRealtimePartialText("");
    setChatPhase("idle");
    setChatLoading(false);
  }, [stopPseudoVisemeQueue]);

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
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "smart.ask.start",
    }));
    stopRealtimeSession();
    // 提问优先级最高：先硬中断当前自动播报/口型，再进入新一轮问答。
    ttsClientRef.current?.stop();
    stopPseudoVisemeQueue();
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
        enqueuePseudoVisemeText(sentence);
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
          setAvatarDebugFlow((prev) => ({
            ...prev,
            lastEvent: "smart.delta",
          }));
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
      setAvatarPlanDebug({
        requestedEmotion: data.avatarPlan?.emotion ?? data.emotion ?? "neutral",
        appliedEmotion: chosenEmotion,
        requestedGestures: (data.avatarPlan?.gestures ?? []).join(", ") || "none",
        appliedGesture: chosenGesture,
        reason: data.avatarPlan?.reason ?? "fallback",
      });
      setAvatarDebugFlow((prev) => ({
        lastEvent: "smart.done",
        lastTurnId: prev.lastTurnId + 1,
        llmDoneCount: prev.llmDoneCount + 1,
        lipSyncEventCount: prev.lipSyncEventCount,
      }));
      if (data.audioUrl) {
        try {
          await playAnswerAudio(data.audioUrl, data.phonemeCues, data.lipSyncTimeline);
        } catch {
          setErrorMessage("语音播放失败，已回退到离线口型演示。");
          playFallbackLipSync(data.phonemeCues, data.lipSyncTimeline);
        }
      } else {
        playFallbackLipSync(data.phonemeCues, data.lipSyncTimeline);
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
      setAvatarPlanDebug({
        requestedEmotion: "-",
        appliedEmotion: "thinking",
        requestedGestures: "-",
        appliedGesture: "none",
        reason: `smart.error: ${message}`,
      });
      setAvatarDebugFlow((prev) => ({
        ...prev,
        lastEvent: "smart.error",
      }));
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
    enqueuePseudoVisemeText,
    question,
    resolveCurrentAvatarModelUrl,
    stopRealtimeSession,
    stopModeIntro,
    stopPseudoVisemeQueue,
    stopTypewriter
  ]);

  const runMouthShapeTest = useCallback(() => {
    adapterRef.current?.runMouthShapeTest?.();
    setLipSyncSource("amplitude");
    setLipSyncTimelineInfo("手动口型序列");
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.mouthshape.test",
      lipSyncEventCount: prev.lipSyncEventCount + 1,
    }));
  }, []);

  const runVowelMouthTest = useCallback(() => {
    adapterRef.current?.runVowelMouthTest?.();
    setLipSyncSource("amplitude");
    setLipSyncTimelineInfo("元音口型 A/E/I/O/U");
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.mouthshape.vowels",
      lipSyncEventCount: prev.lipSyncEventCount + 1,
    }));
  }, []);

  const runTalkingMouthTest = useCallback(() => {
    adapterRef.current?.runTalkingMouthTest?.();
    setLipSyncSource("amplitude");
    setLipSyncTimelineInfo("说话节奏口型");
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.mouthshape.talking",
      lipSyncEventCount: prev.lipSyncEventCount + 1,
    }));
  }, []);

  const runFullMouthChannelSweep = useCallback(() => {
    adapterRef.current?.runFullMouthChannelSweep?.();
    setLipSyncSource("blendshape");
    setLipSyncTimelineInfo("GLB 全口型通道轮巡");
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.mouthshape.full-sweep",
      lipSyncEventCount: prev.lipSyncEventCount + 1,
    }));
  }, []);

  const runChinesePseudoVisemeDemo = useCallback(() => {
    const plan = buildChinesePseudoVisemePlan(CHINESE_PSEUDO_VISEME_DEMO_TEXT);
    const visemes = plan.timeline;
    const stepMs = Math.max(70, Math.round(185 / CHINESE_PSEUDO_VISEME_SPEED));
    adapterRef.current?.runChinesePseudoVisemeSequence?.(visemes, stepMs);
    setLipSyncSource("viseme");
    setLipSyncTimelineInfo(`中文伪viseme(${CHINESE_PSEUDO_VISEME_SPEED}x)：${visemes.slice(0, 16).join(" ")}${visemes.length > 16 ? " ..." : ""}`);
    setPinyinPseudoBreakdown(plan.breakdown.slice(0, 8).join(" | "));
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.mouthshape.cn-pseudo",
      lipSyncEventCount: prev.lipSyncEventCount + 1,
    }));
  }, []);

  const runGestureShowcase = useCallback(() => {
    adapterRef.current?.runGestureShowcase?.();
    setAvatarDebugFlow((prev) => ({
      ...prev,
      lastEvent: "manual.gesture.showcase",
    }));
  }, []);

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
              当前模式：{realtimeActive ? "通话中（可插话打断）" : "待机"} / 连接：
              {realtimeConnected ? "已连接" : "重连中"}
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
          lipSyncSource={lipSyncSource}
          lipSyncTimelineInfo={lipSyncTimelineInfo}
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
                    voiceSessionRef.current?.interrupt();
                    adapterRef.current?.interruptSpeech?.();
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
          <div className="chat-dialog-refs">
            <h4>Avatar 调试</h4>
            <ul>
              <li>
                口型策略：简单振幅/cues
                <button
                  type="button"
                  onClick={runMouthShapeTest}
                  style={{ marginLeft: 8 }}
                >
                  口型压测
                </button>
                <button
                  type="button"
                  onClick={runVowelMouthTest}
                  style={{ marginLeft: 8 }}
                >
                  元音口型
                </button>
                <button
                  type="button"
                  onClick={runTalkingMouthTest}
                  style={{ marginLeft: 8 }}
                >
                  说话口型
                </button>
                <button
                  type="button"
                  onClick={runFullMouthChannelSweep}
                  style={{ marginLeft: 8 }}
                >
                  全口型枚举
                </button>
                <button
                  type="button"
                  onClick={runChinesePseudoVisemeDemo}
                  style={{ marginLeft: 8 }}
                >
                  中文伪viseme
                </button>
                <button
                  type="button"
                  onClick={runGestureShowcase}
                  style={{ marginLeft: 8 }}
                >
                  动作串联
                </button>
              </li>
              <li>计划情绪：{avatarPlanDebug.requestedEmotion}</li>
              <li>实际情绪：{avatarPlanDebug.appliedEmotion}</li>
              <li>计划动作：{avatarPlanDebug.requestedGestures}</li>
              <li>实际动作：{avatarPlanDebug.appliedGesture}</li>
              <li>规划原因：{avatarPlanDebug.reason}</li>
              <li>
                口型时间线：{lipSyncSource} / {lipSyncTimelineInfo}
              </li>
              <li>中文测试文本：{CHINESE_PSEUDO_VISEME_DEMO_TEXT}</li>
              <li style={{ whiteSpace: "normal" }}>
                拼音分解：{pinyinPseudoBreakdown}
              </li>
              {runtime === "talkinghead" && (
                <li style={{ whiteSpace: "normal" }}>
                  GLB 口型枚举（{TALKINGHEAD_MOUTH_CHANNELS.length} 项） / 当前激活：{activeMouthChannel}
                  <br />
                  {TALKINGHEAD_MOUTH_CHANNELS.map(
                    (key) => `${key}:${(talkingHeadMouthChannels[key] ?? 0).toFixed(2)}`
                  ).join(" | ")}
                </li>
              )}
              <li>事件流：{avatarDebugFlow.lastEvent}</li>
              <li>最近 turnId：{avatarDebugFlow.lastTurnId}</li>
              <li>llm.done 次数：{avatarDebugFlow.llmDoneCount}</li>
              <li>lipsync 事件数：{avatarDebugFlow.lipSyncEventCount}</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
