/**
 * 模型管理路由
 * 管理员：上传/编辑/上下架/授权
 * 普通用户：浏览/查看可用模型
 */
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ========== 普通用户接口 ==========

// 浏览模型商店（所有上架模型）
router.get('/', (req, res) => {
  const models = db.prepare('SELECT * FROM live2d_models WHERE status = ? ORDER BY created_at DESC').all('active');
  res.json({ models });
});

// 我可用的模型（免费 + 已授权）
router.get('/available', (req, res) => {
  const models = db.prepare(`
    SELECT m.* FROM live2d_models m
    WHERE m.status = 'active' AND (
      m.is_free = 1
      OR m.id IN (
        SELECT model_id FROM model_grants
        WHERE tenant_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
      )
    )
    ORDER BY m.created_at DESC
  `).all(req.tenantId);
  res.json({ models });
});

// ========== 管理员接口 ==========

// 模型列表（全部，含下架的）
router.get('/admin/all', adminOnly, (req, res) => {
  const models = db.prepare('SELECT * FROM live2d_models ORDER BY created_at DESC').all();
  res.json({ models });
});

// 上传新模型
router.post('/admin', adminOnly, (req, res) => {
  try {
    const { name, description, model_url, thumbnail_url, category, price, is_free } = req.body;
    if (!name || !model_url) {
      return res.status(400).json({ message: 'name 和 model_url 不能为空' });
    }

    const id = uuid();
    db.prepare(
      'INSERT INTO live2d_models (id, name, description, thumbnail_url, model_url, category, price, is_free) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, description || '', thumbnail_url || '', model_url, category || 'casual', price || 0, is_free ? 1 : 0);

    res.json({ id, message: '模型创建成功' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 编辑模型
router.put('/admin/:id', adminOnly, (req, res) => {
  const { name, description, thumbnail_url, model_url, category, price, is_free } = req.body;
  db.prepare(
    `UPDATE live2d_models SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      thumbnail_url = COALESCE(?, thumbnail_url),
      model_url = COALESCE(?, model_url),
      category = COALESCE(?, category),
      price = COALESCE(?, price),
      is_free = COALESCE(?, is_free)
    WHERE id = ?`
  ).run(name, description, thumbnail_url, model_url, category, price, is_free !== undefined ? (is_free ? 1 : 0) : null, req.params.id);
  res.json({ message: '更新成功' });
});

// 上架/下架
router.put('/admin/:id/status', adminOnly, (req, res) => {
  const { status } = req.body; // 'active' | 'disabled'
  db.prepare('UPDATE live2d_models SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ message: `模型已${status === 'active' ? '上架' : '下架'}` });
});

// 删除模型
router.delete('/admin/:id', adminOnly, (req, res) => {
  db.prepare('DELETE FROM live2d_models WHERE id = ?').run(req.params.id);
  db.prepare('DELETE FROM model_grants WHERE model_id = ?').run(req.params.id);
  res.json({ message: '删除成功' });
});

// ========== 授权管理 ==========

// 查看模型的授权列表
router.get('/admin/:id/grants', adminOnly, (req, res) => {
  const grants = db.prepare(
    'SELECT g.*, t.name as tenant_name FROM model_grants g JOIN tenants t ON g.tenant_id = t.id WHERE g.model_id = ?'
  ).all(req.params.id);
  res.json({ grants });
});

// 给租户授权
router.post('/admin/:id/grants', adminOnly, (req, res) => {
  const { tenant_id, expires_at } = req.body;
  if (!tenant_id) return res.status(400).json({ message: 'tenant_id 不能为空' });

  // 检查是否已授权
  const existing = db.prepare('SELECT id FROM model_grants WHERE tenant_id = ? AND model_id = ?').get(tenant_id, req.params.id);
  if (existing) return res.status(409).json({ message: '该租户已被授权' });

  const id = uuid();
  db.prepare(
    'INSERT INTO model_grants (id, tenant_id, model_id, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, tenant_id, req.params.id, req.user.userId, expires_at || null);

  res.json({ id, message: '授权成功' });
});

// 回收授权
router.delete('/admin/grants/:grantId', adminOnly, (req, res) => {
  db.prepare('DELETE FROM model_grants WHERE id = ?').run(req.params.grantId);
  res.json({ message: '授权已回收' });
});

export default router;
