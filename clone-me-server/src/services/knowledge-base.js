/**
 * 平台知识库服务 - 文档入库与知识召回
 */
import {
  KNOWLEDGE_API_BASE_URL,
  KNOWLEDGE_VERSION_GUID,
  OPENAPI_TOKEN,
} from '../config.js';

const DEFAULT_TIMEOUT_MS = 12000;

async function requestKnowledgeApi(pathname, method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${KNOWLEDGE_API_BASE_URL}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Token': OPENAPI_TOKEN,
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`知识库请求失败: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (typeof data?.code === 'number' && data.code !== 0) {
      throw new Error(`知识库业务失败: ${data.code} ${data.msg || ''}`.trim());
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function insertDocument({
  knowledgeVersionGuid = KNOWLEDGE_VERSION_GUID,
  documentName,
  documentText,
  segmentMode = 'AUTOMATIC',
  segmentInfo,
}) {
  if (!knowledgeVersionGuid) {
    throw new Error('knowledgeVersionGuid 不能为空');
  }
  if (!documentName) {
    throw new Error('documentName 不能为空');
  }
  if (!documentText) {
    throw new Error('documentText 不能为空');
  }

  const payload = {
    knowledgeVersionGuid,
    documentName,
    documentType: 'NORMAL',
    documentSource: 'CUSTOM',
    documentText,
    segmentMode,
  };

  if (segmentMode === 'CUSTOM' && segmentInfo) {
    payload.segmentInfo = segmentInfo;
  }

  return requestKnowledgeApi('/openApi/knowledge/document/insert', 'POST', payload);
}

export async function recallKnowledge({
  knowledgeVersionIds = KNOWLEDGE_VERSION_GUID ? [KNOWLEDGE_VERSION_GUID] : [],
  query,
  recallNum = 5,
  retrievalEnum = 'MULTIPLE_RETRIEVAL',
  retrievalObject = ['content'],
  recallObject = ['content'],
  knowledgeType = 'COMMON',
  isNeedToSort = true,
  scalarFilterConfig,
}) {
  if (!knowledgeVersionIds.length) {
    throw new Error('knowledgeVersionIds 不能为空');
  }
  if (!query) {
    throw new Error('query 不能为空');
  }

  const payload = {
    knowledgeVersionIds,
    needToRetrievalTextContent: query,
    retrievalEnum,
    retrievalObject,
    recallObject,
    recallNum,
    knowledgeType,
    isNeedToSort,
  };
  if (scalarFilterConfig) {
    payload.scalarFilterConfig = scalarFilterConfig;
  }

  return requestKnowledgeApi('/openApi/knowledge/recall', 'POST', payload);
}

export async function getDocumentStatus({
  knowledgeVersionGuid = KNOWLEDGE_VERSION_GUID,
  documentGuid,
}) {
  if (!knowledgeVersionGuid) {
    throw new Error('knowledgeVersionGuid 不能为空');
  }
  if (!documentGuid) {
    throw new Error('documentGuid 不能为空');
  }

  const qs = new URLSearchParams({ knowledgeVersionGuid, documentGuid }).toString();
  return requestKnowledgeApi(`/openApi/knowledge/document/status?${qs}`, 'GET');
}
