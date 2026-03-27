import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getAvatar, createAvatar, updateAvatar,
  listAvailableModels, type Avatar, type Live2DModel,
} from "../services/platform-api";

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
    <div className="edit-page">
      <header className="edit-header">
        <button onClick={() => navigate("/dashboard")}>← 返回</button>
        <h2>{isNew ? "创建数字人" : "编辑数字人"}</h2>
      </header>

      <form className="edit-form" onSubmit={onSubmit}>
        <section className="edit-section">
          <h3>基本信息</h3>
          <label>
            <span>名称 *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="如：小美客服" />
          </label>
          <label>
            <span>描述</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="简短描述数字人的用途" />
          </label>
          <label>
            <span>开场白</span>
            <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} placeholder="用户进入对话时的第一句话" />
          </label>
        </section>

        <section className="edit-section">
          <h3>选择形象</h3>
          <div className="model-picker">
            {models.length === 0 ? (
              <p className="empty-hint">暂无可用模型</p>
            ) : (
              models.map((m) => (
                <div
                  key={m.id}
                  className={`model-option ${modelId === m.id ? "selected" : ""}`}
                  onClick={() => setModelId(m.id)}
                >
                  {m.thumbnail_url ? (
                    <img src={m.thumbnail_url} alt={m.name} />
                  ) : (
                    <span className="model-placeholder">🤖</span>
                  )}
                  <span className="model-name">{m.name}</span>
                  <span className="model-price">{m.is_free ? "免费" : `¥${m.price}`}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="edit-section">
          <h3>人设配置</h3>
          <label>
            <span>角色设定（系统提示词）</span>
            <textarea
              value={personaPrompt}
              onChange={(e) => setPersonaPrompt(e.target.value)}
              rows={5}
              placeholder="描述数字人的性格、说话风格、专业领域..."
            />
          </label>
          <label>
            <span>LLM 模型</span>
            <select value={llmModel} onChange={(e) => setLlmModel(e.target.value)}>
              <option value="Qwen3.5-plus">Qwen3.5-plus（推荐）</option>
              <option value="Doubao-Seed-2.0-Pro-0215">豆包 Pro</option>
              <option value="DeepSeek-V3.2">DeepSeek V3.2</option>
            </select>
          </label>
          <label>
            <span>回复温度: {temperature}</span>
            <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
          </label>
        </section>

        {!isNew && (
          <section className="edit-section">
            <h3>声音 & 知识库</h3>
            <div className="edit-links">
              <button type="button" onClick={() => navigate(`/avatar/${id}/voice`)}>🎙️ 声音工坊</button>
              <button type="button" onClick={() => navigate(`/avatar/${id}/knowledge`)}>📚 知识库管理</button>
              <button type="button" onClick={() => navigate(`/avatar/${id}/chat`)}>💬 对话测试</button>
            </div>
          </section>
        )}

        {error && <p className="form-error">{error}</p>}
        <div className="edit-actions">
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? "保存中..." : "保存"}
          </button>
          <button type="button" onClick={() => navigate("/dashboard")}>取消</button>
        </div>
      </form>
    </div>
  );
}
