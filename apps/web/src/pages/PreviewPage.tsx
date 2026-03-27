/**
 * 数字人预览页面
 * 精简版对话界面：只有提问框、回复框和人物形象，无配置面板
 */
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarRuntime,
  type Live2DDriver,
} from "../avatar/live2dAdapter";
import { smartChat } from "../services/api";
import { TTSClient, SentenceBuffer } from "../services/ttsClient";
import { resolveAvatarModelCapability } from "../avatar/modelCapabilities";
import { getAvatar, type Avatar } from "../services/platform-api";

const HARU_MODEL_URL = "/models/haru_greeter_pro_jp/runtime/haru_greeter_t05.model3.json";

export default function PreviewPage() {
  const { id: avatarId } = useParams();
  const navigate = useNavigate();

  const adapterRef = useRef<Live2DDriver | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);
  const typingQueueRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatPhase, setChatPhase] = useState<"idle" | "thinking" | "typing">("idle");
  const [thinkingDots, setThinkingDots] = useState("");
  const [emotion, setEmotion] = useState<AvatarEmotion>("happy");
  const [runtime, setRuntime] = useState<AvatarRuntime>("mock");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(0);
  const [avatarReady, setAvatarReady] = useState(false);
  const [error, setError] = useState("");
  const [sessionId] = useState(() => `preview_${Date.now()}`);
  const [userId] = useState(() => `user_${Date.now().toString(36)}`);

  // 加载数字人信息
  useEffect(() => {
    if (!avatarId) return;
    getAvatar(avatarId).then(res => {
      setAvatar(res.avatar);
      setAnswer(res.avatar.greeting || "你好，有什么可以帮你的？");
    }).catch(() => navigate("/dashboard"));
  }, [avatarId]);

  // 初始化 Live2D
  useEffect(() => {
    const adapter = createLive2DAdapter({
      onStateChange(state) {
        setEmotion(state.emotion);
        setRuntime(state.runtime);
        setIsSpeaking(state.speaking);
        setMouthOpen(state.mouthOpen);
        setAvatarReady(state.initialized);
      },
    });
    adapterRef.current = adapter;

    const timer = setTimeout(() => {
      adapter.init(canvasRef.current ?? "preview-canvas", HARU_MODEL_URL);
    }, 100);

    return () => { clearTimeout(timer); adapter.destroy(); };
  }, []);

  // 初始化 TTS
  useEffect(() => {
    const tts = new TTSClient({
      voiceId: avatar?.voice_id || undefined,
      onSpeakingChange: (s) => { adapterRef.current?.setSpeaking(s); setIsSpeaking(s); },
      onMouthOpen: (v) => { setMouthOpen(v); adapterRef.current?.setMouthOpen(v); },
    });
    ttsClientRef.current = tts;
    tts.connect().catch(() => {});
    return () => { tts.disconnect(); ttsClientRef.current = null; };
  }, [avatar?.voice_id]);

  // 思考动画
  useEffect(() => {
    if (!(chatLoading && chatPhase === "thinking")) { setThinkingDots(""); return; }
    const t = setInterval(() => setThinkingDots(p => p.length >= 3 ? "" : p + "."), 380);
    return () => clearInterval(t);
  }, [chatLoading, chatPhase]);

  const stopTypewriter = useCallback(() => {
    if (typingTimerRef.current) { clearInterval(typingTimerRef.current); typingTimerRef.current = null; }
    typingQueueRef.current = "";
  }, []);

  const pushTypewriterText = useCallback((chunk: string) => {
    if (!chunk) return;
    typingQueueRef.current += chunk;
    if (typingTimerRef.current) return;
    typingTimerRef.current = setInterval(() => {
      const q = typingQueueRef.current;
      if (!q) { if (typingTimerRef.current) { clearInterval(typingTimerRef.current); typingTimerRef.current = null; } return; }
      const seg = q.slice(0, 2);
      typingQueueRef.current = q.slice(2);
      setAnswer(prev => prev + seg);
    }, 22);
  }, []);

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || chatLoading) return;
    setQuestion("");
    setChatLoading(true);
    setChatPhase("thinking");
    setAnswer("");
    setError("");

    ttsClientRef.current?.stop();
    try {
      await ttsClientRef.current?.connect();
    } catch { /* 忽略 */ }

    const sb = new SentenceBuffer(s => ttsClientRef.current?.sendText(s));
    sentenceBufferRef.current = sb;

    try {
      const data = await smartChat({
        userQuestion: q,
        persona: "general",
        sessionId,
        userId,
        avatarModel: resolveAvatarModelCapability(HARU_MODEL_URL),
        onThinking: () => setChatPhase("thinking"),
        onDelta: () => setChatPhase("typing"),
        onDeltaIncrement: (inc) => { setChatPhase("typing"); pushTypewriterText(inc); sb.push(inc); },
      });
      sb.flush();
      ttsClientRef.current?.finishCurrentTask();
      stopTypewriter();
      setAnswer(data.reply);
      adapterRef.current?.setEmotion("happy");
    } catch (err) {
      stopTypewriter();
      setError(err instanceof Error ? err.message : "请求失败");
      setAnswer("抱歉，出了点问题，请稍后再试。");
    } finally {
      setChatPhase("idle");
      setChatLoading(false);
    }
  }

  const usingLive2D = runtime === "live2d";

  return (
    <div style={{ minHeight: "100vh", background: "#0f1220", display: "flex", flexDirection: "column" }}>
      {/* 顶栏 */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px", background: "#131a3f", borderBottom: "1px solid #2c355f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/dashboard")} style={{ background: "none", border: "none", color: "#6b7ff5", cursor: "pointer", fontSize: "0.9rem" }}>← 返回</button>
          <span style={{ color: "#e7ebff", fontSize: "0.95rem", fontWeight: 500 }}>{avatar?.name || "预览"}</span>
        </div>
        <button onClick={() => navigate(`/avatar/${avatarId}/chat`)} style={{ padding: "5px 14px", borderRadius: 8, background: "#4059d4", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.8rem" }}>⚙️ 编辑</button>
      </header>

      {/* 主体：形象 + 对话 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", maxWidth: 800, margin: "0 auto", width: "100%", padding: "16px 20px" }}>
        {/* 人物形象 */}
        <div className="avatar-card" style={{ flex: 1, minHeight: 300 }}>
          <div className={`avatar-stage ${usingLive2D ? "avatar-stage-live2d" : ""}`} style={{ flex: 1, minHeight: 280 }}>
            <canvas ref={canvasRef} id="preview-canvas" className={`avatar-canvas ${usingLive2D ? "visible" : ""}`} />
            {!usingLive2D && (
              <div className={`avatar-loader-shell ${isSpeaking ? "is-speaking" : ""}`}>
                <div className="avatar-loader-core" style={{ transform: `scale(${1 + mouthOpen * 0.18})` }} />
                <div className="avatar-loader-ring avatar-loader-ring-a" />
                <div className="avatar-loader-ring avatar-loader-ring-b" />
                <div className="avatar-loader-ring avatar-loader-ring-c" />
                <div className="avatar-loader-grid" />
                <div className="avatar-loader-text">
                  <strong>{!avatarReady ? "加载中" : "回退模式"}</strong>
                  <span>{!avatarReady ? "正在启动..." : "模型暂不可用"}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 对话区域 */}
        <div className="chat-dialog" style={{ marginTop: 12 }}>
          <div className="chat-dialog-header">
            <span>💬 {avatar?.name || "数字人"}的回复</span>
            <div className="chat-dialog-header-right">
              {chatLoading && <span className="chat-typing">{chatPhase === "thinking" ? `思考中${thinkingDots}` : "输出中..."}</span>}
              {isSpeaking && (
                <button type="button" className="stop-audio-btn" onClick={() => { ttsClientRef.current?.stop(); adapterRef.current?.setSpeaking(false); setIsSpeaking(false); }} title="停止语音">⏹</button>
              )}
            </div>
          </div>
          <div className="chat-dialog-body">
            <p>{chatLoading && chatPhase === "thinking" && !answer ? `🤔 正在思考${thinkingDots}` : answer}</p>
          </div>
        </div>

        {error && <p style={{ color: "#e53935", fontSize: "0.8rem", margin: "8px 0" }}>{error}</p>}

        {/* 提问框 */}
        <form onSubmit={onAsk} style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="输入你的问题..."
            style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1px solid #37457f", background: "#101632", color: "#f4f6ff", fontSize: "0.9rem" }}
          />
          <button type="submit" disabled={chatLoading} style={{ padding: "10px 20px", borderRadius: 10, background: "#4059d4", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.9rem", opacity: chatLoading ? 0.6 : 1 }}>
            {chatLoading ? "思考中..." : "发送"}
          </button>
        </form>
      </div>
    </div>
  );
}
