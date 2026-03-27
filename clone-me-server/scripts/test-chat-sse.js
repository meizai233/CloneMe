const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

async function main() {
  const question = process.argv.slice(2).join(" ").trim() || "请给我一个前端学习建议";
  const mode = process.env.CHAT_MODE ?? "teacher";
  const body = { userQuestion: question, mode };

  console.log("[chat-sse-test] POST", `${API_BASE_URL}/api/chat`);
  console.log("[chat-sse-test] body:", body);

  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  console.log("[chat-sse-test] status:", response.status, response.statusText);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`request failed: ${text}`);
  }
  if (!response.body) {
    throw new Error("response.body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  while (true) {
    const { done, value } = await reader.read();
    sseBuffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload);
        if (event.type === "delta") {
          process.stdout.write(event.content ?? "");
          continue;
        }
        process.stdout.write("\n");
        console.log(`[event:${event.type}]`, JSON.stringify(event, null, 2));
      } catch {
        process.stdout.write("\n");
        console.log("[event:raw]", payload);
      }
    }

    if (done) break;
  }

  console.log("\n[chat-sse-test] completed");
}

main().catch((error) => {
  console.error("[chat-sse-test] failed:", error);
  process.exit(1);
});
