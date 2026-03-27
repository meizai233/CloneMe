import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createLive2DAdapter } from "./avatar/live2dAdapter";
import { chatWithAvatar, initAvatarProfile } from "./services/api";
const modeLabels = {
    teacher: "老师模式",
    friend: "朋友模式",
    support: "客服模式"
};
function buildOfflineReply(question, mode) {
    const modePrefix = {
        teacher: "老师模式建议",
        friend: "朋友模式建议",
        support: "客服模式建议"
    };
    return `${modePrefix[mode]}：当前网络异常，先给你一版离线演示回答。关于“${question}”，建议先拆成学习目标、周计划和复盘机制三步推进。`;
}
function Avatar2D(props) {
    const { speaking, emotion, mouthOpen, ready, runtime, runtimeError } = props;
    const emotionClass = `emotion-${emotion}`;
    const usingLive2D = runtime === "live2d";
    return (_jsxs("div", { className: `avatar-card ${emotionClass}`, children: [_jsxs("div", { className: "avatar-stage", children: [_jsx("canvas", { id: "avatar-canvas", className: `avatar-canvas ${usingLive2D ? "visible" : ""}` }), !usingLive2D && (_jsxs("div", { className: "avatar-face", children: [_jsxs("div", { className: "eyes", children: [_jsx("span", {}), _jsx("span", {})] }), _jsx("div", { className: `mouth ${speaking ? "speaking" : ""}`, style: { transform: `scaleY(${0.65 + mouthOpen * 0.85})` } })] }))] }), _jsxs("p", { className: "avatar-runtime", children: ["\u6E32\u67D3\u6A21\u5F0F\uFF1A", usingLive2D ? "Live2D Runtime" : "Mock Fallback"] }), !usingLive2D && runtimeError && _jsxs("p", { className: "avatar-runtime-error", children: ["Live2D \u9519\u8BEF\uFF1A", runtimeError] }), _jsxs("p", { className: "avatar-status", children: ["\u72B6\u6001\uFF1A", ready ? "模型已就绪" : "模型加载中", " /", " ", emotion === "thinking" ? "思考中" : emotion === "happy" ? "愉快" : "自然", " /", " ", speaking ? "播报中" : "待机"] })] }));
}
export default function App() {
    const adapterRef = useRef(null);
    const audioRef = useRef(null);
    const stopLipSyncRef = useRef(null);
    const fallbackTimerRef = useRef(null);
    const lastActionRef = useRef(null);
    const [mode, setMode] = useState("teacher");
    const [docsInput, setDocsInput] = useState("React 性能优化优先做拆分、memo、减少无意义重渲染。\nTypeScript 项目中优先给 API 返回体建立显式类型。");
    const [question, setQuestion] = useState("怎么系统学习前端工程化？");
    const [answer, setAnswer] = useState("欢迎使用 CloneMe。先上传内容，再开始提问。");
    const [references, setReferences] = useState([]);
    const [emotion, setEmotion] = useState("neutral");
    const [runtime, setRuntime] = useState("mock");
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [mouthOpen, setMouthOpen] = useState(0);
    const [initLoading, setInitLoading] = useState(false);
    const [chatLoading, setChatLoading] = useState(false);
    const [avatarReady, setAvatarReady] = useState(false);
    const [avatarRuntimeError, setAvatarRuntimeError] = useState(null);
    const [errorMessage, setErrorMessage] = useState(null);
    const loading = initLoading || chatLoading;
    const statusLabel = initLoading ? "初始化中" : chatLoading ? "思考中" : isSpeaking ? "播报中" : "待机";
    const docs = useMemo(() => docsInput
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean), [docsInput]);
    const cleanupPlayback = useCallback(() => {
        if (fallbackTimerRef.current) {
            clearTimeout(fallbackTimerRef.current);
            fallbackTimerRef.current = null;
        }
        if (audioRef.current) {
            audioRef.current.onplay = null;
            audioRef.current.onended = null;
            audioRef.current.onerror = null;
            audioRef.current.pause();
            audioRef.current = null;
        }
        if (stopLipSyncRef.current) {
            stopLipSyncRef.current();
            stopLipSyncRef.current = null;
        }
        adapterRef.current?.setSpeaking(false);
    }, []);
    useEffect(() => {
        const adapter = createLive2DAdapter({
            onStateChange(state) {
                setEmotion(state.emotion);
                setRuntime(state.runtime);
                setIsSpeaking(state.speaking);
                setMouthOpen(state.mouthOpen);
                setAvatarReady(state.initialized);
                setAvatarRuntimeError(state.runtimeError);
            }
        });
        adapterRef.current = adapter;
        void adapter.init("avatar-canvas");
        return () => {
            cleanupPlayback();
            adapter.destroy();
            adapterRef.current = null;
        };
    }, [cleanupPlayback]);
    const playAnswerAudio = useCallback(async (audioUrl, cues) => {
        cleanupPlayback();
        const adapter = adapterRef.current;
        if (!adapter || !audioUrl) {
            throw new Error("音频不可用");
        }
        stopLipSyncRef.current = adapter.playLipSync(cues);
        const audio = new Audio(audioUrl);
        audioRef.current = audio;
        audio.onplay = () => adapter.setSpeaking(true);
        audio.onended = () => cleanupPlayback();
        audio.onerror = () => cleanupPlayback();
        await audio.play();
    }, [cleanupPlayback]);
    const runInitAvatar = useCallback(async () => {
        setInitLoading(true);
        setErrorMessage(null);
        try {
            await initAvatarProfile({
                creatorName: "CloneMe Demo 博主",
                domain: "前端工程",
                docs
            });
            setAnswer("分身初始化完成。现在可以提问，我会按你选的模式回答。");
            setReferences([]);
            adapterRef.current?.setEmotion("happy");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setErrorMessage(message);
            setAnswer(`初始化失败：${message}`);
            setReferences(["离线演示可继续：直接点击开始提问"]);
        }
        finally {
            setInitLoading(false);
        }
    }, [docs]);
    async function initAvatar() {
        lastActionRef.current = runInitAvatar;
        await runInitAvatar();
    }
    const runAsk = useCallback(async () => {
        setChatLoading(true);
        setErrorMessage(null);
        cleanupPlayback();
        const safeQuestion = question.trim();
        if (!safeQuestion) {
            setChatLoading(false);
            setErrorMessage("请输入问题后再提问");
            return;
        }
        try {
            const data = await chatWithAvatar({
                userQuestion: safeQuestion,
                mode
            });
            setAnswer(data.reply);
            setReferences(data.references);
            adapterRef.current?.setEmotion(data.emotion);
            try {
                await playAnswerAudio(data.audioUrl, data.phonemeCues);
            }
            catch {
                setErrorMessage("语音播放失败，已回退到离线口型演示。");
                const fallbackCues = data.phonemeCues.length > 0 ? data.phonemeCues : [0.2, 0.7, 0.3, 0.9];
                stopLipSyncRef.current = adapterRef.current?.playLipSync(fallbackCues) ?? null;
                adapterRef.current?.setSpeaking(true);
                fallbackTimerRef.current = setTimeout(() => {
                    cleanupPlayback();
                }, Math.max(1200, fallbackCues.length * 120));
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setErrorMessage(`${message}，已启用离线演示回答。`);
            setAnswer(buildOfflineReply(safeQuestion, mode));
            setReferences(["离线演示兜底回答"]);
            adapterRef.current?.setEmotion("thinking");
            stopLipSyncRef.current = adapterRef.current?.playLipSync([0.2, 0.7, 0.35, 0.8, 0.25, 0.65]) ?? null;
            adapterRef.current?.setSpeaking(true);
            fallbackTimerRef.current = setTimeout(() => {
                adapterRef.current?.setEmotion("neutral");
                cleanupPlayback();
            }, 1500);
        }
        finally {
            setChatLoading(false);
        }
    }, [cleanupPlayback, mode, playAnswerAudio, question]);
    async function onAsk(event) {
        event.preventDefault();
        lastActionRef.current = runAsk;
        await runAsk();
    }
    async function retryLastAction() {
        if (!lastActionRef.current)
            return;
        await lastActionRef.current();
    }
    return (_jsxs("main", { className: "layout", children: [_jsxs("section", { className: "panel", children: [_jsx("h1", { children: "CloneMe - \u77E5\u8BC6\u535A\u4E3B AI \u5206\u8EAB" }), _jsx("p", { className: "subtitle", children: "\u804A\u5929 + \u8BED\u97F3\u9A71\u52A8\u53E3\u578B + 2D \u6570\u5B57\u5F62\u8C61\uFF08\u6700\u5C0F\u53EF\u6F14\u793A\u7248\uFF09" }), _jsxs("p", { className: "status-chip", children: ["\u5F53\u524D\u9636\u6BB5\uFF1A", statusLabel] }), _jsxs("label", { className: "block", children: [_jsx("span", { children: "\u77E5\u8BC6\u5E93\u8F93\u5165\uFF08\u6BCF\u884C\u4E00\u6761\uFF09" }), _jsx("textarea", { value: docsInput, onChange: (e) => setDocsInput(e.target.value), rows: 5 })] }), _jsx("button", { onClick: initAvatar, disabled: loading, children: initLoading ? "初始化中..." : "1) 初始化分身" }), _jsx("div", { className: "mode-row", children: Object.keys(modeLabels).map((item) => (_jsx("button", { className: item === mode ? "active" : "", onClick: () => setMode(item), disabled: loading, children: modeLabels[item] }, item))) }), _jsxs("form", { onSubmit: onAsk, children: [_jsxs("label", { className: "block", children: [_jsx("span", { children: "\u95EE\u9898" }), _jsx("input", { value: question, onChange: (e) => setQuestion(e.target.value) })] }), _jsx("button", { type: "submit", disabled: loading, children: chatLoading ? "思考中..." : "2) 开始提问" })] }), errorMessage && (_jsxs("div", { className: "error-box", children: [_jsx("p", { children: errorMessage }), _jsx("button", { onClick: retryLastAction, disabled: loading, children: "\u91CD\u8BD5\u4E0A\u4E00\u6B65" })] }))] }), _jsxs("section", { className: "panel", children: [_jsx(Avatar2D, { speaking: isSpeaking, emotion: emotion, mouthOpen: mouthOpen, ready: avatarReady, runtime: runtime, runtimeError: avatarRuntimeError }), _jsxs("div", { className: "answer-box", children: [_jsx("h3", { children: "\u5206\u8EAB\u56DE\u590D" }), _jsx("p", { children: answer }), references.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h4", { children: "\u53C2\u8003\u77E5\u8BC6" }), _jsx("ul", { children: references.map((item) => (_jsx("li", { children: item }, item))) })] }))] })] })] }));
}
