/**
 * TTS WebSocket 客户端
 * 管理与后端 /ws/tts 的连接，支持句子队列播放 + 口型驱动
 */

const envApiBase = (import.meta.env.VITE_API_BASE_URL ?? "").trim();
const API_BASE_URL = envApiBase || `${window.location.protocol}//${window.location.hostname}:3001`;
const WS_URL = API_BASE_URL.replace(/^http/, "ws") + "/ws/tts";
const readEnvNumber = (raw: unknown, fallback: number, min: number, max: number) => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const MOUTH_GAIN = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_GAIN, 2.2, 0.2, 5);
const MOUTH_NOISE_FLOOR = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_NOISE_FLOOR, 0.02, 0, 0.2);
const MOUTH_SMOOTHING = readEnvNumber(import.meta.env.VITE_LIVE2D_MOUTH_SMOOTHING, 0.35, 0, 0.95);
const MOUTH_MIN_WHILE_SPEAKING = readEnvNumber(
  import.meta.env.VITE_LIVE2D_MOUTH_MIN_WHILE_SPEAKING,
  0.12,
  0,
  0.4
);

type OnSpeakingChange = (speaking: boolean) => void;
type OnMouthOpen = (value: number) => void;

interface TTSClientOptions {
  voiceId?: string;
  onSpeakingChange?: OnSpeakingChange;
  onMouthOpen?: OnMouthOpen;
}

export class TTSClient {
  private ws: WebSocket | null = null;
  private audioQueue: ArrayBuffer[] = []; // 待播放的合并后音频段
  private chunkBuffer: ArrayBuffer[] = []; // 攒 chunk 的缓冲区
  private chunkBufferSize = 0; // 缓冲区总字节数
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private mouthAnimTimer: ReturnType<typeof setInterval> | null = null;
  private smoothedMouthOpen = 0;
  private voiceId?: string;
  private onSpeakingChange?: OnSpeakingChange;
  private onMouthOpen?: OnMouthOpen;
  private connected = false;
  private pendingSentences: string[] = [];

  // 攒够 MIN_BUFFER_SIZE 字节或等 FLUSH_INTERVAL_MS 后合并播放
  private static MIN_BUFFER_SIZE = 8000; // ~0.3 秒 mp3
  private static FLUSH_INTERVAL_MS = 250;

  constructor(options: TTSClientOptions = {}) {
    this.voiceId = options.voiceId;
    this.onSpeakingChange = options.onSpeakingChange;
    this.onMouthOpen = options.onMouthOpen;
  }

  /**
   * 连接 TTS WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      // 如果有旧连接，先关闭
      if (this.ws) {
        try { this.ws.close(); } catch { /* 忽略 */ }
        this.ws = null;
      }
      this.connected = false;

      this.ws = new WebSocket(WS_URL);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.connected = true;
        // 发送积压的句子
        for (const s of this.pendingSentences) {
          this.sendText(s);
        }
        this.pendingSentences = [];
        resolve();
      };

      this.ws.onmessage = (event) => {
        const data = event.data;

        // binaryType=arraybuffer 时，所有消息都是 ArrayBuffer
        if (data instanceof ArrayBuffer) {
          // 尝试判断是 JSON 还是音频：检查前几个字节是否是 '{'
          const firstByte = new Uint8Array(data)[0];
          if (firstByte === 123) { // '{' = 123
            // JSON 控制消息
            try {
              const text = new TextDecoder().decode(data);
              const msg = JSON.parse(text);
              if (msg.type === "connected") return;
            } catch {
              // 解析失败当音频处理
            }
          }
          // 音频数据 → 攒到缓冲区
          this.chunkBuffer.push(data);
          this.chunkBufferSize += data.byteLength;

          // 攒够了就合并播放
          if (this.chunkBufferSize >= TTSClient.MIN_BUFFER_SIZE) {
            this.flushChunkBuffer();
          } else {
            // 没攒够就设定时器，避免最后一小段丢失
            this.scheduleFlushChunkBuffer();
          }
        } else if (typeof data === "string") {
          // string 类型的 JSON 消息
          try {
            const msg = JSON.parse(data);
            if (msg.type === "connected") return;
          } catch { /* 忽略 */ }
        }
      };

      this.ws.onerror = () => {
        this.connected = false;
        reject(new Error("TTS WebSocket 连接失败"));
      };

      this.ws.onclose = () => {
        this.connected = false;
      };

      // 5 秒超时
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error("TTS WebSocket 连接超时"));
        }
      }, 5000);
    });
  }

  /**
   * 发送一句文本到 TTS 合成
   */
  sendText(text: string) {
    if (!text.trim()) return;

    // 检查实际连接状态（不只依赖 this.connected 标志）
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connected = false;
      this.pendingSentences.push(text);
      // 自动重连
      this.connect().catch(() => {
        console.warn("[TTS] 自动重连失败");
      });
      return;
    }

    this.ws.send(JSON.stringify({
      text: text.trim(),
      voice: this.voiceId || "cherry",
    }));
  }

  /**
   * 合并缓冲区中的 chunk 为一个大段，放入播放队列
   */
  private flushChunkBuffer() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.chunkBuffer.length === 0) return;

    // 合并所有 chunk 为一个 ArrayBuffer
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

  /**
   * 延迟合并（避免最后一小段丢失）
   */
  private scheduleFlushChunkBuffer() {
    if (this.flushTimer) return; // 已有定时器
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushChunkBuffer();
    }, TTSClient.FLUSH_INTERVAL_MS);
  }

  /**
   * 播放队列中的下一段音频
   */
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
          // 继续播放下一段
          this.playNext();
        } else {
          // 全部播完
          this.stopMouthAnimation();
          this.onSpeakingChange?.(false);
        }
      };

      source.start();
    } catch {
      // 音频解码失败，跳过这段
      this.isPlaying = false;
      if (this.audioQueue.length > 0) {
        this.playNext();
      } else {
        this.stopMouthAnimation();
        this.onSpeakingChange?.(false);
      }
    }
  }

  /**
   * 准备音频分析节点，用于实时口型
   */
  private setupAnalyser() {
    if (!this.audioContext || this.analyser) return;
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.5;
    analyser.connect(this.audioContext.destination);
    this.analyser = analyser;
    this.analyserData = new Uint8Array(analyser.fftSize) as Uint8Array<ArrayBuffer>;
  }

  /**
   * 启动口型动画（优先实时振幅驱动，失败时回退模拟）
   */
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
        const speakingMouthOpen = Math.max(MOUTH_MIN_WHILE_SPEAKING, this.smoothedMouthOpen);
        this.onMouthOpen?.(speakingMouthOpen);
      }, 33);
      return;
    }

    let t = 0;
    this.mouthAnimTimer = setInterval(() => {
      t += 1;
      const value = (Math.sin(t * 0.6) + 1) * 0.3 + Math.random() * 0.25;
      const mouthOpen = Math.min(1, Math.max(MOUTH_MIN_WHILE_SPEAKING, value));
      this.onMouthOpen?.(mouthOpen);
    }, 80);
  }

  /**
   * 停止口型动画
   */
  private stopMouthAnimation() {
    if (this.mouthAnimTimer) {
      clearInterval(this.mouthAnimTimer);
      this.mouthAnimTimer = null;
    }
    this.onMouthOpen?.(0);
  }

  /**
   * 停止播放并清空队列
   */
  stop() {
    this.audioQueue = [];
    this.chunkBuffer = [];
    this.chunkBufferSize = 0;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.pendingSentences = [];
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* 忽略 */ }
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.stopMouthAnimation();
    this.onSpeakingChange?.(false);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stop();
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

  /**
   * 通知后端当前 task 的所有文本已发完
   */
  finishCurrentTask() {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'finish' }));
    }
  }

  /**
   * 更新 voiceId
   */
  setVoiceId(voiceId: string | undefined) {
    this.voiceId = voiceId;
  }
}

/**
 * 句子缓冲器：将流式 token 按标点断句
 * 优化策略：
 * 1. 优先在句号/问号/感叹号处断句
 * 2. 超过 maxLength 时在逗号/分号/换行处强制断句
 * 3. 超过 hardMaxLength 时在任意位置强制断句
 */
export class SentenceBuffer {
  private buffer = "";
  private minLength: number;
  private maxLength: number;
  private hardMaxLength: number;
  private onSentence: (sentence: string) => void;

  constructor(onSentence: (sentence: string) => void, minLength = 6, maxLength = 40, hardMaxLength = 60) {
    this.onSentence = onSentence;
    this.minLength = minLength;
    this.maxLength = maxLength;
    this.hardMaxLength = hardMaxLength;
  }

  /**
   * 追加文本，按断句规则触发回调
   */
  push(text: string) {
    this.buffer += text;

    while (this.buffer.length > 0) {
      let cutIdx = -1;

      // 规则 1：在句号/问号/感叹号/换行处断句
      const strongMatch = this.buffer.match(/[。！？\n.!?]/);
      if (strongMatch && strongMatch.index !== undefined) {
        cutIdx = strongMatch.index + 1;
      }

      // 规则 2：如果没有强断句符，但超过 maxLength，在逗号/分号/顿号/冒号处断句
      if (cutIdx === -1 && this.buffer.length >= this.maxLength) {
        // 从 minLength 位置开始搜索，避免在太前面断句
        const searchFrom = this.buffer.slice(this.minLength);
        const weakMatch = searchFrom.match(/[，,；;、：:）)]/);
        if (weakMatch && weakMatch.index !== undefined) {
          cutIdx = this.minLength + weakMatch.index + 1;
        }
      }

      // 规则 3：如果还是没有断句点，但超过 hardMaxLength，在最近的空格或直接截断
      if (cutIdx === -1 && this.buffer.length >= this.hardMaxLength) {
        // 尝试在 maxLength 附近找一个弱断句符
        const nearCut = this.buffer.slice(0, this.hardMaxLength);
        const lastWeak = Math.max(
          nearCut.lastIndexOf('，'),
          nearCut.lastIndexOf(','),
          nearCut.lastIndexOf('。'),
          nearCut.lastIndexOf('；'),
          nearCut.lastIndexOf('、'),
          nearCut.lastIndexOf('：'),
          nearCut.lastIndexOf(' '),
        );
        cutIdx = lastWeak > this.minLength ? lastWeak + 1 : this.maxLength;
      }

      if (cutIdx === -1) break; // 没有断句点且长度未超限，等更多文本

      const sentence = this.buffer.slice(0, cutIdx).trim();
      this.buffer = this.buffer.slice(cutIdx);

      // 短句合并到下一句
      if (sentence.length < this.minLength) {
        this.buffer = sentence + this.buffer;
        break;
      }

      this.onSentence(sentence);
    }
  }

  /**
   * 刷新剩余内容（流结束时调用）
   * 对剩余文本也执行断句，而不是整段发出
   */
  flush() {
    // 先尝试对剩余内容断句
    if (this.buffer.length > this.maxLength) {
      // 强制触发断句：临时降低阈值
      const saved = this.hardMaxLength;
      this.hardMaxLength = this.maxLength;
      this.push(""); // 触发 while 循环重新检查
      this.hardMaxLength = saved;
    }

    // 发送最终剩余的内容
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      // 如果剩余内容还是很长，按 maxLength 强制拆分
      if (remaining.length > this.maxLength) {
        let pos = 0;
        while (pos < remaining.length) {
          const chunk = remaining.slice(pos, pos + this.maxLength);
          // 尝试在断句符处切
          const lastBreak = Math.max(
            chunk.lastIndexOf('，'), chunk.lastIndexOf(','),
            chunk.lastIndexOf('。'), chunk.lastIndexOf('！'),
            chunk.lastIndexOf('？'), chunk.lastIndexOf('；'),
            chunk.lastIndexOf('\n'), chunk.lastIndexOf('：'),
          );
          const cutAt = lastBreak > this.minLength ? lastBreak + 1 : chunk.length;
          const piece = remaining.slice(pos, pos + cutAt).trim();
          if (piece) this.onSentence(piece);
          pos += cutAt;
        }
      } else {
        this.onSentence(remaining);
      }
    }
    this.buffer = "";
  }

  /**
   * 重置
   */
  reset() {
    this.buffer = "";
  }
}
