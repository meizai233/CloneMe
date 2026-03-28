/**
 * 数字人预览页面
 * 左侧人物模型 + 右侧多轮对话记录，背景图铺满整个页面
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function PreviewPage() {
  const { id: avatarId } = useParams();
  const navigate = useNavigate();

  const adapterRef = useRef<Live2DDriver | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ttsClientRef = useRef<TTSClient | null>(null);
  const sentenceBufferRef = useRef<SentenceBuffer | null>(null);
  const typingQueueRef = useRef("");
  const typingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentReply, setCurrentReply] = useState("");
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

  // 自动滚动到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, currentReply]);

  // 加载数字人信息
  useEffect(() => {
    if (!avatarId) return;
    getAvatar(avatarId).then(res => {
      setAvatar(res.avatar);
      if (res.avatar.greeting) {
        setMessages([{ role: "assistant", content: res.avatar.greeting }]);
      }
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
    return () => { clearTimeout(timer); adapter.destroy(); adapterRef.current = null; };
  }, [avatarId]);

  // 初始化 TTS
  useEffect(() => {
    if (ttsClientRef.current) {
      ttsClientRef.current.disconnect();
      ttsClientRef.current = null;
    }
    const tts = new TTSClient({
      voiceId: avatar?.voice_id || undefined,
      onSpeakingChange: (s) => { adapterRef.current?.setSpeaking(s); setIsSpeaking(s); },
      onMouthOpen: (v) => { setMouthOpen(v); adapterRef.current?.setMouthOpen(v); },
    });
    ttsClientRef.current = tts;
    tts.connect().catch(() => {});
    return () => { tts.disconnect(); ttsClientRef.current = null; };
  }, [avatarId, avatar?.voice_id]);

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
      setCurrentReply(prev => prev + seg);
    }, 22);
  }, []);

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || chatLoading) return;

    // 添加用户消息
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setQuestion("");
    setChatLoading(true);
    setChatPhase("thinking");
    setCurrentReply("");
    setError("");

    ttsClientRef.current?.stop();
    try { await ttsClientRef.current?.connect(); } catch { /* 忽略 */ }

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
      // 把完整回复加入消息列表
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
      setCurrentReply("");
      adapterRef.current?.setEmotion("happy");
    } catch (err) {
      stopTypewriter();
      const errMsg = err instanceof Error ? err.message : "请求失败";
      setError(errMsg);
      setMessages(prev => [...prev, { role: "assistant", content: "抱歉，出了点问题，请稍后再试。" }]);
      setCurrentReply("");
    } finally {
      setChatPhase("idle");
      setChatLoading(false);
    }
  }

  const usingLive2D = runtime === "live2d";

  return (
    <div style={{
      minHeight: "100vh",
      backgroundImage: "linear-gradient(180deg, rgba(8,14,36,0.3), rgba(8,14,36,0.6)), url('/images/live2d/haluo-hero-banner.png')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      display: "flex",
      flexDirection: "column",
    }}>
      {/* 顶栏 */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", background: "rgba(19,26,63,0.8)", borderBottom: "1px solid #2c355f",
        backdropFilter: "blur(8px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/dashboard")} style={{ background: "none", border: "none", color: "#6b7ff5", cursor: "pointer", fontSize: "0.9rem" }}>← 返回</button>
          <span style={{ color: "#e7ebff", fontSize: "0.95rem", fontWeight: 500 }}>{avatar?.name || "预览"}</span>
        </div>
        <button onClick={() => navigate(`/avatar/${avatarId}/chat`)} style={{ padding: "5px 14px", borderRadius: 8, background: "#4059d4", color: "#fff", border: "none", cursor: "pointer", fontSize: "0.8rem" }}>⚙️ 编辑</button>
      </header>

      {/* 主体：左侧人物 + 右侧对话 */}
      <div style={{ flex: 1, display: "flex", padding: "16px 20px", gap: 16, overflow: "hidden" }}>
        {/* 左侧：人物模型 */}
        <div style={{ width: "45%", minWidth: 300, display: "flex", flexDirection: "column" }}>
          <div style={{
            flex: 1, borderRadius: 16, overflow: "hidden", position: "relative",
            background: "rgba(15,18,32,0.3)", backdropFilter: "blur(4px)",
          }}>
            <canvas ref={canvasRef} id="preview-canvas" style={{
              width: "100%", height: "100%", borderRadius: 16,
              display: usingLive2D ? "block" : "none",
            }} />
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

        {/* 右侧：对话区域 */}
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "rgba(30,30,30,0.85)", borderRadius: 16,
          border: "1px solid #333", backdropFilter: "blur(8px)", overflow: "hidden",
        }}>
          {/* 对话头部 */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 16px", background: "rgba(37,37,37,0.9)", borderBottom: "1px solid #333",
            fontSize: "0.85rem", color: "#aaa",
          }}>
            <span>💬 与 {avatar?.name || "数字人"} 的对话</span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {chatLoading && <span className="chat-typing">{chatPhase === "thinking" ? `思考中${thinkingDots}` : "输出中..."}</span>}
              {isSpeaking && (
                <button type="button" className="stop-audio-btn" onClick={() => { ttsClientRef.current?.stop(); adapterRef.current?.setSpeaking(false); setIsSpeaking(false); }} title="停止语音">⏹</button>
              )}
            </div>
          </div>

          {/* 消息列表 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.map((msg, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12,
                  fontSize: "0.88rem", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word",
                  ...(msg.role === "user"
                    ? { background: "#4059d4", color: "#fff", borderBottomRightRadius: 4 }
                    : { background: "#2a2a2a", color: "#ddd", borderBottomLeftRadius: 4 }),
                }}>
                  {msg.content}
                </div>
              </div>
            ))}
            {/* 正在输出的回复 */}
            {currentReply && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  maxWidth: "80%", padding: "10px 14px", borderRadius: 12, borderBottomLeftRadius: 4,
                  background: "#2a2a2a", color: "#ddd", fontSize: "0.88rem", lineHeight: 1.7,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {currentReply}
                </div>
              </div>
            )}
            {/* 思考中占位 */}
            {chatLoading && chatPhase === "thinking" && !currentReply && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  padding: "10px 14px", borderRadius: 12, borderBottomLeftRadius: 4,
                  background: "#2a2a2a", color: "#888", fontSize: "0.88rem",
                }}>
                  🤔 正在思考{thinkingDots}
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {error && <p style={{ color: "#e53935", fontSize: "0.8rem", margin: "0 16px 8px" }}>{error}</p>}

          {/* 输入框 */}
          <form onSubmit={onAsk} style={{
            display: "flex", gap: 8, padding: "12px 16px",
            borderTop: "1px solid #333", background: "rgba(37,37,37,0.9)",
          }}>
            <input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="输入你的问题..."
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 10,
                border: "1px solid #37457f", background: "#101632",
                color: "#f4f6ff", fontSize: "0.9rem",
              }}
            />
            <button type="submit" disabled={chatLoading} style={{
              padding: "10px 20px", borderRadius: 10, background: "#4059d4",
              color: "#fff", border: "none", cursor: "pointer", fontSize: "0.9rem",
              opacity: chatLoading ? 0.6 : 1,
            }}>
              {chatLoading ? "思考中..." : "发送"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}