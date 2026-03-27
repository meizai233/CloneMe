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
    <div className="login-page">
      <div className="login-card">
        <h1>CloneMe</h1>
        <p className="login-subtitle">AI 数字分身管理平台</p>

        <form onSubmit={onSubmit}>
          {isRegister && (
            <input
              type="text"
              placeholder="你的名字"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? "处理中..." : isRegister ? "注册" : "登录"}
          </button>
        </form>

        <p className="login-switch">
          {isRegister ? "已有账号？" : "没有账号？"}
          <button type="button" onClick={() => { setIsRegister(!isRegister); setError(""); }}>
            {isRegister ? "去登录" : "去注册"}
          </button>
        </p>
      </div>
    </div>
  );
}
