import { chatStream } from "../src/services/llm.js";

const TYPEWRITER_MS = Number(process.env.TYPEWRITER_MS ?? 12);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function typewriterWrite(text) {
  for (const ch of text) {
    process.stdout.write(ch);
    if (TYPEWRITER_MS > 0) {
      await sleep(TYPEWRITER_MS);
    }
  }
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || "请用50字做自我介绍";
  const messages = [{ role: "user", content: prompt }];

  console.log("[stream-test] prompt:", prompt);
  const startedAt = Date.now();
  const response = await chatStream(messages, { temperature: 0.7 });
  console.log("[stream-test] upstream status:", response.status, response.statusText);

  if (!response.body) {
    throw new Error("上游未返回可读流（response.body 为空）");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let reasoningCount = 0;
  let contentCount = 0;
  let fullContent = "";
  let reasoningStarted = false;
  let contentStarted = false;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload);
        const delta = parsed.choices?.[0]?.delta ?? {};

        if (delta.reasoning_content) {
          reasoningCount += 1;
          if (!reasoningStarted) {
            reasoningStarted = true;
            process.stdout.write("\n[reasoning] ");
          }
          await typewriterWrite(delta.reasoning_content);
        }

        if (delta.content) {
          contentCount += 1;
          fullContent += delta.content;
          if (!contentStarted) {
            contentStarted = true;
            process.stdout.write("\n\n[content] ");
          }
          await typewriterWrite(delta.content);
        }
      } catch {
        // Ignore non-JSON heartbeat or fragmented lines.
      }
    }

    if (done) break;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log("\n\n[stream-test] done");
  console.log("[stream-test] chunks:", { reasoningCount, contentCount });
  console.log("[stream-test] elapsedMs:", elapsedMs);
  console.log("[stream-test] contentLength:", fullContent.length);
  console.log("[stream-test] typewriterMs:", TYPEWRITER_MS);
}

main().catch((error) => {
  console.error("[stream-test] failed:", error);
  process.exit(1);
});
