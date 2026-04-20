# NovelForge · 完整开发计划

> 基于 v1.3.0 代码全量审查 + 你的产品愿景综合制定。
> 最终目标：**一句话生成一部完整小说**——从创意到成品的全链路 AI 编排平台。

---

## 现状评估（先看清楚在哪里）

### 已经有的（不用重做）

| 模块 | 完成度 | 说明 |
|---|---|---|
| 基础 CRUD | ✅ 完整 | 小说/卷/章节/角色/大纲 全套 |
| 富文本编辑器 | ✅ 可用 | Novel.js + 自动保存 |
| RAG 向量检索 | ✅ 架子搭好 | BGE-zh 嵌入 + Vectorize，有数据污染 bug |
| SSE 流式生成 | ✅ 可用 | 章节生成已跑通 |
| 自动摘要 | ✅ 可用 | 生成后自动触发 |
| 多 Provider 支持 | ✅ 可用 | Volcengine / OpenAI / Anthropic |
| 多格式导出 | ✅ 基本 | EPUB/MD/TXT/ZIP，兼容性未验证 |
| MCP Server | ⚠️ 只读 | 无写操作工具 |
| Agent 循环 | ⚠️ 假 ReAct | 实际是单次调用，循环逻辑是死代码 |
| 大纲 AI 生成 | ⚠️ 片面 | 只能单节点生成，无整体规划 |

### 代码中的严重 Bug（必须先修）

代码里已有一份审查文档（`docs/NovelForge-审查与增强方案.md`）记录了 B1~B6 共 6 个 bug，其中 3 个严重级：

- **B2**：`triggerAutoSummary` 未 export → 手动摘要路由 100% 500 报错
- **B3**：`resolveConfig` 查询逻辑错误 → 多小说场景下跨小说用错模型
- **B6**：Vectorize 向量删旧顺序错误 → 旧向量永久残留，RAG 结果被污染

---

## 你的愿景拆解与补充

你的核心流程思路是对的，我在细节层补充了关键缺失点：

```
你描述的流程：
  创意对话 → 总纲 → 角色/世界观 → 卷纲 → 章纲 → 章节正文 → 摘要 → 下一章

补充的缺失点：
  1. 创意对话需要"多轮收敛"——LLM 不是一次就能问出好的世界观，
     需要对话式追问 + 用户确认 + 自动填充数据库
  
  2. 伏笔追踪系统——你提到"本章是否要收尾伏笔、是否要埋入伏笔"，
     当前架构没有任何伏笔数据结构，需要专门建模
  
  3. 境界/成长体系追踪——仙侠类高频需求，主角当前境界必须在上下文中，
     生成时不能境界倒退或突破跨度太大
  
  4. 章节间连贯性评估——生成完一章后自动检查：
     - 与前章摘要是否衔接
     - 伏笔状态是否一致
     - 人物境界是否符合设定
  
  5. 一句话→小说 的编排层（终极目标）——需要一个 Orchestrator Agent
     把以上所有步骤串起来，可中断、可干预、可异步执行
```

---

## Phase 0 · Bug 修复（第 1 天，必做，不可跳过）

**目标**：让现有功能真正跑通，消灭静默失效。

### 任务清单

| # | 文件 | 修复内容 | 影响 |
|---|---|---|---|
| B1 | `contextBuilder.ts` | `estimateMandatoryTokens` 调用参数名对齐 | debug.totalTokenEstimate 始终为 0 |
| B2 | `agent.ts` | `triggerAutoSummary` 加 `export` | 手动摘要 500 |
| B3 | `llm.ts` | `resolveConfig` 两段查询加 `novelId + stage` 双过滤 | 多小说模型串台 |
| B4 | `server/lib/types.ts` | `Env` 补 `VECTORIZE?: VectorizeIndex` | 类型安全 |
| B5 | `agent.ts` + `generate.ts` | `onDone` 回调传 `resolvedModelId`，写入日志 | 日志 modelId 全为 "unknown" |
| B6 | `embedding.ts` | 先取旧 vectorId 列表，再删 D1，再删 Vectorize | RAG 数据污染 |

**验收**：`POST /api/generate/chapter`（开启 RAG）完整跑通，日志 `model_id` 有实际值，多次更新同一章节后 Vectorize 不积累重复向量。

---

## Phase 1 · 核心写作流补完（第 1~2 周）

**目标**：把现有功能做扎实，让"写一本小说"的基础流程顺滑。

### 1.1 滚动摘要链（最高优先级）

**问题**：现在只注入上一章摘要。写到第 50 章，LLM 对前期伏笔和人物关系完全失忆。

**方案**：
- `ContextBundle.mandatory` 已有 `recentChainSummaries`，但 `contextBuilder.ts` 的 `fetchRecentChapterSummaries` 固定取 3 条
- 暴露配置项 `summaryChainLength`（默认 5，最大 15）到 `model_configs.params`
- 摘要链注入格式：明确标注章节序号 + 章节标题，便于 LLM 定位上下文

### 1.2 伏笔追踪系统（新增，你提到但没有数据结构）

**新建 `foreshadowing` 表**：

```sql
CREATE TABLE foreshadowing (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT,          -- 埋入伏笔的章节
  title TEXT NOT NULL,       -- 伏笔标题（简短描述）
  description TEXT,          -- 详细内容
  status TEXT DEFAULT 'open', -- open / resolved / abandoned
  resolved_chapter_id TEXT,  -- 收尾章节
  importance TEXT DEFAULT 'normal', -- high / normal / low
  created_at INTEGER,
  updated_at INTEGER
)
```

- **生成时自动注入**：`contextBuilder` 在强制注入层加入 `fetchOpenForeshadowing`，查出当前章节前所有 status='open' 的伏笔，注入到 system prompt
- **生成后自动提取**：章节生成完成后，用轻量模型分析内容，提取新埋伏笔 + 标记已收尾伏笔，写入 DB
- **前端**：大纲编辑器侧边栏增加"伏笔面板"，可手动管理

### 1.3 境界/成长体系追踪

**扩展 `characters` 表**：新增 `power_level` 字段（JSON）存储当前境界信息：

```json
{
  "system": "修仙境界",
  "current": "金丹期初期",
  "breakthroughs": [
    { "chapterId": "xxx", "from": "筑基期", "to": "金丹期", "note": "..." }
  ]
}
```

- 生成时将主角当前境界注入 prompt："当前境界：金丹期初期，距离突破还需..."
- 生成后用轻量模型检测是否有境界突破事件，自动更新 DB
- 前端角色卡片展示境界历史时间线

### 1.4 ReAct Agent 真正实现

**问题**：现在的"Agent 循环"是死代码，实际就是一次 LLM 调用。

**方案**：
```
while (iteration < maxIterations):
  1. 调用 LLM，开启 stream
  2. 检测 stream 中的 tool_call 事件（OpenAI function calling 格式）
  3. 无工具调用 → 结束循环，输出内容
  4. 有工具调用 → 执行工具 → tool_result 追加 messages → 继续循环
```

关键改动：
- 工具调用需使用 OpenAI 标准 `tools` 格式（而非当前的 JSON 文本解析方案，文本解析极不稳定）
- SSE 增加 `{ type: 'tool_call', name, status: 'running' | 'done', result }` 事件
- 前端 `GeneratePanel` 实时显示工具执行过程（"正在查询大纲..." "正在搜索相关内容..."）

### 1.5 大纲 AI 生成增强

**问题**：现在只能单节点生成，"生成整卷大纲"需要逐个节点点击。

**方案**：
- 新路由 `POST /api/generate/outline-batch`，接受卷 ID，一次性生成该卷下所有章节大纲
- 生成策略：先生成卷纲总结 → 再并发生成各章大纲（考虑 D1 写入并发限制）
- 前端"卷"节点右键菜单增加"AI 批量生成章节大纲"选项

### 1.6 生成模式完善（续写/重写）

代码里已有 `continue` / `rewrite` 模式但前端未接入：
- `GeneratePanel` 增加模式切换 tab
- `rewrite` 模式：用户在编辑器中选中文本 → 触发重写，传入选中内容
- `continue` 模式：传入当前章节末尾 500 字作为上下文

---

## Phase 2 · 对话式创作引擎（第 3~4 周）

**目标**：实现你描述的"通过多轮对话，LLM 帮我总结出小说名称、总纲等内容"。

这是当前完全缺失的最核心功能模块。

### 2.1 创作对话系统（核心新功能）

**架构**：

```
用户输入 "我想写一部主角从废柴逆袭的玄幻小说"
    ↓
对话引导 Agent（新模块）
    ↓ 多轮对话追问：
      - 世界背景？（修仙 / 斗气 / 末日？）
      - 主角起点？（天才被废 / 平民崛起 / 穿越者？）
      - 核心爽点？（系统 / 神器 / 天道认可？）
      - 预计卷数？
      ↓ 用户回答 3~5 轮后
对话 Agent 汇总 → 生成结构化元数据 → 自动填入数据库
    ↓
输出：小说标题、总纲、世界观草稿、主角设定草稿
```

**技术实现**：

```
新路由：POST /api/workshop/session（创建对话会话）
        POST /api/workshop/session/:id/message（发送消息，SSE 响应）
        GET  /api/workshop/session/:id（获取会话历史）
        POST /api/workshop/session/:id/commit（确认生成，写入 DB）
```

新建 `workshop_sessions` 表：

```sql
CREATE TABLE workshop_sessions (
  id TEXT PRIMARY KEY,
  novel_id TEXT,              -- 关联小说（commit 后写入）
  stage TEXT NOT NULL,        -- 'concept' | 'worldbuild' | 'characters' | 'volumes' | 'chapters'
  messages TEXT NOT NULL,     -- JSON 对话历史
  extracted_data TEXT,        -- JSON 当前提取的结构化数据
  status TEXT DEFAULT 'active', -- active / committed / abandoned
  created_at INTEGER,
  updated_at INTEGER
)
```

前端：全新的"创作工坊"页面，左侧对话流，右侧实时预览提取的结构化内容（标题/总纲/角色/大纲树），用户确认后一键提交写入。

### 2.2 分层 Prompt 体系

当前所有生成用同一套 prompt，没有按层级区分。需要建立：

| 层级 | 输入 | 输出 | 模型建议 |
|---|---|---|---|
| 创意层 | 一句话描述 | 小说名 + 总纲 + 核心设定 | 强模型（GPT-4o / Claude Sonnet） |
| 世界观层 | 总纲 + 流派 | 世界观文档（3000字） | 强模型 |
| 角色层 | 总纲 + 世界观 | 角色卡（主角/配角/反派） | 中等模型 |
| 卷层 | 总纲 + 角色 | 卷纲（事件线+蓝图） | 中等模型 |
| 章纲层 | 卷纲 + 前情 | 章节大纲（关键事件+伏笔指令） | 轻量模型 |
| 正文层 | 章纲 + 上下文包 | 章节正文（3000~5000字） | 强模型 |
| 摘要层 | 正文 | 摘要 + 伏笔提取 + 境界更新 | 轻量模型 |

每层在 `model_configs` 中有独立的 `stage` 配置，允许分配不同模型和参数。

### 2.3 章节生成上下文包 v2

当前章节生成注入的上下文是"能拿多少拿多少"，需要改为"精准按需注入"：

**章节生成上下文包应包含**（按 token 优先级排序）：

```
[必须注入，共约 4000 tokens]
- 本章大纲（含本章应埋/收的伏笔指令）
- 上一章摘要
- 主角当前状态卡（境界、装备、随行人物）

[按需注入，共约 4000 tokens]  
- 最近 5 章摘要链
- 当前卷概要
- 关联人物设定（本章出现的角色）
- 未收尾伏笔列表（status='open'，按 importance 排序）

[RAG 动态检索，共约 4000 tokens]
- 语义相关的世界观设定片段
- 语义相关的历史章节内容
- 语义相关的角色描述

[总计约 12000 tokens，与现有 DEFAULT_BUDGET 一致]
```

---

## Phase 3 · 一键生成编排器（第 5~6 周）

**目标**：实现终极愿景——用户给一句话，系统自动完成从创意到完整小说的全流程。

### 3.1 Orchestrator Agent（核心）

**这是整个项目最复杂的模块**，需要一个能够：
- 按依赖顺序编排所有生成步骤
- 在每个关键节点暂停等待用户确认
- 支持断点续传（中途退出可以继续）
- 实时推送进度到前端

**架构设计**：

```
新建 novel_plans 表：
  id, novel_id, status, current_step, total_steps,
  plan_data (JSON), error_msg, created_at, updated_at

步骤定义（plan_data 存储）：
  [
    { step: 1, type: 'concept', status: 'done', data: {...} },
    { step: 2, type: 'worldbuild', status: 'pending', data: null },
    { step: 3, type: 'characters', status: 'pending', ... },
    { step: 4, type: 'volume_outline', count: 3, ... },  // 3卷
    { step: 5, type: 'chapter_outlines', count: 30, ... }, // 30章
    { step: 6, type: 'chapters', count: 30, ... }          // 30章正文
  ]
```

**用户干预节点**（不能全自动，必须人工确认）：
- 总纲生成后：用户确认/修改小说方向
- 世界观生成后：用户确认核心设定
- 角色生成后：用户确认主角设定
- 每卷卷纲生成后：用户确认该卷走向

**新路由**：
```
POST /api/plan/create    - 输入一句话，启动规划
GET  /api/plan/:id       - 查询当前进度
POST /api/plan/:id/approve/:step  - 用户确认某步骤
POST /api/plan/:id/resume         - 用户确认后继续
POST /api/plan/:id/pause          - 暂停
DELETE /api/plan/:id              - 放弃
```

### 3.2 批量章节生成队列

一键生成整卷或整书时，需要串行+限速生成所有章节（避免并发打爆 API 限额）：

- 使用 Cloudflare Queues 或 D1 表模拟任务队列
- 每章生成后：自动生成摘要 → 提取伏笔 → 更新境界 → 触发下一章
- 前端实时展示进度面板：已完成章节数 / 总字数 / 预计剩余时间 / token 消耗

### 3.3 前端"指挥台"页面

新增专门的小说生成指挥台页面（区别于普通编辑工作区）：

```
┌─────────────────────────────────────────────────────┐
│  [小说标题]    状态：生成中 第12章/共30章  48%       │
├──────────────┬──────────────────────────────────────┤
│  生成计划树  │  当前步骤详情                        │
│  ○ 总纲 ✓   │  正在生成：第12章《龙渊秘境》        │
│  ○ 世界观 ✓  │  ────────────────────────────────   │
│  ○ 角色 ✓    │  [实时流式输出预览...]               │
│  ○ 第一卷 ✓  │                                      │
│    ○ 1-1 ✓   │  上下文包：                          │
│    ○ 1-2 ✓   │  ✓ 本章大纲  ✓ 上章摘要             │
│    ○ 1-3 ⏳  │  ✓ 摘要链×5  ✓ 角色卡×3            │
│  ○ 第二卷 …  │  ✓ 伏笔×2   ✓ RAG命中×4            │
│              │                                      │
│  [暂停] [继续]│  [查看全文] [修改后继续]            │
└──────────────┴──────────────────────────────────────┘
```

---

## Phase 4 · 智能化深度增强（第 7~10 周）

**目标**：让生成质量真正达到网文水准，而不只是流畅但平淡的文本。

### 4.1 情节图谱（Plot Graph）

将小说中的事件、人物、地点建模为图结构，存储在 D1 中：

```
节点类型：event（事件）/ character（角色）/ location（地点）/ item（物品）
边类型：caused_by / participated_in / occurred_at / owned_by
```

- 每章生成后，轻量模型提取新增节点和关系，自动更新图谱
- 生成新章节前，查询图谱中与本章相关的节点，精准注入
- 前端提供可视化的情节图谱视图

### 4.2 写作质量评估器

每章生成完成后，自动运行质量评分（不阻塞主流程，异步）：

| 维度 | 评分依据 |
|---|---|
| 情节推进度 | 本章是否有实质性情节发展 |
| 人物一致性 | 行为是否符合角色设定 |
| 伏笔遵守度 | 应收伏笔是否收了，埋入伏笔是否自然 |
| 爽感密度 | 高潮/反转/成就感事件的频率 |
| 文笔流畅度 | 重复词汇率、句式多样性 |

低于阈值时自动提示用户重新生成或修改。

### 4.3 多模态封面生成

当小说总纲和主角设定完成后：
- 调用图像生成 API（Stability AI / DALL-E / CF Workers AI 的 `@cf/stabilityai/stable-diffusion-xl-base-1.0`）
- 自动生成符合小说风格的封面图
- 存储到 R2，更新 `novels.coverR2Key`

### 4.4 写作风格克隆（高级功能）

用户上传参考小说章节（1~3 章）：
- 对参考文本进行风格分析：句子平均长度、对话比例、描写密度、用词风格
- 将风格参数注入 `system prompt`
- 生成的内容在文风上向参考作品靠拢

### 4.5 MCP 写操作工具补全

让 Claude Desktop / 其他 MCP 客户端可以完整操作 NovelForge：

| 工具 | 功能 |
|---|---|
| `createNovel` | 创建新小说 |
| `createOutline` | 创建大纲节点 |
| `updateChapter` | 修改章节内容 |
| `addCharacter` | 添加角色 |
| `addForeshadowing` | 添加伏笔 |
| `generateChapterViaMCP` | 触发章节生成 |
| `getNovelStatus` | 获取小说完整状态 |

### 4.6 多用户与协作

- 集成 Cloudflare Access 实现身份验证
- 多用户数据隔离（`user_id` 字段注入所有表）
- 协作模式：多人实时编辑（基于 Cloudflare Durable Objects + WebSocket）

---

## Phase 5 · 产品化与生态（第 11 周以后）

**目标**：从工具变成产品。

### 5.1 模板市场

- 内置 10+ 类型小说模板（玄幻、都市、科幻、言情、悬疑等）
- 每个模板包含：世界观框架、常用角色类型、写作风格 Prompt、章纲结构
- 用户可导出/导入自己的模板

### 5.2 RAG 知识库扩展

- 用户可上传参考资料（世界设定文档、历史背景资料、已有章节）到个人知识库
- 生成时自动从知识库 RAG 检索相关内容注入
- 向量化入库支持 PDF / DOCX / TXT

### 5.3 语音朗读

- 使用 Workers AI TTS 或第三方 TTS API
- 章节生成完成后可一键转语音
- R2 存储音频，支持流式播放

### 5.4 公开分享与阅读

- 签名 URL 分享（R2 + 时效链接）
- 公开小说主页（SSR/SSG 生成静态页）
- 读者评论系统

---

## 技术债务与架构注意事项

### 需要补充的基础设施

| 项目 | 当前状态 | 建议 |
|---|---|---|
| EPUB/PDF 导出 Workers 兼容性 | 未验证 | Phase 1 期间在 `wrangler dev` 下实测，必要时外置 Node 边车 |
| D1 查询性能 | 单表查询，无索引规划 | 给 `chapters.novel_id + sort_order`、`outlines.novel_id + type` 加索引 |
| SSE 连接超时 | Workers 30s 限制 | 长章节生成（>6000字）可能超时；拆成 continue 模式分段生成 |
| Vectorize 批量索引 | 串行逐条写入 | 改为 `upsert` 批量接口，初始索引性能提升 10x |
| 错误监控 | 无 | 接入 Sentry（Workers 版）或 Cloudflare Analytics Engine |

### D1 Schema 需新增的表

```sql
-- Phase 1 新增
CREATE TABLE foreshadowing (...);

-- Phase 2 新增  
CREATE TABLE workshop_sessions (...);

-- Phase 3 新增
CREATE TABLE novel_plans (...);
CREATE TABLE generation_queue (...);

-- Phase 4 新增
CREATE TABLE plot_nodes (...);
CREATE TABLE plot_edges (...);
CREATE TABLE quality_scores (...);
```

---

## 阶段里程碑一览

| 阶段 | 时间 | 核心交付 | 验收标准 |
|---|---|---|---|
| Phase 0 | 第 1 天 | 6 个 Bug 修复 | 全链路生成跑通，日志正常 |
| Phase 1 | 第 1~2 周 | 写作流补完 | 伏笔面板可用，真 ReAct 工具调用，续写/重写可用 |
| Phase 2 | 第 3~4 周 | 对话式创作引擎 | 用户通过对话能创建完整小说框架 |
| Phase 3 | 第 5~6 周 | 一键生成编排器 | 输入一句话，30 章小说能自动跑完（含干预节点） |
| Phase 4 | 第 7~10 周 | 智能深度增强 | 质量评分、情节图谱、风格克隆 |
| Phase 5 | 第 11 周+ | 产品化 | 模板市场、多用户、公开分享 |

---

## 最近要做的 10 件事（按优先级）

1. **修复 B2/B3/B6**（今天，1小时）
2. **修复 B1/B4/B5**（今天，30分钟）
3. **实现真 ReAct 工具调用**（第 2~3 天）
4. **滚动摘要链**（第 3 天，改 contextBuilder 20 行）
5. **伏笔追踪表 + contextBuilder 注入**（第 4~5 天）
6. **境界追踪字段**（第 5 天，改 characters 表）
7. **创作工坊对话 API**（第 6~8 天）
8. **创作工坊前端页面**（第 9~12 天）
9. **批量章节大纲生成**（第 10 天）
10. **Orchestrator Agent 设计 + 实现**（第 2 周）

---

*生成日期：2026-04-20 | 基于 NovelForge v1.3.0 代码审查*
