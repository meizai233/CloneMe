/**
 * CloneMe 后端服务入口
 * HTTP API + WebSocket 代理（TTS/ASR）
 */
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { PORT } from './config.js';
import { createTTSConnection, startTTSTask, sendTTSText, finishTTSTask } from './services/tts.js';
import { createASRConnection } from './services/asr.js';

// HTTP 路由
import chatRouter from './routes/chat.js';
import { setKnowledgeContext } from './routes/chat.js';
import imageRouter from './routes/image.js';
import videoRouter from './routes/video.js';
import embeddingRouter from './routes/embedding.js';
import voiceCloneRouter from './routes/voice-clone.js';
import uploadRouter from './routes/upload.js';
import smartChatRouter from './routes/smart-chat.js';
import { initPersonas } from './services/persona.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化角色配置
initPersonas();

// 注册 HTTP 路由
app.use('/api/chat', chatRouter);
app.use('/api/chat', smartChatRouter);
app.use('/api', smartChatRouter);
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
  let upstream = null;
  let taskId = null;
  let taskStarted = false;
  let currentVoice = null;
  let pendingTexts = []; // 连接建立前积压的文本
  let finishTimer = null; // 延迟 finish 的定时器

  /**
   * 延迟发送 finish-task
   * 每次收到新文本时重置定时器，确保所有文本发完后才 finish
   * 这样多句话共用一个 task，避免每句话都重建连接
   */
  function scheduleFinish() {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(() => {
      if (upstream && upstream.readyState === 1 && taskStarted) {
        finishTTSTask(upstream, taskId);
        console.log('[TTS] Sent finish-task (debounced)');
      }
      finishTimer = null;
    }, 3000); // 3 秒内没有新文本才 finish，给 LLM 流式输出留足时间
  }

  /**
   * 确保上游连接就绪，返回后可直接发文本
   */
  function ensureUpstream(voice) {
    if (upstream && upstream.readyState === 1 && taskStarted && currentVoice === voice) {
      return; // 连接已就绪且 voice 相同，直接复用
    }

    // voice 变了或连接不可用，需要重建
    if (upstream && upstream.readyState === 1) {
      try {
        if (taskStarted) finishTTSTask(upstream, taskId);
        upstream.close();
      } catch { /* 忽略 */ }
    }

    const conn = createTTSConnection();
    upstream = conn.ws;
    taskId = conn.taskId;
    taskStarted = false;
    currentVoice = voice;

    upstream.on('open', () => {
      console.log('[TTS] Connected to DashScope, starting task for voice:', voice);
      startTTSTask(upstream, taskId, voice);
    });

    upstream.on('message', (upData) => {
      if (!Buffer.isBuffer(upData)) return;
      const str = upData.toString('utf8');

      if (str.charAt(0) === '{') {
        try {
          const upMsg = JSON.parse(str);
          const event = upMsg.header?.event;

          if (event === 'task-started') {
            taskStarted = true;
            clientWs.send(JSON.stringify({ type: 'connected' }));
            // 发送积压的文本
            for (const t of pendingTexts) {
              sendTTSText(upstream, taskId, t);
            }
            if (pendingTexts.length > 0) {
              scheduleFinish();
            }
            pendingTexts = [];
          } else if (event === 'task-finished') {
            // task 结束，但不关闭连接，下次发文本时会重建 task
            taskStarted = false;
            console.log('[TTS] Task finished');
          }
        } catch {
          // JSON 解析失败 = 音频数据
          if (clientWs.readyState === 1) clientWs.send(upData);
        }
      } else {
        // 二进制音频数据 → 转发给客户端
        if (clientWs.readyState === 1) clientWs.send(upData);
      }
    });

    upstream.on('error', (err) => {
      console.error('[TTS] Upstream error:', err.message);
      upstream = null;
      taskStarted = false;
    });

    upstream.on('close', () => {
      upstream = null;
      taskStarted = false;
    });
  }

  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.text) {
        const voice = msg.voice || 'cherry';
        ensureUpstream(voice);

        if (taskStarted) {
          // 连接已就绪，直接发文本
          sendTTSText(upstream, taskId, msg.text);
          scheduleFinish(); // 重置 finish 定时器
        } else {
          // 连接还在建立中，积压文本
          pendingTexts.push(msg.text);
        }
      }

      if (msg.action === 'finish') {
        // 前端主动要求结束
        if (finishTimer) clearTimeout(finishTimer);
        if (upstream && upstream.readyState === 1 && taskStarted) {
          finishTTSTask(upstream, taskId);
        }
      }
    } catch {
      // 非 JSON 数据忽略
    }
  });

  clientWs.on('close', () => {
    if (finishTimer) clearTimeout(finishTimer);
    if (upstream && upstream.readyState === 1) {
      if (taskStarted) {
        try { finishTTSTask(upstream, taskId); } catch { /* 忽略 */ }
      }
      upstream.close();
    }
    upstream = null;
  });
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
  console.log(`   POST /api/chat/smart     - 智能对话（角色+Memory+RAG）`);
  console.log(`   DEL  /api/chat/smart/session/:id - 清除会话`);
  console.log(`   GET  /api/personas       - 获取角色列表`);
  console.log(`   POST /api/personas       - 新增/更新角色`);
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
