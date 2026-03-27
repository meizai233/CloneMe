const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 12000;
class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
function joinUrl(base, path) {
    if (/^https?:\/\//.test(path)) {
        return path;
    }
    return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
async function requestJson(path, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(joinUrl(API_BASE_URL, path), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = (await response.json().catch(() => ({})));
        if (!response.ok) {
            throw new ApiError(data.message ?? "请求失败", response.status);
        }
        return data;
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw new ApiError("请求超时，请稍后重试");
        }
        if (error instanceof ApiError) {
            throw error;
        }
        throw new ApiError("网络异常，请检查服务是否启动");
    }
    finally {
        clearTimeout(timeoutId);
    }
}
export async function initAvatarProfile(payload) {
    return requestJson("/api/avatar/init", payload);
}
export async function chatWithAvatar(payload) {
    const data = await requestJson("/api/chat", payload);
    return {
        ...data,
        audioUrl: joinUrl(API_BASE_URL, data.audioUrl)
    };
}
