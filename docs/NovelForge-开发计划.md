# NovelForge · 开发计划（更新版）

> 基于 v1.4.0 代码全量审查重新制定。  
> 最终目标：**一句话生成一部完整小说**——从创意到成品的全链路 AI 编排平台。  
> 更新日期：2026-04-21

---

## 现状评估（v1.4.0 实际完成情况）

### 已完成（不用重做）

| 模块 | 完成度 | 说明 |
|---|---|---|
| 基础 CRUD | ✅ 完整 | 小说 / 卷 / 章节 / 角色 全套，含软删除 |
| 富文本编辑器 | ✅ 可用 | Novel.js + 自动保存（防抖 1.5s） |
| 阅读器 | ✅ 可用 | Markdown 渲染，主题切换，字号调节 |
| SSE 流式生成 | ✅ 可用 | 章节生成已跑通，含 tool_call 事件 |
| RAG 向量检索 | ✅ 可用 | BGE-zh 嵌入 + Vectorize，vector_index 追踪表 |
| 自动摘要 | ✅ 可用 | 生成后自动触发，写入 chapters.summary |
| 多 Provider 支持 | ✅ 可用 | Volcengine / OpenAI / Anthropic，多级配置 |
| 多格式导出 | ✅ 基本 | EPUB / MD / TXT / ZIP，兼容性未全量验证 |
| **真 ReAct Agent 循环** | ✅ 已实现 | `runReActLoop` 多轮循环，文本解析工具调用 |
| **滚动摘要链** | ✅ 已实现 | 摘要链长度可配（0-15），从 model_configs.params 读取 |
| **伏笔追踪系统** | ✅ 已实现 | foreshadowing 表 + contextBuilder 注入 + 前端面板 |
| **境界/成长追踪** | ✅ 已实现 | powerLevel JSON 字段 + powerLevel.ts 服务 + 自动检测 |
| **总纲管理** | ✅ 已实现 | master_outline 表，版本历史，向量化支持 |
| **小说设定系统** | ✅ 已实现 | novel_settings 表，6 种类型，树形结构，RAG 可检索 |
| **创作规则系统** | ✅ 已实现 | writing_rules 表，优先级 + 启用控制，注入 context |
| **实体索引** | ✅ 已实现 | entity_index 表，树形结构，可重建 |
| **角色图片 + 视觉分析** | ✅ 已实现 | R2 上传 + LLaVA 分析，生成外貌/标签 |
| **内容搜索** | ✅ 基本 | 章节关键词搜索，结果高亮预览 |
| MCP Server | ✅ 已实现 | 只读工具（查询小说/大纲/章节/角色/语义搜索） |
| **批量大纲生成** | ✅ 已实现 | `generateOutlineBatch` 已实现，前端待接入 |
| 角色一致性检查 | ✅ 已实现 | `checkCharacterConsistency` 服务 + 前端组件 |
| 生成日志 | ✅ 已实现 | generation_logs 表，GenerationLogs 前端组件 |
| 卷增强 | ✅ 已实现 | volumes 表含 outline / blueprint / summary 字段 |

### 仍存在的已知问题

> 原计划 B1-B6 六个 Bug，以下是**尚未确认修复**的部分，需逐一验证：

| # | 位置 | 问题 | 优先级 |
|---|---|---|---|
| B3 | `llm.ts · resolveConfig` | 多小说场景下模型串台（novelId + stage 双过滤是否已加） | 🔴 高 |
| B6 | `embedding.ts` | 更新章节时旧向量删除顺序（先取 ID → 删 D1 → 删 Vectorize） | 🔴 高 |
| B5 | `agent.ts / generate.ts` | generation_logs.model_id 是否仍写入 "unknown" | 🟡 中 |

---

## 当前架构速览

### 数据库（13 张表，v2.0）

```
novels              小说主表
master_outline      总纲（版本化）
writing_rules       创作规则（优先级 + 启用控制）
novel_settings      小说设定（世界观/境界/势力/地理/物品/杂录）
volumes             卷（含大纲/蓝图/概要）
chapters            章节（含摘要/向量/生成统计）
characters          角色（含 powerLevel JSON）
foreshadowing       伏笔追踪（open/resolved/abandoned）
model_configs       模型配置（全局/小说级，多 stage）
generation_logs     生成日志
exports             导出记录
vector_index        向量索引追踪
entity_index        实体树索引
```

### 后端路由（16 个模块）

```
/api/novels             /api/chapters         /api/volumes
/api/characters         /api/settings         /api/rules
/api/master-outline     /api/generate         /api/foreshadowing
/api/entities           /api/export           /api/search
/api/vectorize          /api/config           /api/mcp
/api/health
```

### 前端结构

```
页面：NovelsPage / WorkspacePage / ReaderPage
侧边栏 7 个 Tab：章节 / 角色 / 设定 / 规则 / 总纲 / 卷 / 伏笔
右侧面板 2 个 Tab：AI 生成 / 导出
```

### 服务层

```
agent.ts            ReAct 循环 + 工具调用 + 自动摘要 + 批量大纲 + 角色一致性检查
contextBuilder.ts   上下文组装（摘要链 + 伏笔 + 境界 + 规则 + RAG）
llm.ts              多 Provider 统一调用层
embedding.ts        向量化服务
powerLevel.ts       境界突破检测
vision.ts           角色图片视觉分析
export.ts           多格式导出
foreshadowing.ts    伏笔提取
entity-index.ts     实体树管理
```

---

## Phase 0 · 遗留 Bug 修复（最优先，1 天内）

**目标**：确认并清除所有静默失效。

| # | 文件 | 验证方法 | 修复内容 |
|---|---|---|---|
| B3 | `llm.ts · resolveConfig` | 切换两个小说各配不同模型，检查生成日志的 model_id | 查询加 `novelId + stage` 双条件过滤 |
| B6 | `embedding.ts` | 同一章节更新 3 次后，Vectorize 中该章向量条数应等于 chunk 数而非累积 | 先查 vector_index 取旧 id → 删 D1 记录 → 删 Vectorize |
| B5 | `generate.ts` | 生成一章后查 generation_logs，model_id 字段应为真实模型名 | onDone 回调传 resolvedModelId |

**验收**：多小说生成日志 model_id 全部为真实值，同一章节反复更新后 Vectorize 不积累重复向量。

---

## Phase 1 · 功能完整性补全（第 1~2 周）

**目标**：把已实现的后端能力全部接入前端，消灭"有 API 没 UI"的空缺。

### 1.1 批量大纲生成前端接入

后端 `generateOutlineBatch` 已实现，前端未接入。

- VolumePanel 卷节点增加"AI 批量生成章节大纲"操作入口
- 触发后 SSE 流式展示逐章生成进度
- 生成完成后自动刷新章节列表

### 1.2 生成模式完整接入（续写 / 重写）

后端 `mode: continue | rewrite` 已支持，GeneratePanel 未暴露。

- GeneratePanel 增加模式切换（生成 / 续写 / 重写）
- rewrite 模式：从编辑器读取选中文本，传入 existingContent
- continue 模式：自动截取当前章节末尾 500 字作为上下文

### 1.3 境界追踪前端展示

powerLevel.ts 服务已实现自动检测，前端角色卡片未展示。

- CharacterList / 角色详情展示境界信息和突破历史时间线
- 境界字段在角色编辑表单中可手动录入和修改

### 1.4 MCP 写操作工具补全

当前 MCP Server 只有读工具，无法通过 Claude Desktop 写入内容。

新增工具：

| 工具名 | 功能 |
|---|---|
| `createChapter` | 创建章节 |
| `updateChapter` | 修改章节内容 |
| `addForeshadowing` | 新增伏笔 |
| `resolveForeshadowing` | 标记伏笔已收尾 |
| `addWritingRule` | 添加创作规则 |
| `triggerGenerate` | 触发章节生成 |

### 1.5 导出兼容性验证与修复

EPUB / ZIP 导出在 Cloudflare Workers 环境下兼容性未验证。

- 在 `wrangler dev` 下全量测试四种格式
- EPUB 如有 Worker 兼容问题，改为生成 ZIP + 客户端组装方案
- 修复已知的 export 关键字冲突后遗症

---

## Phase 2 · 生成质量深化（第 3~4 周）

**目标**：让 AI 生成的内容质量真正达到可用水准，而不只是流畅但平淡的文本。

### 2.1 ReAct 工具调用机制升级

当前 ReAct 循环使用文本解析提取工具调用（极不稳定，依赖 LLM 严格输出格式）。

**升级方案**：
- 改用 OpenAI 标准 `tools` 参数格式（function calling），消灭文本解析
- SSE 增加 `{ type: 'tool_call', name, status: 'running' | 'done', result }` 事件
- GeneratePanel 实时显示工具执行步骤（"正在查询伏笔..." "正在检索世界观..."）

> 根本原因：文本解析依赖模型严格遵守格式，任何一次格式偏差就丢失工具调用；function calling 是协议级保证。

### 2.2 章节生成上下文包精细化

当前上下文是"能拿多少拿多少"的策略，需改为按优先级精准注入：

```
[强制注入 ~4000 tokens]
- 本章大纲（含伏笔指令）
- 上一章摘要
- 主角当前状态卡（境界 + 随行人物）
- 激活的高优先级创作规则

[按需注入 ~4000 tokens]
- 最近 N 章摘要链（N 从 model_configs 读取）
- 当前卷概要
- 本章出现角色的设定卡
- 未收尾伏笔列表（按 importance 排序）

[RAG 动态检索 ~4000 tokens]
- 语义相关的世界观/境界/势力设定
- 语义相关的历史章节片段
```

### 2.3 章节连贯性自动检测

章节生成完成后，异步运行一次轻量模型检查（不阻塞主流程）：

- 与前章摘要衔接是否自然
- 应收尾的伏笔是否已收（对比本章大纲中的伏笔指令）
- 主角境界是否出现不合理突变

检测结果以非阻塞 toast 形式提示用户，不强制重生成。

### 2.4 写作统计增强

WritingStats 组件已存在但数据较少，增加：

- 每日字数趋势折线图
- 各章生成耗时和 token 消耗（来自 generation_logs）
- 模型使用分布

---

## Phase 3 · 对话式创作引擎（第 5~6 周）

**目标**：实现"通过多轮对话，LLM 帮我总结出小说名称、总纲等内容"——当前完全缺失的核心模块。

### 3.1 创作工坊（Workshop）

**新增数据库表**：

```sql
CREATE TABLE workshop_sessions (
  id TEXT PRIMARY KEY,
  novel_id TEXT,
  stage TEXT NOT NULL,       -- concept | worldbuild | characters | volumes | chapters
  messages TEXT NOT NULL,    -- JSON 对话历史
  extracted_data TEXT,       -- JSON 当前提取的结构化数据
  status TEXT DEFAULT 'active',  -- active | committed | abandoned
  created_at INTEGER,
  updated_at INTEGER
)
```

**新增路由**：

```
POST /api/workshop/session              创建对话会话
POST /api/workshop/session/:id/message  发消息（SSE 响应）
GET  /api/workshop/session/:id          获取会话历史
POST /api/workshop/session/:id/commit   确认，写入数据库
```

**前端**：新增"创作工坊"页面（`/workshop`），左侧多轮对话，右侧实时预览已提取的结构化内容（标题 / 总纲 / 角色草稿 / 卷纲树），用户确认后一键提交写入。

**对话引导流程**：

```
用户："我想写一部仙侠小说，主角从废柴逆袭"
  → Agent 追问：世界背景？主角起点？核心爽点？预计卷数？
  → 3~5 轮对话后汇总
  → 生成结构化元数据，自动填入 novels + master_outline + characters + volumes
```

### 3.2 分层 Prompt 体系

当前所有生成共用一套 prompt。建立按层级区分的 stage 配置：

| stage | 输入 | 输出 | 推荐模型级别 |
|---|---|---|---|
| `concept` | 一句话描述 | 小说名 + 总纲 + 核心设定 | 强模型 |
| `worldbuild` | 总纲 + 流派 | 世界观文档（3000字） | 强模型 |
| `character_design` | 总纲 + 世界观 | 角色卡（主角/配角/反派） | 中等模型 |
| `volume_outline` | 总纲 + 角色 | 卷纲（事件线+蓝图） | 中等模型 |
| `chapter_outline` | 卷纲 + 前情 | 章节大纲（关键事件+伏笔指令） | 轻量模型 |
| `chapter` | 章纲 + 上下文包 | 章节正文（3000~5000字） | 强模型 |
| `summary` | 正文 | 摘要 + 伏笔提取 + 境界更新 | 轻量模型 |

每个 stage 在 model_configs 中有独立配置，允许分配不同模型和参数。

---

## Phase 4 · 一键生成编排器（第 7~8 周）

**目标**：实现终极愿景——输入一句话，系统自动完成从创意到完整小说的全流程。

### 4.1 Orchestrator Agent

**新增数据库表**：

```sql
CREATE TABLE novel_plans (
  id TEXT PRIMARY KEY,
  novel_id TEXT,
  status TEXT DEFAULT 'running',  -- running | paused | done | failed
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER,
  plan_data TEXT NOT NULL,         -- JSON 步骤定义
  error_msg TEXT,
  created_at INTEGER,
  updated_at INTEGER
)

CREATE TABLE generation_queue (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  step_type TEXT NOT NULL,         -- concept | worldbuild | character_design | ...
  step_index INTEGER,
  target_id TEXT,                  -- 目标 chapter_id / volume_id 等
  status TEXT DEFAULT 'pending',   -- pending | running | done | failed
  result TEXT,                     -- JSON
  error_msg TEXT,
  created_at INTEGER
)
```

**新增路由**：

```
POST   /api/plan/create           输入一句话，启动规划
GET    /api/plan/:id              查询当前进度（SSE 或轮询）
POST   /api/plan/:id/approve/:step  用户确认某关键节点
POST   /api/plan/:id/resume       用户确认后继续
POST   /api/plan/:id/pause        暂停
DELETE /api/plan/:id              放弃
```

**必须人工确认的节点**（不能全自动）：

- 总纲生成后：确认小说方向
- 世界观生成后：确认核心设定
- 角色生成后：确认主角设定
- 每卷卷纲生成后：确认该卷走向

### 4.2 前端"指挥台"页面

新增 `/novels/:id/command` 路由，区别于普通工作区：

```
┌────────────────────────────────────────────────────┐
│  [小说标题]   状态：生成中  第12章/共30章  48%      │
├─────────────┬──────────────────────────────────────┤
│  生成计划树 │  当前步骤详情                        │
│  ○ 总纲 ✓  │  正在生成：第12章《龙渊秘境》        │
│  ○ 世界观 ✓ │  ─────────────────────────────────  │
│  ○ 角色 ✓   │  [流式输出预览...]                   │
│  ○ 第一卷 ✓ │                                      │
│    ○ 1-1 ✓  │  上下文包：                          │
│    ○ 1-2 ✓  │  ✓ 本章大纲  ✓ 上章摘要             │
│    ○ 1-3 ⏳ │  ✓ 摘要链×5  ✓ 角色卡×3            │
│  ○ 第二卷 … │  ✓ 伏笔×2   ✓ RAG 命中×4           │
│             │                                      │
│  [暂停][继续]│  [查看全文][修改后继续]             │
└─────────────┴──────────────────────────────────────┘
```

---

## Phase 5 · 智能增强（第 9~12 周）

**目标**：让平台具备真正的智能辅助能力，而不只是"执行生成请求的工具"。

### 5.1 写作质量评分

章节生成完成后异步运行（不阻塞），结果写入新表 `quality_scores`：

| 维度 | 评分依据 |
|---|---|
| 情节推进度 | 本章是否有实质性情节发展 |
| 人物一致性 | 行为是否符合角色设定 |
| 伏笔遵守度 | 应收伏笔是否收了，埋入伏笔是否自然 |
| 爽感密度 | 高潮/反转/成就感事件的频率 |
| 文笔流畅度 | 重复词汇率、句式多样性 |

低于阈值时提示用户重新生成或修改，不强制拦截。

### 5.2 情节图谱（Plot Graph）

将事件、人物、地点建模为图结构：

```sql
CREATE TABLE plot_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  type TEXT NOT NULL,       -- event | character | location | item
  title TEXT NOT NULL,
  description TEXT,
  chapter_id TEXT,
  meta TEXT,                -- JSON
  created_at INTEGER
)

CREATE TABLE plot_edges (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,   -- caused_by | participated_in | occurred_at | owned_by
  created_at INTEGER
)
```

- 每章生成后轻量模型自动提取新节点和关系
- 前端提供可视化图谱视图（使用 D3 或 React Flow）

### 5.3 写作风格克隆

用户上传 1~3 章参考文本：

- 分析文风参数：句子平均长度、对话比例、描写密度、用词偏好
- 将风格参数注入 system prompt
- 生成内容在文风上向参考作品靠拢

### 5.4 多模态封面生成

总纲和主角设定完成后：

- 调用图像生成 API（Stability AI / DALL-E / CF Workers AI `@cf/stabilityai/stable-diffusion-xl-base-1.0`）
- 自动生成符合小说风格的封面图
- 存储到 R2，更新 `novels.cover_r2_key`

---

## Phase 6 · 产品化（第 13 周以后）

### 6.1 多用户与认证

- 集成 Cloudflare Access 实现身份验证
- 所有表增加 `user_id` 字段，数据完全隔离
- 协作模式（可选）：Cloudflare Durable Objects + WebSocket 实时共编

### 6.2 RAG 知识库扩展

- 用户可上传参考资料（PDF / DOCX / TXT）到个人知识库
- 向量化入库，生成时自动 RAG 检索注入

### 6.3 模板市场

- 内置 10+ 类型小说模板（玄幻/都市/科幻/言情/悬疑等）
- 每个模板包含：世界观框架、角色类型、写作风格 Prompt、章纲结构
- 用户可导出/导入自己的模板

### 6.4 公开分享与朗读

- 签名 URL 分享（R2 + 时效链接）
- 公开小说主页（SSR/SSG 静态页）
- Workers AI TTS 章节语音朗读，R2 缓存音频

---

## 技术债务与架构注意事项

| 项目 | 当前状态 | 建议 |
|---|---|---|
| ReAct 工具解析 | 文本 JSON 解析（不稳定） | Phase 2 改为 function calling 协议（根本修复） |
| EPUB/PDF 导出兼容性 | 未在 Workers 环境验证 | Phase 1 期间完整测试 |
| D1 性能 | 核心查询无全局索引规划 | 给 `chapters(novel_id, sort_order)`、`foreshadowing(novel_id, status)` 补索引 |
| SSE 超时 | Workers 限制 ~100s | 长章节（>6000字）改用分段 continue 模式 |
| Vectorize 批量写入 | 串行逐条 | 改为 `upsert` 批量接口，初始化性能提升 10x |
| 错误监控 | 无 | 接入 Cloudflare Analytics Engine 或 Sentry（Workers 版） |

---

## 待新增的数据库表汇总

```sql
-- Phase 3
CREATE TABLE workshop_sessions (...);

-- Phase 4
CREATE TABLE novel_plans (...);
CREATE TABLE generation_queue (...);

-- Phase 5
CREATE TABLE quality_scores (...);
CREATE TABLE plot_nodes (...);
CREATE TABLE plot_edges (...);
```

---

## 阶段里程碑一览

| 阶段 | 时间 | 核心交付 | 验收标准 |
|---|---|---|---|
| Phase 0 | 第 1 天 | 遗留 Bug 修复 | B3/B5/B6 验证通过，日志 model_id 正常 |
| Phase 1 | 第 1~2 周 | 功能完整性补全 | 批量大纲前端可用，续写/重写可用，MCP 写操作可用 |
| Phase 2 | 第 3~4 周 | 生成质量深化 | function calling 工具调用稳定，上下文包精准注入 |
| Phase 3 | 第 5~6 周 | 对话式创作引擎 | 用户通过多轮对话能生成完整小说框架并写入数据库 |
| Phase 4 | 第 7~8 周 | 一键生成编排器 | 输入一句话，30 章小说自动跑完（含人工确认节点） |
| Phase 5 | 第 9~12 周 | 智能增强 | 质量评分可用，情节图谱可视化，风格克隆可用 |
| Phase 6 | 第 13 周+ | 产品化 | 多用户隔离，模板市场，公开分享 |

---

## 最近要做的 10 件事（按优先级）

1. **验证并修复 B3**（resolveConfig 多小说串台）
2. **验证并修复 B6**（Vectorize 旧向量残留）
3. **验证并修复 B5**（generation_logs model_id 为 unknown）
4. **批量大纲生成前端接入**（VolumePanel 操作入口 + SSE 进度）
5. **续写/重写模式前端接入**（GeneratePanel 模式切换）
6. **境界信息前端展示**（角色详情面板）
7. **ReAct 工具调用改为 function calling**（稳定性根本修复）
8. **上下文包精细化**（按优先级分层注入）
9. **创作工坊 API**（workshop_sessions 表 + 对话路由）
10. **创作工坊前端页面**（对话流 + 结构化预览 + 一键提交）

---

*基于 NovelForge v1.4.0 代码全量审查 | 更新日期：2026-04-21*
