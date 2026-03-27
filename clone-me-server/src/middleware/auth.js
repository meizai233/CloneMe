/**
 * JWT 认证中间件
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'cloneme-secret-key-change-in-production';

/**
 * 验证 JWT Token，注入 req.user
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { userId, tenantId, role, email }
    req.tenantId = decoded.tenantId;
    next();
  } catch {
    return res.status(401).json({ message: 'Token 无效或已过期' });
  }
}

/**
 * 管理员权限校验
 */
export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '需要管理员权限' });
  }
  next();
}

/**
 * 生成 JWT Token
 */
export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}
