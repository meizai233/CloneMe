import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listAvatars, deleteAvatar, logout, getMe, createAvatar,
  listAdminModels, listAllModels, createModel, updateModel, setModelStatus, deleteModel,
  listVoices, createVoice, deleteVoice, uploadAudioFile, getFullUploadUrl, updateAvatar, getAvatar,
  type Avatar, type User, type Live2DModel, type VoiceInfo,
} from "../services/platform-api";

const INPUT_CLS = "w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200";
const LABEL_CLS = "block text-xs text-[#b8c1ef] mb-1.5 font-medium";

type TabKey = "avatars" | "voices" | "models";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("avatars");

  useEffect(() => {
    getMe().then(res => { setUser(res.user); setLoading(false); }).catch(() => navigate("/login"));
  }, []);

  if (loading) return <div className="min-h-screen bg-[#0f1220] flex items-center justify-center text-[#b8c1ef]">加载中...</div>;

  // 模型管理仅管理员可见
  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "avatars", label: "我的数字人", icon: "🤖" },
    { key: "voices", label: "声音工坊", icon: "🎙️" },
    ...(user?.role === "admin" ? [{ key: "models" as TabKey, label: "模型管理", icon: "🎭" }] : []),
  ];

  return (
    <div className="min-h-screen bg-[#0f1220] relative">
      <div className="fixed top-[-300px] left-1/4 w-[800px] h-[600px] bg-[#4059d4]/8 rounded-full blur-[150px] pointer-events-none" />

      {/* 顶栏 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0f1220]/95 border-b border-[#2c355f]">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          {/* 左侧：Logo + 导航 */}
          <div className="flex items-center gap-10">
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-1.5">
              <span className="text-[#4059d4]">Clone</span><span className="text-white">Me</span>
              <span className="text-[10px] text-[#4059d4]/60 border border-[#4059d4]/30 rounded px-1 py-0.5 ml-1 font-normal">AI</span>
            </h1>
            <nav className="flex items-center gap-6">
              {tabs.map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`text-sm transition-colors duration-200 ${
                    tab === t.key
                      ? "text-[#4059d4] font-medium"
                      : "text-[#b8c1ef]/70 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          </div>
          {/* 右侧：用户名悬浮退出 */}
          <div className="relative group">
            <span className="text-sm text-[#b8c1ef]/70 hover:text-white cursor-pointer transition-colors">👤 {user?.name}</span>
            <div className="absolute right-0 top-full pt-1 hidden group-hover:block">
              <button
                onClick={() => { logout(); navigate("/login"); }}
                className="whitespace-nowrap text-xs text-[#b8c1ef] hover:text-white px-4 py-2 rounded-lg bg-[#1a1f36] border border-[#2c355f] hover:border-[#4052a5] shadow-lg transition-all duration-200"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 relative z-10">

        {tab === "avatars" && <AvatarsTab navigate={navigate} />}
        {tab === "voices" && <VoicesTab />}
        {tab === "models" && <ModelsTab />}
      </main>
    </div>
  );
}


// ==================== 数字人 Tab ====================
function AvatarsTab({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => { listAvatars().then(r => { setAvatars(r.avatars); setLoaded(true); }); }, []);

  async function onDelete(id: string, name: string) {
    if (!confirm(`确定删除「${name}」？`)) return;
    await deleteAvatar(id);
    setAvatars(prev => prev.filter(a => a.id !== id));
  }

  async function onCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await createAvatar({ name: newName.trim(), description: newDesc.trim() });
      setShowCreateModal(false);
      setNewName(""); setNewDesc("");
      navigate(`/avatar/${res.id}/chat`);
    } catch { /* 忽略 */ }
    finally { setCreating(false); }
  }

  if (!loaded) return <p className="text-[#5a6080] text-sm">加载中...</p>;

  return (
    <>
      {/* 创建弹窗 */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#1a1f36] border border-[#2c355f] rounded-2xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-medium text-[#e7ebff] mb-4">创建数字人</h3>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs text-[#b8c1ef] mb-1.5">名称 *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="如：小美客服" autoFocus className="w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all" />
              </div>
              <div>
                <label className="block text-xs text-[#b8c1ef] mb-1.5">描述</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="简短描述数字人的用途" className="w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-[#b8c1ef] hover:text-white rounded-lg border border-[#2c355f] hover:border-[#4052a5] transition-all">取消</button>
              <button onClick={onCreate} disabled={creating || !newName.trim()} className="px-4 py-2 text-sm text-white bg-[#4059d4] hover:bg-[#4f6ae0] rounded-lg disabled:opacity-50 transition-all">{creating ? "创建中..." : "确认"}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">我的数字人</h2>
          <p className="text-xs text-[#b8c1ef]/60 mt-1">创建和管理你的 AI 数字分身</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.25)] active:scale-[0.98] transition-all duration-200">+ 创建数字人</button>
      </div>
      {avatars.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1a1f36] border border-[#2c355f] flex items-center justify-center text-3xl">🤖</div>
          <p className="text-[#b8c1ef] text-sm">还没有数字人</p>
          <p className="text-[#5a6080] text-xs mt-1">点击上方按钮创建第一个</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {avatars.map(avatar => (
            <div key={avatar.id} className="group relative bg-[#1a1f36] border border-[#2c355f] rounded-xl overflow-hidden hover:border-[#4052a5] hover:shadow-[0_4px_24px_rgba(0,0,0,0.3)] transition-all duration-300">
              {/* 左侧装饰竖线 */}
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#4059d4] rounded-l-xl" />

              {/* 卡片内容 */}
              <div className="pl-5 pr-4 pt-4 pb-3">
                {/* 标题行：名称 + 状态标签 */}
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="text-[#e7ebff] font-semibold text-sm">{avatar.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${avatar.voice_id ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" : "text-[#6b7ff5] border-[#4059d4]/30 bg-[#4059d4]/10"}`}>
                    {avatar.voice_id ? "已配音" : "未配音"}
                  </span>
                </div>

                {/* 描述 */}
                <p className="text-[#b8c1ef]/60 text-xs leading-relaxed line-clamp-2 mb-3">{avatar.description || "暂无描述"}</p>

                {/* 信息行 */}
                <div className="text-[10px] text-[#5a6080] space-y-0.5 mb-3">
                  <p>音色：{avatar.voice_name || (avatar.voice_id ? avatar.voice_id.split("-").pop() : "-")}</p>
                  <p>知识库：{avatar.docCount ? `${avatar.docCount} 篇` : "-"}</p>
                </div>

                {/* 底部操作栏 */}
                <div className="flex gap-2 pt-2.5 border-t border-[#2c355f]/50">
                  <button onClick={() => navigate(`/avatar/${avatar.id}/preview`)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#4059d4]/20 text-[#90a4ff] hover:bg-[#4059d4]/30 border border-[#4059d4]/30 transition-all">预览</button>
                  <button onClick={() => navigate(`/avatar/${avatar.id}/chat`)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#2c355f]/50 text-[#d4dcff] hover:bg-[#2c355f]/80 hover:text-white border border-[#4052a5]/40 transition-all">编辑</button>
                  <button onClick={() => onDelete(avatar.id, avatar.name)} className="text-xs py-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">删除</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}


// ==================== 声音工坊 Tab ====================
function VoicesTab() {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [uploadedUrl, setUploadedUrl] = useState("");
  const [speakerName, setSpeakerName] = useState("我的音色");
  const [consent, setConsent] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [showSampleText, setShowSampleText] = useState(false);

  const mediaRecorderRef = { current: null as MediaRecorder | null };
  const audioChunksRef = { current: [] as Blob[] };
  const timerRef = { current: null as ReturnType<typeof setInterval> | null };

  useEffect(() => { listVoices().then(r => { setVoices(r.voices || []); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
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
          } catch (err) { setError(`上传失败: ${err instanceof Error ? err.message : String(err)}`); }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true); setRecordingDuration(0);
      timerRef.current = setInterval(() => setRecordingDuration(d => d + 1), 1000);
    } catch (err) { setError(`无法访问麦克风: ${err instanceof Error ? err.message : String(err)}`); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === "recording") { mediaRecorderRef.current.stop(); setIsRecording(false); }
  }

  async function onClone() {
    if (!consent) { setError("请先确认已获本人授权"); return; }
    if (!uploadedUrl.trim()) { setError("请先录制或提供音频 URL"); return; }
    setLoading(true); setError(""); setSuccess("");
    try {
      const prefix = (speakerName.trim() || "cloneme").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "cloneme";
      const res = await createVoice(uploadedUrl.trim(), prefix, speakerName.trim() || "我的音色");
      setSuccess(`声音克隆成功，ID: ${res.voiceId}`);
      const r = await listVoices(); setVoices(r.voices || []);
    } catch (err) { setError(err instanceof Error ? err.message : "克隆失败"); }
    finally { setLoading(false); }
  }

  async function onDeleteVoice(voiceId: string) {
    if (!confirm("确定删除该声音？")) return;
    try { await deleteVoice(voiceId); setVoices(prev => prev.filter(v => v.voice_id !== voiceId)); } catch (err) { setError(err instanceof Error ? err.message : "删除失败"); }
  }

  if (!loaded) return <p className="text-[#5a6080] text-sm">加载中...</p>;

  return (
    <>
      <h2 className="text-xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent mb-1">声音工坊</h2>
      <p className="text-xs text-[#b8c1ef]/60 mb-6">录制语音样本，克隆你的声音用于数字人播报</p>

      {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
      {success && <p className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 mb-4">{success}</p>}

      {/* 克隆区域 */}
      <div className="bg-[#1a1f36] border border-[#2c355f] rounded-2xl p-6 mb-8">
        <h3 className="text-sm font-medium text-[#e7ebff] mb-3">录制语音样本</h3>
        <p className="text-xs text-[#b8c1ef]/60 mb-4">录制 10~20 秒清晰语音，用于克隆你的声音。</p>
        <button type="button" onClick={() => setShowSampleText(!showSampleText)} className="text-xs text-[#6b7ff5] hover:text-[#90a4ff] mb-3 transition-colors">📖 {showSampleText ? "收起" : "查看"}参考朗读文本</button>
        {showSampleText && <div className="mb-4 p-3 bg-[#101632] border border-[#2c355f] rounded-lg text-xs text-[#b8c1ef] leading-relaxed">各位观众朋友大家好，欢迎收看本期节目。今天我们将深入探讨人工智能技术在日常生活中的应用与发展趋势。从智能语音助手到自动驾驶，AI 正在以前所未有的速度改变着我们的世界。</div>}

        <div className="flex items-center gap-4 mb-4">
          {!isRecording
            ? <button onClick={startRecording} disabled={loading} className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm rounded-lg transition-all disabled:opacity-50">🎙️ 开始录音</button>
            : <button onClick={stopRecording} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg animate-pulse transition-all">⏹ 停止 ({recordingDuration}s)</button>
          }
          {uploadedUrl && <span className="text-xs text-emerald-400">✓ 已上传</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div><label className={LABEL_CLS}>或直接输入音频 URL</label><input value={uploadedUrl} onChange={e => setUploadedUrl(e.target.value)} placeholder="https://... .wav / .mp3" className={INPUT_CLS} /></div>
          <div><label className={LABEL_CLS}>音色名称</label><input value={speakerName} onChange={e => setSpeakerName(e.target.value)} placeholder="如：我的播客音色" className={INPUT_CLS} /></div>
        </div>

        <label className="flex items-center gap-2 text-xs text-[#b8c1ef] cursor-pointer mb-4"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} className="accent-[#4059d4]" />我确认已获得声音所有者本人授权</label>
        <button onClick={onClone} disabled={loading || !consent} className="px-6 py-2.5 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.25)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed">{loading ? "克隆中..." : "🎵 开始克隆"}</button>
      </div>

      {/* 声音列表 */}
      <h3 className="text-xs font-medium text-[#8a8fb0] uppercase tracking-wider mb-4 pb-2 border-b border-[#2c355f]">已有声音</h3>
      {voices.length === 0 ? <p className="text-sm text-[#5a6080] text-center py-8">暂无克隆声音</p> : (
        <div className="space-y-3">
          {voices.map(v => (
            <div key={v.voice_id} className="flex items-center justify-between p-4 rounded-xl border border-[#2c355f] bg-[#1a1f36] hover:border-[#4052a5] transition-all">
              <div className="flex items-center gap-3">
                <span className="text-lg">🔊</span>
                <div>
                  <p className="text-sm text-[#e7ebff] font-medium">{v.speaker_name || v.voice_id}</p>
                  <p className="text-[10px] text-[#5a6080]">ID: {v.voice_id}</p>
                  <p className="text-[10px] text-[#5a6080]">{v.created_at || ""}</p>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {v.audio_url && (
                  <button onClick={() => { const a = new Audio(v.audio_url); a.play(); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#4059d4]/10 text-[#6b7ff5] hover:bg-[#4059d4]/20 border border-[#4059d4]/20 transition-all">▶ 试听</button>
                )}
                <button onClick={() => onDeleteVoice(v.voice_id)} className="text-xs px-3 py-1.5 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}


// ==================== 模型管理 Tab ====================
function ModelsTab() {
  const [models, setModels] = useState<Live2DModel[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelUrl, setModelUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [category, setCategory] = useState("casual");
  const [price, setPrice] = useState(0);
  const [isFree, setIsFree] = useState(true);

  useEffect(() => { listAdminModels().then(r => { setModels(r.models); setLoaded(true); }).catch(() => setLoaded(true)); }, []);

  function resetForm() {
    setName(""); setDescription(""); setModelUrl(""); setThumbnailUrl("");
    setCategory("casual"); setPrice(0); setIsFree(true);
    setEditId(null); setShowForm(false); setError("");
  }

  function openEdit(m: Live2DModel) {
    setName(m.name); setDescription(m.description); setModelUrl(m.model_url);
    setThumbnailUrl(m.thumbnail_url); setCategory(m.category);
    setPrice(m.price); setIsFree(!!m.is_free);
    setEditId(m.id); setShowForm(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      const data = { name, description, model_url: modelUrl, thumbnail_url: thumbnailUrl, category, price, is_free: isFree };
      if (editId) { await updateModel(editId, data); } else { await createModel(data); }
      resetForm();
      const r = await listAdminModels(); setModels(r.models);
    } catch (err) { setError(err instanceof Error ? err.message : "操作失败"); }
  }

  async function onToggleStatus(m: Live2DModel) {
    const next = m.status === "active" ? "disabled" : "active";
    await setModelStatus(m.id, next as "active" | "disabled");
    setModels(prev => prev.map(x => x.id === m.id ? { ...x, status: next } : x));
  }

  async function onDelete(m: Live2DModel) {
    if (!confirm(`确定删除模型「${m.name}」？`)) return;
    await deleteModel(m.id);
    setModels(prev => prev.filter(x => x.id !== m.id));
  }

  if (!loaded) return <p className="text-[#5a6080] text-sm">加载中...</p>;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">模型管理</h2>
          <p className="text-xs text-[#b8c1ef]/60 mt-1">上传和管理 Live2D 模型资源</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.25)] active:scale-[0.98] transition-all duration-200">+ 上传模型</button>
      </div>

      {/* 新建/编辑表单 */}
      {showForm && (
        <div className="mb-8 bg-[#1a1f36] border border-[#2c355f] rounded-2xl p-6">
          <h3 className="text-sm font-medium text-[#e7ebff] mb-4">{editId ? "编辑模型" : "上传新模型"}</h3>
          <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className={LABEL_CLS}>模型名称 *</label><input value={name} onChange={e => setName(e.target.value)} required placeholder="如：Haru 接待员" className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>模型文件 URL *</label><input value={modelUrl} onChange={e => setModelUrl(e.target.value)} required placeholder="model3.json 的 URL" className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>缩略图 URL</label><input value={thumbnailUrl} onChange={e => setThumbnailUrl(e.target.value)} placeholder="预览图片 URL" className={INPUT_CLS} /></div>
            <div><label className={LABEL_CLS}>分类</label>
              <select value={category} onChange={e => setCategory(e.target.value)} className={INPUT_CLS}>
                <option value="casual">休闲</option><option value="business">商务</option><option value="cute">可爱</option><option value="custom">自定义</option>
              </select>
            </div>
            <div className="md:col-span-2"><label className={LABEL_CLS}>描述</label><input value={description} onChange={e => setDescription(e.target.value)} placeholder="模型简介" className={INPUT_CLS} /></div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-[#b8c1ef] cursor-pointer"><input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} className="accent-[#4059d4]" />免费模型</label>
              {!isFree && <div className="flex items-center gap-2"><label className="text-xs text-[#b8c1ef]">价格 ¥</label><input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} min={0} className="w-24 px-2 py-1.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm" /></div>}
            </div>
            <div className="md:col-span-2 flex gap-3">
              {error && <p className="text-red-400 text-xs self-center">{error}</p>}
              <div className="ml-auto flex gap-3">
                <button type="button" onClick={resetForm} className="px-4 py-2 text-sm text-[#b8c1ef] border border-[#2c355f] rounded-lg hover:bg-[#1a1f36] transition-all">取消</button>
                <button type="submit" className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm rounded-lg transition-all">保存</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* 模型列表 */}
      {models.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[#1a1f36] border border-[#2c355f] flex items-center justify-center text-3xl">🎭</div>
          <p className="text-[#b8c1ef] text-sm">暂无模型</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {models.map(m => (
            <div key={m.id} className="bg-gradient-to-b from-[#1a1f36] to-[#131a3f] border border-[#2c355f] rounded-2xl p-5 hover:border-[#4052a5] transition-all duration-300">
              <div className="flex items-start justify-between mb-3">
                <div className="w-12 h-12 rounded-xl bg-[#4059d4]/10 border border-[#4059d4]/20 flex items-center justify-center overflow-hidden">
                  {m.thumbnail_url ? <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover rounded-xl" /> : <span className="text-2xl">🎭</span>}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full border ${m.status === "active" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : "text-red-400 border-red-500/20 bg-red-500/10"}`}>{m.status === "active" ? "已上架" : "已下架"}</span>
              </div>
              <h3 className="text-[#e7ebff] font-medium text-sm">{m.name}</h3>
              <p className="text-[#b8c1ef]/70 text-xs mt-1 line-clamp-1">{m.description || "暂无描述"}</p>
              <div className="flex gap-2 mt-2">
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#2c355f] bg-[#131a3f] text-[#b8c1ef]/50">{m.category}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#2c355f] bg-[#131a3f] text-[#6b7ff5]">{m.is_free ? "免费" : `¥${m.price}`}</span>
              </div>
              <div className="flex gap-2 mt-4 pt-3 border-t border-[#2c355f]/40">
                <button onClick={() => openEdit(m)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all">编辑</button>
                <button onClick={() => onToggleStatus(m)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all">{m.status === "active" ? "下架" : "上架"}</button>
                <button onClick={() => onDelete(m)} className="text-xs py-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
