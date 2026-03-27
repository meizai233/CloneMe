export function createLive2DAdapter(options = {}) {
    const { onStateChange } = options;
    const state = {
        emotion: "neutral",
        speaking: false,
        mouthOpen: 0,
        initialized: false,
        runtime: "mock",
        runtimeError: null
    };
    let pixiApp = null;
    let live2dModel = null;
    let timer = null;
    const emit = () => {
        if (!onStateChange)
            return;
        onStateChange({
            emotion: state.emotion,
            speaking: state.speaking,
            mouthOpen: state.mouthOpen,
            initialized: state.initialized,
            runtime: state.runtime,
            runtimeError: state.runtimeError
        });
    };
    const setModelParameter = (parameterId, value) => {
        live2dModel?.internalModel?.coreModel?.setParameterValueById?.(parameterId, value);
    };
    const applyMouthOpenToModel = (value) => {
        setModelParameter("ParamMouthOpenY", value);
        setModelParameter("PARAM_MOUTH_OPEN_Y", value);
    };
    const applyEmotionToModel = (emotion) => {
        if (!live2dModel)
            return;
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
        if (!pixiApp || !live2dModel)
            return;
        const { width, height } = pixiApp.renderer;
        const scale = Math.min(width / Math.max(1, live2dModel.width), height / Math.max(1, live2dModel.height)) * 0.92;
        live2dModel.scale.set(scale);
        live2dModel.anchor?.set?.(0.5, 1);
        live2dModel.x = width * 0.5;
        live2dModel.y = height * 0.98;
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
    return {
        async init(canvasId) {
            const canvas = canvasId && typeof document !== "undefined"
                ? document.getElementById(canvasId)
                : null;
            const modelUrl = import.meta.env.VITE_LIVE2D_MODEL_URL ??
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
                const [{ Application }, { Live2DModel }] = await Promise.all([
                    import("pixi.js"),
                    import("pixi-live2d-display")
                ]);
                try {
                    pixiApp = new Application({
                        view: canvas,
                        autoStart: true,
                        backgroundAlpha: 0,
                        antialias: true,
                        resizeTo: canvas.parentElement ?? undefined
                    });
                }
                catch {
                    pixiApp = new Application();
                    const appWithInit = pixiApp;
                    await appWithInit.init?.({
                        canvas,
                        autoStart: true,
                        backgroundAlpha: 0,
                        antialias: true,
                        resizeTo: canvas.parentElement ?? undefined
                    });
                }
                live2dModel = await Live2DModel.from(modelUrl, { autoInteract: false });
                if (pixiApp) {
                    pixiApp.stage.addChild(live2dModel);
                    resizeModelToViewport();
                    applyEmotionToModel(state.emotion);
                    state.runtime = "live2d";
                    state.runtimeError = null;
                }
            }
            catch (error) {
                console.error("[Live2D] init failed, fallback to mock runtime.", error);
                state.runtime = "mock";
                state.runtimeError = error instanceof Error ? error.message : "Unknown Live2D init error";
            }
            finally {
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
        destroy() {
            stopLipSync();
            state.speaking = false;
            state.initialized = false;
            live2dModel = null;
            pixiApp?.destroy(true);
            pixiApp = null;
            emit();
        }
    };
}
