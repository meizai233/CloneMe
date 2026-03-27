# CloneMe - Knowledge Avatar Starter

`CloneMe` is a hackathon-friendly starter for a "knowledge creator AI clone":
- personalized Q&A (`mode` switch: teacher/friend/support)
- lightweight RAG over creator docs
- TTS/lipsync pipeline placeholder
- 2D dynamic avatar (emotion + mouth movement)

## Tech Stack

- `apps/web`: React + Vite + TypeScript
- `clone-me-server`: Node.js + Express

## Quick Start

```bash
cp apps/web/.env.example apps/web/.env
npm install
npm run dev
```

Open:
- Web: `http://localhost:5173`
- API: `http://localhost:3001`

## Current API

- `GET /api/health`
- `POST /api/chat`
- `POST /api/chat/stream` (SSE)
- `POST /api/image/generate`
- `POST /api/video/create`
- `GET /api/video/task/:id`
- `POST /api/embedding`
- `WS /ws/tts`
- `WS /ws/asr`

## Voice Clone Setup

1. Copy `apps/web/.env.example` to `apps/web/.env`.
2. Ensure `VITE_API_BASE_URL` points to your running backend (default `http://localhost:3001`).
3. Start services with `npm run dev`.

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
