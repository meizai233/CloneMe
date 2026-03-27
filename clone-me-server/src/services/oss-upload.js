/**
 * OSS 文件上传服务
 * 复用 upload-to-oss skill 的核心逻辑，将文件上传到阿里云 OSS 并返回公网 URL
 */
import { readFileSync } from 'fs';
import { join } from 'path';

// SSO Token 换取地址
const EXCHANGE_URL = 'https://aibrain-ai-application.hellobike.cn/AIBrainAIApplication/api/v1/auth/exchangeAuthentic';
const GATEWAY_URL = 'https://evbikeadmin.hellobike.com';

let tokenCache = null;

/**
 * 获取 ACCESS_KEY
 */
function getAccessKey() {
  const key = process.env.HELLO_ACCESS_KEY || process.env.ACCESS_KEY || '';
  if (!key) {
    throw new Error('HELLO_ACCESS_KEY 未配置');
  }
  return key;
}

/**
 * 通过 ACCESS_KEY 换取 SSO Token（带缓存）
 */
async function getToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expireTime > now) {
    return tokenCache.token;
  }

  const accessKey = getAccessKey();
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey }),
  });

  const data = await res.json();
  if (data.code !== 0 || !data.data) {
    throw new Error(`Token 换取失败: ${data.msg || '未知错误'}`);
  }

  tokenCache = { token: data.data, expireTime: now + 55 * 60 * 1000 };
  return data.data;
}

/**
 * 上传 Buffer 到 OSS
 * @param {Buffer} fileBuffer - 文件内容
 * @param {string} fileName - 文件名（含后缀）
 * @param {string} contentType - MIME 类型
 * @returns {Promise<string>} - 公网可访问的 URL
 */
export async function uploadBufferToOSS(fileBuffer, fileName, contentType = 'audio/webm') {
  const token = await getToken();

  // 获取预签名上传 URL
  const params = {
    bucketName: 'ridemobile-oho-pub',
    isPrivate: false,
    type: 3,
    fileName,
    needConvertPinyin: true,
    source: 'ohoKiroUpload',
    contentType,
  };

  const urlRes = await fetch(`${GATEWAY_URL}/getGeneralUploadUrl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'token': token,
    },
    body: JSON.stringify(params),
  });

  const urlData = await urlRes.json();
  if (urlData.code !== 0 || !urlData.data?.uploadUrl) {
    throw new Error(`获取上传 URL 失败: ${urlData.msg || JSON.stringify(urlData)}`);
  }

  // PUT 上传到 OSS（替换内网域名为公网域名）
  const uploadUrl = urlData.data.uploadUrl.replace(/-internal\.aliyuncs\.com/, '.aliyuncs.com');

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileBuffer.length),
    },
    body: fileBuffer,
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`PUT 上传失败 (${putRes.status}): ${err.slice(0, 200)}`);
  }

  return urlData.data.originUrl;
}

/**
 * 上传本地文件到 OSS
 * @param {string} filePath - 本地文件路径
 * @param {string} contentType - MIME 类型
 * @returns {Promise<string>} - 公网可访问的 URL
 */
export async function uploadFileToOSS(filePath, contentType) {
  const buffer = readFileSync(filePath);
  const fileName = filePath.split('/').pop() || `file_${Date.now()}`;
  return uploadBufferToOSS(buffer, fileName, contentType);
}
