/**
 * 平台能力配置 - 所有 API Key 和模型配置集中管理
 */

// 大模型平台基础地址
export const LLM_BASE_URL = 'https://pre-aibrain-large-model-engine.hellobike.cn/v1';

// WebSocket 地址
export const TTS_WS_URL = 'wss://pre-aibrain-speech-engine.hellobike.cn/v1/realtime/tts';
export const ASR_WS_URL = 'wss://pre-aibrain-speech-engine.hellobike.cn/v1/realtime/asr';

// 阿里百炼（视频生成直连）
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';

// API Keys（按能力分类）
export const API_KEYS = {
  llm: 'sk-wpKbzykan-uFR6HCgW8rfwyBCGd-J0N2efi5B3B7qk4',
  embedding: 'sk-4N0tr8LQDwpHoQM5zu9SQl84kPBl3aLTz3HuMBu6MtQ',
  imageGen: 'sk-paDtoivI7wO46vrYehZlwbG353Kb1rFXgYOxGwVHjYE',
  tts: 'sk-Zz3S30auhbu5fwXFsWodv7jIreX2LaYZIAjIdLF-5Vo',
  asr: 'sk-TIKydg6AJ6LGNFqmZGNdJc19UK0IPp4TB3kNJHP5Ry4',
  video: 'sk-2b544e6943b34787ae9bdbd95a994c9c',
};

// 默认模型选择
export const MODELS = {
  chat: 'GPT-5.4',
  embedding: 'Qwen-text-embedding-v4',
  imageGen: 'Doubao-Seedream-5.0-lite',
  tts: 'DouBao-seed-tts-1.0',
  asr: 'Doubao-Volc-Bigasr-Sauc-Duration',
  video: 'wan2.6-i2v-flash',
};

// 服务端口
export const PORT = process.env.PORT || 3001;
