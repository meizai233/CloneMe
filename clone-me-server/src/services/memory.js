/**
 * 会话记忆服务 - 管理多轮对话上下文 + 记忆库持久化
 * 按 sessionId 隔离，支持滑动窗口裁剪
 * 每轮对话异步写入 pre 环境记忆库
 */

/** 记忆库 API 配置 */
const MEMORY_BANK_BASE_URL = 'https://pre-aibrain-memory-bank.hellobike.cn';
const MEMORY_BANK_LIBRARY_ID = '2037419477752942593';
const MEMORY_BANK_CREATE_ID = '38668_ai_clone_me';

/** 最大保留的历史轮数（一问一答算一轮） */
const MAX_HISTORY_ROUNDS = 10;
/** 会话过期时间（毫秒），默认 30 分钟 */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** @type {Map<string, {messages: Array, updatedAt: number}>} */
const sessions = new Map();

/**
 * 获取指定会话的历史消息列表
 * @param {string} sessionId - 会话标识
 * @returns {Array<{role: string, content: string}>}
 */
export function getHistory(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  if (Date.now() - session.updatedAt > SESSION_TTL_MS) {
    sessions.delete(sessionId);
    return [];
  }
  return session.messages;
}

/**
 * 追加一轮对话到会话历史，并异步写入记忆库
 * @param {string} sessionId - 会话标识
 * @param {string} userContent - 用户输入
 * @param {string} assistantContent - 助手回复
 * @param {string} [userId] - 用户ID（用于记忆库）
 */
export function appendRound(sessionId, userContent, assistantContent, userId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], updatedAt: Date.now() };
    sessions.set(sessionId, session);
  }
  session.messages.push(
    { role: 'user', content: userContent },
    { role: 'assistant', content: assistantContent },
  );
  session.updatedAt = Date.now();
  // 滑动窗口裁剪
  const maxMessages = MAX_HISTORY_ROUNDS * 2;
  if (session.messages.length > maxMessages) {
    session.messages = session.messages.slice(-maxMessages);
  }

  // 异步写入记忆库（不阻塞主流程）
  if (userId) {
    saveToMemoryBank(userId, sessionId, userContent, assistantContent).catch((err) => {
      console.error('[MemoryBank] 写入记忆库失败:', err.message);
    });
  }
}

/**
 * 异步将对话写入 pre 环境记忆库
 * @param {string} userId - 用户ID
 * @param {string} sessionId - 会话ID
 * @param {string} userContent - 用户输入
 * @param {string} assistantContent - 助手回复
 */
async function saveToMemoryBank(userId, sessionId, userContent, assistantContent) {
  const url = `${MEMORY_BANK_BASE_URL}/api/v1/memories/add?sync=true`;

  const body = {
    userId,
    libraryId: MEMORY_BANK_LIBRARY_ID,
    createId: MEMORY_BANK_CREATE_ID,
    sessionId,
    messages: [
      { role: 'user', content: userContent },
      { role: 'assistant', content: assistantContent },
    ],
    infer: true,
    decisionCRUD: true,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const result = await res.json();
  console.log('[MemoryBank] 写入成功, taskId:', result.taskId ?? 'sync', 'events:', result.results?.map(r => r.event));
  return result;
}

/**
 * 搜索记忆库 - 支持混合搜索（向量搜索 + 元数据过滤）
 * @param {string} userId - 用户ID（必填，用于权限校验）
 * @param {object} options - 搜索选项
 * @param {string} [options.queryText] - 查询文本（语义检索）
 * @param {string} [options.sessionId] - 会话ID过滤
 * @param {number} [options.topK=5] - 返回最相似结果数
 * @param {number} [options.similarityThreshold=0.7] - 相似度阈值
 * @param {object} [options.metadataFilters] - 元数据简化查询（等于查询，AND关系）
 * @param {object} [options.dslQuery] - DSL高级查询（支持复杂操作符）
 * @param {number} [options.page=1] - 页码
 * @param {number} [options.pageSize=10] - 每页数量
 * @param {string} [options.sortField] - 排序字段（createTime/updateTime/similarity）
 * @param {string} [options.sortDirection='DESC'] - 排序方向
 * @returns {Promise<{results: Array, total: number, hasMore: boolean}>}
 */
export async function searchMemories(userId, options = {}) {
  const url = `${MEMORY_BANK_BASE_URL}/api/v1/memories/search`;

  const body = {
    userId,
    libraryId: MEMORY_BANK_LIBRARY_ID,
  };

  // 会话ID过滤
  if (options.sessionId) {
    body.sessionId = options.sessionId;
  }

  // 元数据简化查询
  if (options.metadataFilters) {
    body.metadataFilters = options.metadataFilters;
  }

  // DSL高级查询
  if (options.dslQuery) {
    body.dslQuery = options.dslQuery;
  }

  // 向量搜索参数
  if (options.queryText) {
    body.embeddingSearch = {
      queryText: options.queryText,
      topK: options.topK ?? 5,
      similarityThreshold: options.similarityThreshold ?? 0.7,
      metricType: options.metricType ?? 'COSINE',
    };
  }

  // 分页与排序
  body.page = options.page ?? 1;
  body.pageSize = options.pageSize ?? 10;
  if (options.sortField) {
    body.sortField = options.sortField;
    body.sortDirection = options.sortDirection ?? 'DESC';
  }

  console.log('[MemoryBank] 检索请求 body:', JSON.stringify(body).slice(0, 500));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`记忆检索失败 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  console.log('[MemoryBank] 检索成功, total:', data.total, 'results:', data.results?.length);
  return {
    results: data.results ?? [],
    total: data.total ?? 0,
    page: data.page ?? 1,
    pageSize: data.pageSize ?? 10,
    hasMore: data.hasMore ?? false,
  };
}

/**
 * 基于用户问题检索相关记忆（语义搜索快捷方法）
 * 用于对话场景，自动组装向量搜索参数
 * @param {string} userId - 用户ID
 * @param {string} query - 用户问题
 * @param {number} [topK=5] - 返回条数
 * @returns {Promise<Array<{content: string, similarity: number, matchReason: string}>>}
 */
export async function searchRelevantMemories(userId, query, topK = 5) {
  try {
    const { results } = await searchMemories(userId, {
      queryText: query,
      topK,
      similarityThreshold: 0.5,
      sortField: 'similarity',
      sortDirection: 'DESC',
    });

    return results.map(r => ({
      content: r.memory?.content ?? '',
      similarity: r.similarity ?? 0,
      matchReason: r.matchReason ?? '',
    }));
  } catch (err) {
    console.error('[MemoryBank] 语义检索失败:', err.message);
    return [];
  }
}

/**
 * 清除指定会话
 * @param {string} sessionId
 */
export function clearSession(sessionId) {
  sessions.delete(sessionId);
}
