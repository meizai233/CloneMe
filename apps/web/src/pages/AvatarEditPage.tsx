import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getAvatar, createAvatar, updateAvatar,
  listAvailableModels, type Avatar, type Live2DModel,
} from "../services/platform-api";

// 统一冷色调色值常量
const INPUT_CLS = "w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200";
const LABEL_CLS = "block text-xs text-[#b8c1ef] mb-1.5 font-medium";
const SECTION_TITLE_CLS = "text-xs font-medium text-[#8a8fb0] uppercase tracking-wider mb-4 pb-2 border-b border-[#2c355f]";

export default function AvatarEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "create";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [greeting, setGreeting] = useState("");
  const [personaPrompt, setPersonaPrompt] = useState("");
  const [llmModel, setLlmModel] = useState("Qwen3.5-plus");
  const [temperature, setTemperature] = useState(0.7);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState<Live2DModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadModels();
    if (!isNew) loadAvatar();
  }, [id]);

  async function loadModels() {
    try {
      const res = await listAvailableModels();
      setModels(res.models);
    } catch { /* 忽略 */ }
  }

  async function loadAvatar() {
    try {
      const res = await getAvatar(id!);
      const a = res.avatar;
      setName(a.name);
      setDescription(a.description);
      setGreeting(a.greeting);
      setPersonaPrompt(a.persona_prompt);
      setLlmModel(a.llm_model);
      setTemperature(a.temperature);
      setModelId(a.live2d_model_id || "");
    } catch {
      navigate("/dashboard");
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = {
        name, description, greeting,
        persona_prompt: personaPrompt,
        llm_model: llmModel,
        temperature,
        live2d_model_id: modelId || undefined,
      };
      if (isNew) {
        await createAvatar(data);
      } else {
        await updateAvatar(id!, data);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0f1220] relative">
      {/* 背景光晕 */}
      <div className="fixed top-[-300px] right-1/4 w-[700px] h-[500px] bg-[#4059d4]/8 rounded-full blur-[150px] pointer-events-none" />

      {/* 顶栏 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0f1220]/80 border-b border-[#2c355f]">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="text-sm text-[#b8c1ef] hover:text-white flex items-center gap-1 transition-colors"
          >
            ← 返回
          </button>
          <h2 className="text-sm font-medium text-[#e7ebff]">
            {isNew ? "创建数字人" : "编辑数字人"}
          </h2>
        </div>
      </header>

      {/* 表单 */}
      <main className="max-w-3xl mx-auto px-6 py-8 relative z-10">
        <form onSubmit={onSubmit} className="space-y-8">

          {/* 基本信息 */}
          <section>
            <h3 className={SECTION_TITLE_CLS}>基本信息</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>名称 *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="如：小美客服" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>描述</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简短描述数字人的用途" className={INPUT_CLS} />
              </div>
              <div>
                <label className={LABEL_CLS}>开场白</label>
                <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} placeholder="用户进入对话时的第一句话" className={`${INPUT_CLS} resize-y`} />
              </div>
            </div>
          </section>

          {/* 选择形象 */}
          <section>
            <h3 className={SECTION_TITLE_CLS}>选择形象</h3>
            <div className="flex gap-3 flex-wrap">
              {models.length === 0 ? (
                <p className="text-sm text-[#5a6080]">暂无可用模型</p>
              ) : (
                models.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => setModelId(m.id)}
                    className={`w-[100px] p-3 rounded-xl border-2 text-center cursor-pointer transition-all duration-200 ${
                      modelId === m.id
                        ? "border-[#4059d4] bg-[#4059d4]/10 shadow-[0_0_20px_rgba(64,89,212,0.2)]"
                        : "border-[#2c355f] bg-[#131a3f] hover:border-[#4052a5]"
                    }`}
                  >
                    {m.thumbnail_url ? (
                      <img src={m.thumbnail_url} alt={m.name} className="w-14 h-14 mx-auto rounded-lg object-cover" />
                    ) : (
                      <span className="text-3xl block mb-1">🤖</span>
                    )}
                    <span className="block text-xs text-[#e7ebff] mt-1 truncate">{m.name}</span>
                    <span className="block text-[10px] text-[#6b7ff5] mt-0.5">
                      {m.is_free ? "免费" : `¥${m.price}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* 人设配置 */}
          <section>
            <h3 className={SECTION_TITLE_CLS}>人设配置</h3>
            <div className="space-y-4">
              <div>
                <label className={LABEL_CLS}>角色设定（系统提示词）</label>
                <textarea value={personaPrompt} onChange={(e) => setPersonaPrompt(e.target.value)} rows={5} placeholder="描述数字人的性格、说话风格、专业领域..." className={`${INPUT_CLS} resize-y`} />
              </div>
              <div>
                <label className={LABEL_CLS}>LLM 模型</label>
                <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)} className={INPUT_CLS}>
                  <option value="Qwen3.5-plus">Qwen3.5-plus（推荐）</option>
                  <option value="Doubao-Seed-2.0-Pro-0215">豆包 Pro</option>
                  <option value="DeepSeek-V3.2">DeepSeek V3.2</option>
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>
                  回复温度: <span className="text-[#6b7ff5]">{temperature}</span>
                </label>
                <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} className="w-full h-1.5 bg-[#2c355f] rounded-full appearance-none cursor-pointer accent-[#4059d4]" />
                <div className="flex justify-between text-[10px] text-[#5a6080] mt-1">
                  <span>精确</span>
                  <span>创意</span>
                </div>
              </div>
            </div>
          </section>

          {/* 声音 & 知识库（仅编辑模式） */}
          {!isNew && (
            <section>
              <h3 className={SECTION_TITLE_CLS}>声音 & 知识库</h3>
              <div className="flex gap-3">
                <button type="button" onClick={() => navigate(`/avatar/${id}/voice`)} className="flex-1 py-2.5 text-sm rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all duration-200">
                  🎙️ 声音工坊
                </button>
                <button type="button" onClick={() => navigate(`/avatar/${id}/knowledge`)} className="flex-1 py-2.5 text-sm rounded-lg bg-[#1a1f36] text-[#b8c1ef] hover:bg-[#2c355f]/60 hover:text-white border border-[#2c355f] transition-all duration-200">
                  📚 知识库管理
                </button>
                <button type="button" onClick={() => navigate(`/avatar/${id}/chat`)} className="flex-1 py-2.5 text-sm rounded-lg bg-[#4059d4]/10 text-[#6b7ff5] hover:bg-[#4059d4]/20 border border-[#4059d4]/20 transition-all duration-200">
                  💬 对话测试
                </button>
              </div>
            </section>
          )}

          {/* 错误提示 */}
          {error && (
            <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="px-6 py-2.5 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_0_1px_rgba(64,89,212,0.6),0_8px_20px_rgba(64,89,212,0.4)] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? "保存中..." : "保存"}
            </button>
            <button type="button" onClick={() => navigate("/dashboard")} className="px-6 py-2.5 text-sm text-[#b8c1ef] hover:text-white rounded-lg border border-[#2c355f] hover:border-[#4052a5] hover:bg-[#1a1f36] transition-all duration-200">
              取消
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
