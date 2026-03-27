/**
 * 认证路由
 * POST /api/auth/register - 注册（自动创建租户）
 * POST /api/auth/login    - 登录
 * GET  /api/auth/me       - 获取当前用户
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { signToken, authMiddleware } from '../middleware/auth.js';

const router = Router();

// 注册
router.post('/register', (req, res) => {
  try {
    const { email, password, name, tenantName } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ message: 'email、password、name 不能为空' });
    }

    // 检查邮箱是否已注册
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      return res.status(409).json({ message: '该邮箱已注册' });
    }

    // 创建租户
    const tenantId = uuid();
    db.prepare('INSERT INTO tenants (id, name) VALUES (?, ?)').run(tenantId, tenantName || `${name}的团队`);

    // 创建用户
    const userId = uuid();
    const passwordHash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, email, password_hash, name, tenant_id, role) VALUES (?, ?, ?, ?, ?, ?)').run(
      userId, email, passwordHash, name, tenantId, 'user'
    );

    const token = signToken({ userId, tenantId, role: 'user', email });
    res.json({ token, user: { id: userId, email, name, role: 'user', tenantId } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 登录
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'email 和 password 不能为空' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const token = signToken({ userId: user.id, tenantId: user.tenant_id, role: user.role, email: user.email });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenant_id } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 获取当前用户
router.get('/me', authMiddleware, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, tenant_id FROM users WHERE id = ?').get(req.user.userId);
  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(user.tenant_id);
  res.json({ user: { ...user, tenantId: user.tenant_id }, tenant });
});

export default router;
