import { live2dEmotionProfiles, live2dGestureProfiles } from "./live2dProfiles";

export type AvatarEmotion =
  | "neutral"
  | "happy"
  | "thinking"
  | "excited"
  | "confident"
  | "warm"
  | "serious"
  | "surprised";
export type AvatarRuntime = "live2d" | "talkinghead" | "mock";
export type AvatarGesture =
  | "none"
  | "nod"
  | "emphasis"
  | "thinking"
  | "clap"
  | "openArms"
  | "promoPitch"
  | "discountHighlight"
  | "comfortExplain";
export interface AvatarPose {
  headX: number;
  headY: number;
  bodyX: number;
  bodyY: number;
  eyeX: number;
  eyeY: number;
}

interface Live2DState {
  emotion: AvatarEmotion;
  speaking: boolean;
  mouthOpen: number;
  initialized: boolean;
  runtime: AvatarRuntime;
  runtimeError: string | null;
}

interface CreateLive2DAdapterOptions {
  onStateChange?: (state: Live2DState) => void;
}

export interface Live2DDriver {
  init(canvasTarget?: string | HTMLCanvasElement | null, modelUrlOverride?: string): Promise<void>;
  setEmotion(emotion: AvatarEmotion): void;
  setPose(pose: Partial<AvatarPose>): void;
  playGesture(gesture: AvatarGesture): void;
  setMouthOpen(value: number): void;
  setSpeaking(speaking: boolean): void;
  playLipSync(cues: number[]): () => void;
  runMouthShapeTest?(): void;
  runVowelMouthTest?(): void;
  runTalkingMouthTest?(): void;
  runFullMouthChannelSweep?(): void;
  runChinesePseudoVisemeSequence?(visemes: string[], stepMs?: number): void;
  runGestureShowcase?(): void;
  interruptSpeech?(): void;
  destroy(): void;
}

export function createLive2DAdapter(options: CreateLive2DAdapterOptions = {}): Live2DDriver {
  const { onStateChange } = options;
  const viewportFit = {
    widthRatio: 0.78,
    heightRatio: 0.86,
    centerXRatio: 0.3,
    baselineYRatio: 0.54,
    // Live2D bounds often include large transparent margins.
    // Use a slightly right-shifted focus point inside bounds so visible body stays centered.
    focalXRatio: 0.68,
    focalYRatio: 1
  };
  const viewportHeightRatioRaw = Number(import.meta.env.VITE_LIVE2D_VIEWPORT_HEIGHT_RATIO ?? 0.9);
  const viewportHeightRatio = Number.isFinite(viewportHeightRatioRaw)
    ? Math.min(1.2, Math.max(0.3, viewportHeightRatioRaw))
    : 0.9;
  const scaleRatioRaw = Number(import.meta.env.VITE_LIVE2D_SCALE_RATIO ?? 0.8);
  const scaleRatio = Number.isFinite(scaleRatioRaw) ? Math.min(1.5, Math.max(0.2, scaleRatioRaw)) : 0.8;
  const bottomSafeAreaRatioRaw = Number(import.meta.env.VITE_LIVE2D_BOTTOM_SAFE_AREA_RATIO ?? 0.08);
  const bottomSafeAreaRatio = Number.isFinite(bottomSafeAreaRatioRaw)
    ? Math.min(0.25, Math.max(0, bottomSafeAreaRatioRaw))
    : 0.08;
  const state: Live2DState = {
    emotion: "happy",
    speaking: false,
    mouthOpen: 0,
    initialized: false,
    runtime: "mock",
    runtimeError: null
  };

  let pixiApp: any = null;
  let live2dModel:
    | {
        width: number;
        height: number;
        x: number;
        y: number;
        rotation?: number;
        scale: { set: (value: number) => void };
        anchor?: { set: (x: number, y: number) => void };
        internalModel?: { coreModel?: { setParameterValueById?: (id: string, value: number) => void } };
        expression?: (name: string) => void;
      }
    | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let motionTimer: ReturnType<typeof setInterval> | null = null;
  let gesturePosePulseTimer: ReturnType<typeof setInterval> | null = null;
  let gestureParameterPulseTimer: ReturnType<typeof setInterval> | null = null;
  let gestureTouchedParameterIds = new Set<string>();
  let onResize: (() => void) | null = null;
  let baseTransform = { x: 0, y: 0, scale: 1 };
  let initToken = 0;
  let tickerRegistered = false;
  const semanticPoseTarget: AvatarPose = {
    headX: 0,
    headY: 0,
    bodyX: 0,
    bodyY: 0,
    eyeX: 0,
    eyeY: 0
  };
  const semanticPoseCurrent: AvatarPose = {
    headX: 0,
    headY: 0,
    bodyX: 0,
    bodyY: 0,
    eyeX: 0,
    eyeY: 0
  };
  const gesturePoseTarget: AvatarPose = {
    headX: 0,
    headY: 0,
    bodyX: 0,
    bodyY: 0,
    eyeX: 0,
    eyeY: 0
  };
  const gesturePoseCurrent: AvatarPose = {
    headX: 0,
    headY: 0,
    bodyX: 0,
    bodyY: 0,
    eyeX: 0,
    eyeY: 0
  };

  const emit = () => {
    if (!onStateChange) return;
    onStateChange({
      emotion: state.emotion,
      speaking: state.speaking,
      mouthOpen: state.mouthOpen,
      initialized: state.initialized,
      runtime: state.runtime,
      runtimeError: state.runtimeError
    });
  };

  const setModelParameter = (parameterId: string, value: number) => {
    live2dModel?.internalModel?.coreModel?.setParameterValueById?.(parameterId, value);
  };

  const applyMouthOpenToModel = (value: number) => {
    setModelParameter("ParamMouthOpenY", value);
    setModelParameter("PARAM_MOUTH_OPEN_Y", value);
  };
  const applyParameterSnapshot = (snapshot: Record<string, number> | undefined) => {
    if (!snapshot) return;
    for (const [parameterId, value] of Object.entries(snapshot)) {
      setModelParameter(parameterId, value);
    }
  };

  const clampUnit = (value: number) => Math.min(1, Math.max(-1, value));
  const playModelMotion = (index: number) => {
    (live2dModel as unknown as { motion?: (group: string, index: number) => Promise<unknown> | unknown }).motion?.(
      "",
      index
    );
  };
  const resetGestureTarget = () => {
    gesturePoseTarget.headX = 0;
    gesturePoseTarget.headY = 0;
    gesturePoseTarget.bodyX = 0;
    gesturePoseTarget.bodyY = 0;
    gesturePoseTarget.eyeX = 0;
    gesturePoseTarget.eyeY = 0;
  };
  const resetGestureParameters = () => {
    for (const parameterId of gestureTouchedParameterIds) {
      setModelParameter(parameterId, 0);
    }
    gestureTouchedParameterIds = new Set<string>();
  };
  const stopGestureParameterPulse = () => {
    if (gestureParameterPulseTimer) {
      clearInterval(gestureParameterPulseTimer);
      gestureParameterPulseTimer = null;
    }
    resetGestureParameters();
  };
  const stopGesturePosePulse = () => {
    if (gesturePosePulseTimer) {
      clearInterval(gesturePosePulseTimer);
      gesturePosePulseTimer = null;
    }
    resetGestureTarget();
  };
  const stopGesturePulse = () => {
    stopGesturePosePulse();
    stopGestureParameterPulse();
  };
  const startGesturePosePulse = (frames: Array<Partial<AvatarPose>>, frameMs: number) => {
    stopGesturePosePulse();
    let index = 0;
    gesturePosePulseTimer = setInterval(() => {
      const frame = frames[index];
      if (frame) {
        if (typeof frame.headX === "number") gesturePoseTarget.headX = clampUnit(frame.headX);
        if (typeof frame.headY === "number") gesturePoseTarget.headY = clampUnit(frame.headY);
        if (typeof frame.bodyX === "number") gesturePoseTarget.bodyX = clampUnit(frame.bodyX);
        if (typeof frame.bodyY === "number") gesturePoseTarget.bodyY = clampUnit(frame.bodyY);
        if (typeof frame.eyeX === "number") gesturePoseTarget.eyeX = clampUnit(frame.eyeX);
        if (typeof frame.eyeY === "number") gesturePoseTarget.eyeY = clampUnit(frame.eyeY);
      }
      index += 1;
      if (index >= frames.length) {
        stopGesturePosePulse();
      }
    }, Math.max(70, frameMs));
  };
  const startGestureParameterPulse = (frames: Array<Record<string, number>>, frameMs: number) => {
    stopGestureParameterPulse();
    if (frames.length === 0) return;
    let index = 0;
    gestureParameterPulseTimer = setInterval(() => {
      const frame = frames[index];
      if (frame) {
        for (const [parameterId, value] of Object.entries(frame)) {
          gestureTouchedParameterIds.add(parameterId);
          setModelParameter(parameterId, value);
        }
      }
      index += 1;
      if (index >= frames.length) {
        stopGestureParameterPulse();
      }
    }, Math.max(70, frameMs));
  };

  const stopIdleMotion = () => {
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
    if (motionTimer) {
      clearInterval(motionTimer);
      motionTimer = null;
    }
  };

  const startIdleMotion = () => {
    stopIdleMotion();

    const startedAt = Date.now();
    // Prefer model-authored motions for natural movement. Some models have static index 0,
    // so alternate short motion clips to keep visible idle dynamics.
    playModelMotion(1);
    motionTimer = setInterval(() => {
      const motionIndex = 1 + Math.floor(Math.random() * 26);
      playModelMotion(motionIndex);
    }, 5000);

    idleTimer = setInterval(() => {
      if (!live2dModel) return;

      const t = (Date.now() - startedAt) / 1000;
      const breathing = (Math.sin(t * 1.5) + 1) * 0.5;
      const idleScale = state.speaking ? 0.55 : 1;
      const smoothing = 0.12;
      semanticPoseCurrent.headX += (semanticPoseTarget.headX - semanticPoseCurrent.headX) * smoothing;
      semanticPoseCurrent.headY += (semanticPoseTarget.headY - semanticPoseCurrent.headY) * smoothing;
      semanticPoseCurrent.bodyX += (semanticPoseTarget.bodyX - semanticPoseCurrent.bodyX) * smoothing;
      semanticPoseCurrent.bodyY += (semanticPoseTarget.bodyY - semanticPoseCurrent.bodyY) * smoothing;
      semanticPoseCurrent.eyeX += (semanticPoseTarget.eyeX - semanticPoseCurrent.eyeX) * smoothing;
      semanticPoseCurrent.eyeY += (semanticPoseTarget.eyeY - semanticPoseCurrent.eyeY) * smoothing;
      gesturePoseCurrent.headX += (gesturePoseTarget.headX - gesturePoseCurrent.headX) * 0.26;
      gesturePoseCurrent.headY += (gesturePoseTarget.headY - gesturePoseCurrent.headY) * 0.26;
      gesturePoseCurrent.bodyX += (gesturePoseTarget.bodyX - gesturePoseCurrent.bodyX) * 0.26;
      gesturePoseCurrent.bodyY += (gesturePoseTarget.bodyY - gesturePoseCurrent.bodyY) * 0.26;
      gesturePoseCurrent.eyeX += (gesturePoseTarget.eyeX - gesturePoseCurrent.eyeX) * 0.26;
      gesturePoseCurrent.eyeY += (gesturePoseTarget.eyeY - gesturePoseCurrent.eyeY) * 0.26;

      const headYaw =
        Math.sin(t * 0.9) * 8 * idleScale + (semanticPoseCurrent.headY + gesturePoseCurrent.headY) * 12;
      const headPitch =
        Math.sin(t * 1.15) * 4 * idleScale + (semanticPoseCurrent.headX + gesturePoseCurrent.headX) * 8;
      const bodyYaw =
        Math.sin(t * 0.62) * 5 * idleScale + (semanticPoseCurrent.bodyY + gesturePoseCurrent.bodyY) * 8;
      const bodyLean =
        Math.sin(t * 0.45) * 2 * idleScale + (semanticPoseCurrent.bodyX + gesturePoseCurrent.bodyX) * 6;
      const eyeBallX =
        Math.sin(t * 0.7) * 0.35 * idleScale + (semanticPoseCurrent.eyeX + gesturePoseCurrent.eyeX) * 0.5;
      const eyeBallY =
        Math.sin(t * 1.1) * 0.18 * idleScale + (semanticPoseCurrent.eyeY + gesturePoseCurrent.eyeY) * 0.4;

      setModelParameter("ParamBreath", breathing);
      setModelParameter("PARAM_BREATH", breathing);
      setModelParameter("ParamAngleY", headYaw);
      setModelParameter("PARAM_ANGLE_Y", headYaw);
      setModelParameter("ParamAngleX", headPitch);
      setModelParameter("PARAM_ANGLE_X", headPitch);
      setModelParameter("ParamBodyAngleY", bodyYaw);
      setModelParameter("PARAM_BODY_ANGLE_Y", bodyYaw);
      setModelParameter("ParamBodyAngleX", bodyLean);
      setModelParameter("PARAM_BODY_ANGLE_X", bodyLean);
      setModelParameter("ParamEyeBallX", eyeBallX);
      setModelParameter("PARAM_EYE_BALL_X", eyeBallX);
      setModelParameter("ParamEyeBallY", eyeBallY);
      setModelParameter("PARAM_EYE_BALL_Y", eyeBallY);

      // Keep subtle mouth movement while idle; speaking is controlled by lip-sync cues.
      if (!state.speaking) {
        const idleMouth = 0.03 + Math.max(0, Math.sin(t * 1.5)) * 0.04;
        applyMouthOpenToModel(idleMouth);
      }

      // Soft blink cycle to avoid static gaze.
      const blinkPhase = (Math.sin(t * 2.6) + 1) * 0.5;
      const eyeOpen = blinkPhase > 0.92 ? 0.2 : 1;
      setModelParameter("ParamEyeLOpen", eyeOpen);
      setModelParameter("ParamEyeROpen", eyeOpen);
      setModelParameter("PARAM_EYE_L_OPEN", eyeOpen);
      setModelParameter("PARAM_EYE_R_OPEN", eyeOpen);
    }, 50);
  };

  const applyEmotionToModel = (emotion: AvatarEmotion) => {
    if (!live2dModel) return;

    const baseline = live2dEmotionProfiles.neutral;
    const profile = live2dEmotionProfiles[emotion] ?? baseline;
    live2dModel.expression?.(baseline.expression ?? "F00");
    applyParameterSnapshot(baseline.params);
    live2dModel.expression?.(profile.expression ?? baseline.expression ?? "F00");
    applyParameterSnapshot(profile.params);
  };

  const resizeModelToViewport = () => {
    if (!pixiApp || !live2dModel) return;
    const { width, height } = pixiApp.renderer;
    const canvas = pixiApp.view as HTMLCanvasElement | undefined;
    const canvasCssHeight = Math.max(1, canvas?.clientHeight ?? height);
    const rendererToCssRatio = height / canvasCssHeight;
    const localBounds = (
      live2dModel as unknown as {
        getLocalBounds?: () => { x: number; y: number; width: number; height: number };
      }
    ).getLocalBounds?.();
    const modelWidth = Math.max(1, localBounds?.width ?? live2dModel.width);
    const modelHeight = Math.max(1, localBounds?.height ?? live2dModel.height);
    const usableCanvasCssHeight = canvasCssHeight * (1 - bottomSafeAreaRatio);
    const targetHeightCss = Math.min(window.innerHeight * viewportHeightRatio, usableCanvasCssHeight);
    const targetHeight = Math.max(1, targetHeightCss * rendererToCssRatio);
    const scaleBase = Math.min(
      (width / modelWidth) * viewportFit.widthRatio,
      (targetHeight / modelHeight) * viewportFit.heightRatio
    );
    const scale = scaleBase * scaleRatio;
    live2dModel.scale.set(scale);
    const pivotX = localBounds
      ? localBounds.x + localBounds.width * viewportFit.focalXRatio
      : live2dModel.width * viewportFit.focalXRatio;
    const pivotY = localBounds
      ? localBounds.y + localBounds.height * viewportFit.focalYRatio
      : live2dModel.height * viewportFit.focalYRatio;
    (live2dModel as unknown as { pivot?: { set?: (x: number, y: number) => void } }).pivot?.set?.(
      pivotX,
      pivotY
    );
    baseTransform = {
      x: width * viewportFit.centerXRatio,
      y: height * Math.min(0.98, viewportFit.baselineYRatio + bottomSafeAreaRatio),
      scale
    };
    live2dModel.x = baseTransform.x;
    live2dModel.y = baseTransform.y;
  };

  const stopLipSync = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    state.mouthOpen = 0;
    applyMouthOpenToModel(0);
    emit();
  };

  const cleanupRuntime = () => {
    stopIdleMotion();
    stopGesturePulse();
    stopLipSync();
    if (onResize && typeof window !== "undefined") {
      window.removeEventListener("resize", onResize);
    }
    onResize = null;
    live2dModel = null;
    pixiApp?.destroy(true);
    pixiApp = null;
  };

  return {
    async init(canvasTarget, modelUrlOverride) {
      const token = ++initToken;
      let canvas: HTMLCanvasElement | null = null;
      const canvasId = typeof canvasTarget === "string" ? canvasTarget : null;

      if (canvasTarget instanceof HTMLCanvasElement) {
        canvas = canvasTarget;
      } else if (canvasId && typeof document !== "undefined") {
        canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
      }

      // 在 dev/hot-reload 或复杂布局切换下，canvas 可能晚于 init 一个 tick 挂载；
      // 这里做短暂重试，避免误判为 mock fallback。
      if (!canvas && canvasId && typeof document !== "undefined") {
        for (let attempt = 0; attempt < 20 && !canvas; attempt += 1) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 50);
          });
          if (token !== initToken) {
            return;
          }
          canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
        }
      }

      const modelUrl =
        modelUrlOverride ??
        import.meta.env.VITE_LIVE2D_MODEL_URL ??
        "/models/haru_greeter_pro_jp/runtime/haru_greeter_t05.model3.json";
      if (!canvas || !modelUrl) {
        state.runtime = "mock";
        state.runtimeError = !canvas
          ? "Canvas not found"
          : "VITE_LIVE2D_MODEL_URL is empty";
        state.initialized = true;
        emit();
        return;
      }

      try {
        const [{ Application, Ticker }, { Live2DModel }] = await Promise.all([
          import("pixi.js"),
          import("pixi-live2d-display/cubism4")
        ]);

        if (token !== initToken) {
          return;
        }

        if (!tickerRegistered && Ticker) {
          Live2DModel.registerTicker(Ticker as unknown as never);
          tickerRegistered = true;
        }

        cleanupRuntime();

        const devicePixelRatio =
          typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
        const appOptions = {
          autoStart: true,
          backgroundAlpha: 0,
          antialias: true,
          resizeTo: canvas.parentElement ?? undefined,
          resolution: devicePixelRatio,
          autoDensity: true,
          eventMode: 'none' as const,
          eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
        };

        let nextApp: any = null;
        try {
          nextApp = new Application({
            view: canvas,
            ...appOptions
          } as never);
        } catch {
          nextApp = new Application();
          const appWithInit = nextApp as unknown as { init?: (options: unknown) => Promise<void> };
          await appWithInit.init?.({
            canvas,
            ...appOptions
          });
        }

        const nextModel = await Live2DModel.from(modelUrl, { autoInteract: false });
        // 禁用模型的交互事件，避免 pixi v7 EventBoundary.isInteractive 兼容问题
        (nextModel as unknown as { interactive?: boolean; interactiveChildren?: boolean }).interactive = false;
        (nextModel as unknown as { interactive?: boolean; interactiveChildren?: boolean }).interactiveChildren = false;
        // pixi v7.3+ 使用 eventMode 替代 interactive
        (nextModel as unknown as { eventMode?: string }).eventMode = 'none';
        if (token !== initToken) {
          nextApp?.destroy(true);
          return;
        }
        pixiApp = nextApp;
        live2dModel = nextModel;
        (live2dModel as unknown as { autoUpdate?: boolean }).autoUpdate = true;
        if (nextApp) {
          nextApp.stage.addChild(nextModel);
          resizeModelToViewport();
          if (typeof window !== "undefined") {
            window.requestAnimationFrame(() => resizeModelToViewport());
            window.setTimeout(() => resizeModelToViewport(), 120);
          }
          onResize = () => resizeModelToViewport();
          if (typeof window !== "undefined") {
            window.addEventListener("resize", onResize);
          }
          applyEmotionToModel(state.emotion);
          startIdleMotion();
          state.runtime = "live2d";
          state.runtimeError = null;
        }
      } catch (error) {
        console.error("[Live2D] init failed, fallback to mock runtime.", error);
        state.runtime = "mock";
        state.runtimeError = error instanceof Error ? error.message : "Unknown Live2D init error";
      } finally {
        state.initialized = true;
        emit();
      }
    },
    setEmotion(emotion) {
      state.emotion = emotion;
      applyEmotionToModel(emotion);
      emit();
    },
    setPose(pose) {
      if (typeof pose.headX === "number") semanticPoseTarget.headX = clampUnit(pose.headX);
      if (typeof pose.headY === "number") semanticPoseTarget.headY = clampUnit(pose.headY);
      if (typeof pose.bodyX === "number") semanticPoseTarget.bodyX = clampUnit(pose.bodyX);
      if (typeof pose.bodyY === "number") semanticPoseTarget.bodyY = clampUnit(pose.bodyY);
      if (typeof pose.eyeX === "number") semanticPoseTarget.eyeX = clampUnit(pose.eyeX);
      if (typeof pose.eyeY === "number") semanticPoseTarget.eyeY = clampUnit(pose.eyeY);
    },
    playGesture(gesture) {
      if (!live2dModel || gesture === "none") return;
      const profile = live2dGestureProfiles[gesture];
      if (!profile) return;
      if (typeof profile.motionIndex === "number") {
        playModelMotion(profile.motionIndex);
      }
      const frameMs = Math.max(70, profile.frameMs ?? 120);
      if (profile.poseFrames && profile.poseFrames.length > 0) {
        startGesturePosePulse(profile.poseFrames, frameMs);
      } else {
        stopGesturePosePulse();
      }
      if (profile.parameterFrames && profile.parameterFrames.length > 0) {
        startGestureParameterPulse(profile.parameterFrames, frameMs);
      } else {
        stopGestureParameterPulse();
      }
    },
    setMouthOpen(value) {
      state.mouthOpen = Math.min(1, Math.max(0, value));
      applyMouthOpenToModel(state.mouthOpen);
      emit();
    },
    setSpeaking(speaking) {
      state.speaking = speaking;
      if (!speaking) {
        stopLipSync();
        return;
      }
      emit();
    },
    playLipSync(cues) {
      stopLipSync();

      if (cues.length === 0) {
        return stopLipSync;
      }

      let index = 0;
      timer = setInterval(() => {
        state.mouthOpen = Math.min(1, Math.max(0, cues[index] ?? 0));
        applyMouthOpenToModel(state.mouthOpen);
        emit();
        index += 1;
        if (index >= cues.length) {
          index = 0;
        }
      }, 90);

      return stopLipSync;
    },
    runMouthShapeTest() {
      const demo = [0.08, 0.18, 0.35, 0.65, 0.9, 0.55, 0.25, 0.05];
      let index = 0;
      stopLipSync();
      state.speaking = true;
      emit();
      timer = setInterval(() => {
        state.mouthOpen = demo[index] ?? 0;
        applyMouthOpenToModel(state.mouthOpen);
        emit();
        index += 1;
        if (index >= demo.length) {
          stopLipSync();
          state.speaking = false;
          emit();
        }
      }, 220);
    },
    runVowelMouthTest() {
      stopLipSync();
      state.speaking = true;
      emit();
      const vowels = [0.78, 0.46, 0.34, 0.62, 0.52, 0.18];
      let index = 0;
      timer = setInterval(() => {
        state.mouthOpen = vowels[index] ?? 0;
        applyMouthOpenToModel(state.mouthOpen);
        emit();
        index += 1;
        if (index >= vowels.length) {
          stopLipSync();
          state.speaking = false;
          emit();
        }
      }, 300);
    },
    runTalkingMouthTest() {
      stopLipSync();
      state.speaking = true;
      emit();
      const scriptLikeCues = [0.06, 0.22, 0.48, 0.18, 0.65, 0.12, 0.38, 0.71, 0.2, 0.44, 0.08, 0.31, 0.58, 0.14];
      let index = 0;
      timer = setInterval(() => {
        state.mouthOpen = scriptLikeCues[index] ?? 0;
        applyMouthOpenToModel(state.mouthOpen);
        emit();
        index += 1;
        if (index >= scriptLikeCues.length) {
          stopLipSync();
          state.speaking = false;
          emit();
        }
      }, 130);
    },
    runGestureShowcase() {
      const sequence: Array<Exclude<AvatarGesture, "none">> = [
        "nod",
        "emphasis",
        "thinking",
        "openArms",
        "promoPitch",
        "comfortExplain",
        "clap",
      ];
      sequence.forEach((gesture, idx) => {
        setTimeout(() => {
          if (!live2dModel) return;
          const profile = live2dGestureProfiles[gesture];
          if (!profile) return;
          if (typeof profile.motionIndex === "number") {
            playModelMotion(profile.motionIndex);
          }
        }, idx * 900);
      });
    },
    destroy() {
      initToken += 1;
      cleanupRuntime();
      state.speaking = false;
      state.initialized = false;
      emit();
    }
  };
}
