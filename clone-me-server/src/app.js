/**
 * CloneMe 后端服务入口
 * HTTP API + WebSocket 代理（TTS/ASR）
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PORT } from './config.js';
import { createTTSConnection, sendTTSText } from './services/tts.js';
import { createASRConnection } from './services/asr.js';

// HTTP 路由
import chatRouter from './routes/chat.js';
import { setKnowledgeContext } from './routes/chat.js';
import imageRouter from './routes/image.js';
import videoRouter from './routes/video.js';
import embeddingRouter from './routes/embedding.js';
import voiceCloneRouter from './routes/voice-clone.js';
import uploadRouter from './routes/upload.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 注册 HTTP 路由
app.use('/api/chat', chatRouter);
app.use('/api/image', imageRouter);
app.use('/api/video', videoRouter);
app.use('/api/embedding', embeddingRouter);
app.use('/api/voice', voiceCloneRouter);
app.use('/api/upload', uploadRouter);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'clone-me-server' });
});

// 分身初始化（注入知识库）
app.post('/api/avatar/init', (req, res) => {
  const { creatorName = 'CloneMe 博主', domain = '技术', docs = [] } = req.body;
  setKnowledgeContext(docs);
  res.json({
    message: 'avatar initialized',
    profile: { creatorName, domain, docCount: docs.length },
  });
});

// 创建 HTTP 服务器
const server = createServer(app);

// WebSocket 服务器 - TTS 代理（路径: /ws/tts）
const ttsWss = new WebSocketServer({ noServer: true });
ttsWss.on('connection', (clientWs) => {
  // 为每个客户端创建到上游 TTS 的连接
  const upstream = createTTSConnection();

  upstream.on('open', () => {
    clientWs.send(JSON.stringify({ type: 'connected' }));
  });

  // 上游音频数据 → 客户端
  upstream.on('message', (data) => {
    if (clientWs.readyState === 1) {
      clientWs.send(data);
    }
  });

  // 客户端文本 → 上游 TTS
  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.text && upstream.readyState === 1) {
        sendTTSText(upstream, msg.text, { voice: msg.voice });
      }
    } catch {
      // 非 JSON 数据忽略
    }
  });

  clientWs.on('close', () => upstream.close());
  upstream.on('close', () => {
    if (clientWs.readyState === 1) clientWs.close();
  });
  upstream.on('error', () => upstream.close());
});

// WebSocket 服务器 - ASR 代理（路径: /ws/asr）
const asrWss = new WebSocketServer({ noServer: true });
asrWss.on('connection', (clientWs) => {
  const upstream = createASRConnection();

  upstream.on('open', () => {
    clientWs.send(JSON.stringify({ type: 'connected' }));
  });

  // 上游识别结果 → 客户端
  upstream.on('message', (data) => {
    if (clientWs.readyState === 1) {
      clientWs.send(data);
    }
  });

  // 客户端音频数据 → 上游 ASR
  clientWs.on('message', (data) => {
    if (upstream.readyState === 1) {
      upstream.send(data);
    }
  });

  clientWs.on('close', () => upstream.close());
  upstream.on('close', () => {
    if (clientWs.readyState === 1) clientWs.close();
  });
  upstream.on('error', () => upstream.close());
});

// WebSocket 升级路由分发
server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url, `http://${request.headers.host}`);

  if (pathname === '/ws/tts') {
    ttsWss.handleUpgrade(request, socket, head, (ws) => {
      ttsWss.emit('connection', ws, request);
    });
  } else if (pathname === '/ws/asr') {
    asrWss.handleUpgrade(request, socket, head, (ws) => {
      asrWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`🚀 CloneMe Server 启动成功: http://localhost:${PORT}`);
  console.log(`📡 API 路由:`);
  console.log(`   POST /api/chat          - 对话`);
  console.log(`   POST /api/chat/stream    - 流式对话（SSE）`);
  console.log(`   POST /api/image/generate - 图片生成`);
  console.log(`   POST /api/video/create   - 视频生成`);
  console.log(`   GET  /api/video/task/:id - 查询视频任务`);
  console.log(`   POST /api/embedding      - 文本向量化`);
  console.log(`   POST /api/voice/create   - 创建克隆声音`);
  console.log(`   GET  /api/voice/list     - 查询声音列表`);
  console.log(`   GET  /api/voice/:id      - 查询声音状态`);
  console.log(`   DEL  /api/voice/:id      - 删除声音`);
  console.log(`🔌 WebSocket:`);
  console.log(`   ws://localhost:${PORT}/ws/tts - TTS 语音合成`);
  console.log(`   ws://localhost:${PORT}/ws/asr - ASR 语音识别`);
});
