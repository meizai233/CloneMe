/**
 * 数字人预览页面
 * 左侧人物模型 + 右侧多轮对话记录，背景图铺满整个页面
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createLive2DAdapter,
  type AvatarEmotion,
  type AvatarRuntime,
  type Live2DDriver,
} from "../avatar/live2dAdapter";
import { SentenceBuffer, TTSClient } from "../services/ttsClient";
import { VoiceSessionClient } from "../services/voiceSessionClient";
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
  const voiceSessionRef = useRef<VoiceSessionClient | null>(null);
  const realtimeSentenceBufferRef = useRef<SentenceBuffer | null>(null);
  const lastAsrFinalRef = useRef("");
  const lastDoneReplyRef = useRef("");
  const replyBufferRef = useRef("");
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentReply, setCurrentReply] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatPhase, setChatPhase] = useState<"idle" | "thinking" | "typing">("idle");
  const [thinkingDots, setThinkingDots] = useState("");
  const [realtimeActive, setRealtimeActive] = useState(false);
  const [realtimeLoading, setRealtimeLoading] = useState(false);
  const [realtimePartialText, setRealtimePartialText] = useState("");
  const [realtimeFinalText, setRealtimeFinalText] = useState("");
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

  // 初始化实时语音会话
  useEffect(() => {
    const voiceSession = new VoiceSessionClient({
      voiceId: avatar?.voice_id || undefined,
      playbackEnabled: false,
      onSpeakingChange: (s) => {
        adapterRef.current?.setSpeaking(s);
        setIsSpeaking(s);
      },
      onMouthOpen: (v) => {
        setMouthOpen(v);
        adapterRef.current?.setMouthOpen(v);
      },
      onAsrPartial: (text) => {
        setRealtimePartialText(text);
      },
      onAsrFinal: (text) => {
        const finalText = text.trim();
        const prevFinal = lastAsrFinalRef.current;
        const isIncremental = prevFinal && finalText.startsWith(prevFinal);
        const turnUserText = isIncremental ? finalText.slice(prevFinal.length).trim() : finalText;
        lastAsrFinalRef.current = finalText;
        setRealtimePartialText("");
        setRealtimeFinalText(finalText);
        if (turnUserText) {
          setMessages((prev) => [...prev, { role: "user", content: turnUserText }]);
        }
        replyBufferRef.current = "";
        setCurrentReply("");
        setChatLoading(true);
        setChatPhase("thinking");
        ttsClientRef.current?.stop();
        const sentenceBuffer = new SentenceBuffer((sentence) => {
          ttsClientRef.current?.sendText(sentence);
        });
        realtimeSentenceBufferRef.current = sentenceBuffer;
      },
      onLlmDelta: (text) => {
        setChatPhase("typing");
        replyBufferRef.current += text;
        setCurrentReply(replyBufferRef.current);
        realtimeSentenceBufferRef.current?.push(text);
      },
      onLlmDone: (event) => {
        const rawReply = event.reply.trim();
        const bufferedReply = replyBufferRef.current.trim();
        const prevDone = lastDoneReplyRef.current;
        const isIncrementalDone = !bufferedReply && prevDone && rawReply.startsWith(prevDone);
        const reply = isIncrementalDone ? rawReply.slice(prevDone.length).trim() : (bufferedReply || rawReply);
        lastDoneReplyRef.current = rawReply;
        if (reply) {
          setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        }
        replyBufferRef.current = "";
        realtimeSentenceBufferRef.current?.flush();
        realtimeSentenceBufferRef.current = null;
        ttsClientRef.current?.finishCurrentTask();
        setCurrentReply("");
        setChatLoading(false);
        setChatPhase("idle");
      },
    });
    voiceSessionRef.current = voiceSession;
    void voiceSession.connect().catch(() => {
      // 启动实时模式时会重试连接
    });

    return () => {
      voiceSession.disconnect();
      voiceSessionRef.current = null;
    };
  }, [avatar?.voice_id]);

  // 思考动画
  useEffect(() => {
    if (!(chatLoading && chatPhase === "thinking")) { setThinkingDots(""); return; }
    const t = setInterval(() => setThinkingDots(p => p.length >= 3 ? "" : p + "."), 380);
    return () => clearInterval(t);
  }, [chatLoading, chatPhase]);

  const stopRealtimeSession = useCallback(() => {
    voiceSessionRef.current?.interrupt();
    voiceSessionRef.current?.stopRecording();
    realtimeSentenceBufferRef.current?.reset();
    realtimeSentenceBufferRef.current = null;
    replyBufferRef.current = "";
    ttsClientRef.current?.stop();
    setRealtimeActive(false);
    setRealtimeLoading(false);
    setRealtimePartialText("");
  }, []);

  const startRealtimeSession = useCallback(async () => {
    ttsClientRef.current?.stop();
    setCurrentReply("");
    setError("");
    setRealtimeLoading(true);
    setRealtimePartialText("");
    setRealtimeFinalText("");
    lastAsrFinalRef.current = "";
    lastDoneReplyRef.current = "";
    replyBufferRef.current = "";

    try {
      try {
        await ttsClientRef.current?.connect();
      } catch {
        // TTS 连接失败不阻塞实时会话
      }
      const client = voiceSessionRef.current;
      if (!client) {
        throw new Error("实时语音客户端未初始化");
      }
      await client.connect();
      client.startSession({
        sessionId,
        userId,
        persona: "general",
        voiceId: avatar?.voice_id || undefined,
        avatarModel: resolveAvatarModelCapability(HARU_MODEL_URL),
      });
      await client.startRecording();
      setRealtimeActive(true);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "实时语音启动失败";
      setError(errMsg);
      setRealtimeActive(false);
    } finally {
      setRealtimeLoading(false);
    }
  }, [avatar?.voice_id, sessionId, userId]);

  const usingLive2D = runtime === "live2d";

  return (
    <div style={{
      minHeight: "100vh",
      backgroundImage: "linear-gradient(180deg, rgba(8,14,36,0.3), rgba(8,14,36,0.6)), url('/images/live2d/unified-avatar-bg.jpg')",
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
                <button
                  type="button"
                  className="stop-audio-btn"
                  onClick={() => {
                    ttsClientRef.current?.stop();
                    voiceSessionRef.current?.interrupt();
                    adapterRef.current?.setSpeaking(false);
                    setIsSpeaking(false);
                  }}
                  title="停止语音"
                >
                  ⏹
                </button>
              )}
            </div>
          </div>

          {/* 消息列表 */}
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
            {realtimeFinalText && (
              <div style={{ fontSize: "0.78rem", color: "#9fa8da" }}>
                最近识别：{realtimeFinalText}
              </div>
            )}
            {realtimePartialText && (
              <div style={{ fontSize: "0.78rem", color: "#7b89b8" }}>
                正在识别：{realtimePartialText}
              </div>
            )}
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

          {/* 实时对话控制 */}
          <div style={{
            display: "flex", gap: 8, padding: "12px 16px", alignItems: "center",
            borderTop: "1px solid #333", background: "rgba(37,37,37,0.9)",
          }}>
            <span style={{ color: "#9ea7d8", fontSize: "0.82rem", flex: 1 }}>
              当前模式：{realtimeActive ? "通话中（可插话）" : "待机"}
            </span>
            {!realtimeActive ? (
              <button
                type="button"
                onClick={() => void startRealtimeSession()}
                disabled={chatLoading || realtimeLoading}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  background: "#4059d4",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  opacity: chatLoading || realtimeLoading ? 0.6 : 1,
                }}
              >
                {realtimeLoading ? "启动中..." : "开始实时对话"}
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRealtimeSession}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  background: "#8c2f2f",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                }}
              >
                停止实时对话
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}