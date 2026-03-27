import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAvatars, deleteAvatar, logout, getMe, type Avatar, type User } from "../services/platform-api";

export default function DashboardPage() {
  const navigate = useNavigate();
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [meRes, avatarRes] = await Promise.all([getMe(), listAvatars()]);
      setUser(meRes.user);
      setAvatars(avatarRes.avatars);
    } catch { navigate("/login"); }
    finally { setLoading(false); }
  }

  async function onDelete(id: string, name: string) {
    if (!confirm(`确定删除「${name}」？`)) return;
    await deleteAvatar(id);
    setAvatars((prev) => prev.filter((a) => a.id !== id));
  }

  if (loading) return (
    <div className="min-h-screen bg-[#050506] flex items-center justify-center text-[#8A8F98]">加载中...</div>
  );

  return (
    <div className="min-h-screen bg-[#050506] relative">
      {/* 背景光晕 */}
      <div className="fixed top-[-300px] left-1/4 w-[800px] h-[600px] bg-[#5E6AD2]/8 rounded-full blur-[150px] pointer-events-none" />

      {/* 顶栏 */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#050506]/80 border-b border-white/[0.06]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
            CloneMe
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[#8A8F98]">{user?.name}</span>
            <button
              onClick={() => { logout(); navigate("/login"); }}
              className="text-xs text-[#8A8F98] hover:text-white px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-200"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="max-w-6xl mx-auto px-6 py-10 relative z-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight bg-gradient-to-b from-white to-white/70 bg-clip-text text-transparent">
              我的数字人
            </h2>
            <p className="text-sm text-[#8A8F98] mt-1">创建和管理你的 AI 数字分身</p>
          </div>
          <button
            onClick={() => navigate("/avatar/create")}
            className="px-4 py-2 bg-[#5E6AD2] hover:bg-[#6872D9] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_12px_rgba(94,106,210,0.25)] hover:shadow-[0_0_0_1px_rgba(94,106,210,0.6),0_8px_20px_rgba(94,106,210,0.35)] active:scale-[0.98] transition-all duration-200"
          >
            + 创建数字人
          </button>
        </div>

        {avatars.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-3xl">
              🤖
            </div>
            <p className="text-[#8A8F98] text-sm">还没有数字人</p>
            <p className="text-[#8A8F98]/60 text-xs mt-1">点击上方按钮创建第一个</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {avatars.map((avatar) => (
              <div
                key={avatar.id}
                className="group relative bg-gradient-to-b from-white/[0.06] to-white/[0.02] border border-white/[0.06] rounded-2xl p-5 hover:border-white/[0.12] hover:shadow-[0_8px_40px_rgba(0,0,0,0.3),0_0_60px_rgba(94,106,210,0.08)] transition-all duration-300"
              >
                {/* 头像 */}
                <div className="w-12 h-12 rounded-xl bg-[#5E6AD2]/10 border border-[#5E6AD2]/20 flex items-center justify-center text-2xl mb-3">
                  {avatar.model_thumbnail ? (
                    <img src={avatar.model_thumbnail} alt="" className="w-8 h-8 rounded-lg object-cover" />
                  ) : "🤖"}
                </div>

                <h3 className="text-[#EDEDEF] font-medium text-sm">{avatar.name}</h3>
                <p className="text-[#8A8F98] text-xs mt-1 line-clamp-2">{avatar.description || "暂无描述"}</p>

                {/* 标签 */}
                <div className="flex gap-2 mt-3">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${avatar.voice_id ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/10" : "text-[#8A8F98] border-white/[0.06] bg-white/[0.03]"}`}>
                    声音 {avatar.voice_id ? "✓" : "×"}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/[0.06] bg-white/[0.03] text-[#8A8F98]">
                    知识库 {avatar.docCount ?? 0}
                  </span>
                </div>

                {/* 操作 */}
                <div className="flex gap-2 mt-4 pt-3 border-t border-white/[0.04]">
                  <button
                    onClick={() => navigate(`/avatar/${avatar.id}/chat`)}
                    className="flex-1 text-xs py-1.5 rounded-lg bg-[#5E6AD2]/10 text-[#5E6AD2] hover:bg-[#5E6AD2]/20 border border-[#5E6AD2]/20 transition-all duration-200"
                  >
                    💬 对话
                  </button>
                  <button
                    onClick={() => navigate(`/avatar/${avatar.id}`)}
                    className="flex-1 text-xs py-1.5 rounded-lg bg-white/[0.04] text-[#8A8F98] hover:bg-white/[0.08] hover:text-white border border-white/[0.06] transition-all duration-200"
                  >
                    编辑
                  </button>
                  <button
                    onClick={() => onDelete(avatar.id, avatar.name)}
                    className="text-xs py-1.5 px-3 rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-all duration-200"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
