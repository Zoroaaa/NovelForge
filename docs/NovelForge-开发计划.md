# NovelForge · 开发计划（v2.0）

> 最终目标：**一句话生成一部完整小说**——从创意到成品的全链路 AI 编排平台。  
> 更新日期：2026-04-26

---

## Phase 1 · 生成编排器（最高优先级）

核心缺口：`generateNextChapter` 已存在，但没有跨章节自动编排能力、Orchestrator 状态机和前端"指挥台"。

### 1.1 Orchestrator 状态机

**新增数据库表**：

```sql
CREATE TABLE novel_plans (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  status TEXT DEFAULT 'running',     -- running | paused | waiting_approval | done | failed
  current_step INTEGER DEFAULT 0,
  total_steps INTEGER,
  plan_data TEXT NOT NULL,           -- JSON 步骤定义
  error_msg TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE generation_queue (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  step_type TEXT NOT NULL,           -- chapter | summary | coherence_check | volume_progress
  step_index INTEGER,
  target_id TEXT,                    -- chapter_id / volume_id
  status TEXT DEFAULT 'pending',     -- pending | running | done | failed | skipped
  result TEXT,
  error_msg TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER
);
```

**新增路由**：

```
POST   /api/plan/create              启动编排计划（指定起始章节 + 目标章节数）
GET    /api/plan/:id                 查询当前进度（SSE 实时推送）
POST   /api/plan/:id/approve         人工确认节点（批准继续）
POST   /api/plan/:id/pause           暂停
POST   /api/plan/:id/resume          继续
DELETE /api/plan/:id                 取消
```

**每章自动化流程**：

```
生成章节正文
  → 触发自动摘要
  → Queue: 角色一致性检查 + 章节连贯性检查
  → Queue: 卷完成度评估
  → 低分/高风险 → 暂停，状态切换为 waiting_approval
  → 用户确认后继续下一章
```

**必须人工确认的节点**（不能全自动）：

- 综合质量检查评分 < 60
- 卷完成度检测到"提前结束"或"严重拖延"风险
- 每 N 章里程碑检查点（N 可配置）

### 1.2 前端"指挥台"页面

新增 `/novels/:id/command` 路由：

```
┌────────────────────────────────────────────────────┐
│  [小说标题]   状态：生成中  第12章/共30章  48%      │
├─────────────┬──────────────────────────────────────┤
│  生成计划树 │  当前步骤详情                        │
│  ○ 第一卷 ✓ │  正在生成：第12章《龙渊秘境》        │
│    ○ 1-1 ✓  │  ─────────────────────────────────  │
│    ○ 1-2 ✓  │  [流式输出预览...]                   │
│    ○ 1-3 ⏳ │                                      │
│  ○ 第二卷 … │  质量检查：87分 ✓  卷进度：正常 ✓   │
│             │                                      │
│  [暂停][继续]│  [查看全文][修改后继续]             │
└─────────────┴──────────────────────────────────────┘
```

---

## Phase 2 · 生成质量深化

### 2.1 写作质量评分

章节生成完成后 Queue 异步运行（不阻塞主流程），结果写入新表：

```sql
CREATE TABLE quality_scores (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  total_score INTEGER,            -- 0-100
  plot_score INTEGER,             -- 情节推进度
  consistency_score INTEGER,      -- 人物一致性
  foreshadowing_score INTEGER,    -- 伏笔遵守度
  pacing_score INTEGER,           -- 爽感/节奏密度
  fluency_score INTEGER,          -- 文笔流畅度
  details TEXT,                   -- JSON 各维度细节
  created_at INTEGER
);
```

- queue-handler 新增 `quality_check` 任务类型
- 低于阈值提示用户重新生成（不强制拦截）
- WritingStats 展示质量分趋势折线图

---

## Phase 3 · 封面图生成

### 3.1 image_gen Stage

`model_configs` 新增 `image_gen` stage，ModelConfigPage 加对应配置入口。复用现有 provider/apiBase/apiKey 结构，后端调用 `/images/generations` 接口而非 `/chat/completions`。

支持配置 Doubao-Seedream-3.0 等图像生成模型，示例配置：

```
provider:  volcengine
apiBase:   https://ark.cn-beijing.volces.com/api/v3
model:     doubao-seedream-3-0-t2i-250415（或其他图像模型 ID）
```

### 3.2 后端图像生成服务

新增 `server/services/imageGen.ts`：

```
输入：novelId
  → 读取总纲摘要 + 主角设定（role=protagonist 的 name/description/attributes）
  → 拼装 prompt（风格/世界观/主角外貌/情绪基调）
  → resolveConfig('image_gen', novelId) 取模型配置
  → POST {base}/images/generations { model, prompt, size: "1024x1536", n: 1 }
  → 返回图片 URL，fetch 下载为 ArrayBuffer
  → 写入 R2（key: covers/{novelId}.jpg），更新 novels.cover_r2_key
```

新增路由：

```
POST /api/novels/:id/cover/generate   触发封面生成（Queue 异步，立即返回任务 ID）
GET  /api/novels/:id/cover            获取当前封面 R2 签名 URL
```

### 3.3 前端接入

- NovelsPage 小说卡片封面区域：有封面时展示图片，无封面时展示"生成封面"按钮
- 点击生成 → 轮询任务状态 → 完成后刷新封面图片

---

## Phase 4 · 智能增强

### 4.1 情节图谱（Plot Graph）

```sql
CREATE TABLE plot_nodes (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  type TEXT NOT NULL,       -- event | character | location | item
  title TEXT NOT NULL,
  description TEXT,
  chapter_id TEXT,
  meta TEXT,
  created_at INTEGER
);

CREATE TABLE plot_edges (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,   -- caused_by | participated_in | occurred_at | owned_by
  created_at INTEGER
);
```

- 每章生成完成后 Queue 异步调用轻量模型提取节点和关系
- 伏笔节点自动关联（`addForeshadowing` 时创建对应 `plot_node`）
- 前端图谱视图（D3 / React Flow）

> 解决 100 章以上长篇人物关系混乱、地点矛盾的根本问题。

### 4.2 写作风格克隆

用户上传 1~3 章参考文本：

- 新增 `/api/style/analyze` 路由，调用 `analysis` stage 模型
- 分析：句子平均长度、对话比例、描写密度、用词偏好
- 结果写入 `writing_rules` 表（category = `style_clone`，高优先级），注入后续生成上下文

---

## Phase 5 · 产品化

### 5.1 多用户数据隔离

用户认证已完成，但业务表无 `user_id` 字段，当前数据所有用户共享。

- 所有核心表新增 `user_id` 字段
- 所有查询加 `user_id` 过滤
- 中间件层统一从 JWT 注入 `userId`

> 对外开放的前提，必须在分享功能之前完成。

### 5.2 RAG 知识库扩展

用户可上传参考资料（PDF / DOCX / TXT）：

- 接收文件 → 写入 R2 → Queue 异步向量化（`sourceType = 'user_doc'`）
- 生成时自动 RAG 检索注入
- AI 监控中心展示知识库统计

### 5.3 模板市场

- 内置 10+ 类型模板（玄幻/都市/科幻/言情/悬疑等）
- 每个模板包含世界观框架 + 角色类型 + 写作风格规则 + 章纲结构
- 通过 Workshop 一键加载模板进入对话式精调
- 用户可将小说导出为模板

### 5.4 公开分享与语音朗读

- 签名 URL 分享（R2 + 时效链接）
- Workers AI TTS 章节语音朗读，R2 缓存音频
- 公开小说主页（前端路由 `/read/:shareCode`）

---

## 待新增数据库表汇总

```sql
-- Phase 1
CREATE TABLE novel_plans (...);
CREATE TABLE generation_queue (...);

-- Phase 2
CREATE TABLE quality_scores (...);

-- Phase 4
CREATE TABLE plot_nodes (...);
CREATE TABLE plot_edges (...);
```

---

## 技术债务

| 项目 | 当前状态 | 建议 |
|---|---|---|
| 多用户数据隔离 | 业务表无 user_id | Phase 5 统一加字段 + 过滤 |
| Vectorize 批量写入 | 串行逐条 | 改为 `upsert` 批量接口，初始化性能提升 10x |
| 错误监控 | 无 | 接入 Cloudflare Analytics Engine 或 Sentry（Workers 版） |
| novel_plans / generation_queue 索引 | 新表需补 | 建表时加 `novel_id`、`plan_id`、`status` 索引 |

---

## 优先级排序

1. `novel_plans` + `generation_queue` 表 + Orchestrator 路由
2. 前端"指挥台"页面
3. `image_gen` stage 配置（ModelConfigPage 入口）
4. `imageGen.ts` 服务 + 封面生成路由
5. 小说卡片封面区域前端接入
6. `quality_scores` 表 + queue `quality_check` 任务
7. WritingStats 质量分趋势图
8. 多用户数据隔离（业务表加 user_id）
9. 情节图谱 DB 层 + 章节生成后自动提取
10. 情节图谱前端可视化

---

*基于 NovelForge v1.8.0 代码全量审查 | 更新日期：2026-04-25*
