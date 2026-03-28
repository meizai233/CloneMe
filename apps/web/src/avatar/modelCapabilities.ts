import type { AvatarEmotion, AvatarGesture } from "./live2dAdapter";

export interface AvatarModelCapability {
  modelKey: string;
  modelLabel: string;
  allowedEmotions: AvatarEmotion[];
  allowedGestures: AvatarGesture[];
  gestureHints: Record<string, string>;
}

const ALL_EMOTIONS: AvatarEmotion[] = [
  "neutral",
  "happy",
  "thinking",
  "excited",
  "confident",
  "warm",
  "serious",
  "surprised",
];
const ALL_GESTURES: AvatarGesture[] = [
  "none",
  "nod",
  "emphasis",
  "thinking",
  "clap",
  "openArms",
  "promoPitch",
  "discountHighlight",
  "comfortExplain",
];

const HARU_CAPABILITY: AvatarModelCapability = {
  modelKey: "haru_greeter_pro_jp",
  modelLabel: "Haru",
  allowedEmotions: ALL_EMOTIONS,
  allowedGestures: [
    "none",
    "nod",
    "emphasis",
    "thinking",
    "clap",
    "openArms",
    "promoPitch",
    "discountHighlight",
    "comfortExplain",
  ],
  gestureHints: {
    nod: "轻微点头，适合确认和安抚。",
    emphasis: "短促强调动作，适合重点提醒。",
    thinking: "偏思考姿态，适合解释复杂规则。",
    clap: "高兴时拍手，适合好消息或成功场景。",
    openArms: "张开手臂，适合欢迎或引导。",
    promoPitch: "偏销售讲解动作，适合推荐方案。",
    discountHighlight: "强调优惠和卖点。",
    comfortExplain: "温和解释动作，适合投诉安抚。",
  },
};

const NATORI_CAPABILITY: AvatarModelCapability = {
  modelKey: "natori_pro_zh",
  modelLabel: "Natori",
  allowedEmotions: ALL_EMOTIONS,
  allowedGestures: [
    "none",
    "nod",
    "emphasis",
    "thinking",
    "promoPitch",
    "discountHighlight",
    "comfortExplain",
  ],
  gestureHints: {
    nod: "轻微点头，适合确认用户诉求。",
    emphasis: "上半身强调，适合提醒关键步骤。",
    thinking: "偏思考姿态，适合分析原因。",
    promoPitch: "偏讲解姿态，适合介绍方案。",
    discountHighlight: "强调信息点，适合说明规则。",
    comfortExplain: "安抚解释，适合处理投诉场景。",
  },
};

const TALKINGHEAD_BRUNETTE_CAPABILITY: AvatarModelCapability = {
  modelKey: "talkinghead_brunette_glb",
  modelLabel: "TalkingHead Brunette",
  allowedEmotions: ALL_EMOTIONS,
  allowedGestures: ALL_GESTURES,
  gestureHints: {
    nod: "轻微确认，适合承接用户输入。",
    emphasis: "重点强调，适合关键规则说明。",
    thinking: "解释复杂问题时使用，节奏更缓。",
    clap: "表达正向反馈，避免高频连续触发。",
    openArms: "欢迎或引导场景，动作幅度较大。",
    promoPitch: "讲解方案与推荐时使用。",
    discountHighlight: "突出优惠、价格、时效信息。",
    comfortExplain: "投诉或负向情绪下优先安抚解释。",
  },
};

const TALKINGHEAD_AVATURN_CAPABILITY: AvatarModelCapability = {
  modelKey: "talkinghead_avaturn_glb",
  modelLabel: "TalkingHead Avaturn",
  allowedEmotions: ALL_EMOTIONS,
  allowedGestures: ALL_GESTURES,
  gestureHints: {
    nod: "默认确认动作，适合多数问答回合。",
    emphasis: "用于步骤和结论强调。",
    thinking: "用于分析型回答和推理场景。",
    clap: "结果达成/成功消息时使用。",
    openArms: "欢迎、引导、总结收尾时使用。",
    promoPitch: "推荐套餐、方案时使用。",
    discountHighlight: "优惠点和卖点强化。",
    comfortExplain: "投诉、焦虑语气下优先。",
  },
};

const DEFAULT_CAPABILITY: AvatarModelCapability = {
  modelKey: "generic_avatar",
  modelLabel: "Generic Avatar",
  allowedEmotions: ALL_EMOTIONS,
  allowedGestures: ["none", "nod", "emphasis", "thinking"],
  gestureHints: {
    nod: "基础点头动作。",
    emphasis: "基础强调动作。",
    thinking: "基础思考动作。",
  },
};

export function resolveAvatarModelCapability(modelUrl: string): AvatarModelCapability {
  const normalized = modelUrl.toLowerCase();
  if (normalized.includes("talkinghead/avaturn.glb")) return TALKINGHEAD_AVATURN_CAPABILITY;
  if (normalized.includes("talkinghead/brunette.glb")) return TALKINGHEAD_BRUNETTE_CAPABILITY;
  if (normalized.includes("natori_pro_zh")) return NATORI_CAPABILITY;
  if (normalized.includes("haru_greeter_pro_jp")) return HARU_CAPABILITY;
  return DEFAULT_CAPABILITY;
}
