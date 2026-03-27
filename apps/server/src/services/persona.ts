import type { PersonaMode } from "../types.js";

const modePrefixMap: Record<PersonaMode, string> = {
  teacher: "老师模式",
  friend: "朋友模式",
  support: "客服模式"
};

export function composeReply(params: {
  mode: PersonaMode;
  question: string;
  references: string[];
}): string {
  const { mode, question, references } = params;
  const prefix = modePrefixMap[mode];
  const knowledgeDigest = references.map((item, idx) => `${idx + 1}. ${item}`).join("；");
  return `${prefix}回答：你问的是「${question}」。结合我已有内容，建议优先这样做：${knowledgeDigest}。如果你愿意，我可以再给你一个可直接执行的步骤清单。`;
}

export function inferEmotion(reply: string): "neutral" | "happy" | "thinking" {
  if (reply.includes("建议") || reply.includes("步骤")) return "thinking";
  if (reply.includes("可以")) return "happy";
  return "neutral";
}
