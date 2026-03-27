import type { CreatorProfile } from "../types.js";

const DEFAULT_KNOWLEDGE = [
  "React 性能优化优先做拆分、memo、减少无意义重渲染。",
  "TypeScript 项目中，优先给 API 返回体建立显式类型，避免 any 扩散。",
  "排查线上前端问题时，先看复现路径，再看监控和日志，最后定位代码。",
  "做技术内容输出时，用问题-方案-示例三段式更容易被用户理解。"
];

const profile: CreatorProfile = {
  creatorName: "CloneMe Demo 博主",
  domain: "前端工程与效率",
  toneHints: "通俗、直接、少废话、偶尔类比",
  knowledge: [...DEFAULT_KNOWLEDGE]
};

export function upsertKnowledge(docs: string[]): CreatorProfile {
  const cleaned = docs.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length > 0) {
    profile.knowledge = cleaned;
  }
  return profile;
}

export function getProfile(): CreatorProfile {
  return profile;
}

export function retrieveTopK(question: string, k = 3): string[] {
  const tokens = question.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = profile.knowledge.map((chunk) => {
    const haystack = chunk.toLowerCase();
    const score = tokens.reduce((sum, token) => (haystack.includes(token) ? sum + 1 : sum), 0);
    return { chunk, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((item) => item.chunk);
}
