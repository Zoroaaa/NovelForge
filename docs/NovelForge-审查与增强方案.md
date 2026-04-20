# NovelForge 审查与增强方案

> 基于代码全量审查 + `novelforge_architecture.svg` 规划的分阶段实施方案。
> 
> 优先级原则：先消除阻塞生产的 bug，再补基础设施盲区，再按架构图扩展功能。

---

## Bug 清单（需在 Phase 0 全部修复）

### B1 · 严重 · `contextBuilder.ts` 参数名类型不匹配 → 运行时崩溃

**位置**：`server/services/contextBuilder.ts` 第 117 行、第 323 行

**根因**：`estimateMandatoryTokens` 的调用端传入 `{ chapterOutline, prevSummary, volumeSummary, protagonists }`，但函数签名定义的参数名是 `prevChapterSummary` 和 `protagonistCards`。TypeScript 在跨文件推断时未捕获此错误，运行时两个字段均为 `undefined`，导致 token 估算结果为 0，同时破坏整个 `ContextBundle` 的 debug 数据。

**影响**：每次开启 RAG 的章节生成都会在 context 构建阶段静默返回错误数据，`debug.totalTokenEstimate` 永远为 0。

**修复**：统一调用端参数名，使其与接口定义一致。

---

### B2 · 严重 · `triggerAutoSummary` 未导出 → 手动摘要触发 undefined

**位置**：`server/services/agent.ts` 第 194 行 / `server/routes/generate.ts` 第 133 行

**根因**：`triggerAutoSummary` 声明为 `async function`（未加 `export`），但 `generate.ts` 的 `/summary` 路由通过动态 `import('../services/agent')` 解构该函数。运行时解构得到 `undefined`，调用时直接抛出 `TypeError: triggerAutoSummary is not a function`。

**影响**：`POST /api/generate/summary`（手动触发摘要）路由完全失效，500 报错。

**修复**：为 `triggerAutoSummary` 添加 `export` 关键字。

---

### B3 · 严重 · `resolveConfig` 查询逻辑缺陷 → 返回错误模型配置

**位置**：`server/services/llm.ts` 第 73–83 行

**根因**：第一步查询仅 `where(eq(modelConfigs.stage, stage))`，取回的是全局所有 stage 匹配的最新记录。随后在 JS 层判断 `stageConfig.novelId === novelId`——当最新记录恰好属于另一部小说时，条件不满足，直接 fall through 到全局配置查询，但全局配置查询又没有 stage 过滤，会把任意 `scope='global'` 的最新记录当成目标模型。两步查询的业务语义完全错位。

**影响**：多小说场景下，章节生成可能使用了另一部小说的专属模型配置，或使用了不匹配 stage 的全局配置（如用 `summary_gen` 配置去做 `chapter_gen`）。

**修复**：第一步查询同时加 `novelId` 和 `stage` 过滤；全局配置回退同时加 `stage` 过滤；两步合并为一个优先级查询。

---

### B4 · 中等 · `Env` 类型缺失 `VECTORIZE` 绑定声明

**位置**：`server/lib/types.ts`

**根因**：`Env` 类型中只声明了 `DB / STORAGE / AI` 及三个 API Key 字符串，未声明 `VECTORIZE: VectorizeIndex`。导致所有引用 `env.VECTORIZE` 的地方类型为 `any`，失去类型保护，wrangler 绑定缺失时也无法在编译期发现。

**修复**：补充 `VECTORIZE?: VectorizeIndex`（可选，兼容未配置 Vectorize 的部署环境）。

---

### B5 · 中等 · 生成日志 `modelId` 永远写入字符串 `"unknown"`

**位置**：`server/routes/generate.ts` 第 47 行

**根因**：`const modelId = 'unknown'` 在 `generateChapter` 调用前声明，`generateChapter` 不返回实际使用的模型 ID，`generationLogs` 表的 `model_id` 字段因此永远记录为 `"unknown"`。

**影响**：日志数据失去追踪价值，无法通过日志分析各模型的 token 消耗和成功率。

**修复**：`generateChapter` 的 `onDone` 回调携带 `resolvedModelId`；或在 `agent.ts` 中将 resolved 模型 ID 传回路由层。

---

### B6 · 中等 · `indexContent` 删旧向量时逻辑错误 → Vectorize 向量残留

**位置**：`server/services/embedding.ts` 第 229–244 行

**根因**：先执行 `db.delete(vectorIndex).where(eq(vectorIndex.sourceId, sourceId))` 将 D1 中的记录全部删除，紧接着又查询同一张表取旧 vector ID 列表——此时表已清空，查询结果为空数组，`deleteVector` 循环一次都不执行。Vectorize 中的旧向量永久残留，与 D1 索引表脱节。

**影响**：内容每次更新都会在 Vectorize 中叠加旧向量，RAG 检索命中旧内容，相似度排序结果污染。

**修复**：先查出旧 vector ID 列表，再删 D1 记录，最后删 Vectorize 向量（严格按此顺序）。

---

## Phase 0 · Bug 修复

**目标**：消除所有运行时崩溃和静默失效，不引入新功能。

**预计工时**：1–2 天

| 任务 | 文件 | 改动范围 |
|---|---|---|
| 修复 B1 参数名 | `contextBuilder.ts` | 2 处变量名替换 |
| 修复 B2 导出缺失 | `agent.ts` | 加 `export` 关键字 |
| 修复 B3 查询逻辑 | `llm.ts` | 重写 `resolveConfig` 两段查询 |
| 修复 B4 类型声明 | `types.ts` | 补一行接口字段 |
| 修复 B5 modelId 传递 | `agent.ts` + `generate.ts` | 回调增加 `modelId` 字段 |
| 修复 B6 删除顺序 | `embedding.ts` | 调换 3 行操作顺序 |

**验收标准**：`POST /api/generate/chapter` 全链路（含 RAG + 自动摘要 + 日志写入）在 `wrangler dev` 下完整跑通，日志表 `model_id` 字段有实际值。

---

## Phase 1 · 核心稳定 + 写作流增强

**目标**：补基础设施盲区，提升核心写作体验，不触动架构。

**预计工时**：1–2 周

### 1.1 Embedding 批量并发（性能）

**现状**：`embedding.ts` 的 `embedBatch` 用 `for` 循环串行调用 `embedText`，对长文档分块（10+ 片段）每次索引耗时随块数线性增长。

**方案**：改为 `Promise.all` 并发；对超过 20 块的内容加并发限制（`p-limit` 或手动分批），避免触发 Workers AI 速率限制。

**影响范围**：`embedding.ts`，不改接口。

---

### 1.2 大纲保存自动触发向量化（补钩子）

**现状**：`chapters.ts` 的 PATCH 路由已有 `c.executionContext.waitUntil` 自动索引钩子，但 `outlines.ts` 的 PATCH 没有，修改大纲内容后需手动调用 `POST /api/vectorize/index`。

**方案**：在 `outlines.ts` PATCH 路由更新内容后，用 `waitUntil` 异步触发 `indexContent(env, 'outline', ...)`，与 chapters 路由保持一致。同样在 `characters.ts` PATCH 后触发角色描述的向量化。

**为什么不在 Phase 0**：不阻塞现有功能，属于体验优化。

---

### 1.3 生成模式扩展：续写 / 重写

**现状**：`GeneratePanel` 只支持从零生成，没有"续写已有内容"和"重写选中段落"两种高频场景。

**方案**：
- `GeneratePanel` 增加 `mode: 'generate' | 'continue' | 'rewrite'` prop
- `POST /api/generate/chapter` body 增加可选的 `existingContent` 字段
- `agent.ts` 的 `buildMessages` 根据 mode 调整 prompt 模板：续写传入已有内容末尾 500 字；重写传入选中文本 + 改写指令

---

### 1.4 写作风格 Prompt 可配置

**现状**：`agent.ts` 的 `systemPrompt` 硬编码了"玄幻/仙侠类"风格描述，对其他类型小说（都市、悬疑、科幻）生成质量差。

**方案**：
- `model_configs.params` JSON 字段增加 `systemPromptOverride?: string` 键
- `buildMessages` 优先读取该字段；`ModelConfig` 前端 UI 增加对应的 textarea 输入项
- 内置 3–5 个风格预设（玄幻、都市、悬疑）供选择

---

### 1.5 生成日志 UI

**现状**：`generationLogs` 表已有数据结构，但前端没有任何展示入口，token 消耗无法追踪。

**方案**：在 Settings 页增加"生成日志"标签，展示：
- 最近 50 条生成记录（章节名、模型、token 用量、耗时、状态）
- 近 7 天 token 消耗折线图（用 `recharts` 或原生 SVG）
- 后端增加 `GET /api/settings/logs?novelId=&limit=` 路由

---

### 1.6 `deindexContent` 修复：从 D1 查实际 chunk 数

**现状**：`vectorize.ts` DELETE 路由调用 `deindexContent(env, sourceType, sourceId, 1)` 硬编码 `totalChunks=1`，对多块内容只删了第 0 个向量。

**方案**：删除前先查 `vector_index` 表获取实际 chunk 数，再按实际数量删除。或直接改 `deindexContent` 内部实现为从 D1 查询，不依赖调用方传入数量。

---

## Phase 2 · 架构扩展（对照 `novelforge_architecture.svg`）

**目标**：落地架构图中已规划但当前仅存在接口或占位的核心模块。

**预计工时**：2–4 周

### 2.1 ReAct Agent 多轮循环真正实现

**现状**：`agent.ts` 的 `generateChapter` 名为"ReAct Loop"，实际是单次 LLM 调用——上下文构建 → 一次生成 → 结束。架构图中的"工具调用 → 回填 assistant msg → 继续生成"循环从未执行。

**方案**：

```
迭代上限: maxIterations（默认 3）

loop:
  1. LLM 流式生成，同时检测 tool_call 事件
  2. 若无工具调用 → 输出内容，结束循环
  3. 若有工具调用（queryOutline / queryCharacter / searchSemantic）：
     a. 执行工具，获取结果
     b. 将 tool_result 追加到 messages
     c. 继续下一轮生成
```

需解决的细节：
- 工具调用结果通过 SSE 以 `{ type: 'tool_call', name, result }` 事件推送到前端，`ContextPreview` 实时展示工具执行过程
- 工具定义复用 `server/mcp/index.ts` 的 `TOOLS` 数组（MCP 工具与 Agent 工具同源，避免重复维护）
- `onChunk` 回调需区分"工具执行中"和"正在生成内容"两种状态

---

### 2.2 滚动上下文窗口：最近 N 章摘要链

**现状**：`contextBuilder.ts` 的 `fetchPrevChapterSummary` 只取上一章摘要。写到第 50 章时，Agent 只知道第 49 章发生了什么，对前期伏笔和人物关系毫无感知，生成内容频繁出现逻辑断层。

**方案**：
- `ContextBundle.mandatory` 增加 `recentChainSummaries: string[]`（最近 3–5 章的摘要，从新到旧排列）
- 总 token 预算从摘要链开始分配，按优先级截断：本章大纲 > 上一章摘要 > 摘要链 > RAG 片段
- `buildMessages` 中摘要链以"前情回顾"段落注入，明确标注章节序号

**配置项**：`model_configs.params` 增加 `summaryChainLength: number`（默认 3，最大 10）

---

### 2.3 角色一致性检查服务

**架构图扩展方向**：在生成完成后，增加一道轻量 LLM 校验，对比角色设定与生成内容是否存在冲突。

**方案**：
- 新路由 `POST /api/generate/check`，接受 `chapterId` + `characterIds[]`
- 使用 `summary_gen` 模型配置（轻量模型），prompt 要求模型输出 JSON 格式的冲突列表：`{ characterName, conflict, excerpt }`
- 前端在 GeneratePanel "写入编辑器"按钮旁增加"一致性检查"按钮，结果以列表形式展示
- 此路由为可选调用，不阻塞写入流程

---

### 2.4 MCP Server 补充写操作工具

**现状**：`server/mcp/index.ts` 的工具全部为只读（queryNovels / queryOutlines / queryChapters / getChapterContent / searchSemantic）。Claude Desktop 可以读取小说内容，但无法通过 MCP 创建大纲或修改章节。

**方案**：增加以下写操作工具：

| 工具名 | 功能 | 对应 REST 路由 |
|---|---|---|
| `createOutline` | 创建大纲节点 | `POST /api/outlines` |
| `updateChapter` | 更新章节内容 | `PATCH /api/chapters/:id` |
| `bulkIndexNovels` | 批量触发向量化 | `POST /api/vectorize/index` × N |
| `generateChapterSummary` | 手动触发摘要 | `POST /api/generate/summary` |

写操作工具须在 `handleToolCall` 中加入参数校验，`novelId` 为必填且需存在于 DB 中。

---

### 2.5 章节版本快照（R2 存储）

**架构图中 R2 用途**：当前仅用于角色图片和导出文件。扩展为章节历史版本存储。

**方案**：
- `chapters` 表增加 `snapshotKeys: text`（JSON 数组，存 R2 对象键列表，最多保留 10 个版本）
- 每次 AI 生成完成写入编辑器时，先将当前内容存一份到 R2（key：`snapshots/{novelId}/{chapterId}/{timestamp}.txt`）
- 前端在 ChapterEditor 增加"历史版本"入口，列出最近 10 个快照并支持预览和恢复
- 后端路由 `GET /api/chapters/:id/snapshots` 返回快照列表，`POST /api/chapters/:id/restore` 恢复到指定版本

---

## Phase 3 · 产品完善

**目标**：提升产品完整度，视资源和优先级排期，不影响核心写作流。

### 3.1 EPUB/PDF 导出环境兼容性验证

**风险**：`epub-gen-memory` 依赖 `Buffer` 等 Node.js API，Cloudflare Workers 的 `nodejs_compat` 标志提供部分支持但不完整。架构图注释了"Cloudflare Browser Rendering → PDF"，PDF 导出走 Browser Rendering API 路线需额外配置。

**行动项**：
1. 在 `wrangler dev` 下实测 `exportAsEpub`，观察是否有 `Buffer is not defined` 或 `window is not defined` 类报错
2. 若不兼容，改用 `epub-gen` 的 Workers 兼容分支，或在 Worker 外套一层 Node.js 边车服务处理导出
3. PDF 路线：使用 `@cloudflare/puppeteer` + Browser Rendering 绑定，wrangler.toml 增加 `browser` binding

---

### 3.2 全文搜索（FTS5 on D1）

**方案**：D1 支持 SQLite FTS5。创建 `chapters_fts` 虚拟表，对 `title + content + summary` 建立全文索引。新增 `GET /api/search?novelId=&q=` 路由，返回命中章节和高亮片段。前端工作区顶部增加搜索框。

---

### 3.3 写作统计 Dashboard

`novels` 表的 `wordCount` 和 `chapterCount` 已在变更时更新。扩展为：
- 每日字数折线图（需新增 `daily_stats` 表或从 `chapters.updatedAt` 聚合）
- 各章节 token 消耗分布（来自 `generationLogs`）
- 生成成功率（`status='success'` vs `status='error'`）

---

### 3.4 小说封面图上传与展示

`novels.coverR2Key` 字段已存在但前端未实现。补充：
- `NovelCard` 组件展示封面缩略图
- `CreateNovelDialog` / 小说设置页增加图片上传入口，复用 `CharacterImageUpload` 组件逻辑
- 上传路由：`POST /api/novels/:id/cover`，走 R2 存储

---

## 架构扩展优先级汇总

| 优先级 | 模块 | 理由 |
|---|---|---|
| P0（立即） | B1–B6 Bug 修复 | 阻塞或污染现有功能 |
| P1（本周） | B6 deindexContent 修复 + 大纲向量化钩子 | 数据质量，影响 RAG 效果 |
| P1 | 滚动摘要链（2.2） | 长篇写作最核心痛点，实现成本低 |
| P2 | ReAct 多轮循环（2.1） | 架构图核心承诺，影响生成质量上限 |
| P2 | 生成模式扩展（1.3）+ 风格配置（1.4） | 直接影响日常写作效率 |
| P3 | MCP 写操作工具（2.4）+ 版本快照（2.5） | 增强外部集成能力 |
| P3 | Phase 3 各项 | 产品完整度，不影响核心流程 |

---

## 附：`novelforge_architecture.svg` 规划模块完成度

| 架构层 | 规划功能 | 当前状态 |
|---|---|---|
| Frontend | 大纲管理、章节编辑器、导出面板、模型配置 | ✅ 已实现 |
| Workers API | REST API、SSE 流式输出、MCP Server、导出任务 | ✅ 已实现（MCP 只读） |
| Agent Core | 上下文组装 → RAG → 工具调用 → LLM → 摘要 | ⚠️ 工具调用循环未实现 |
| D1 | 结构化数据（大纲/章节/摘要） | ✅ 已实现 |
| Vectorize | 向量索引、RAG 语义检索 | ⚠️ 有 B6 数据污染问题 |
| R2 | 导出文件、角色图片 | ⚠️ 导出兼容性未验证；版本快照未实现 |
| Workers AI | Embedding（bge-base-zh） | ✅ 已实现（串行，待并发优化） |
| 模型配置层 | 多 provider、per-stage 配置 | ⚠️ 有 B3 查询逻辑缺陷 |
| 导出模块 | epub/txt/md/pdf/zip | ⚠️ EPUB/PDF Workers 兼容性未验证 |
| MCP Server | 工具暴露给 Claude Desktop | ⚠️ 缺写操作工具 |
