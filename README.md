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
  - body: `{ userQuestion, mode: "teacher" | "friend" | "support" }`
  - returns: `{ reply, references, emotion, audioUrl, phonemeCues }`

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
