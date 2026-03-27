import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { composeReply, inferEmotion } from "./services/persona.js";
import { retrieveTopK, upsertKnowledge } from "./services/rag.js";
import { synthesizeSpeech } from "./services/tts.js";
import {
  createClonedVoice,
  listClonedVoices,
  queryClonedVoice,
  deleteClonedVoice,
} from "./services/voice-clone.js";
import type { ChatResponsePayload } from "./types.js";

const app = express();
const port = config.port;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    providers: {
      llm: config.llmProvider,
      tts: config.ttsProvider,
      vector: config.vectorProvider
    }
  });
});

const initSchema = z.object({
  creatorName: z.string().min(1).default("CloneMe Demo 博主"),
  domain: z.string().min(1).default("前端工程"),
  docs: z.array(z.string()).default([])
});

app.post("/api/avatar/init", (req, res) => {
  const parsed = initSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const profile = upsertKnowledge(parsed.data.docs);
  res.json({
    message: "avatar initialized",
    profile: {
      ...profile,
      creatorName: parsed.data.creatorName,
      domain: parsed.data.domain
    }
  });
});

const chatSchema = z.object({
  userQuestion: z.string().min(1),
  mode: z.enum(["teacher", "friend", "support"]).default("teacher")
});

app.post("/api/chat", (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const references = retrieveTopK(parsed.data.userQuestion);
  const reply = composeReply({
    mode: parsed.data.mode,
    question: parsed.data.userQuestion,
    references
  });
  const { audioUrl, phonemeCues } = synthesizeSpeech(reply);

  const payload: ChatResponsePayload = {
    reply,
    references,
    emotion: inferEmotion(reply),
    audioUrl,
    phonemeCues
  };

  res.json(payload);
});

// ========== 声音克隆 API ==========

// 创建克隆声音（上传音频 URL）
const createVoiceSchema = z.object({
  audioUrl: z.string().url(),
  prefix: z.string().max(10).default("cloneme"),
  targetModel: z.string().default("cosyvoice-v2"),
});

app.post("/api/voice/create", async (req, res) => {
  const parsed = createVoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  try {
    const result = await createClonedVoice(
      parsed.data.audioUrl,
      parsed.data.prefix,
      parsed.data.targetModel
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// 查询克隆声音列表
app.get("/api/voice/list", async (req, res) => {
  try {
    const prefix = req.query.prefix as string | undefined;
    const result = await listClonedVoices(prefix);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// 查询单个克隆声音状态
app.get("/api/voice/:voiceId", async (req, res) => {
  try {
    const result = await queryClonedVoice(req.params.voiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

// 删除克隆声音
app.delete("/api/voice/:voiceId", async (req, res) => {
  try {
    const result = await deleteClonedVoice(req.params.voiceId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(port, () => {
  console.log(`CloneMe server listening at http://localhost:${port}`);
  console.log(`声音克隆 API:`);
  console.log(`  POST   /api/voice/create    - 创建克隆声音`);
  console.log(`  GET    /api/voice/list       - 查询声音列表`);
  console.log(`  GET    /api/voice/:voiceId   - 查询声音状态`);
  console.log(`  DELETE /api/voice/:voiceId   - 删除声音`);
});
