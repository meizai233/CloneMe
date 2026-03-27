import type { AvatarEmotion, AvatarGesture } from "./live2dAdapter";

export interface Live2DEmotionProfile {
  expression?: string;
  params: Record<string, number>;
}

export interface Live2DGestureProfile {
  motionIndex?: number;
  frameMs?: number;
  poseFrames?: Array<
    Partial<{
      headX: number;
      headY: number;
      bodyX: number;
      bodyY: number;
      eyeX: number;
      eyeY: number;
    }>
  >;
  parameterFrames?: Array<Record<string, number>>;
}

export const live2dEmotionProfiles: Record<AvatarEmotion, Live2DEmotionProfile> = {
  neutral: {
    expression: "F00",
    params: {
      ParamEyeLSmile: 0,
      ParamEyeRSmile: 0,
      ParamMouthForm: 0,
      ParamBrowLY: 0,
      ParamBrowRY: 0,
      ParamBrowLAngle: 0,
      ParamBrowRAngle: 0,
      ParamTere: 0,
      ParamTear: 0
    }
  },
  happy: {
    expression: "F01",
    params: {
      ParamEyeLSmile: 0.55,
      ParamEyeRSmile: 0.55,
      ParamMouthForm: 0.72,
      ParamBrowLY: 0.08,
      ParamBrowRY: 0.08,
      ParamTere: 0.16
    }
  },
  thinking: {
    expression: "F02",
    params: {
      ParamBrowLY: -0.35,
      ParamBrowRY: -0.35,
      ParamBrowLAngle: -0.12,
      ParamBrowRAngle: -0.12,
      ParamMouthForm: -0.08
    }
  },
  excited: {
    expression: "F01",
    params: {
      ParamEyeLSmile: 0.7,
      ParamEyeRSmile: 0.7,
      ParamMouthForm: 0.9,
      ParamFaceForm: 0.2,
      ParamBrowLY: 0.14,
      ParamBrowRY: 0.14,
      ParamTere: 0.25
    }
  },
  confident: {
    expression: "F01",
    params: {
      ParamMouthForm: 0.5,
      ParamBrowLAngle: 0.18,
      ParamBrowRAngle: 0.18,
      ParamBrowLY: 0.06,
      ParamBrowRY: 0.06,
      ParamEyeBallForm: 0.1
    }
  },
  warm: {
    expression: "F01",
    params: {
      ParamEyeLSmile: 0.42,
      ParamEyeRSmile: 0.42,
      ParamMouthForm: 0.35,
      ParamBrowLY: 0.03,
      ParamBrowRY: 0.03
    }
  },
  serious: {
    expression: "F00",
    params: {
      ParamEyeLSmile: 0,
      ParamEyeRSmile: 0,
      ParamMouthForm: -0.25,
      ParamBrowLY: -0.18,
      ParamBrowRY: -0.18,
      ParamBrowLAngle: -0.15,
      ParamBrowRAngle: -0.15
    }
  },
  surprised: {
    expression: "F00",
    params: {
      ParamEyeLOpen: 1,
      ParamEyeROpen: 1,
      ParamMouthOpenY: 0.28,
      ParamMouthForm: 0.15,
      ParamBrowLY: 0.28,
      ParamBrowRY: 0.28,
      ParamBrowLAngle: 0.18,
      ParamBrowRAngle: 0.18
    }
  }
};

export const live2dGestureProfiles: Partial<Record<Exclude<AvatarGesture, "none">, Live2DGestureProfile>> = {
  nod: {
    motionIndex: 2,
    frameMs: 120,
    poseFrames: [{ headX: 0.25 }, { headX: -0.2 }, { headX: 0.1 }]
  },
  emphasis: {
    motionIndex: 4,
    frameMs: 110,
    poseFrames: [{ headY: 0.2, bodyY: 0.16 }, { headY: -0.12, bodyY: -0.08 }, { headY: 0.05 }]
  },
  thinking: {
    motionIndex: 3,
    frameMs: 160,
    poseFrames: [{ headX: 0.14, headY: -0.1, eyeY: -0.08 }, { headX: 0.06, headY: -0.03, eyeY: -0.02 }]
  },
  clap: {
    motionIndex: 9,
    frameMs: 95,
    parameterFrames: [
      { ParamArmLA: 0.5, ParamArmRA: 0.5, ParamHandAngleL: 0.22, ParamHandAngleR: -0.22 },
      { ParamArmLA: 0.86, ParamArmRA: 0.86, ParamHandAngleL: 0.04, ParamHandAngleR: -0.04 },
      { ParamArmLA: 0.52, ParamArmRA: 0.52, ParamHandAngleL: 0.18, ParamHandAngleR: -0.18 }
    ]
  },
  openArms: {
    motionIndex: 11,
    frameMs: 120,
    parameterFrames: [
      { ParamArmLA: -0.4, ParamArmRA: 0.4, ParamBodyUpper: 0.08 },
      { ParamArmLA: -0.7, ParamArmRA: 0.7, ParamBodyUpper: 0.16 },
      { ParamArmLA: -0.35, ParamArmRA: 0.35, ParamBodyUpper: 0.06 }
    ]
  },
  promoPitch: {
    motionIndex: 14,
    frameMs: 105,
    poseFrames: [
      { headY: 0.22, bodyY: 0.2, eyeX: 0.1 },
      { headY: -0.1, bodyY: -0.08, eyeX: -0.08 },
      { headY: 0.18, bodyY: 0.15 }
    ],
    parameterFrames: [
      { ParamBodyUpper: 0.2, ParamScarf: 0.28, ParamHairFront: 0.16 },
      { ParamBodyUpper: 0.08, ParamScarf: -0.12, ParamHairFront: -0.08 },
      { ParamBodyUpper: 0.15, ParamScarf: 0.2, ParamHairFront: 0.12 }
    ]
  },
  discountHighlight: {
    motionIndex: 18,
    frameMs: 100,
    poseFrames: [{ headX: 0.06, headY: 0.18 }, { headX: -0.04, headY: -0.12 }, { headX: 0.03, headY: 0.1 }],
    parameterFrames: [
      { ParamHandChangeR: 1, ParamHandAngleR: -0.52, ParamBrowLAngle: 0.22, ParamBrowRAngle: 0.22 },
      { ParamHandChangeR: 1, ParamHandAngleR: -0.2, ParamBrowLAngle: 0.08, ParamBrowRAngle: 0.08 },
      { ParamHandChangeR: 1, ParamHandAngleR: -0.45, ParamBrowLAngle: 0.18, ParamBrowRAngle: 0.18 }
    ]
  },
  comfortExplain: {
    motionIndex: 21,
    frameMs: 135,
    poseFrames: [{ headX: -0.08, eyeY: -0.06 }, { headX: 0.05, eyeY: -0.04 }, { headX: -0.04, eyeY: -0.02 }],
    parameterFrames: [
      { ParamArmLB: 0.35, ParamArmRB: -0.28, ParamBodyUpper: -0.08, ParamHairSide: 0.12 },
      { ParamArmLB: 0.18, ParamArmRB: -0.16, ParamBodyUpper: -0.04, ParamHairSide: -0.04 },
      { ParamArmLB: 0.3, ParamArmRB: -0.22, ParamBodyUpper: -0.06, ParamHairSide: 0.08 }
    ]
  }
};
