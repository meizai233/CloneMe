import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAvatars, deleteAvatar, logout, getMe, type Avatar, type User } from "../services/platform-api";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [meRes, avatarRes] = await Promise.all([getMe(), listAvatars()]);
      setUser(meRes.user);
      setAvatars(avatarRes.avatars);
    } catch {
      navigate("/login");
    } finally {
      setLoading(false);
    }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`确定删除数字人「${name}」？`)) return;
    await deleteAvatar(id);
    setAvatars((prev) => prev.filter((a) => a.id !== id));
  }

  function onLogout() {
    logout();
    navigate("/login");
  }

  if (loading) return <div className="page-loading">加载中...</div>;

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>CloneMe</h1>
        <div className="dashboard-header-right">
          <span>{user?.name}</span>
          <button onClick={onLogout}>退出</button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-title-row">
          <h2>我的数字人</h2>
          <button className="btn-primary" onClick={() => navigate("/avatar/create")}>
            + 创建数字人
          </button>
        </div>

        {avatars.length === 0 ? (
          <div className="empty-state">
            <p>还没有数字人，点击上方按钮创建第一个吧</p>
          </div>
        ) : (
          <div className="avatar-grid">
            {avatars.map((avatar) => (
              <div key={avatar.id} className="avatar-card-item">
                <div className="avatar-card-thumb">
                  {avatar.model_thumbnail ? (
                    <img src={avatar.model_thumbnail} alt={avatar.name} />
                  ) : (
                    <span className="avatar-card-emoji">🤖</span>
                  )}
                </div>
                <h3>{avatar.name}</h3>
                <p className="avatar-card-desc">{avatar.description || "暂无描述"}</p>
                <div className="avatar-card-tags">
                  <span>声音: {avatar.voice_id ? "✅" : "❌"}</span>
                  <span>知识库: {avatar.docCount ?? 0}</span>
                </div>
                <div className="avatar-card-actions">
                  <button onClick={() => navigate(`/avatar/${avatar.id}/chat`)}>对话</button>
                  <button onClick={() => navigate(`/avatar/${avatar.id}`)}>编辑</button>
                  <button className="btn-danger" onClick={() => onDelete(avatar.id, avatar.name)}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
