/**
 * 角色管理服务 - 管理系统级角色提示词
 * 支持从 personas.json 加载预设角色，也支持运行时动态增删
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PERSONAS_FILE = join(__dirname, '..', 'personas.json');

/** 角色存储（内存） */
let personas = {};
/** 默认角色 key */
let defaultPersonaKey = 'general';

/**
 * 初始化：从 personas.json 加载预设角色
 */
export function initPersonas() {
  try {
    const raw = readFileSync(PERSONAS_FILE, 'utf-8');
    const config = JSON.parse(raw);
    personas = config.personas || {};
    defaultPersonaKey = config.defaultPersona || 'general';
    console.log(`✅ 角色配置加载成功，共 ${Object.keys(personas).length} 个角色`);
  } catch (err) {
    console.error(`❌ 角色配置加载失败: ${err.message}`);
    personas = {};
  }
}

/**
 * 获取指定角色的系统提示词
 * @param {string} personaKey - 角色标识
 * @returns {string|null} 系统提示词，角色不存在时返回 null
 */
export function getSystemPrompt(personaKey) {
  const key = personaKey || defaultPersonaKey;
  const persona = personas[key];
  return persona ? persona.systemPrompt : null;
}

/**
 * 获取所有可用角色列表（不含完整 systemPrompt）
 * @returns {Array<{key: string, name: string, description: string}>}
 */
export function listPersonas() {
  return Object.entries(personas).map(([key, val]) => ({
    key,
    name: val.name,
    description: val.description,
  }));
}

/**
 * 获取默认角色标识
 * @returns {string}
 */
export function getDefaultPersonaKey() {
  return defaultPersonaKey;
}

/**
 * 运行时新增/更新角色
 * @param {string} key - 角色标识
 * @param {object} persona - { name, description, systemPrompt }
 */
export function upsertPersona(key, persona) {
  if (!key || !persona || !persona.systemPrompt) {
    throw new Error('角色标识和 systemPrompt 不能为空');
  }
  personas[key] = {
    name: persona.name || key,
    description: persona.description || '',
    systemPrompt: persona.systemPrompt,
  };
}

/**
 * 运行时删除角色
 * @param {string} key - 角色标识
 * @returns {boolean} 是否删除成功
 */
export function removePersona(key) {
  if (!personas[key]) return false;
  delete personas[key];
  return true;
}
