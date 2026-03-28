import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register } from "../services/platform-api";

export default function LoginPage() {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1220] relative overflow-hidden">
      {/* 背景光晕 */}
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[#4059d4]/12 rounded-full blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-100px] right-[-200px] w-[500px] h-[500px] bg-[#5062b8]/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-[400px] mx-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold tracking-tight bg-gradient-to-b from-white via-white/95 to-white/60 bg-clip-text text-transparent">
            CloneMe
          </h1>
          <p className="text-sm text-[#8A8F98] mt-1">AI 数字分身管理平台</p>
        </div>

        {/* 卡片 */}
        <div className="bg-[#1a1f36]/80 backdrop-blur-xl border border-[#2c355f] rounded-2xl p-8 shadow-[0_0_0_1px_rgba(44,53,95,0.4),0_8px_40px_rgba(0,0,0,0.4)]">
          <form onSubmit={onSubmit} className="space-y-4">
            {isRegister && (
              <div>
                <label className="block text-xs text-[#b8c1ef] mb-1.5 font-medium">名字</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="你的名字"
                  className="w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-[#b8c1ef] mb-1.5 font-medium">邮箱</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className="w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200"
              />
            </div>
            <div>
              <label className="block text-xs text-[#b8c1ef] mb-1.5 font-medium">密码</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="至少 6 位"
                className="w-full px-3.5 py-2.5 bg-[#101632] border border-[#2c355f] rounded-lg text-[#e7ebff] text-sm placeholder:text-[#5a6080] focus:border-[#4059d4] focus:ring-2 focus:ring-[#4059d4]/20 focus:outline-none transition-all duration-200"
              />
            </div>

            {error && (
              <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[#4059d4] hover:bg-[#4f6ae0] text-white text-sm font-medium rounded-lg shadow-[0_0_0_1px_rgba(64,89,212,0.5),0_4px_12px_rgba(64,89,212,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:shadow-[0_0_0_1px_rgba(64,89,212,0.6),0_8px_20px_rgba(64,89,212,0.4)] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "处理中..." : isRegister ? "创建账号" : "登录"}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-[#2c355f]/60 text-center">
            <span className="text-xs text-[#b8c1ef]/60">
              {isRegister ? "已有账号？" : "还没有账号？"}
            </span>
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(""); }}
              className="text-xs text-[#4059d4] hover:text-[#6b7ff5] ml-1 transition-colors"
            >
              {isRegister ? "去登录" : "注册一个"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
