import type { AvatarEmotion, AvatarGesture } from "./live2dAdapter";
import type { PersonaMode } from "../services/api";

export interface AvatarIntroSegment {
  text: string;
  emotion: AvatarEmotion;
  gesture: AvatarGesture;
  cues: number[];
  durationMs: number;
}

export interface AvatarIntroScript {
  avatarName: string;
  segments: AvatarIntroSegment[];
}

export const avatarIntroScripts: Partial<Record<PersonaMode, AvatarIntroScript>> = {
  support: {
    avatarName: "哈小啰",
    segments: [
      {
        text: "（卡顿音效） 嗨，我是哈小啰，刚开机有点卡。",
        emotion: "thinking",
        gesture: "thinking",
        cues: [0.05, 0.25, 0.1, 0.35, 0.12, 0.28],
        durationMs: 2300
      },
      {
        text: "（清晰流畅） （拍手，挺胸） 调试完成！哈小啰正式上线，哈啰数字人到位。",
        emotion: "excited",
        gesture: "promoPitch",
        cues: [0.2, 0.7, 0.45, 0.8, 0.35, 0.62],
        durationMs: 3200
      },
      {
        text: "（语速稍快） 哈啰租电动车，主打一个“按头安利”！不论你是打工人要通勤便捷，还是骑手兄弟跑单要换电？各种车型一应俱全！全国门店超5000家，可以轻松找到附近电动车租赁点，享受高品质的电动车租赁服务。",
        emotion: "confident",
        gesture: "discountHighlight",
        cues: [0.35, 0.82, 0.52, 0.68, 0.42, 0.78],
        durationMs: 5600
      },
      {
        text: "（夸张热情） 钱包告急？别急着买车！日租、周租、月租，租多久你说了算。主打一个“灵活多变”，省下的钱买奶茶不香吗？赶紧上车！",
        emotion: "warm",
        gesture: "comfortExplain",
        cues: [0.4, 0.88, 0.55, 0.72, 0.35, 0.8],
        durationMs: 4600
      }
    ]
  }
};
