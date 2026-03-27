import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listAdminModels, createModel, updateModel, setModelStatus, deleteModel,
  getMe, type Live2DModel, type User,
} from "../services/platform-api";

const INPUT_CLS = "w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200";
const LABEL_CLS = "block text-xs text-[#b8c1ef] mb-1.5 font-medium";

export default function ModelsPage() {
  const navigate = useNavigate();
  const [models, setModels] = useState<Live2DModel[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");

  // 表单字段
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [modelUrl, setModelUrl] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [category, setCategory] = useState("casual");
  const [price, setPrice] = useState(0);
  const [isFree, setIsFree] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [meRes, modelsRes] = await Promise.all([getMe(), listAdminModels()]);
      setUser(meRes.user);
      if (meRes.user.role !== "admin") { navigate("/dashboard"); return; }
      setModels(modelsRes.models);
    } catch { navigate("/login"); }
    finally { setLoading(false); }
  }

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = { name, description, model_url: modelUrl, thumbnail_url: thumbnailUrl, category, price, is_free: isFree };
      if (editId) {
        await updateModel(editId, data);
      } else {
        await createModel(data);
      }
      resetForm();
      const res = await listAdminModels();
      setModels(res.models);
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  async function onToggleStatus(m: Live2DModel) {
    const next = m.status === "active" ? "disabled" : "active";
    await setModelStatus(m.id, next);
    setModels(prev => prev.map(x => x.id === m.id ? { ...x, status: next } : x));
  }

  async function onDelete(m: Live2DModel) {
    if (!confirm(`确定删除模型「${m.name}」？`)) return;
    await deleteModel(m.id);
    setModels(prev => prev.filter(x => x.id !== m.id));
  }

  if (loading) return <div className="min-h-screen bg-[#0f1220] flex items-center justify-center text-[#b8c1ef]">加载中...</div>;

  return (
    <div className="min-h-screen bg-[#0f1220] relative">
      <div className="fixed top-[-300px] right-1/3 w-[700px] h-[500px] bg-[#4059d4]/8 rounded-full blur-[150px] pointer-events-none" />

      {/* 顶栏 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0f1220]/80 border-b border-[#2c355f]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/dashboard")} className="text-sm text-[#b8c1ef] hover:text-white transition-colors">← 返回</button>
            <h1 className="text-sm font-medium text-[#e7ebff]">模型管理</h1>
          </div>
          <button onClick={() => { resetForm(); setShowForm(true); }} className="px-4 py-2 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.25)] active:scale-[0.98] transition-all duration-200">
            + 上传模型
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 relative z-10">
        {/* 新建/编辑表单 */}
        {showForm && (
          <div className="mb-8 bg-[#1a1f36] border border-[#2c355f] rounded-2xl p-6">
            <h3 className="text-sm font-medium text-[#e7ebff] mb-4">{editId ? "编辑模型" : "上传新模型"}</h3>
            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>模型名称 *</label>
                <input value={name} onChange={e => setName(e.target.value)} required placeholder="如：Haru 接待员" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>模型文件 URL *</label>
                <input value={modelUrl} onChange={e => setModelUrl(e.target.value)} required placeholder="model3.json 的 URL" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>缩略图 URL</label>
                <input value={thumbnailUrl} onChange={e => setThumbnailUrl(e.target.value)} placeholder="预览图片 URL" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>分类</label>
                <select value={category} onChange={e => setCategory(e.target.value)} className={INPUT_CLS}>
                  <option value="casual">休闲</option>
                  <option value="business">商务</option>
                  <option value="cute">可爱</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className={LABEL_CLS}>描述</label>
                <input value={description} onChange={e => setDescription(e.target.value)} placeholder="模型简介" className={INPUT_CLS} />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-[#b8c1ef] cursor-pointer">
                  <input type="checkbox" checked={isFree} onChange={e => setIsFree(e.target.checked)} className="accent-[#4059d4]" />
                  免费模型
                </label>
                {!isFree && (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#b8c1ef]">价格 ¥</label>
                    <input type="number" value={price} onChange={e => setPrice(Number(e.target.value))} min={0} className="w-24 px-2 py-1.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm" />
                  </div>
                )}
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
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${m.status === "active" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : "text-red-400 border-red-500/20 bg-red-500/10"}`}>
                    {m.status === "active" ? "已上架" : "已下架"}
                  </span>
                </div>
                <h3 className="text-[#e7ebff] font-medium text-sm">{m.name}</h3>
                <p className="text-[#b8c1ef]/70 text-xs mt-1 line-clamp-1">{m.description || "暂无描述"}</p>
                <div className="flex gap-2 mt-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#2c355f] bg-[#131a3f] text-[#b8c1ef]/50">{m.category}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-[#2c355f] bg-[#131a3f] text-[#6b7ff5]">{m.is_free ? "免费" : `¥${m.price}`}</span>
                </div>
                <div className="flex gap-2 mt-4 pt-3 border-t border-[#2c355f]/40">
                  <button onClick={() => openEdit(m)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all">编辑</button>
                  <button onClick={() => onToggleStatus(m)} className="flex-1 text-xs py-1.5 rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all">
                    {m.status === "active" ? "下架" : "上架"}
                  </button>
                  <button onClick={() => onDelete(m)} className="text-xs py-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all">删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
