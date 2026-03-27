/**
 * TTS WebSocket 客户端
 * 管理与后端 /ws/tts 的连接，支持句子队列播放 + 口型驱动
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const WS_URL = API_BASE_URL.replace(/^http/, "ws") + "/ws/tts";

type OnSpeakingChange = (speaking: boolean) => void;
type OnMouthOpen = (value: number) => void;

interface TTSClientOptions {
  voiceId?: string;
  onSpeakingChange?: OnSpeakingChange;
  onMouthOpen?: OnMouthOpen;
}

export class TTSClient {
  private ws: WebSocket | null = null;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private mouthAnimTimer: ReturnType<typeof setInterval> | null = null;
  private voiceId?: string;
  private onSpeakingChange?: OnSpeakingChange;
  private onMouthOpen?: OnMouthOpen;
  private connected = false;
  private pendingSentences: string[] = [];

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
        if (typeof event.data === "string") {
          // JSON 控制消息
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "connected") return;
          } catch {
            // 忽略
          }
        } else {
          // 二进制音频数据
          this.audioQueue.push(event.data as ArrayBuffer);
          this.playNext();
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

    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
      this.pendingSentences.push(text);
      return;
    }

    this.ws!.send(JSON.stringify({
      text: text.trim(),
      voice: this.voiceId || "cherry",
    }));
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

      const audioBuffer = await this.audioContext.decodeAudioData(audioData.slice(0));
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
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
   * 启动口型动画（模拟说话时嘴巴开合）
   */
  private startMouthAnimation() {
    this.stopMouthAnimation();
    let t = 0;
    this.mouthAnimTimer = setInterval(() => {
      t += 1;
      const value = (Math.sin(t * 0.6) + 1) * 0.3 + Math.random() * 0.25;
      this.onMouthOpen?.(Math.min(1, Math.max(0, value)));
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
 */
export class SentenceBuffer {
  private buffer = "";
  private minLength: number;
  private onSentence: (sentence: string) => void;

  constructor(onSentence: (sentence: string) => void, minLength = 8) {
    this.onSentence = onSentence;
    this.minLength = minLength;
  }

  /**
   * 追加文本，遇到断句标点时触发回调
   */
  push(text: string) {
    this.buffer += text;

    // 按句子标点断句
    const sentenceEnders = /([。！？\n.!?])/;
    while (true) {
      const match = this.buffer.match(sentenceEnders);
      if (!match || match.index === undefined) break;

      const endIdx = match.index + match[0].length;
      const sentence = this.buffer.slice(0, endIdx).trim();
      this.buffer = this.buffer.slice(endIdx);

      // 短句合并到下一句
      if (sentence.length >= this.minLength) {
        this.onSentence(sentence);
      } else {
        this.buffer = sentence + this.buffer;
        break;
      }
    }
  }

  /**
   * 刷新剩余内容（流结束时调用）
   */
  flush() {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.onSentence(remaining);
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
