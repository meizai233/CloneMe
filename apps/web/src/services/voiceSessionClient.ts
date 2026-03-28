import type { LipSyncTimeline } from "../avatar/lipSyncTimeline";
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const WS_URL = API_BASE_URL.replace(/^http/, "ws") + "/ws/voice-session";

type OnSpeakingChange = (speaking: boolean) => void;
type OnMouthOpen = (value: number) => void;

export interface VoiceSessionStartOptions {
  sessionId?: string;
  userId?: string;
  persona?: string;
  voiceId?: string;
  avatarModel?: {
    modelKey: string;
    modelLabel: string;
    allowedEmotions: string[];
    allowedGestures: string[];
    gestureHints?: Record<string, string>;
  };
}

export interface VoiceSessionDoneEvent {
  turnId: number;
  reply: string;
  references: string[];
  emotion: string;
  avatarPlan?: {
    emotion?: string;
    gestures?: string[];
    reason?: string;
  };
  sessionId: string;
  persona: string;
}

export interface VoiceSessionLipSyncEvent {
  turnId: number;
  timeline: LipSyncTimeline;
  text?: string;
}

interface VoiceSessionClientOptions {
  voiceId?: string;
  onSpeakingChange?: OnSpeakingChange;
  onMouthOpen?: OnMouthOpen;
  onAsrPartial?: (text: string) => void;
  onAsrFinal?: (text: string) => void;
  onLlmDelta?: (text: string) => void;
  onLlmDone?: (event: VoiceSessionDoneEvent) => void;
  onLipSyncTimeline?: (event: VoiceSessionLipSyncEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

const readEnvNumber = (raw: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const MOUTH_GAIN = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_GAIN, 1.4, 0.2, 4);
const MOUTH_NOISE_FLOOR = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_NOISE_FLOOR, 0.02, 0, 0.2);
const MOUTH_SMOOTHING = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_SMOOTHING, 0.75, 0, 0.95);

export class VoiceSessionClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private voiceId?: string;
  private onSpeakingChange?: OnSpeakingChange;
  private onMouthOpen?: OnMouthOpen;
  private onAsrPartial?: (text: string) => void;
  private onAsrFinal?: (text: string) => void;
  private onLlmDelta?: (text: string) => void;
  private onLlmDone?: (event: VoiceSessionDoneEvent) => void;
  private onLipSyncTimeline?: (event: VoiceSessionLipSyncEvent) => void;
  private onConnectionChange?: (connected: boolean) => void;
  private mediaRecorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private mouthAnimTimer: ReturnType<typeof setInterval> | null = null;
  private smoothedMouthOpen = 0;
  private lastStartOptions: VoiceSessionStartOptions | null = null;
  private shouldRecord = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private activeTurnId = 0;

  constructor(options: VoiceSessionClientOptions = {}) {
    this.voiceId = options.voiceId;
    this.onSpeakingChange = options.onSpeakingChange;
    this.onMouthOpen = options.onMouthOpen;
    this.onAsrPartial = options.onAsrPartial;
    this.onAsrFinal = options.onAsrFinal;
    this.onLlmDelta = options.onLlmDelta;
    this.onLlmDone = options.onLlmDone;
    this.onLipSyncTimeline = options.onLipSyncTimeline;
    this.onConnectionChange = options.onConnectionChange;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }
      this.manualDisconnect = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      this.ws = new WebSocket(WS_URL);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.onConnectionChange?.(true);
        if (this.lastStartOptions) {
          this.startSession(this.lastStartOptions);
        }
        if (this.shouldRecord) {
          void this.startRecording().catch(() => {
            // ignore auto resume error
          });
        }
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = event.data;
        if (data instanceof ArrayBuffer) {
          this.audioQueue.push(data);
          this.playNext();
          return;
        }
        if (typeof data === "string") {
          this.handleJsonMessage(data);
        }
      };

      this.ws.onerror = () => {
        this.connected = false;
        this.onConnectionChange?.(false);
        reject(new Error("Voice session 连接失败"));
      };

      this.ws.onclose = () => {
        this.connected = false;
        this.onConnectionChange?.(false);
        if (!this.manualDisconnect) {
          this.scheduleReconnect();
        }
      };

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Voice session 连接超时"));
        }
      }, 5000);
    });
  }

  startSession(options: VoiceSessionStartOptions) {
    this.lastStartOptions = options;
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Voice session 未连接");
    }
    this.ws.send(
      JSON.stringify({
        type: "start",
        ...options,
        voiceId: options.voiceId ?? this.voiceId,
      })
    );
  }

  async startRecording() {
    this.shouldRecord = true;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Voice session 未连接");
    }
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      return;
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(this.micStream, { mimeType: "audio/webm" });
    this.mediaRecorder = mediaRecorder;

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size <= 0) return;
      const payload = await event.data.arrayBuffer();
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(payload);
      }
    };

    mediaRecorder.start(250);
  }

  stopRecording() {
    this.shouldRecord = false;
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((track) => track.stop());
      this.micStream = null;
    }
    this.mediaRecorder = null;
  }

  interrupt() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "interrupt" }));
    }
    this.stopPlayback();
    this.activeTurnId = 0;
  }

  setVoiceId(voiceId: string | undefined) {
    this.voiceId = voiceId;
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopRecording();
    this.stopPlayback();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.onConnectionChange?.(false);
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.analyserData = null;
    this.smoothedMouthOpen = 0;
    this.activeTurnId = 0;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manualDisconnect) return;
    const delay = Math.min(4000, 500 * 2 ** Math.min(this.reconnectAttempts, 3));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => {
        this.scheduleReconnect();
      });
    }, delay);
  }

  private handleJsonMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof msg.type === "string" ? msg.type : "";
    if (type === "turn.started") {
      this.activeTurnId = Number(msg.turnId ?? 0);
      return;
    }
    if (type === "turn.interrupted") {
      this.activeTurnId = 0;
      this.stopPlayback();
      return;
    }
    if (type === "asr.partial" && typeof msg.text === "string") {
      this.onAsrPartial?.(msg.text);
      return;
    }
    if (type === "asr.final" && typeof msg.text === "string") {
      this.onAsrFinal?.(msg.text);
      return;
    }
    if (type === "llm.delta" && typeof msg.text === "string") {
      const turnId = Number(msg.turnId ?? 0);
      if (this.activeTurnId > 0 && turnId > 0 && turnId !== this.activeTurnId) {
        return;
      }
      this.onLlmDelta?.(msg.text);
      return;
    }
    if (type === "tts.lipsync") {
      const turnId = Number(msg.turnId ?? 0);
      if (this.activeTurnId > 0 && turnId > 0 && turnId !== this.activeTurnId) {
        return;
      }
      const source = typeof msg.source === "string" ? msg.source : "";
      if (
        source === "viseme" &&
        Array.isArray(msg.visemes) &&
        Array.isArray(msg.vtimes) &&
        Array.isArray(msg.vdurations)
      ) {
        this.onLipSyncTimeline?.({
          turnId,
          timeline: {
            source: "viseme",
            visemes: msg.visemes.filter((item): item is string => typeof item === "string"),
            vtimes: msg.vtimes.map((item) => Number(item) || 0),
            vdurations: msg.vdurations.map((item) => Number(item) || 0),
          },
          text: typeof msg.text === "string" ? msg.text : undefined,
        });
      } else if (
        (source === "word" || source === "heuristic") &&
        Array.isArray(msg.words) &&
        Array.isArray(msg.wtimes) &&
        Array.isArray(msg.wdurations)
      ) {
        this.onLipSyncTimeline?.({
          turnId,
          timeline: {
            source,
            words: msg.words.filter((item): item is string => typeof item === "string"),
            wtimes: msg.wtimes.map((item) => Number(item) || 0),
            wdurations: msg.wdurations.map((item) => Number(item) || 0),
          },
          text: typeof msg.text === "string" ? msg.text : undefined,
        });
      }
      return;
    }
    if (type === "llm.done") {
      const turnId = Number(msg.turnId ?? 0);
      if (this.activeTurnId > 0 && turnId > 0 && turnId !== this.activeTurnId) {
        return;
      }
      this.onLlmDone?.({
        turnId,
        reply: typeof msg.reply === "string" ? msg.reply : "",
        references: Array.isArray(msg.references) ? (msg.references as string[]) : [],
        emotion: typeof msg.emotion === "string" ? msg.emotion : "neutral",
        avatarPlan: typeof msg.avatarPlan === "object" ? (msg.avatarPlan as VoiceSessionDoneEvent["avatarPlan"]) : undefined,
        sessionId: typeof msg.sessionId === "string" ? msg.sessionId : "",
        persona: typeof msg.persona === "string" ? msg.persona : "",
      });
      this.activeTurnId = 0;
    }
  }

  private async playNext() {
    if (this.isPlaying || this.audioQueue.length === 0) return;

    this.isPlaying = true;
    this.onSpeakingChange?.(true);
    this.startMouthAnimation();

    const audioData = this.audioQueue.shift()!;
    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      this.setupAnalyser();

      const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      if (this.analyser) {
        source.connect(this.analyser);
      } else {
        source.connect(this.audioContext.destination);
      }
      this.currentSource = source;

      source.onended = () => {
        this.isPlaying = false;
        this.currentSource = null;
        if (this.audioQueue.length > 0) {
          this.playNext();
        } else {
          this.stopMouthAnimation();
          this.onSpeakingChange?.(false);
        }
      };

      source.start();
    } catch {
      this.isPlaying = false;
      if (this.audioQueue.length > 0) {
        this.playNext();
      } else {
        this.stopMouthAnimation();
        this.onSpeakingChange?.(false);
      }
    }
  }

  private setupAnalyser() {
    if (!this.audioContext || this.analyser) return;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    analyser.connect(this.audioContext.destination);
    this.analyser = analyser;
    this.analyserData = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
  }

  private startMouthAnimation() {
    this.stopMouthAnimation();
    this.smoothedMouthOpen = 0;
    if (this.analyser && this.analyserData) {
      this.mouthAnimTimer = setInterval(() => {
        if (!this.analyser || !this.analyserData) return;
        this.analyser.getByteTimeDomainData(this.analyserData);
        let power = 0;
        for (const sample of this.analyserData) {
          const centered = (sample - 128) / 128;
          power += centered * centered;
        }
        const rms = Math.sqrt(power / this.analyserData.length);
        const boosted = Math.max(0, rms - MOUTH_NOISE_FLOOR) * MOUTH_GAIN;
        const target = Math.min(1, boosted);
        this.smoothedMouthOpen =
          this.smoothedMouthOpen * MOUTH_SMOOTHING + target * (1 - MOUTH_SMOOTHING);
        this.onMouthOpen?.(this.smoothedMouthOpen);
      }, 33);
      return;
    }

    let t = 0;
    this.mouthAnimTimer = setInterval(() => {
      t += 1;
      const value = (Math.sin(t * 0.6) + 1) * 0.3 + Math.random() * 0.25;
      this.onMouthOpen?.(Math.min(1, Math.max(0, value)));
    }, 80);
  }

  private stopMouthAnimation() {
    if (this.mouthAnimTimer) {
      clearInterval(this.mouthAnimTimer);
      this.mouthAnimTimer = null;
    }
    this.onMouthOpen?.(0);
  }

  private stopPlayback() {
    this.audioQueue = [];
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // ignore
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.stopMouthAnimation();
    this.onSpeakingChange?.(false);
  }
}
