import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  listVoices, createVoice, deleteVoice,
  uploadAudioFile, getFullUploadUrl, updateAvatar, getAvatar,
  type VoiceInfo,
} from "../services/platform-api";

const INPUT_CLS = "w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200";
const LABEL_CLS = "block text-xs text-[#b8c1ef] mb-1.5 font-medium";

// 参考朗读文本
const SAMPLE_TEXT = "各位观众朋友大家好，欢迎收看本期节目。今天我们将深入探讨人工智能技术在日常生活中的应用与发展趋势。从智能语音助手到自动驾驶，从医疗诊断到金融风控，AI 正在以前所未有的速度改变着我们的世界。";

export default function VoiceWorkshopPage() {
  const { id: avatarId } = useParams();
  const navigate = useNavigate();

  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [currentVoiceId, setCurrentVoiceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // 录音相关
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [speakerName, setSpeakerName] = useState("我的音色");
  const [consent, setConsent] = useState(false);
  const [showSampleText, setShowSampleText] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadData();
  }, [avatarId]);

  async function loadData() {
    try {
      const [voiceRes, avatarRes] = await Promise.all([
        listVoices(),
        avatarId ? getAvatar(avatarId) : Promise.resolve(null),
      ]);
      setVoices(voiceRes.voices || []);
      if (avatarRes) setCurrentVoiceId(avatarRes.avatar.voice_id || null);
    } catch { /* 忽略 */ }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            const res = await uploadAudioFile(reader.result as string, `voice_${Date.now()}.webm`);
            setUploadedUrl(getFullUploadUrl(res.audioUrl));
            setSuccess("录音上传成功");
          } catch (err) {
            setError(`上传失败: ${err instanceof Error ? err.message : String(err)}`);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (err) {
      setError(`无法访问麦克风: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  async function onCloneVoice() {
    if (!consent) { setError("请先确认已获本人授权"); return; }
    const audioUrl = uploadedUrl.trim();
    if (!audioUrl) { setError("请先录制或提供音频 URL"); return; }
    setLoading(true); setError(""); setSuccess("");
    try {
      const prefix = (speakerName.trim() || "cloneme").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "cloneme";
      const res = await createVoice(audioUrl, prefix, speakerName.trim() || "我的音色");
      setSuccess(`声音克隆成功，ID: ${res.voiceId}`);
      // 自动绑定到当前数字人
      if (avatarId) {
        await updateAvatar(avatarId, { voice_id: res.voiceId } as any);
        setCurrentVoiceId(res.voiceId);
      }
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "克隆失败");
    } finally {
      setLoading(false);
    }
  }

  async function onSelectVoice(voiceId: string) {
    if (!avatarId) return;
    try {
      await updateAvatar(avatarId, { voice_id: voiceId } as any);
      setCurrentVoiceId(voiceId);
      setSuccess("已切换声音");
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换失败");
    }
  }

  async function onDeleteVoice(voiceId: string) {
    if (!confirm("确定删除该声音？")) return;
    try {
      await deleteVoice(voiceId);
      if (currentVoiceId === voiceId) setCurrentVoiceId(null);
      setVoices(prev => prev.filter(v => v.voice_id !== voiceId));
      setSuccess("已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1220] relative">
      <div className="fixed top-[-300px] left-1/3 w-[700px] h-[500px] bg-[#4059d4]/8 rounded-full blur-[150px] pointer-events-none" />

      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0f1220]/80 border-b border-[#2c355f]">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <button onClick={() => navigate(avatarId ? `/avatar/${avatarId}` : "/dashboard")} className="text-sm text-[#b8c1ef] hover:text-white transition-colors">← 返回</button>
          <h2 className="text-sm font-medium text-[#e7ebff]">🎙️ 声音工坊</h2>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 relative z-10 space-y-8">
        {/* 提示信息 */}
        {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">{success}</p>}

        {/* 录音区域 */}
        <section className="bg-[#1a1f36] border border-[#2c355f] rounded-2xl p-6">
          <h3 className="text-sm font-medium text-[#e7ebff] mb-4">录制语音样本</h3>
          <p className="text-xs text-[#b8c1ef]/70 mb-4">录制 10~20 秒清晰语音，用于克隆你的声音。</p>

          <div className="mb-4">
            <button type="button" onClick={() => setShowSampleText(!showSampleText)} className="text-xs text-[#6b7ff5] hover:text-[#90a4ff] cursor-pointer transition-colors">
              📖 {showSampleText ? "收起" : "查看"}参考朗读文本
            </button>
            {showSampleText && (
              <div className="mt-2 p-3 bg-[#101632] border border-[#2c355f] rounded-lg text-xs text-[#b8c1ef] leading-relaxed">{SAMPLE_TEXT}</div>
            )}
          </div>

          <div className="flex items-center gap-4 mb-4">
            {!isRecording ? (
              <button onClick={startRecording} disabled={loading} className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm rounded-lg transition-all disabled:opacity-50">🎙️ 开始录音</button>
            ) : (
              <button onClick={stopRecording} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg animate-pulse transition-all">⏹ 停止 ({recordingDuration}s)</button>
            )}
            {uploadedUrl && <span className="text-xs text-emerald-400">✓ 已上传</span>}
          </div>

          <div className="mb-4">
            <label className={LABEL_CLS}>或直接输入音频 URL</label>
            <input value={uploadedUrl} onChange={e => setUploadedUrl(e.target.value)} placeholder="https://... .wav / .mp3" className={INPUT_CLS} />
          </div>

          <div className="mb-4">
            <label className={LABEL_CLS}>音色名称</label>
            <input value={speakerName} onChange={e => setSpeakerName(e.target.value)} placeholder="如：我的播客音色" className={INPUT_CLS} />
          </div>

          <label className="flex items-center gap-2 text-xs text-[#b8c1ef] cursor-pointer mb-4">
            <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="accent-[#4059d4]" />
            我确认已获得声音所有者本人授权
          </label>

          <button onClick={onCloneVoice} disabled={loading || !consent} className="px-6 py-2.5 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.25)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? "克隆中..." : "🎵 开始克隆"}
          </button>
        </section>

        {/* 声音列表 */}
        <section>
          <h3 className="text-xs font-medium text-[#8a8fb0] uppercase tracking-wider mb-4 pb-2 border-b border-[#2c355f]">已有声音</h3>
          {voices.length === 0 ? (
            <p className="text-sm text-[#5a6080] text-center py-8">暂无克隆声音</p>
          ) : (
            <div className="space-y-3">
              {voices.map(v => (
                <div key={v.voice_id} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${currentVoiceId === v.voice_id ? "border-[#4059d4] bg-[#4059d4]/5" : "border-[#2c355f] bg-[#1a1f36]"}`}>
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{currentVoiceId === v.voice_id ? "🔊" : "🔇"}</span>
                    <div>
                      <p className="text-sm text-[#e7ebff]">{v.voice_id}</p>
                      <p className="text-[10px] text-[#5a6080]">{v.gmt_create || "未知时间"}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {avatarId && currentVoiceId !== v.voice_id && (
                      <button onClick={() => onSelectVoice(v.voice_id)} className="text-xs px-3 py-1.5 rounded-lg bg-[#4059d4]/10 text-[#6b7ff5] hover:bg-[#4059d4]/20 border border-[#4059d4]/20 transition-all">使用</button>
                    )}
                    {currentVoiceId === v.voice_id && (
                      <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">当前使用</span>
                    )}
                    <button onClick={() => onDeleteVoice(v.voice_id)} className="text-xs px-3 py-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
