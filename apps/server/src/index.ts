import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config.js";
import { composeReply, inferEmotion } from "./services/persona.js";
import { retrieveTopK, upsertKnowledge } from "./services/rag.js";
import { synthesizeSpeech } from "./services/tts.js";
import { registerVoiceCloneProfile, synthesizeClonedVoice } from "./services/voiceClone.js";
import type { ChatResponsePayload, VoiceCloneProfilePayload } from "./types.js";

const app = express();
const port = config.port;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") ?? randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
});

function getClientId(req: express.Request): string {
  const xff = req.header("x-forwarded-for");
  if (xff) {
    return xff.split(",")[0]?.trim() ?? "unknown";
  }
  return req.ip || "unknown";
}

function sendApiError(
  res: express.Response,
  status: number,
  code: string,
  message: string,
  requestId: string
): void {
  res.status(status).json({ code, message, requestId });
}

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
  const requestId = res.locals.requestId as string;
  const parsed = initSchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "VALIDATION_ERROR", parsed.error.message, requestId);
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
  mode: z.enum(["teacher", "friend", "support"]).default("teacher"),
  voiceId: z.string().min(1).optional()
});

function buildFallbackCues(text: string): number[] {
  const chars = text.replace(/\s+/g, "");
  const cueCount = Math.max(6, Math.min(24, Math.ceil(chars.length / 5)));
  const cues: number[] = [];
  for (let i = 0; i < cueCount; i += 1) {
    cues.push(((i % 5) + 1) / 6);
  }
  return cues;
}

app.post("/api/chat", async (req, res) => {
  const requestId = res.locals.requestId as string;
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "VALIDATION_ERROR", parsed.error.message, requestId);
    return;
  }

  const references = retrieveTopK(parsed.data.userQuestion);
  const reply = composeReply({
    mode: parsed.data.mode,
    question: parsed.data.userQuestion,
    references
  });

  if (parsed.data.voiceId) {
    try {
      const cloneResult = await synthesizeClonedVoice({
        requestId,
        clientId: getClientId(req),
        voiceId: parsed.data.voiceId,
        text: reply
      });

      const payload: ChatResponsePayload = {
        reply,
        references,
        emotion: inferEmotion(reply),
        audioUrl: cloneResult.audioUrl,
        phonemeCues: buildFallbackCues(reply),
        latency: cloneResult.latency
      };
      res.json(payload);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "语音克隆失败";
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "chat_voice_clone_fallback",
          requestId,
          reason: message
        })
      );
      const payload: ChatResponsePayload = {
        reply,
        references,
        emotion: inferEmotion(reply),
        audioUrl: "",
        phonemeCues: buildFallbackCues(reply)
      };
      res.json(payload);
      return;
    }
  }

  const { audioUrl, phonemeCues } = synthesizeSpeech(reply);
  res.json({
    reply,
    references,
    emotion: inferEmotion(reply),
    audioUrl,
    phonemeCues
  } satisfies ChatResponsePayload);
});

const cloneProfileSchema = z.object({
  speakerName: z.string().min(1).max(40).optional(),
  consentConfirmed: z.literal(true),
  sampleAudioBase64: z.string().min(1)
});

app.post("/api/voice-clone/profile", async (req, res) => {
  const requestId = res.locals.requestId as string;
  const parsed = cloneProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "VALIDATION_ERROR", parsed.error.message, requestId);
    return;
  }

  try {
    const profile = await registerVoiceCloneProfile({
      requestId,
      clientId: getClientId(req),
      speakerName: parsed.data.speakerName,
      sampleAudioBase64: parsed.data.sampleAudioBase64
    });

    const payload: VoiceCloneProfilePayload = {
      voiceId: profile.voiceId,
      metrics: profile.metrics
    };
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建语音克隆失败";
    sendApiError(res, 400, "VOICE_CLONE_PROFILE_FAILED", message, requestId);
  }
});

const cloneSynthesizeSchema = z.object({
  voiceId: z.string().min(1),
  text: z.string().min(1).max(600),
  style: z
    .object({
      speed: z.number().min(0.5).max(2).optional(),
      pitch: z.number().min(-12).max(12).optional(),
      emotion: z.enum(["neutral", "happy", "serious"]).optional()
    })
    .optional()
});

app.post("/api/voice-clone/synthesize", async (req, res) => {
  const requestId = res.locals.requestId as string;
  const parsed = cloneSynthesizeSchema.safeParse(req.body);
  if (!parsed.success) {
    sendApiError(res, 400, "VALIDATION_ERROR", parsed.error.message, requestId);
    return;
  }

  try {
    const result = await synthesizeClonedVoice({
      requestId,
      clientId: getClientId(req),
      voiceId: parsed.data.voiceId,
      text: parsed.data.text,
      style: parsed.data.style
    });

    res.json({
      audioUrl: result.audioUrl,
      latency: result.latency
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "语音合成失败";
    sendApiError(res, 400, "VOICE_CLONE_SYNTH_FAILED", message, requestId);
  }
});

app.listen(port, () => {
  console.log(`CloneMe server listening at http://localhost:${port}`);
});
