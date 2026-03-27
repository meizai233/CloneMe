import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { composeReply, inferEmotion } from "./services/persona.js";
import { retrieveTopK, upsertKnowledge } from "./services/rag.js";
import { synthesizeSpeech } from "./services/tts.js";
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

app.listen(port, () => {
  console.log(`CloneMe server listening at http://localhost:${port}`);
});
