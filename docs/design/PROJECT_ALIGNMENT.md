# mini-openclaw — 项目对齐文档

> 本文档用于与 LLM 对齐 mini-openclaw 项目的目标、架构、阶段规划与关键设计决策。
> 在每次交互中，请以本文档为上下文基准。

---

## 1. 项目定位

**mini-openclaw** 是一个通过「渐进式重建」策略学习并精简复刻 [OpenClaw](https://github.com/nicepkg/openclaw)（30 万行 TypeScript）全架构的项目。

- **不是** fork / 二次开发，而是 **从零编写**，在遇到设计决策时参考 OpenClaw 源码。
- 技术栈：**TypeScript / Node.js 22 / pnpm**，与 OpenClaw 保持一致以方便对比。
- 项目周期：**3–4 周，5 个渐进阶段**。

### 核心目标

1. 搭建一个 **功能完整的精简版 OpenClaw**。
2. 覆盖全部核心架构层：渠道适配、Gateway 路由、Agent 执行循环、工具系统、插件机制、记忆系统、安全沙箱。
3. 每个阶段对标 OpenClaw 源码的具体文件和模块，建立精确的知识映射。
4. 最终产出一个可以持续迭代、加入自己创新的开源项目。

---

## 2. 目标架构

最终完成后的分层架构（每阶段增量叠加）：

```
mini-openclaw/
  src/
    gateway/            # Phase 2: WebSocket 服务器 & 协议
      server.ts
      protocol.ts
      router.ts
    agents/             # Phase 1+: Agent Runtime
      runner.ts         # Agentic Loop 核心
      system-prompt.ts
      memory-search.ts  # Phase 4
    channels/           # Phase 1-2: 渠道适配器
      base.ts           # 抽象接口
      wecom.ts          # 企业微信
      http-api.ts
      webchat.ts
    tools/              # Phase 3: 工具系统
      registry.ts
      built-in/
        shell.ts
        file.ts
        web-fetch.ts
    plugins/            # Phase 3: 插件加载
      loader.ts
      sdk.ts
    config/             # Phase 2: 配置系统
      schema.ts         # Zod schema
      loader.ts
    sessions/           # Phase 1+: 会话管理
      store.ts
      compaction.ts     # Phase 4
    security/           # Phase 4: 安全
      sandbox.ts
      access-control.ts
  extensions/           # Phase 3+: 外部插件
  workspace/            # 工作区
    SOUL.md
    AGENTS.md
    skills/
  config.json5          # 配置文件
  package.json
  tsconfig.json
```

---

## 3. 五阶段路线图

### Phase 1 — 最小可用（1–2 天）

**目标**：企业微信收消息 → 调用 LLM → 返回响应 → 记住对话历史。

| 功能 | 实现方式 | 对标 OpenClaw 源码 |
|---|---|---|
| 企业微信自建应用 | HTTP 回调 + AES-256-CBC 加解密 + REST API 主动推送 | 新增 `src/wecom/` |
| LLM 调用 | Anthropic SDK（流式） | `src/agents/pi-embedded-runner/` |
| 会话持久化 | JSONL 文件追加写入（崩溃安全） | `sessions/<id>.jsonl` |
| 人格注入 | 读取 `SOUL.md` 作为 system prompt | `src/agents/system-prompt.ts` |

**关键实现细节**：

- **企业微信适配器** (`src/channels/wecom.ts`)：
  - GET 回调验证：SHA1 签名校验 + AES 解密 echostr 返回明文。
  - POST 消息接收：验签 → 解析 XML → AES 解密 → 提取内容 → 立即返回空串（5 秒限制） → 异步处理。
  - AES-256-CBC 加解密：密钥由 `EncodingAESKey + '='` Base64 解码；IV 取密钥前 16 字节；PKCS#7 填充；消息体格式为 `16字节随机 + 4字节消息长度(网络序) + 明文 + CorpID`。
  - 主动推送：通过 `https://qyapi.weixin.qq.com/cgi-bin/message/send` REST API 发送，access_token 缓存 2 小时。
- **会话存储** (`src/sessions/store.ts`)：JSONL 格式，每行一个 JSON，追加写入保证崩溃安全。
- **Agent Runner** (`src/agents/runner.ts`)：简化版单轮 LLM 调用（Phase 1 不含工具），流式响应。

**验收标准**：
- [x] 能通过企业微信与 bot 对话
- [x] 重启进程后仍记得之前的对话内容
- [x] 修改 SOUL.md 后 bot 性格发生变化

---

### Phase 2 — Gateway 化（3–4 天）

**目标**：重构为 Gateway 架构，解决多渠道统一、会话共享、集中管控。

| 功能 | 实现方式 | 对标 OpenClaw 源码 |
|---|---|---|
| WebSocket 服务器 | ws 库，端口 18789 | `src/gateway/server.ts` |
| 协议定义 | TypeBox + JSON Schema 验证 | `src/gateway/protocol/` |
| 渠道抽象层 | BaseChannel 接口 + 适配器模式 | `src/wecom/`, `src/discord/`... |
| 消息路由 | 根据来源解析 sessionKey | `src/auto-reply/reply/` |
| 配置系统 | JSON5 + Zod 验证 + 热重载 | `src/config/` |
| 第二个渠道 | HTTP API 或 WebChat | 验证多渠道共享会话 |

**关键设计决策**：

- **渠道抽象接口** (`ChannelAdapter`)：所有渠道实现统一接口——`start()`, `stop()`, `sendMessage()`, `onMessage()`。
- **标准化消息** (`NormalizedMessage`)：包含 `channelName`, `senderId`, `text`, `attachments?`, `sessionKey`。
- **会话键解析**：自己发的消息 → `main`；别人 DM → `dm:channel:id`；群组 → `group:channel:id`。不同会话键 = 不同安全边界。
- **Zod 配置验证**：启动时即校验配置，避免运行时莫名崩溃。

**验收标准**：
- [x] 企业微信和 HTTP API 连接同一个 Gateway
- [x] 跨渠道同一 session 能保持对话连续
- [x] 配置文件有错误时启动直接报错
- [x] 修改配置后不重启即生效（热重载）

---

### Phase 3 — 工具与插件（5–7 天）

**目标**：让 Agent 能调用工具执行实际操作，建立插件机制允许第三方扩展。深入理解 Agentic Loop 本质——模型在 while 循环里交替生成和执行。

| 功能 | 实现方式 | 对标 OpenClaw 源码 |
|---|---|---|
| 工具注册表 | 统一注册 schema + handler | `src/tools/registry.ts` |
| Agentic Loop | `while (stop_reason === 'tool_use')` | `agent-runner-execution.ts` |
| Shell 工具 | `child_process.spawn` | `pi-tools.ts (system.run)` |
| 文件读写 | `fs.readFile / fs.writeFile` | `pi-tools.ts (file.*)` |
| Web Fetch | fetch API | `openclaw-tools.ts (web.*)` |
| 权限控制 | allowlist / denylist 策略 | `tools.global.*` 配置 |
| 插件加载器 | 扫描 `extensions/` + dynamic import | `src/plugins/loader.ts` |
| Plugin SDK | `api.registerTool()` 接口 | `openclaw/plugin-sdk` |

**关键实现**：

- **ToolRegistry**：工具注册表，支持 `register()` / `getAvailable(sessionType)` / `execute()` ，以及 allowlist/denylist 权限过滤。
- **Agentic Loop（升级版）**：核心 while 循环——LLM 返回 `tool_use` 时执行工具并将结果回传，返回 `end_turn` 时结束。对标 `runAgentTurnWithFallback()`。
- **插件加载器**：扫描 `extensions/` → 找 `package.json` 中的 `openclaw.extensions` → dynamic import → 调用 register。

**验收标准**：
- [x] 对 bot 说"列出当前目录的文件"，它能调用 shell 工具执行 ls 并返回结果
- [x] 对 bot 说"创建一个 hello.py 并运行它"，它能连续调用文件写入 + shell 执行
- [x] 在 `extensions/` 下写一个天气查询插件，重启后自动加载
- [x] denylist 中的工具名被拒绝执行

---

### Phase 4 — 记忆与安全（第 2 周）

**目标**：解决上下文窗口限制问题，并为非 main 会话建立安全隔离。

#### 记忆系统

| 机制 | 描述 | 对标 |
|---|---|---|
| 向量语义搜索 | 旧对话嵌入为向量，存入 SQLite（better-sqlite3 + FTS5），新对话前搜索相关历史注入上下文 | `src/agents/memory-search.ts` |
| 上下文压缩 (Compaction) | 会话 token 数接近窗口限制时自动摘要压缩旧消息；压缩失败则创建新 session 保证可用性 | `resetSessionAfterCompactionFailure()` |

#### 安全沙箱

| 机制 | 描述 | 对标 |
|---|---|---|
| 会话级工具策略 | main 会话允许所有工具，dm/group 会话只允许安全子集 | `sandbox: 'non-main'` 配置 |
| Docker 沙箱 | 非 main 会话的 shell 命令在 Docker 容器中执行 | `dockerode` |
| 访问控制增强 | DM pairing 机制——未知发送者收到配对码，需手动批准 | `src/gateway/auth-*.ts` |

---

### Phase 5 — 高级特性（第 3 周+）

| 特性 | 描述 |
|---|---|
| **多代理编排** | 子代理 Spawn (`sessions_spawn`)、代理路由 (`bindings[]`)、代理间通信 (`sessions_send`) |
| **Canvas A2UI** | 独立 Canvas 服务器（端口 18793），Agent 推送 HTML 给浏览器渲染，HTML 元素点击反向触发 Agent 工具调用 |
| **定时任务** | `cron.set` / `cron.list` 工具，基于 node-cron，cron job 生成内部系统消息走 Agent 处理流程 |

**持续演进方向**：

| 方向 | 描述 | 复杂度 |
|---|---|---|
| Voice 语音 | STT + TTS 集成（Whisper + ElevenLabs） | 中 |
| Browser 控制 | Playwright/CDP 集成网页自动化 | 高 |
| Model Failover | 多 provider 自动切换 + 认证轮转 | 中 |
| Webhook 触发 | 外部事件触发 Agent 执行 | 低 |
| Skill 市场 | 对接 ClawHub 安装社区技能 | 中 |
| Nix 部署 | 声明式配置 + 可复现部署 | 中 |

---

## 4. 技术选型

| 领域 | 选择 | 理由 |
|---|---|---|
| 运行时 | Node.js 22 + tsx | 与 OpenClaw 一致，方便对比 |
| 语言 | TypeScript (strict) | 类型安全，对标源码 |
| 包管理 | pnpm | 与 OpenClaw monorepo 一致 |
| WebSocket | ws | 与 OpenClaw 一致，轻量 |
| 企业微信 | HTTP 回调 + xml2js + crypto | 自建应用模式 |
| LLM SDK | @anthropic-ai/sdk | 流式支持好，类型完整 |
| 配置 | JSON5 + Zod | 与 OpenClaw 一致 |
| 数据库 | better-sqlite3 | 嵌入式，无需外部依赖 |
| 向量搜索 | SQLite FTS5 + 嵌入 API | OpenClaw 的混合搜索方案 |
| 沙箱 | dockerode | Node.js Docker 客户端 |
| 测试 | vitest | 快速，与 TypeScript 集成好 |

---

## 5. OpenClaw 源码映射（Top 10 必读文件）

按优先级排序，辅助开发时的参考查阅：

| # | 文件 | 理解什么 |
|---|---|---|
| 1 | `src/agents/system-prompt.ts` | 提示词是怎么组装的 |
| 2 | `src/auto-reply/reply/agent-runner.ts` | 消息进来后的完整处理链 |
| 3 | `src/agents/pi-embedded-runner/run/attempt.ts` | 单次 Agent 回合的执行细节 |
| 4 | `src/gateway/server.ts` | Gateway 如何管理连接和分发 |
| 5 | `src/config/zod-schema.ts` | 所有配置项的完整定义 |
| 6 | `src/tools/registry.ts` | 工具注册和策略执行 |
| 7 | `src/agents/memory-search.ts` | 记忆检索的实现 |
| 8 | `src/plugins/loader.ts` | 插件发现和加载机制 |
| 9 | `src/agents/pi-embedded-subscribe.ts` | 流式响应的事件处理 |
| 10 | `src/gateway/protocol/` | WebSocket 协议的完整定义 |

---

## 6. 编码约定与原则

1. **渐进式构建**：每个 Phase 只关注一层，不要提前过度设计。
2. **对标源码**：遇到设计决策时去 OpenClaw 源码搜关键词，而非通读。
3. **崩溃安全优先**：数据存储使用追加写入（JSONL），配置加载使用 Zod 校验。
4. **接口先行**：先定义 `ChannelAdapter` / `ToolDefinition` 等抽象接口，再实现具体类。
5. **安全分层**：会话键决定安全边界，`main` 与 `dm/group` 有不同的工具权限。

---

## 7. 快速参考

### 依赖清单

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "xml2js": "^0.6.2",
    "express": "^4.21.0",
    "ws": "^8.18.0",
    "zod": "^3.23.0",
    "json5": "^2.2.3",
    "better-sqlite3": "^11.7.0"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "tsup": "^8.3.0",
    "typescript": "^5.7.0",
    "@types/ws": "^8.5.0",
    "@types/better-sqlite3": "^7.6.0",
    "vitest": "^2.1.0"
  }
}
```

### tsconfig 要点

`target: ES2022`, `module: NodeNext`, `strict: true`, `outDir: dist/`

---

*本文档基于 `docs/design/mini-openclaw.docx`（2026 年 3 月）生成，供 LLM 在辅助开发时作为项目上下文参考。*
