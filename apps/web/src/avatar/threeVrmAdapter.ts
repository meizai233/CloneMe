import type { AvatarDriver, AvatarEmotion, AvatarState } from "./types";

interface CreateThreeVrmAdapterOptions {
  onStateChange?: (state: AvatarState) => void;
}

type ThreeContext = {
  renderer: any;
  scene: any;
  camera: any;
  clock: any;
  vrm: any;
};

const EMOTION_TO_VRM: Record<AvatarEmotion, string> = {
  neutral: "neutral",
  happy: "happy",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  thinking: "relaxed"
};

const EXPRESSION_PRESETS = ["neutral", "happy", "sad", "angry", "surprised", "relaxed"];
const MOUTH_KEYS = ["aa", "ih", "ou", "ee", "oh", "A", "I", "U", "E", "O"];

export function createThreeVrmAdapter(options: CreateThreeVrmAdapterOptions = {}): AvatarDriver {
  const { onStateChange } = options;
  const state: AvatarState = {
    emotion: "happy",
    speaking: false,
    mouthOpen: 0,
    initialized: false,
    runtime: "mock",
    runtimeError: null
  };

  let context: ThreeContext | null = null;
  let lipSyncTimer: ReturnType<typeof setInterval> | null = null;
  let initToken = 0;
  let previousFrameAt = 0;

  const emit = () => {
    onStateChange?.({ ...state });
  };

  const stopLipSync = () => {
    if (lipSyncTimer) {
      clearInterval(lipSyncTimer);
      lipSyncTimer = null;
    }
    state.mouthOpen = 0;
    applyMouth(state.mouthOpen);
    emit();
  };

  const setExpression = (name: string, value: number) => {
    const vrm = context?.vrm;
    if (!vrm) return;
    vrm.expressionManager?.setValue(name, value);
    vrm.blendShapeProxy?.setValue(name, value);
  };

  const resetExpression = () => {
    for (const preset of EXPRESSION_PRESETS) {
      setExpression(preset, 0);
    }
  };

  const applyEmotion = (emotion: AvatarEmotion) => {
    resetExpression();
    const preset = EMOTION_TO_VRM[emotion] ?? "neutral";
    setExpression(preset, 1);

    // "thinking" is approximated by a neutral face + slight head tilt.
    if (context?.vrm?.scene) {
      context.vrm.scene.rotation.y = emotion === "thinking" ? 0.08 : 0;
    }
  };

  const applyMouth = (value: number) => {
    for (const key of MOUTH_KEYS) {
      setExpression(key, key === "aa" || key === "A" ? value : value * 0.2);
    }
    context?.vrm?.expressionManager?.update?.();
    context?.vrm?.blendShapeProxy?.update?.();
  };

  const resize = () => {
    if (!context) return;
    const canvas = context.renderer.domElement;
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    context.renderer.setSize(width, height, false);
    context.camera.aspect = width / height;
    context.camera.updateProjectionMatrix();
  };

  const destroyContext = () => {
    stopLipSync();
    context?.renderer.dispose();
    context = null;
    previousFrameAt = 0;
  };

  return {
    async init(canvasId?: string) {
      const token = ++initToken;
      destroyContext();

      const canvas =
        canvasId && typeof document !== "undefined"
          ? (document.getElementById(canvasId) as HTMLCanvasElement | null)
          : null;
      const modelUrl = import.meta.env.VITE_VRM_MODEL_URL ?? "/models/avatar.vrm";

      if (!canvas || !modelUrl) {
        state.runtime = "mock";
        state.runtimeError = !canvas ? "Canvas not found: avatar-canvas" : "VITE_VRM_MODEL_URL is empty";
        state.initialized = true;
        emit();
        return;
      }

      try {
        const [{ Clock, DirectionalLight, PerspectiveCamera, Scene, WebGLRenderer }, { GLTFLoader }, vrmPkg] =
          await Promise.all([
            import("three"),
            import("three/examples/jsm/loaders/GLTFLoader.js"),
            import("@pixiv/three-vrm")
          ]);

        if (token !== initToken) return;

        const { VRMLoaderPlugin, VRMUtils } = vrmPkg as unknown as {
          VRMLoaderPlugin: new (parser: unknown) => unknown;
          VRMUtils: { removeUnnecessaryVertices?: (obj: unknown) => void; removeUnnecessaryJoints?: (obj: unknown) => void };
        };

        const scene = new Scene();
        const camera = new PerspectiveCamera(30, 1, 0.1, 1000);
        camera.position.set(0, 1.35, 2.2);
        const keyLight = new DirectionalLight(0xffffff, 1.15);
        keyLight.position.set(1, 1, 1);
        scene.add(keyLight);

        const renderer = new WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

        const loader = new GLTFLoader();
        loader.register(((parser: unknown) => new VRMLoaderPlugin(parser)) as any);

        const gltf = await new Promise<unknown>((resolve, reject) => {
          loader.load(modelUrl, resolve, undefined, reject);
        });

        if (token !== initToken) {
          renderer.dispose();
          return;
        }

        const gltfData = gltf as { scene?: unknown; userData?: { vrm?: ThreeContext["vrm"] } };
        const vrm = gltfData.userData?.vrm;
        if (!vrm) {
          throw new Error("VRM parse failed");
        }

        // VRMUtils expects an Object3D root (with traverse), not the whole glTF wrapper.
        const root = gltfData.scene ?? vrm.scene;
        VRMUtils.removeUnnecessaryVertices?.(root);
        VRMUtils.removeUnnecessaryJoints?.(root);

        vrm.scene.rotation.y = Math.PI;
        vrm.scene.position.set(0, -1, 0);
        scene.add(vrm.scene);

        context = {
          renderer,
          scene,
          camera,
          clock: new Clock(),
          vrm
        };

        resize();
        applyEmotion(state.emotion);
        applyMouth(0);

        state.runtime = "three-vrm";
        state.runtimeError = null;
      } catch (error) {
        console.error("[ThreeVRM] init failed, fallback to mock runtime.", error);
        state.runtime = "mock";
        state.runtimeError = error instanceof Error ? error.message : "Unknown Three.js VRM init error";
      } finally {
        state.initialized = true;
        emit();
      }
    },
    resize,
    render(deltaMs) {
      if (!context) return;
      const now = Date.now();
      const computedDelta = previousFrameAt > 0 ? (now - previousFrameAt) / 1000 : context.clock.getDelta();
      previousFrameAt = now;
      const delta = typeof deltaMs === "number" ? Math.max(0.001, deltaMs / 1000) : Math.max(0.001, computedDelta);

      context.vrm.update(delta);
      if (!state.speaking && state.mouthOpen > 0) {
        state.mouthOpen = Math.max(0, state.mouthOpen - delta * 1.8);
        applyMouth(state.mouthOpen);
      }
      context.renderer.render(context.scene, context.camera);
    },
    setEmotion(emotion) {
      state.emotion = emotion;
      applyEmotion(emotion);
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
      if (cues.length === 0) return stopLipSync;

      let index = 0;
      lipSyncTimer = setInterval(() => {
        state.mouthOpen = Math.min(1, Math.max(0, cues[index] ?? 0));
        applyMouth(state.mouthOpen);
        emit();
        index = (index + 1) % cues.length;
      }, 90);

      return stopLipSync;
    },
    destroy() {
      initToken += 1;
      destroyContext();
      state.initialized = false;
      state.speaking = false;
      emit();
    }
  };
}
