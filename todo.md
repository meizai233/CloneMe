# CloneMe 下一步 TODO

> 目标：在当前可运行骨架上，快速升级为“可答辩、可演示、可扩展”的比赛版本。

- 比赛 tts 是否支持时间戳

## 技术选型（对标 HeyGen 的降级 Demo）

- AI 对话：`平台 LLM`
- TTS：`平台 TTS`
- RAG：`平台 RAG API`
- Memory：`平台 Memory API`
- 数字人：`Live2D Cubism`
- 前端：`React`（当前仓库保持 React 路线；如重构可切 Next.js）
- 后端：`Node.js`（当前仓库）；可替换 `Java / Go`
- 音频播放：浏览器 `HTMLAudioElement`（联动口型最稳）
- 日志与可观测：`pino` + request id（Demo 出问题可快速定位）

## 模块对应关系（锁定实现边界）

- 模块：AI 对话
  - 技术：`平台 LLM`
  - 落点文件：`clone-me-server/src/routes/chat.js`、`clone-me-server/src/services/llm.js`
- 模块：TTS
  - 技术：`平台 TTS`
  - 落点文件：`clone-me-server/src/services/tts.js`
- 模块：RAG
  - 技术：`平台 RAG API`
  - 落点文件：`clone-me-server/src/routes/embedding.js`
- 模块：Memory
  - 技术：`平台 Memory API`
  - 落点文件：`clone-me-server/src/routes/chat.js`
- 模块：数字人
  - 技术：`Live2D Cubism`
  - 落点文件：`apps/web/src/avatar/live2dAdapter.ts`
- 模块：前端
  - 技术：`React`
  - 落点文件：`apps/web/src/App.tsx`
- 模块：后端
  - 技术：`Node.js`
  - 落点文件：`clone-me-server/src/app.js`

## 接口约定（先锁死，减少联调扯皮）

- `POST /api/avatar/init`
  - 入参：`{ creatorName, domain, docs: string[] }`
  - 出参：`{ message, profile }`
- `POST /api/chat`
  - 入参：`{ userQuestion, mode }`
  - 出参：`{ reply, references, emotion, audioUrl, phonemeCues, memoryHints }`
- 约束 1：`mode` 只允许 `teacher | friend | support`
- 约束 2：`references` 必须返回，答辩时用于“可解释性”展示
- 约束 3：接口错误统一 `{ code, message, requestId }`
- 约束 4：`memoryHints` 必须返回（用于展示“记忆进化”）

## 目录与代码职责（按文件改，不容易乱）

- 前端
  - `apps/web/src/App.tsx`：页面流程、模式切换、播放状态
  - `apps/web/src/avatar/live2dAdapter.ts`：Live2D 初始化、表情、口型驱动
  - `apps/web/src/services/api.ts`（新增）：封装所有后端请求
- 后端
  - `clone-me-server/src/app.js`：服务入口、路由注册、WS 代理
  - `clone-me-server/src/routes/chat.js`：对话路由与流式接口
  - `clone-me-server/src/routes/embedding.js`：向量化接口
  - `clone-me-server/src/services/tts.js`：平台 TTS 接入
  - `clone-me-server/src/services/asr.js`：平台 ASR 接入
  - `clone-me-server/src/services/llm.js`：模型调用与流式能力

## 四人分工（前端 + 后端A + 后端B + 运营）

### 角色 A：前端（负责人：交互与演示效果）

- [ ] 负责页面主流程：上传内容 -> 生成分身 -> 开始对话
- [ ] 负责数字人表现：口型、表情、模式切换动效
- [ ] 负责语音播放联动：收到后端音频后自动播放并驱动口型
- [ ] 负责 Demo 兜底：失败提示、重试按钮、离线演示入口
- [ ] 每天交付：可录屏演示的前端页面（至少 1 条完整问答链路）

### 角色 B1：后端A（负责人：AI 核心链路）

- [ ] 负责 LLM 接入与人设 Prompt（teacher/friend/support 三模式）
- [ ] 负责平台 RAG API 对接（知识入库、检索、引用返回）
- [ ] 负责平台 Memory API 对接（读取偏好、写入会话总结）
- [ ] 负责 `POST /api/chat` 业务编排（RAG -> LLM -> Memory 更新）
- [ ] 每天交付：可复现的“问答成功用例” + Prompt/RAG/Memory 参数变更说明

### 角色 B2：后端B（负责人：语音与工程稳定性）

- [ ] 负责 TTS 接口与返回结构（音频地址/流 + 口型参数）
- [ ] 负责服务稳定：超时、重试、降级、统一错误码
- [ ] 负责日志与可观测（requestId、错误日志、调用耗时）
- [ ] 每天交付：Postman/脚本可复现的“TTS + 全平台 API 异常兜底用例” + API 文档更新

### 角色 C：运营（不会 coding，负责人：内容与答辩）

- [ ] 准备高质量知识库素材（20~40 条，覆盖高频问题）
- [ ] 设计三种模式的“风格样例”与禁用话术（避免跑偏）
- [ ] 编写 Demo 剧本：开场 30 秒 + 核心演示 2 分钟 + 收尾 30 秒
- [ ] 准备答辩材料：用户痛点、竞品差异、商业化路径、应用场景
- [ ] 每天交付：可直接贴入系统的内容包 + 讲稿迭代版

### 协作接口（每天站会对齐）

- [ ] 前端 <- 后端：固定 `POST /api/chat` 返回格式，不随意改字段名
- [ ] 后端A <- 后端B：固定 TTS 返回协议（`audioUrl` / `phonemeCues`）与错误码
- [ ] 后端 <- 运营：每天新增知识条目与“标准回答风格样例”
- [ ] 运营 <- 前后端：每天一版可录屏 Demo，用于打磨讲述节奏

### 三天排期（按人拆任务）

- Day 1
  - 前端：聊天流程 + 模式切换 + 播放状态 UI
  - 后端A：平台 LLM + RAG API 首版打通
  - 后端B：TTS 接口打通，定义语音与口型返回格式
  - 运营：整理首版知识库与 10 个评委常问问题

- Day 2
  - 前端：接 Live2D/Pixi 运行时，打通表情与口型映射
  - 后端A：平台 Memory API 接入，返回 `memoryHints`
  - 后端B：超时/重试/降级策略接入，补全错误码
  - 运营：完成 Demo 讲稿 v1，并做一次彩排

- Day 3
  - 前端：UI 打磨、错误态优化、演示专用模式
  - 后端A：调优回答质量（模式差异、长度、事实性）
  - 后端B：监控日志补齐、压测与演示兜底开关
  - 运营：答辩稿定稿 + Q&A 清单 + 现场分工口播

## P0（今天做，先保证 Demo 稳）

- [ ] 接入真实 LLM（完善 `clone-me-server/src/services/llm.js` 的业务编排）
  - 输出要求：固定人设、三种模式可控、回复长度可控
  - 技术选型：比赛平台大模型 API（温度 `0.4~0.6`，max tokens `300~500`）
  - 实现细节：`system prompt` + `mode prompt` + `rag context` + `memory context` 四段拼接
  - 验收：同一问题在 `teacher/friend/support` 三种模式下回答明显不同

- [ ] 接入真实 TTS（完善 `clone-me-server/src/services/tts.js`）
  - 建议：优先接平台 WebSocket TTS；备选 ElevenLabs
  - 技术选型：先返回 `base64 音频` 或临时 URL，避免前端跨域踩坑
  - 实现细节：把文本按句号切片，超长文本分段合成再拼接
  - 验收：前端收到可播放音频 URL（或音频流）+ 可用口型驱动参数

- [ ] 前端增加“语音播放”能力（当前只有口型动画占位）
  - 位置：`apps/web/src/App.tsx`
  - 技术选型：`new Audio(audioUrl)` + `onplay/onended/onerror` 驱动 UI 状态
  - 实现细节：播放开始时 `isSpeaking=true`，结束或失败都回落为 `false`
  - 验收：提问后自动播报回答，口型与播报状态联动

- [ ] 接入真实内容上传入口（文件/文本）
  - 后端通过平台 RAG API 完成内容入库
  - 技术选型：前端 `textarea + txt/md 上传`；后端做上传转发
  - 实现细节：每段 `200~400` 字，保留 `source` 字段并传给平台
  - 验收：上传后可用于下一轮问答检索

## P1（明天做，提升完整度和评分）

- [ ] 把 RAG 改为平台 API 正式链路
  - 当前文件：`clone-me-server/src/routes/embedding.js`
  - 技术选型：平台 RAG（检索参数由平台托管）
  - 实现细节：固定 `topK=3~5`，无命中时走“无检索兜底回答”
  - 验收：能返回 topK 片段，并记录引用来源

- [ ] 接入平台 Memory API（记忆进化）
  - 当前文件：`clone-me-server/src/routes/chat.js`
  - 技术选型：平台 Memory（会话摘要 + 用户偏好）
  - 实现细节：每次回答后写入偏好标签（短回答/详细回答等）
  - 验收：连续 3 轮对话后，回答风格出现可见变化

- [ ] 接入 Live2D 运行时（替换 mock driver）
  - 当前文件：`apps/web/src/avatar/live2dAdapter.ts`
  - 建议：PixiJS + Live2D Cubism
  - 技术选型：`pixi.js` + `pixi-live2d-display`（或官方 runtime）
  - 实现细节：至少实现 `setEmotion()` + `playLipSync(cues)` 两个能力
  - 验收：数字人可显示、可切表情、可随语音节奏动嘴

- [ ] UI 包装成“产品感”流程
  - 三步：上传内容 -> 生成分身 -> 开始对话
  - 验收：首次使用无学习成本，演示路径清晰

## P2（后天做，冲刺亮点）

- [ ] 个性进化（轻量 memory）
  - 做法：记录用户偏好（回答长短、语气）
  - 验收：连续对话后回答风格自动调整

- [ ] 多场景切换可视化强化
  - 当前已有模式切换按钮，补充模式说明和示例问题
  - 验收：评委 10 秒能看懂“同问不同答”

- [ ] 数据看板（可选）
  - 指标：回答次数、模式占比、常见问题
  - 验收：答辩时可展示业务可持续性

## 技术债与风险控制

- [ ] 所有第三方 API 增加超时、重试、降级策略
- [ ] 前后端错误码统一，避免 Demo 现场静默失败
- [ ] 预置离线兜底回答（无网络也能演示基本流程）
- [ ] 每次提交前执行：`npm run build`
- [ ] 平台 API 配额和限流预案（429 自动退避 + 运营侧演示脚本降频）

## DoD（完成定义，避免“看起来做了”）

- 前端 DoD：从“输入问题”到“数字人播报+口型变化+引用展示”全链路 1 次成功
- 后端 DoD：`/api/chat` 在有知识、无知识、TTS 失败三种情况下都可返回可用结果
- 后端 DoD（新增）：平台 RAG / Memory API 超时或限流时，仍可返回降级回答
- 运营 DoD：准备 10 个现场问题，并给出预期回答风格（老师/朋友/客服）

## 建议里程碑

- Day 1：LLM + TTS 打通，能“说话”
- Day 2：RAG + Memory + Live2D 打通，能“像人”
- Day 3：打磨 UI + 答辩脚本，能“拿分”
