
/**
 * RAG 检索服务 - 对接 AIBrain 知识库召回接口
 */

/** 知识库接口地址 */
const KNOWLEDGE_API_URL =
  'https://aibrain-large-model.hellobike.cn/AIBrainLmp/api/v1/openApi/knowledge/recall';

/** 知识库版本 ID，可按需扩展为数组 */
const KNOWLEDGE_VERSION_ID = '1354731846745653248';

/**
 * 根据用户问题检索相关知识片段
 * @param {string} query - 用户问题
 * @param {object} options - 可选参数
 * @param {number} options.topK - 返回的最大条数，默认 5
 * @returns {Promise<Array<{content: string, score: number, question: string}>>}
 */
export async function retrieve(query, options = {}) {
  const { topK = 15 } = options;

  try {
    const body = {
      knowledgeVersionIds: [KNOWLEDGE_VERSION_ID],
      needToRetrievalTextContent: query,
      retrievalEnum: 'KEYWORD_RETRIEVAL',
      retrievalObject: ['问题', '回答'],
      recallObject: ['问题', '回答'],
      recallNum: topK,
      isNeedToSort: true,
      knowledgeType: 'STRUCTURED',
    };

    const res = await fetch(KNOWLEDGE_API_URL, {
      method: 'POST',
      headers: {
        'Token': 'openApi',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error(`[RAG] 知识库请求失败: ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (json.code !== 0 || !json.data) {
      console.error(`[RAG] 知识库返回异常:`, json.msg);
      return [];
    }

    // 合并"问题"和"回答"两个召回通道的结果，按 knowledgeBase_guid 去重
    const seen = new Map();
    const results = [];

    for (const group of Object.values(json.data)) {
      if (!Array.isArray(group)) continue;
      for (const item of group) {
        const key = item.knowledgeBase_guid;
        const score = parseFloat(item.distance) || 0;
        // 同一条记录取较高分
        if (seen.has(key)) {
          const prev = seen.get(key);
          if (score > prev.score) prev.score = score;
          continue;
        }
        const entry = {
          content: `Q: ${item['问题']}\nA: ${item['回答']}`,
          score,
          question: item['问题'],
        };
        seen.set(key, entry);
        results.push(entry);
      }
    }

    // 按相关性分数降序排列，取 topK 条
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  } catch (err) {
    console.error('[RAG] 知识库检索异常:', err.message);
    return [];
  }
}
