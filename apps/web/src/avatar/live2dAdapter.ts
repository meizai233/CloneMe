export type AvatarEmotion = "neutral" | "happy" | "thinking";
export type AvatarRuntime = "live2d" | "mock";

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
  init(canvasId?: string): Promise<void>;
  setEmotion(emotion: AvatarEmotion): void;
  setSpeaking(speaking: boolean): void;
  setMouthOpen(value: number): void;
  playLipSync(cues: number[]): () => void;
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
  let speakingMotionTimer: ReturnType<typeof setInterval> | null = null;
  let onResize: (() => void) | null = null;
  let baseTransform = { x: 0, y: 0, scale: 1 };
  let initToken = 0;
  let tickerRegistered = false;

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

  const stopSpeakingMotion = () => {
    if (speakingMotionTimer) {
      clearInterval(speakingMotionTimer);
      speakingMotionTimer = null;
    }
  };

  const startSpeakingMotion = () => {
    stopSpeakingMotion();
    const playMotion = (index: number) => {
      (live2dModel as unknown as { motion?: (group: string, index: number) => Promise<unknown> | unknown })
        .motion?.("", index);
    };
    playMotion(0);
    speakingMotionTimer = setInterval(() => {
      const motionIndex = Math.floor(Math.random() * 6);
      playMotion(motionIndex);
    }, 2200);
  };

  const startIdleMotion = () => {
    stopIdleMotion();

    const startedAt = Date.now();
    const playMotion = (index: number) => {
      (live2dModel as unknown as { motion?: (group: string, index: number) => Promise<unknown> | unknown })
        .motion?.("", index);
    };
    // Prefer model-authored motions for natural movement. Some models have static index 0,
    // so alternate short motion clips to keep visible idle dynamics.
    playMotion(1);
    motionTimer = setInterval(() => {
      const motionIndex = 1 + Math.floor(Math.random() * 26);
      playMotion(motionIndex);
    }, 5000);

    idleTimer = setInterval(() => {
      if (!live2dModel) return;

      const t = (Date.now() - startedAt) / 1000;
      const breathing = (Math.sin(t * 1.5) + 1) * 0.5;
      const headYaw = Math.sin(t * 0.9) * 8;
      const headPitch = Math.sin(t * 1.15) * 4;
      const bodyYaw = Math.sin(t * 0.62) * 5;
      const bodyLean = Math.sin(t * 0.45) * 2;
      const eyeBallX = Math.sin(t * 0.7) * 0.35;
      const eyeBallY = Math.sin(t * 1.1) * 0.18;

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

    if (emotion === "happy") {
      live2dModel.expression?.("F01");
      setModelParameter("ParamEyeSmile", 0.6);
      setModelParameter("ParamMouthForm", 0.7);
      return;
    }

    if (emotion === "thinking") {
      live2dModel.expression?.("F02");
      setModelParameter("ParamBrowLY", -0.35);
      setModelParameter("ParamBrowRY", -0.35);
      return;
    }

    live2dModel.expression?.("F00");
    setModelParameter("ParamEyeSmile", 0);
    setModelParameter("ParamMouthForm", 0);
    setModelParameter("ParamBrowLY", 0);
    setModelParameter("ParamBrowRY", 0);
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
    stopSpeakingMotion();
    stopIdleMotion();
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
    async init(canvasId) {
      const token = ++initToken;
      const canvas =
        canvasId && typeof document !== "undefined"
          ? (document.getElementById(canvasId) as HTMLCanvasElement | null)
          : null;

      const modelUrl =
        import.meta.env.VITE_LIVE2D_MODEL_URL ??
        "/models/haru_greeter_pro_jp/runtime/haru_greeter_t05.model3.json";
      if (!canvas || !modelUrl) {
        state.runtime = "mock";
        state.runtimeError = !canvas
          ? "Canvas not found: avatar-canvas"
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
          Live2DModel.registerTicker(Ticker);
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
          autoDensity: true
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
    setSpeaking(speaking) {
      state.speaking = speaking;
      if (!speaking) {
        stopSpeakingMotion();
        startIdleMotion();
        stopLipSync();
        emit();
        return;
      }
      stopIdleMotion();
      startSpeakingMotion();
      emit();
    },
    setMouthOpen(value) {
      state.mouthOpen = Math.min(1, Math.max(0, value));
      applyMouthOpenToModel(state.mouthOpen);
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
    destroy() {
      initToken += 1;
      cleanupRuntime();
      state.speaking = false;
      state.initialized = false;
      emit();
    }
  };
}
