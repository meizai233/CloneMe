const envApiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE_URL = envApiBase || `${window.location.protocol}//${window.location.hostname}:3001`;
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

interface VoiceSessionClientOptions {
  voiceId?: string;
  onSpeakingChange?: OnSpeakingChange;
  onMouthOpen?: OnMouthOpen;
  onAsrPartial?: (text: string) => void;
  onAsrFinal?: (text: string) => void;
  onLlmDelta?: (text: string) => void;
  onLlmDone?: (event: VoiceSessionDoneEvent) => void;
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

  constructor(options: VoiceSessionClientOptions = {}) {
    this.voiceId = options.voiceId;
    this.onSpeakingChange = options.onSpeakingChange;
    this.onMouthOpen = options.onMouthOpen;
    this.onAsrPartial = options.onAsrPartial;
    this.onAsrFinal = options.onAsrFinal;
    this.onLlmDelta = options.onLlmDelta;
    this.onLlmDone = options.onLlmDone;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(WS_URL);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.connected = true;
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
        reject(new Error("Voice session 连接失败"));
      };

      this.ws.onclose = () => {
        this.connected = false;
      };

      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("Voice session 连接超时"));
        }
      }, 5000);
    });
  }

  startSession(options: VoiceSessionStartOptions) {
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
  }

  setVoiceId(voiceId: string | undefined) {
    this.voiceId = voiceId;
  }

  disconnect() {
    this.stopRecording();
    this.stopPlayback();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.analyserData = null;
    this.smoothedMouthOpen = 0;
  }

  private handleJsonMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = typeof msg.type === "string" ? msg.type : "";
    if (type === "asr.partial" && typeof msg.text === "string") {
      this.onAsrPartial?.(msg.text);
      return;
    }
    if (type === "asr.final" && typeof msg.text === "string") {
      this.onAsrFinal?.(msg.text);
      return;
    }
    if (type === "llm.delta" && typeof msg.text === "string") {
      this.onLlmDelta?.(msg.text);
      return;
    }
    if (type === "llm.done") {
      this.onLlmDone?.({
        turnId: Number(msg.turnId ?? 0),
        reply: typeof msg.reply === "string" ? msg.reply : "",
        references: Array.isArray(msg.references) ? (msg.references as string[]) : [],
        emotion: typeof msg.emotion === "string" ? msg.emotion : "neutral",
        avatarPlan: typeof msg.avatarPlan === "object" ? (msg.avatarPlan as VoiceSessionDoneEvent["avatarPlan"]) : undefined,
        sessionId: typeof msg.sessionId === "string" ? msg.sessionId : "",
        persona: typeof msg.persona === "string" ? msg.persona : "",
      });
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
