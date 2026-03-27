/**
 * 数字人 CRUD 路由
 * 所有接口需要认证，自动按 tenant_id 隔离
 */
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// 列表
router.get('/', (req, res) => {
  const avatars = db.prepare(
    'SELECT a.*, m.name as model_name, m.thumbnail_url as model_thumbnail FROM avatars a LEFT JOIN live2d_models m ON a.live2d_model_id = m.id WHERE a.tenant_id = ? ORDER BY a.created_at DESC'
  ).all(req.tenantId);
  res.json({ avatars });
});

// 详情
router.get('/:id', (req, res) => {
  const avatar = db.prepare(
    'SELECT a.*, m.name as model_name, m.thumbnail_url as model_thumbnail, m.model_url FROM avatars a LEFT JOIN live2d_models m ON a.live2d_model_id = m.id WHERE a.id = ? AND a.tenant_id = ?'
  ).get(req.params.id, req.tenantId);
  if (!avatar) return res.status(404).json({ message: '数字人不存在' });

  // 获取知识库文档数量
  const docCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_docs WHERE avatar_id = ?').get(req.params.id);
  res.json({ avatar: { ...avatar, docCount: docCount.count } });
});

// 创建
router.post('/', (req, res) => {
  try {
    const { name, description, greeting, persona_prompt, llm_model, temperature, live2d_model_id } = req.body;
    if (!name) return res.status(400).json({ message: '名称不能为空' });

    // 检查数字人数量限制
    const tenant = db.prepare('SELECT avatar_limit FROM tenants WHERE id = ?').get(req.tenantId);
    const count = db.prepare('SELECT COUNT(*) as count FROM avatars WHERE tenant_id = ?').get(req.tenantId);
    if (count.count >= (tenant?.avatar_limit || 3)) {
      return res.status(403).json({ message: `已达数字人数量上限（${tenant?.avatar_limit || 3}个）` });
    }

    // 校验模型权限
    if (live2d_model_id) {
      const model = db.prepare('SELECT * FROM live2d_models WHERE id = ? AND status = ?').get(live2d_model_id, 'active');
      if (!model) return res.status(400).json({ message: '模型不存在或已下架' });
      if (!model.is_free) {
        const grant = db.prepare(
          "SELECT * FROM model_grants WHERE tenant_id = ? AND model_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))"
        ).get(req.tenantId, live2d_model_id);
        if (!grant) return res.status(403).json({ message: '未授权使用此模型，请前往模型商店' });
      }
    }

    const id = uuid();
    db.prepare(
      'INSERT INTO avatars (id, tenant_id, name, description, greeting, persona_prompt, llm_model, temperature, live2d_model_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, req.tenantId, name, description || '', greeting || '', persona_prompt || '', llm_model || 'Qwen3.5-plus', temperature || 0.7, live2d_model_id || null);

    res.json({ id, message: '创建成功' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 更新
router.put('/:id', (req, res) => {
  const avatar = db.prepare('SELECT * FROM avatars WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
  if (!avatar) return res.status(404).json({ message: '数字人不存在' });

  const { name, description, greeting, persona_prompt, llm_model, temperature, live2d_model_id, voice_id, voice_model } = req.body;

  db.prepare(
    `UPDATE avatars SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      greeting = COALESCE(?, greeting),
      persona_prompt = COALESCE(?, persona_prompt),
      llm_model = COALESCE(?, llm_model),
      temperature = COALESCE(?, temperature),
      live2d_model_id = COALESCE(?, live2d_model_id),
      voice_id = COALESCE(?, voice_id),
      voice_model = COALESCE(?, voice_model),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ?`
  ).run(name, description, greeting, persona_prompt, llm_model, temperature, live2d_model_id, voice_id, voice_model, req.params.id, req.tenantId);

  res.json({ message: '更新成功' });
});

// 删除
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM avatars WHERE id = ? AND tenant_id = ?').run(req.params.id, req.tenantId);
  if (result.changes === 0) return res.status(404).json({ message: '数字人不存在' });
  // 同时删除关联的知识库文档
  db.prepare('DELETE FROM knowledge_docs WHERE avatar_id = ?').run(req.params.id);
  res.json({ message: '删除成功' });
});

export default router;
