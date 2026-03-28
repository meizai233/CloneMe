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
  playbackEnabled?: boolean;
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

const MOUTH_GAIN = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_GAIN, 2.2, 0.2, 5);
const MOUTH_NOISE_FLOOR = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_NOISE_FLOOR, 0.02, 0, 0.2);
const MOUTH_SMOOTHING = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_SMOOTHING, 0.35, 0, 0.95);

export class VoiceSessionClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private voiceId?: string;
  private playbackEnabled = true;
  private onSpeakingChange?: OnSpeakingChange;
  private onMouthOpen?: OnMouthOpen;
  private onAsrPartial?: (text: string) => void;
  private onAsrFinal?: (text: string) => void;
  private onLlmDelta?: (text: string) => void;
  private onLlmDone?: (event: VoiceSessionDoneEvent) => void;
  private mediaRecorder: MediaRecorder | null = null;
  private micStream: MediaStream | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private chunkBuffer: ArrayBuffer[] = [];
  private chunkBufferSize = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private mouthAnimTimer: ReturnType<typeof setInterval> | null = null;
  private smoothedMouthOpen = 0;
  private static MIN_BUFFER_SIZE = 8000;
  private static FLUSH_INTERVAL_MS = 250;

  constructor(options: VoiceSessionClientOptions = {}) {
    this.voiceId = options.voiceId;
    this.playbackEnabled = options.playbackEnabled ?? true;
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
          const firstByte = new Uint8Array(data)[0];
          if (firstByte === 123) {
            try {
              const text = new TextDecoder().decode(data);
              this.handleJsonMessage(text);
              return;
            } catch {
              // 解析失败按音频处理
            }
          }
          if (!this.playbackEnabled) {
            return;
          }
          this.chunkBuffer.push(data);
          this.chunkBufferSize += data.byteLength;
          if (this.chunkBufferSize >= VoiceSessionClient.MIN_BUFFER_SIZE) {
            this.flushChunkBuffer();
          } else {
            this.scheduleFlushChunkBuffer();
          }
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
    if (this.mediaRecorder) {
      return;
    }

    // 使用 AudioContext + ScriptProcessor 采集 PCM 16kHz 16bit 单声道
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(this.micStream);
    // 使用 ScriptProcessorNode 采集原始 PCM（bufferSize=4096, 单声道输入, 单声道输出）
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const float32 = e.inputBuffer.getChannelData(0);
      // 将 Float32 转为 Int16 PCM
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.ws.send(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination);

    // 存储引用以便 stopRecording 时清理
    this.mediaRecorder = { stop: () => {
      processor.disconnect();
      source.disconnect();
      audioCtx.close();
    } } as any;
  }

  stopRecording() {
    if (this.mediaRecorder) {
      try { (this.mediaRecorder as any).stop(); } catch { /* 忽略 */ }
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
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
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
    if (type === "turn.interrupted" || type === "turn.started") {
      // 新一轮对话开始或被打断，立即停止当前音频播放
      this.stopPlayback();
      this.audioQueue = [];
    }
  }

  private flushChunkBuffer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.chunkBuffer.length === 0) return;
    const totalSize = this.chunkBuffer.reduce((sum, buf) => sum + buf.byteLength, 0);
    const merged = new Uint8Array(totalSize);
    let offset = 0;
    for (const buf of this.chunkBuffer) {
      merged.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    this.chunkBuffer = [];
    this.chunkBufferSize = 0;
    this.audioQueue.push(merged.buffer);
    this.playNext();
  }

  private scheduleFlushChunkBuffer() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushChunkBuffer();
    }, VoiceSessionClient.FLUSH_INTERVAL_MS);
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
    this.chunkBuffer = [];
    this.chunkBufferSize = 0;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
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
