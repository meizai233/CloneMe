/**
 * RAG 检索服务 - 知识库检索（预留接口）
 * 当前为 mock 实现，后续接入向量检索
 */

/**
 * 根据用户问题检索相关知识片段
 * @param {string} query - 用户问题
 * @param {object} options - 可选参数
 * @param {number} options.topK - 返回的最大条数，默认 3
 * @returns {Promise<Array<{content: string, score: number}>>}
 */
export async function retrieve(query, options = {}) {
  // TODO: 后续接入 embedding 向量检索，替换 mock 实现
  return [];
}
