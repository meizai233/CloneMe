/**
 * SQLite 数据库初始化
 * 自动建表，零配置启动
 */
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = join(__dirname, '../data');
mkdirSync(DB_DIR, { recursive: true });

const db = new Database(join(DB_DIR, 'cloneme.db'));

// 开启 WAL 模式，提升并发性能
db.pragma('journal_mode = WAL');

// 建表
db.exec(`
  -- 租户表
  CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plan TEXT DEFAULT 'free',
    avatar_limit INTEGER DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 用户表
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Live2D 模型表（平台级）
  CREATE TABLE IF NOT EXISTS live2d_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    thumbnail_url TEXT DEFAULT '',
    model_url TEXT NOT NULL,
    category TEXT DEFAULT 'casual',
    price REAL DEFAULT 0,
    is_free INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 模型授权表
  CREATE TABLE IF NOT EXISTS model_grants (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    model_id TEXT NOT NULL REFERENCES live2d_models(id),
    granted_by TEXT REFERENCES users(id),
    granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME
  );

  -- 数字人表
  CREATE TABLE IF NOT EXISTS avatars (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    greeting TEXT DEFAULT '',
    persona_prompt TEXT DEFAULT '',
    llm_model TEXT DEFAULT 'Qwen3.5-plus',
    temperature REAL DEFAULT 0.7,
    voice_id TEXT DEFAULT '',
    voice_model TEXT DEFAULT 'cosyvoice-v2',
    live2d_model_id TEXT REFERENCES live2d_models(id),
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 知识库文档表
  CREATE TABLE IF NOT EXISTS knowledge_docs (
    id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL REFERENCES avatars(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 对话会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL REFERENCES avatars(id),
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    messages TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- 克隆声音表
  CREATE TABLE IF NOT EXISTS voices (
    id TEXT PRIMARY KEY,
    voice_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    speaker_name TEXT DEFAULT '',
    audio_url TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export default db;
