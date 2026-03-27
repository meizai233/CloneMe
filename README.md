# CloneMe - Knowledge Avatar Starter

`CloneMe` is a hackathon-friendly starter for a "knowledge creator AI clone":
- personalized Q&A (`mode` switch: teacher/friend/support)
- lightweight RAG over creator docs
- TTS/lipsync pipeline placeholder
- 2D dynamic avatar (emotion + mouth movement)

## Tech Stack

- `apps/web`: React + Vite + TypeScript
- `apps/server`: Node.js + Express + TypeScript

## Quick Start

```bash
cp .env.example .env
npm install
npm run dev
```

Open:
- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Current API

- `POST /api/avatar/init`
  - body: `{ creatorName, domain, docs: string[] }`
- `POST /api/chat`
  - body: `{ userQuestion, mode: "teacher" | "friend" | "support", voiceId? }`
  - returns: `{ reply, references, emotion, audioUrl, phonemeCues, latency? }`
  - note: when `voiceId` is provided, server tries third-party cloned TTS first; timeout retries once and falls back to text+lip-sync cues
- `POST /api/voice-clone/profile`
  - body: `{ speakerName?, consentConfirmed: true, sampleAudioBase64 }`
  - returns: `{ voiceId, metrics: { durationSec, snrDb, silenceRatio } }`
  - quality gate: duration/SNR/silence ratio are validated server-side
- `POST /api/voice-clone/synthesize`
  - body: `{ voiceId, text, style? }`
  - returns: `{ audioUrl, latency: { firstByteMs, totalMs, meetsTarget } }`
  - abuse guard: sensitive text filter + in-memory rate limit + audit log

## Voice Clone Setup

1. Copy `.env.example` to `.env`.
2. Fill `TTS_API_KEY` and `TTS_API_URL`.
3. Adjust provider paths if your platform differs:
   - `TTS_VOICE_CLONE_PROFILE_PATH`
   - `TTS_VOICE_CLONE_SYNTH_PATH`
4. Run `npm run dev`, upload a WAV sample in web UI, create `voiceId`, then ask questions.

## Demo Flow

1. Paste creator knowledge lines in the textarea.
2. Click "初始化分身".
3. Switch persona mode.
4. Ask a question and view dynamic response + references.

## Next Integrations (for your final competition version)

1. Replace `composeReply` with real LLM API call and persona prompt template.
2. Replace `retrieveTopK` with vector search (pgvector / Milvus / Elasticsearch).
3. Replace `synthesizeSpeech` with platform WebSocket TTS or ElevenLabs.
4. Replace `Avatar2D` with Live2D + PixiJS runtime and viseme mapping.
