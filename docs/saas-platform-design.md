# CloneMe 数字人管理平台设计方案

## 一、产品定位

一个多租户的数字人管理 SaaS 平台。每个租户（企业/个人）可以：
- 创建多个数字人，配置各自的人设、声音、知识库
- 在平台内直接与数字人对话、试听语音效果
- 管理声音克隆、知识库文档

不对外提供 API，所有功能通过 Web 管理后台操作。

## 二、整体架构

```
┌──────────────────────────────────────────────┐
│              Web 管理后台（React）              │
│  登录注册 │ 数字人管理 │ 声音工坊 │ 对话测试    │
└──────────────────┬───────────────────────────┘
                   │ HTTP / WebSocket
┌──────────────────▼───────────────────────────┐
│              后端服务（Node.js Express）        │
│                                               │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ 认证中间件│ │ 租户隔离  │ │ 路由层         │  │
│  │ (JWT)   │ │ (tenant) │ │ /auth /avatar │  │
│  └─────────┘ └──────────┘ │ /voice /chat  │  │
│                            └───────────────┘  │
│  ┌────────────────────────────────────────┐   │
│  │            核心服务层                    │   │
│  │  LLM对话 │ TTS合成 │ 声音克隆 │ 记忆    │   │
│  └────────────────────────────────────────┘   │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────▼───────────────────────────┐
│                 数据层                         │
│  SQLite（租户/数字人/知识库）                    │
│  文件系统（音频文件、Live2D 模型）               │
│  大模型平台（LLM / TTS / CosyVoice）           │
└──────────────────────────────────────────────┘
```

> 用 SQLite 而不是 PostgreSQL，因为比赛场景不需要重量级数据库，零部署成本。

## 三、页面设计

### 3.1 页面结构

```
/login                    - 登录页
/register                 - 注册页
/dashboard                - 工作台首页（数字人列表）
/avatar/create            - 创建数字人
/avatar/:id               - 数字人详情/编辑
/avatar/:id/voice         - 声音工坊
/avatar/:id/knowledge     - 知识库管理
/avatar/:id/chat          - 对话测试

# 管理员专属
/admin/models             - 模型商店管理（上传、编辑、上下架）
/admin/models/:id/grants  - 模型授权管理（给租户授权/回收）
/admin/tenants            - 租户管理

# 普通用户
/models                   - 模型商店（浏览可用模型）
```

### 3.2 工作台首页

```
┌─────────────────────────────────────────────┐
│  CloneMe    [用户名]  [退出]                  │
├─────────────────────────────────────────────┤
│                                             │
│  我的数字人                    [+ 创建数字人]  │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ 🤖 小美   │ │ 🤖 老王   │ │ 🤖 导师   │    │
│  │ 客服助手  │ │ 技术顾问  │ │ 知识博主  │    │
│  │ 声音: ✅  │ │ 声音: ❌  │ │ 声音: ✅  │    │
│  │ 知识库: 3 │ │ 知识库: 0 │ │ 知识库: 5 │    │
│  │          │ │          │ │          │    │
│  │ [对话] [编辑]│ [对话] [编辑]│ [对话] [编辑]│    │
│  └──────────┘ └──────────┘ └──────────┘    │
└─────────────────────────────────────────────┘
```

### 3.3 创建/编辑数字人

```
┌─────────────────────────────────────────────┐
│  ← 返回    创建数字人                         │
├─────────────────────────────────────────────┤
│                                             │
│  基本信息                                    │
│  ┌─────────────────────────────────────┐    │
│  │ 名称:    [小美客服              ]    │    │
│  │ 描述:    [专业的在线客服助手      ]    │    │
│  │ 开场白:  [你好，我是小美，有什么...]  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  选择形象                                    │
│  ┌─────────────────────────────────────┐    │
│  │ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐   │    │
│  │ │ 🔒  │ │ ✅  │ │ ✅  │ │ 🔒  │   │    │
│  │ │小美  │ │小雪  │ │老王  │ │萌萌  │   │    │
│  │ │职业装│ │休闲装│ │西装  │ │动漫风│   │    │
│  │ └─────┘ └─────┘ └─────┘ └─────┘   │    │
│  │ ✅ = 已授权可用  🔒 = 需购买         │    │
│  │ [前往模型商店 →]                      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  人设配置                                    │
│  ┌─────────────────────────────────────┐    │
│  │ 角色设定（系统提示词）:               │    │
│  │ [你是一位专业的客服，说话风格亲切    ] │    │
│  │ [耐心，善于倾听用户问题...          ] │    │
│  │                                     │    │
│  │ LLM 模型:  [Qwen3.5-plus ▼]        │    │
│  │ 回复风格:  ○简洁 ●适中 ○详细        │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  声音配置                                    │
│  ┌─────────────────────────────────────┐    │
│  │ 当前声音: 未配置                      │    │
│  │ [前往声音工坊 →]                      │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [保存]  [取消]                               │
└─────────────────────────────────────────────┘
```

### 3.4 声音工坊

```
┌─────────────────────────────────────────────┐
│  ← 返回    小美客服 - 声音工坊                 │
├─────────────────────────────────────────────┤
│                                             │
│  第一步：录制声音样本                          │
│  ┌─────────────────────────────────────┐    │
│  │ 📖 参考朗读文本（悬浮查看）            │    │
│  │                                     │    │
│  │ [🎙️ 开始录音]  录音时长: 0s          │    │
│  │                                     │    │
│  │ 或上传音频文件: [选择文件]             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  第二步：克隆声音                              │
│  ┌─────────────────────────────────────┐    │
│  │ [创建克隆声音]                        │    │
│  │                                     │    │
│  │ 状态: ✅ 已就绪                       │    │
│  │ Voice ID: cosyvoice-v2-xxx          │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  第三步：试听效果                              │
│  ┌─────────────────────────────────────┐    │
│  │ 试听文本: [你好，我是小美客服    ]     │    │
│  │ [▶ 试听]                             │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 四、数据模型

### 4.1 用户表（users）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| email | TEXT UNIQUE | 登录邮箱 |
| password_hash | TEXT | bcrypt 哈希 |
| name | TEXT | 显示名称 |
| tenant_id | TEXT FK | 所属租户 |
| role | TEXT | admin / user（admin 可管理模型商店） |
| created_at | DATETIME | 创建时间 |

### 4.2 租户表（tenants）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT | 企业/团队名称 |
| plan | TEXT | free / pro |
| avatar_limit | INTEGER | 数字人数量上限 |
| created_at | DATETIME | 创建时间 |

### 4.3 Live2D 模型表（live2d_models）—— 平台级，管理员管理

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT | 模型名称（如"小美-职业装"） |
| description | TEXT | 模型描述 |
| thumbnail_url | TEXT | 缩略图 URL |
| model_url | TEXT | model3.json 的路径（相对于 /models/） |
| category | TEXT | 分类：business / casual / anime / custom |
| price | REAL | 价格（0 = 免费） |
| is_free | BOOLEAN | 是否免费（免费模型所有用户可用） |
| status | TEXT | active / disabled |
| created_at | DATETIME | |

### 4.4 模型授权表（model_grants）—— 租户与模型的关系

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| tenant_id | TEXT FK | 被授权的租户 |
| model_id | TEXT FK | 被授权的模型 |
| granted_by | TEXT FK | 授权人（管理员 user_id） |
| granted_at | DATETIME | 授权时间 |
| expires_at | DATETIME | 过期时间（NULL = 永久） |

> 查询租户可用模型：免费模型（is_free=true）+ 已授权模型（model_grants 中有记录且未过期）

### 4.5 数字人表（avatars）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| tenant_id | TEXT FK | 所属租户 |
| name | TEXT | 数字人名称 |
| description | TEXT | 描述 |
| greeting | TEXT | 开场白 |
| persona_prompt | TEXT | 系统提示词 |
| llm_model | TEXT | LLM 模型名 |
| temperature | REAL | 温度参数 |
| voice_id | TEXT | CosyVoice 克隆声音 ID |
| voice_model | TEXT | 声音模型 |
| live2d_model_id | TEXT FK | 关联的 Live2D 模型（引用 live2d_models.id） |
| status | TEXT | active / disabled |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### 4.6 知识库文档表（knowledge_docs）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| avatar_id | TEXT FK | 所属数字人 |
| tenant_id | TEXT FK | 所属租户 |
| title | TEXT | 文档标题 |
| content | TEXT | 文档内容 |
| created_at | DATETIME | |

### 4.7 对话会话表（sessions）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| avatar_id | TEXT FK | 使用的数字人 |
| tenant_id | TEXT FK | 所属租户 |
| messages | TEXT | JSON 序列化的对话历史 |
| created_at | DATETIME | |
| last_active_at | DATETIME | |

### 3.5 模型商店（普通用户视角）

```
┌─────────────────────────────────────────────┐
│  CloneMe    模型商店                          │
├─────────────────────────────────────────────┤
│                                             │
│  筛选: [全部▼] [免费] [已授权] [未授权]       │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │  [预览图] │ │  [预览图] │ │  [预览图] │    │
│  │ 小雪-休闲 │ │ 老王-西装 │ │ 萌萌-动漫 │    │
│  │ 免费      │ │ 已授权    │ │ ¥99      │    │
│  │ [已拥有✅]│ │ [已拥有✅]│ │ [申请授权]│    │
│  └──────────┘ └──────────┘ └──────────┘    │
│                                             │
│  ┌──────────┐ ┌──────────┐                  │
│  │  [预览图] │ │  [预览图] │                  │
│  │ 小美-职业 │ │ 博士-学术 │                  │
│  │ ¥199     │ │ ¥149     │                  │
│  │ [申请授权]│ │ [申请授权]│                  │
│  └──────────┘ └──────────┘                  │
└─────────────────────────────────────────────┘
```

### 3.6 模型管理（管理员视角）

```
┌─────────────────────────────────────────────┐
│  CloneMe 管理后台    模型管理    [+ 上传模型]  │
├─────────────────────────────────────────────┤
│                                             │
│  | 模型名称    | 分类     | 价格  | 状态  |   │
│  |------------|---------|------|-------|   │
│  | 小雪-休闲   | casual  | 免费  | 上架  |   │
│  | 老王-西装   | business| ¥99  | 上架  |   │
│  | 萌萌-动漫   | anime   | ¥99  | 上架  |   │
│  | 小美-职业   | business| ¥199 | 上架  |   │
│  | 测试模型    | custom  | ¥0   | 下架  |   │
│  |            |         |      |       |   │
│  | [编辑] [授权管理] [上架/下架]          |   │
│                                             │
│  上传模型                                    │
│  ┌─────────────────────────────────────┐    │
│  │ 模型名称: [                    ]     │    │
│  │ 分类:     [business ▼]              │    │
│  │ 价格:     [99]  ☐ 免费              │    │
│  │ 缩略图:   [选择图片]                 │    │
│  │ 模型文件: [选择 .zip 文件]           │    │
│  │ (包含 model3.json + moc3 + 贴图等)  │    │
│  │ [上传并发布]                         │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 3.7 模型授权管理（管理员）

```
┌─────────────────────────────────────────────┐
│  ← 返回    小美-职业装 - 授权管理              │
├─────────────────────────────────────────────┤
│                                             │
│  已授权租户                                   │
│  | 租户名称      | 授权时间    | 到期时间  |   │
│  |--------------|-----------|---------|   │
│  | 哈啰出行      | 2026-03-20 | 永久    |   │
│  | 某某科技      | 2026-03-25 | 2027-03 |   │
│  |              |           | [回收]  |   │
│                                             │
│  新增授权                                    │
│  ┌─────────────────────────────────────┐    │
│  │ 租户: [搜索租户名称...        ▼]     │    │
│  │ 有效期: ○永久 ○1年 ○自定义          │    │
│  │ [授权]                               │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 5.1 认证

```
POST /api/auth/register    - 注册
POST /api/auth/login       - 登录（返回 JWT）
GET  /api/auth/me          - 获取当前用户信息
```

所有其他接口需要 Header: `Authorization: Bearer {jwt_token}`

### 5.2 数字人 CRUD

```
GET    /api/avatars              - 列表（自动按 tenant_id 过滤）
POST   /api/avatars              - 创建
GET    /api/avatars/:id          - 详情
PUT    /api/avatars/:id          - 更新
DELETE /api/avatars/:id          - 删除
```

### 5.3 声音管理

```
POST   /api/avatars/:id/voice/upload   - 上传音频样本（录音/文件）
POST   /api/avatars/:id/voice/clone    - 创建克隆声音
GET    /api/avatars/:id/voice          - 查询声音状态
DELETE /api/avatars/:id/voice          - 删除声音
POST   /api/avatars/:id/voice/preview  - 试听（传文本，返回音频）
```

### 5.4 知识库管理

```
GET    /api/avatars/:id/knowledge       - 文档列表
POST   /api/avatars/:id/knowledge       - 添加文档
PUT    /api/avatars/:id/knowledge/:docId - 更新文档
DELETE /api/avatars/:id/knowledge/:docId - 删除文档
```

### 5.5 对话

```
POST   /api/avatars/:id/chat           - 对话（SSE 流式）
WS     /ws/tts?avatar_id=xxx           - TTS 语音合成
DELETE /api/avatars/:id/chat/session    - 清除会话
```

## 六、多租户隔离

| 维度 | 实现方式 |
|------|---------|
| 数据隔离 | 所有表带 tenant_id，中间件自动注入和过滤 |
| 认证隔离 | JWT 中包含 tenant_id，每次请求自动提取 |
| 声音隔离 | CosyVoice prefix 包含 tenant_id 前缀 |
| 文件隔离 | 上传文件按 tenant_id 分目录存储 |

中间件伪代码：
```javascript
function tenantMiddleware(req, res, next) {
  const { tenantId } = req.user; // 从 JWT 解析
  req.tenantId = tenantId;
  // 后续所有数据库查询自动加 WHERE tenant_id = ?
  next();
}
```

## 七、技术选型

| 层 | 技术 | 理由 |
|---|------|------|
| 前端 | React + Vite + TailwindCSS | 现有技术栈，快速开发 |
| 后端 | Node.js + Express | 现有技术栈，WebSocket 友好 |
| 数据库 | SQLite（better-sqlite3） | 零部署，比赛够用，后续可迁移 PostgreSQL |
| 认证 | JWT（jsonwebtoken + bcrypt） | 轻量，无状态 |
| 文件存储 | 本地 + OSS | 录音上传到 OSS 获取公网 URL |
| 大模型 | 阿里百炼 + 豆包 | 现有对接 |

## 八、从现有代码的改造步骤

### 第一步：加认证层（0.5 天）

1. 安装 `better-sqlite3`、`jsonwebtoken`、`bcryptjs`
2. 创建 `db.js`：初始化 SQLite，建表
3. 创建 `routes/auth.js`：注册/登录/获取用户信息
4. 创建 `middleware/auth.js`：JWT 验证 + tenant_id 注入

### 第二步：数字人 CRUD（0.5 天）

1. 创建 `routes/avatars.js`：CRUD 接口
2. 现有的 persona 配置从 JSON 文件迁移到数据库
3. 前端新增数字人列表页和创建/编辑表单

### 第三步：改造对话和 TTS（0.5 天）

1. `/api/avatars/:id/chat` 替代现有的 `/api/chat/smart`
2. 对话时从数据库读取该数字人的 persona_prompt、voice_id、knowledge
3. TTS WebSocket 连接时传 avatar_id，后端自动查 voice_id

### 第四步：声音工坊页面（0.5 天）

1. 把现有的录音 + 克隆 UI 抽成独立页面
2. 克隆成功后 voice_id 写入 avatars 表
3. 加试听功能

### 第五步：知识库管理（0.5 天）

1. 知识库文档 CRUD 页面
2. 对话时从 knowledge_docs 表检索相关文档注入 LLM

总计约 2.5 天可完成最小可用版本。

## 五、API 设计

### 5.1 认证

```
POST /api/auth/register    - 注册（自动创建租户）
POST /api/auth/login       - 登录（返回 JWT，含 role + tenant_id）
GET  /api/auth/me          - 获取当前用户信息
```

### 5.2 模型商店（管理员）

```
GET    /api/admin/models              - 模型列表（全部）
POST   /api/admin/models              - 上传新模型（multipart/form-data）
PUT    /api/admin/models/:id          - 编辑模型信息
DELETE /api/admin/models/:id          - 删除模型
PUT    /api/admin/models/:id/status   - 上架/下架

# 授权管理
GET    /api/admin/models/:id/grants   - 查看模型的授权列表
POST   /api/admin/models/:id/grants   - 给租户授权
DELETE /api/admin/grants/:grantId     - 回收授权
```

### 5.3 模型商店（普通用户）

```
GET    /api/models                    - 浏览模型商店（所有上架模型）
GET    /api/models/available          - 我可用的模型（免费 + 已授权）
```

### 5.4 数字人 CRUD

```
GET    /api/avatars              - 列表（自动按 tenant_id 过滤）
POST   /api/avatars              - 创建（live2d_model_id 必须是可用模型）
GET    /api/avatars/:id          - 详情
PUT    /api/avatars/:id          - 更新
DELETE /api/avatars/:id          - 删除
```

### 5.5 声音管理

```
POST   /api/avatars/:id/voice/upload   - 上传音频样本
POST   /api/avatars/:id/voice/clone    - 创建克隆声音
GET    /api/avatars/:id/voice          - 查询声音状态
DELETE /api/avatars/:id/voice          - 删除声音
POST   /api/avatars/:id/voice/preview  - 试听
```

### 5.6 知识库管理

```
GET    /api/avatars/:id/knowledge       - 文档列表
POST   /api/avatars/:id/knowledge       - 添加文档
PUT    /api/avatars/:id/knowledge/:docId - 更新文档
DELETE /api/avatars/:id/knowledge/:docId - 删除文档
```

### 5.7 对话

```
POST   /api/avatars/:id/chat           - 对话（SSE 流式）
WS     /ws/tts?avatar_id=xxx           - TTS 语音合成
DELETE /api/avatars/:id/chat/session    - 清除会话
```

### 5.8 管理员 - 租户管理

```
GET    /api/admin/tenants              - 租户列表
GET    /api/admin/tenants/:id          - 租户详情
PUT    /api/admin/tenants/:id          - 编辑租户（套餐、配额）
```

## 六、权限模型

```
角色        可访问的功能
─────────────────────────────────────────
admin       模型上传/编辑/上下架
            模型授权管理（给租户授权/回收）
            租户管理
            + 所有 user 权限

user        浏览模型商店
            使用已授权的模型创建数字人
            数字人 CRUD（仅自己租户的）
            声音克隆、知识库、对话
```

创建数字人时的模型权限校验：
```javascript
// 后端校验逻辑
async function validateModelAccess(tenantId, modelId) {
  const model = db.get('SELECT * FROM live2d_models WHERE id = ?', modelId);
  if (!model || model.status !== 'active') throw new Error('模型不存在');
  
  // 免费模型所有人可用
  if (model.is_free) return true;
  
  // 检查授权
  const grant = db.get(
    'SELECT * FROM model_grants WHERE tenant_id = ? AND model_id = ? AND (expires_at IS NULL OR expires_at > datetime("now"))',
    tenantId, modelId
  );
  if (!grant) throw new Error('未授权使用此模型，请前往模型商店');
  
  return true;
}
```
