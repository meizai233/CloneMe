import type {
  AvatarEmotion,
  AvatarGesture,
  AvatarPose,
  AvatarRuntime,
  Live2DDriver,
} from "./live2dAdapter";

interface TalkingHeadState {
  emotion: AvatarEmotion;
  speaking: boolean;
  mouthOpen: number;
  mouthChannels: Record<string, number>;
  initialized: boolean;
  runtime: AvatarRuntime;
  runtimeError: string | null;
}

interface CreateTalkingHeadAdapterOptions {
  onStateChange?: (state: TalkingHeadState) => void;
}

type TalkingHeadLike = {
  showAvatar: (avatar: Record<string, unknown>) => Promise<void>;
  setMood?: (mood: string) => void;
  playGesture?: (name: string, dur?: number, mirror?: boolean, ms?: number) => void;
  setFixedValue?: (key: string, value: number | null) => void;
  stop?: () => void;
};

const DEFAULT_AVATAR_URL =
  "/models/talkinghead/brunette.glb";
const INITIAL_EMOTION: AvatarEmotion = "warm";
const INITIAL_GREETING_GESTURE: AvatarGesture = "openArms";
const DEFAULT_TTS_LANG = import.meta.env.VITE_TALKINGHEAD_TTS_LANG || "zh-CN";
const DEFAULT_LIPSYNC_LANG = import.meta.env.VITE_TALKINGHEAD_LIPSYNC_LANG || "zh";

const EMOTION_TO_MOOD: Record<AvatarEmotion, string> = {
  neutral: "neutral",
  happy: "happy",
  thinking: "neutral",
  excited: "happy",
  confident: "neutral",
  warm: "love",
  serious: "neutral",
  surprised: "fear",
};

const GESTURE_TO_TALKINGHEAD: Record<AvatarGesture, string | null> = {
  none: null,
  nod: "side",
  emphasis: "handup",
  thinking: "side",
  clap: "thumbup",
  openArms: "shrug",
  promoPitch: "handup",
  discountHighlight: "index",
  comfortExplain: "side",
};

export const TALKINGHEAD_MOUTH_CHANNELS = [
  "jawForward",
  "jawLeft",
  "jawOpen",
  "jawRight",
  "mouthClose",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthFunnel",
  "mouthLeft",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthOpen",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthPucker",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthSmile",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "tongueOut",
  "viseme_CH",
  "viseme_DD",
  "viseme_E",
  "viseme_FF",
  "viseme_I",
  "viseme_O",
  "viseme_PP",
  "viseme_RR",
  "viseme_SS",
  "viseme_TH",
  "viseme_U",
  "viseme_aa",
  "viseme_kk",
  "viseme_nn",
  "viseme_sil",
] as const;

const createEmptyMouthChannels = (): Record<string, number> =>
  Object.fromEntries(TALKINGHEAD_MOUTH_CHANNELS.map((key) => [key, 0]));
const PSEUDO_JAW_OPEN_GAIN = 0.66;
const PSEUDO_MOUTH_OPEN_GAIN = 0.58;

const PSEUDO_VISEME_CHANNELS: Record<string, Partial<Record<(typeof TALKINGHEAD_MOUTH_CHANNELS)[number], number>>> = {
  SIL: {
    viseme_sil: 1,
    mouthClose: 0.26,
    mouthPressLeft: 0.16,
    mouthPressRight: 0.16,
    jawOpen: 0.01,
  },
  A: {
    viseme_aa: 0.92,
    jawOpen: 0.46,
    mouthOpen: 0.34,
    mouthLowerDownLeft: 0.22,
    mouthLowerDownRight: 0.22,
    mouthStretchLeft: 0.2,
    mouthStretchRight: 0.2,
    mouthShrugUpper: 0.1,
  },
  O: {
    viseme_O: 0.92,
    jawOpen: 0.3,
    mouthOpen: 0.2,
    mouthPucker: 0.56,
    mouthFunnel: 0.54,
    mouthRollUpper: 0.16,
    mouthRollLower: 0.14,
  },
  E: {
    viseme_E: 0.95,
    jawOpen: 0.09,
    mouthOpen: 0.045,
    mouthStretchLeft: 0.82,
    mouthStretchRight: 0.82,
    mouthPressLeft: 0.22,
    mouthPressRight: 0.22,
    mouthRollLower: 0.15,
    mouthRollUpper: 0.1,
    mouthPucker: 0.03,
  },
  I: {
    viseme_I: 0.92,
    jawOpen: 0.12,
    mouthOpen: 0.06,
    mouthStretchLeft: 0.74,
    mouthStretchRight: 0.74,
    mouthShrugLower: 0.14,
    mouthShrugUpper: 0.12,
  },
  U: {
    viseme_U: 0.94,
    jawOpen: 0.16,
    mouthOpen: 0.09,
    mouthPucker: 0.64,
    mouthFunnel: 0.62,
    mouthRollUpper: 0.22,
    mouthRollLower: 0.2,
  },
  M: {
    viseme_PP: 0.98,
    mouthClose: 0.92,
    mouthPressLeft: 0.72,
    mouthPressRight: 0.72,
    jawOpen: 0.01,
    mouthOpen: 0.01,
  },
  B: {
    viseme_PP: 1,
    mouthClose: 0.95,
    mouthPressLeft: 0.76,
    mouthPressRight: 0.76,
    mouthRollUpper: 0.14,
    jawOpen: 0.01,
    mouthOpen: 0.01,
  },
  P: {
    viseme_PP: 1,
    mouthClose: 0.98,
    mouthPressLeft: 0.82,
    mouthPressRight: 0.82,
    mouthRollUpper: 0.18,
    mouthRollLower: 0.1,
    jawOpen: 0.005,
    mouthOpen: 0.005,
  },
  S: {
    viseme_SS: 0.92,
    jawOpen: 0.11,
    mouthOpen: 0.05,
    mouthStretchLeft: 0.58,
    mouthStretchRight: 0.58,
    mouthRollLower: 0.22,
    mouthRollUpper: 0.16,
  },
  Z: {
    viseme_SS: 0.94,
    jawOpen: 0.1,
    mouthOpen: 0.045,
    mouthStretchLeft: 0.5,
    mouthStretchRight: 0.5,
    mouthRollLower: 0.2,
    mouthRollUpper: 0.14,
    mouthPucker: 0.05,
    mouthFunnel: 0.04,
  },
  C: {
    viseme_SS: 0.9,
    viseme_CH: 0.2,
    jawOpen: 0.12,
    mouthOpen: 0.06,
    mouthStretchLeft: 0.38,
    mouthStretchRight: 0.38,
    mouthPucker: 0.24,
    mouthFunnel: 0.2,
    mouthRollLower: 0.16,
  },
  CH: {
    viseme_CH: 0.98,
    jawOpen: 0.18,
    mouthOpen: 0.1,
    mouthPucker: 0.2,
    mouthFunnel: 0.16,
    mouthShrugUpper: 0.14,
  },
  SH: {
    viseme_CH: 0.95,
    viseme_SS: 0.28,
    jawOpen: 0.13,
    mouthOpen: 0.07,
    mouthPucker: 0.34,
    mouthFunnel: 0.26,
    mouthRollUpper: 0.16,
    mouthRollLower: 0.14,
    mouthStretchLeft: 0.08,
    mouthStretchRight: 0.08,
  },
  ZH: {
    viseme_CH: 1,
    jawOpen: 0.16,
    mouthOpen: 0.09,
    mouthPucker: 0.28,
    mouthFunnel: 0.2,
    mouthRollUpper: 0.12,
    mouthRollLower: 0.1,
  },
  R: {
    viseme_RR: 0.96,
    jawOpen: 0.14,
    mouthOpen: 0.07,
    mouthRight: 0.24,
    mouthRollLower: 0.2,
    mouthRollUpper: 0.18,
  },
  N: {
    viseme_nn: 0.96,
    jawOpen: 0.1,
    mouthOpen: 0.045,
    mouthPressLeft: 0.28,
    mouthPressRight: 0.28,
    mouthShrugLower: 0.14,
  },
  L: {
    viseme_DD: 0.88,
    viseme_nn: 0.52,
    jawOpen: 0.11,
    mouthOpen: 0.055,
    mouthStretchLeft: 0.22,
    mouthStretchRight: 0.22,
    tongueOut: 0.06,
    mouthShrugLower: 0.1,
  },
  K: {
    viseme_kk: 0.96,
    jawOpen: 0.22,
    mouthOpen: 0.12,
    mouthFunnel: 0.1,
    mouthPucker: 0.1,
  },
  F: {
    viseme_FF: 0.95,
    jawOpen: 0.12,
    mouthOpen: 0.05,
    mouthFunnel: 0.15,
    mouthPucker: 0.2,
    mouthUpperUpLeft: 0.28,
    mouthUpperUpRight: 0.28,
  },
  D: {
    viseme_DD: 0.95,
    jawOpen: 0.15,
    mouthOpen: 0.08,
    mouthShrugLower: 0.2,
    mouthShrugUpper: 0.12,
  },
  TH: {
    viseme_TH: 0.95,
    jawOpen: 0.2,
    mouthOpen: 0.1,
    tongueOut: 0.14,
    mouthStretchLeft: 0.22,
    mouthStretchRight: 0.22,
  },
};

const PSEUDO_VISEME_ALIASES: Record<string, string> = {
  // Initials
  B: "B",
  P: "P",
  M: "M",
  F: "F",
  D: "D",
  T: "D",
  N: "N",
  L: "L",
  G: "K",
  K: "K",
  H: "K",
  J: "CH",
  Q: "CH",
  X: "S",
  ZH: "ZH",
  CH: "CH",
  SH: "SH",
  R: "R",
  Z: "Z",
  C: "C",
  S: "S",
  // Finals (richer pinyin tokens)
  A: "A",
  O: "O",
  E: "E",
  I: "I",
  U: "U",
  V: "U",
  AI: "A",
  EI: "E",
  AO: "O",
  OU: "O",
  AN: "A",
  EN: "E",
  ANG: "A",
  ENG: "E",
  ONG: "O",
  ER: "R",
  IA: "A",
  IE: "E",
  IAO: "A",
  IU: "I",
  IAN: "A",
  IN: "I",
  IANG: "A",
  ING: "I",
  IONG: "O",
  UA: "A",
  UO: "O",
  UAI: "A",
  UI: "E",
  UAN: "A",
  UN: "U",
  UANG: "A",
  UENG: "O",
  VE: "U",
  VAN: "A",
  VN: "U",
};

export function createTalkingHeadAdapter(
  options: CreateTalkingHeadAdapterOptions = {}
): Live2DDriver {
  const { onStateChange } = options;
  const state: TalkingHeadState = {
    emotion: INITIAL_EMOTION,
    speaking: false,
    mouthOpen: 0,
    mouthChannels: createEmptyMouthChannels(),
    initialized: false,
    runtime: "mock",
    runtimeError: null,
  };

  let timer: ReturnType<typeof setInterval> | null = null;
  let mouthShapeTimers: Array<ReturnType<typeof setTimeout>> = [];
  let initToken = 0;
  let hostNode: HTMLDivElement | null = null;
  let head: TalkingHeadLike | null = null;

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
  const clampSigned = (value: number) => Math.min(1, Math.max(-1, value));

  const emit = () => {
    onStateChange?.({ ...state, mouthChannels: { ...state.mouthChannels } });
  };

  const setMouthChannel = (key: string, value: number | null) => {
    const nextValue = value == null ? 0 : key === "jawLeft" || key === "jawRight" ? clampSigned(value) : clamp01(value);
    state.mouthChannels[key] = nextValue;
    head?.setFixedValue?.(key, value);
  };

  const resetMouthChannels = () => {
    for (const key of TALKINGHEAD_MOUTH_CHANNELS) {
      state.mouthChannels[key] = 0;
    }
  };

  const stopLipSync = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    state.mouthOpen = 0;
    setMouthChannel("jawOpen", 0);
    setMouthChannel("mouthOpen", null);
    setMouthChannel("mouthPucker", null);
    setMouthChannel("mouthFunnel", null);
    emit();
  };

  const cleanupRuntime = () => {
    stopLipSync();
    resetMouthChannels();
    mouthShapeTimers.forEach((item) => clearTimeout(item));
    mouthShapeTimers = [];
    try {
      head?.stop?.();
    } catch {
      // ignore runtime cleanup errors
    }
    head = null;
    if (hostNode?.parentNode) {
      hostNode.parentNode.removeChild(hostNode);
    }
    hostNode = null;
  };

  const applyMouthOpen = (value: number) => {
    const clamped = clamp01(value);
    state.mouthOpen = clamped;
    setMouthChannel("jawOpen", clamped);
    setMouthChannel("mouthOpen", Math.min(1, clamped * 0.8));
  };

  const clearMouthChannels = () => {
    for (const key of TALKINGHEAD_MOUTH_CHANNELS) {
      setMouthChannel(key, null);
    }
    resetMouthChannels();
  };

  const applyPseudoViseme = (viseme: string) => {
    const normalized = viseme.trim().toUpperCase();
    const mapped = PSEUDO_VISEME_ALIASES[normalized] ?? normalized;
    const profile = PSEUDO_VISEME_CHANNELS[mapped] ?? PSEUDO_VISEME_CHANNELS.SIL;
    clearMouthChannels();
    for (const [key, value] of Object.entries(profile)) {
      if (value == null) {
        setMouthChannel(key, null);
        continue;
      }
      if (key === "jawOpen") {
        setMouthChannel(key, value * PSEUDO_JAW_OPEN_GAIN);
        continue;
      }
      if (key === "mouthOpen") {
        setMouthChannel(key, value * PSEUDO_MOUTH_OPEN_GAIN);
        continue;
      }
      setMouthChannel(key, value);
    }
    const mouthByOpen = profile.mouthOpen ?? profile.jawOpen ?? 0;
    state.mouthOpen = clamp01(mouthByOpen);
    emit();
  };

  return {
    async init(canvasTarget, modelUrlOverride) {
      const token = ++initToken;
      cleanupRuntime();

      const canvas =
        canvasTarget instanceof HTMLCanvasElement
          ? canvasTarget
          : typeof canvasTarget === "string"
            ? (document.getElementById(canvasTarget) as HTMLCanvasElement | null)
            : null;
      const mountNode = canvas?.parentElement ?? null;
      if (!mountNode) {
        state.runtime = "mock";
        state.runtimeError = "Canvas host not found";
        state.initialized = true;
        emit();
        return;
      }

      hostNode = document.createElement("div");
      hostNode.className = "avatar-talkinghead-host";
      mountNode.appendChild(hostNode);

      try {
        const { TalkingHead } = await import("@met4citizen/talkinghead");
        if (token !== initToken) return;
        const avatarUrl =
          modelUrlOverride?.trim() ||
          import.meta.env.VITE_TALKINGHEAD_AVATAR_URL ||
          DEFAULT_AVATAR_URL;
        const instance = new TalkingHead(hostNode, {
          cameraView: "upper",
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
          ttsLang: DEFAULT_TTS_LANG,
          ttsRate: 1.0,
          ttsPitch: 0,
          lipsyncLang: DEFAULT_LIPSYNC_LANG,
          avatarIdleEyeContact: 0.32,
          avatarIdleHeadMove: 0.42,
          avatarSpeakingEyeContact: 0.8,
          avatarSpeakingHeadMove: 0.65,
          lightAmbientIntensity: 2.2,
          lightDirectIntensity: 18,
        }) as TalkingHeadLike;
        await instance.showAvatar({
          url: avatarUrl,
          body: "F",
          avatarMood: EMOTION_TO_MOOD[state.emotion] ?? "neutral",
          ttsLang: DEFAULT_TTS_LANG,
          lipsyncLang: DEFAULT_LIPSYNC_LANG,
          ttsRate: 1.0,
          ttsPitch: 0,
          avatarIdleEyeContact: 0.32,
          avatarIdleHeadMove: 0.42,
          avatarSpeakingEyeContact: 0.8,
          avatarSpeakingHeadMove: 0.65,
        });
        head = instance;
        head.setMood?.(EMOTION_TO_MOOD[state.emotion] ?? "neutral");
        // Start in a friendly "greeting" pose right after model appears.
        const initGesture = GESTURE_TO_TALKINGHEAD[INITIAL_GREETING_GESTURE];
        if (initGesture) {
          head.playGesture?.(initGesture, 2, false, 260);
        }
        state.runtime = "talkinghead";
        state.runtimeError = null;
      } catch (error) {
        state.runtime = "mock";
        state.runtimeError =
          error instanceof Error ? error.message : "Unknown TalkingHead init error";
      } finally {
        state.initialized = true;
        emit();
      }
    },
    setEmotion(emotion) {
      state.emotion = emotion;
      head?.setMood?.(EMOTION_TO_MOOD[emotion] ?? "neutral");
      emit();
    },
    setPose(_pose: Partial<AvatarPose>) {
      // TalkingHead does not expose semantic pose control compatible with Live2D mapping.
    },
    playGesture(gesture) {
      const mapped = GESTURE_TO_TALKINGHEAD[gesture];
      if (!mapped) return;
      head?.playGesture?.(mapped, 2, false, 350);
    },
    setMouthOpen(value) {
      applyMouthOpen(value);
      emit();
    },
    setSpeaking(speaking) {
      state.speaking = speaking;
      if (!speaking) {
        stopLipSync();
        return;
      }
      emit();
    },
    playLipSync(cues) {
      stopLipSync();
      if (cues.length === 0) return stopLipSync;
      let index = 0;
      timer = setInterval(() => {
        applyMouthOpen(cues[index] ?? 0);
        emit();
        index += 1;
        if (index >= cues.length) index = 0;
      }, 90);
      return stopLipSync;
    },
    runMouthShapeTest() {
      stopLipSync();
      mouthShapeTimers.forEach((item) => clearTimeout(item));
      mouthShapeTimers = [];
      state.speaking = true;
      emit();
      const sequence: Array<{ atMs: number; jawOpen: number; mouthOpen: number; mouthPucker: number; mouthFunnel: number }> = [
        { atMs: 0, jawOpen: 0.14, mouthOpen: 0.12, mouthPucker: 0.05, mouthFunnel: 0.04 },
        { atMs: 420, jawOpen: 0.7, mouthOpen: 0.56, mouthPucker: 0.05, mouthFunnel: 0.03 },
        { atMs: 840, jawOpen: 0.28, mouthOpen: 0.22, mouthPucker: 0.06, mouthFunnel: 0.04 },
        { atMs: 1260, jawOpen: 0.42, mouthOpen: 0.34, mouthPucker: 0.38, mouthFunnel: 0.44 },
        { atMs: 1680, jawOpen: 0.2, mouthOpen: 0.16, mouthPucker: 0.62, mouthFunnel: 0.56 },
        { atMs: 2100, jawOpen: 0.04, mouthOpen: 0.03, mouthPucker: 0.04, mouthFunnel: 0.02 },
      ];
      sequence.forEach((pose) => {
        const timerId = setTimeout(() => {
          setMouthChannel("jawOpen", clamp01(pose.jawOpen));
          setMouthChannel("mouthOpen", clamp01(pose.mouthOpen));
          setMouthChannel("mouthPucker", clamp01(pose.mouthPucker));
          setMouthChannel("mouthFunnel", clamp01(pose.mouthFunnel));
          state.mouthOpen = clamp01(pose.mouthOpen);
          emit();
        }, pose.atMs);
        mouthShapeTimers.push(timerId);
      });
      const endTimer = setTimeout(() => {
        stopLipSync();
        state.speaking = false;
        emit();
      }, 2500);
      mouthShapeTimers.push(endTimer);
    },
    runVowelMouthTest() {
      stopLipSync();
      mouthShapeTimers.forEach((item) => clearTimeout(item));
      mouthShapeTimers = [];
      state.speaking = true;
      emit();
      const sequence: Array<{ atMs: number; jawOpen: number; mouthOpen: number; mouthPucker: number; mouthFunnel: number }> = [
        { atMs: 0, jawOpen: 0.74, mouthOpen: 0.6, mouthPucker: 0.04, mouthFunnel: 0.02 },   // A
        { atMs: 420, jawOpen: 0.36, mouthOpen: 0.3, mouthPucker: 0.06, mouthFunnel: 0.04 },  // E
        { atMs: 840, jawOpen: 0.26, mouthOpen: 0.21, mouthPucker: 0.05, mouthFunnel: 0.03 }, // I
        { atMs: 1260, jawOpen: 0.46, mouthOpen: 0.35, mouthPucker: 0.34, mouthFunnel: 0.4 }, // O
        { atMs: 1680, jawOpen: 0.22, mouthOpen: 0.18, mouthPucker: 0.66, mouthFunnel: 0.58 }, // U
        { atMs: 2100, jawOpen: 0.04, mouthOpen: 0.03, mouthPucker: 0.04, mouthFunnel: 0.03 }, // rest
      ];
      sequence.forEach((pose) => {
        const timerId = setTimeout(() => {
          setMouthChannel("jawOpen", clamp01(pose.jawOpen));
          setMouthChannel("mouthOpen", clamp01(pose.mouthOpen));
          setMouthChannel("mouthPucker", clamp01(pose.mouthPucker));
          setMouthChannel("mouthFunnel", clamp01(pose.mouthFunnel));
          state.mouthOpen = clamp01(pose.mouthOpen);
          emit();
        }, pose.atMs);
        mouthShapeTimers.push(timerId);
      });
      const endTimer = setTimeout(() => {
        stopLipSync();
        state.speaking = false;
        emit();
      }, 2550);
      mouthShapeTimers.push(endTimer);
    },
    runTalkingMouthTest() {
      const cues = [0.08, 0.24, 0.48, 0.16, 0.62, 0.22, 0.38, 0.7, 0.26, 0.44, 0.12, 0.3, 0.56, 0.18, 0.1];
      stopLipSync();
      state.speaking = true;
      emit();
      let index = 0;
      timer = setInterval(() => {
        const open = clamp01(cues[index] ?? 0);
        setMouthChannel("jawOpen", open);
        setMouthChannel("mouthOpen", Math.min(1, open * 0.85));
        setMouthChannel("mouthPucker", open > 0.45 ? 0.28 : 0.08);
        setMouthChannel("mouthFunnel", open > 0.5 ? 0.22 : 0.06);
        state.mouthOpen = open;
        emit();
        index += 1;
        if (index >= cues.length) {
          stopLipSync();
          state.speaking = false;
          emit();
        }
      }, 130);
    },
    runFullMouthChannelSweep() {
      stopLipSync();
      mouthShapeTimers.forEach((item) => clearTimeout(item));
      mouthShapeTimers = [];
      state.speaking = true;
      emit();
      TALKINGHEAD_MOUTH_CHANNELS.forEach((channel, index) => {
        const timerId = setTimeout(() => {
          clearMouthChannels();
          const channelValue =
            channel === "jawLeft"
              ? -0.65
              : channel === "jawRight"
                ? 0.65
                : 1;
          setMouthChannel(channel, channelValue);
          if (channel === "jawOpen" || channel === "mouthOpen") {
            state.mouthOpen = Math.max(0, channelValue);
          } else {
            state.mouthOpen = 0;
          }
          emit();
        }, index * 280);
        mouthShapeTimers.push(timerId);
      });
      const endTimer = setTimeout(() => {
        clearMouthChannels();
        state.mouthOpen = 0;
        state.speaking = false;
        emit();
      }, TALKINGHEAD_MOUTH_CHANNELS.length * 280 + 120);
      mouthShapeTimers.push(endTimer);
    },
    runChinesePseudoVisemeSequence(visemes, stepMs = 170) {
      stopLipSync();
      mouthShapeTimers.forEach((item) => clearTimeout(item));
      mouthShapeTimers = [];
      if (visemes.length === 0) return;
      state.speaking = true;
      emit();
      visemes.forEach((viseme, index) => {
        const timerId = setTimeout(() => {
          applyPseudoViseme(viseme);
        }, index * stepMs);
        mouthShapeTimers.push(timerId);
      });
      const endTimer = setTimeout(() => {
        clearMouthChannels();
        state.mouthOpen = 0;
        state.speaking = false;
        emit();
      }, visemes.length * stepMs + 80);
      mouthShapeTimers.push(endTimer);
    },
    runGestureShowcase() {
      mouthShapeTimers.forEach((item) => clearTimeout(item));
      mouthShapeTimers = [];
      const sequence: AvatarGesture[] = ["nod", "emphasis", "thinking", "openArms", "promoPitch", "comfortExplain", "clap"];
      sequence.forEach((gesture, idx) => {
        const timerId = setTimeout(() => {
          const mapped = GESTURE_TO_TALKINGHEAD[gesture];
          if (!mapped) return;
          head?.playGesture?.(mapped, 2, false, 350);
        }, idx * 900);
        mouthShapeTimers.push(timerId);
      });
    },
    interruptSpeech() {
      stopLipSync();
      state.speaking = false;
      emit();
    },
    destroy() {
      initToken += 1;
      cleanupRuntime();
      state.speaking = false;
      state.initialized = false;
      emit();
    },
  };
}
