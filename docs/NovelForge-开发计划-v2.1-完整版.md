# NovelForge · 开发计划（v2.1）

> 最终目标：**一句话生成一部完整小说**——从创意到成品的全链路 AI 编排平台。  
> 更新日期：2026-04-27

---

## Phase 1 · 批量章节生成（最高优先级，"一句话生成小说"最后一环）

> 用户指定生成数量，Queues 串行驱动，每章检查报告自动注入下一章上下文。

### 1.0 删除：创作工坊 `chapter_outline` 环节

**为什么删**：工坊生成的章节大纲是静态文本，不与数据库章节记录绑定，无法被章节生成服务直接消费，对生成质量无实质提升。章节生成本身已通过 RAG + 工具调用动态获取上下文，额外大纲层是冗余步骤。

**删除范围**：

- `server/services/workshop/session.ts` — 移除 `chapter_outline` 阶段判断逻辑
- `server/services/workshop/prompt.ts` — 移除 `chapter_outline` prompt 模板
- `server/services/workshop/extract.ts` — 移除 `chapter_outline` 数据提取分支
- `server/services/workshop/commit.ts` — 移除 `stage === 'chapter_outline'` 的章节写入逻辑
- 前端工坊流程 — 移除该步骤入口和 UI

工坊流程变为：`concept → worldbuild → character_design → volume_outline → [提交创建小说]`

### 1.1 数据库变更

```sql
CREATE TABLE batch_generation_tasks (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  volume_id TEXT NOT NULL,
  status TEXT DEFAULT 'running',         -- running | paused | done | failed | cancelled
  start_chapter_order INTEGER NOT NULL,  -- 从第几章开始（sortOrder）
  target_count INTEGER NOT NULL,         -- 计划生成章数
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  error_msg TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE INDEX idx_batch_novel ON batch_generation_tasks(novel_id);
CREATE INDEX idx_batch_status ON batch_generation_tasks(status);
```

### 1.2 API 路由

```
POST   /api/batch/start                  启动批量生成
GET    /api/batch/:taskId                查询任务状态
POST   /api/batch/:taskId/pause          暂停（当前章完成后生效）
POST   /api/batch/:taskId/resume         恢复
DELETE /api/batch/:taskId                取消
GET    /api/novels/:id/batch/active      查询该小说当前运行中的批量任务
```

**POST /api/batch/start 请求体**：

```json
{
  "novelId": "xxx",
  "volumeId": "xxx",
  "targetCount": 10,       // 要生成的章节数量
  "startFromNext": true    // 从当前最后一章的下一章开始（默认），false 时指定 startChapterOrder
}
```

### 1.3 批量生成核心流程（Queue 串行）

触发逻辑：`POST /api/batch/start` 立即返回 `taskId`，同时向 Queue 推送第一个 `batch_generate_chapter` 消息。

**每章处理流程（`queue-handler.ts` 新增 case `batch_generate_chapter`）**：

```
1. 读取 taskId → 检查 task.status
   └─ paused / cancelled → ack，终止

2. 卷完成检测（提前拦截）
   └─ 当前卷 chapterCount >= targetChapterCount → 卷 status = 'completed'，task status = 'done'，终止

3. 获取当前待生成章节（按 sortOrder）
   └─ 章节不存在 → 自动创建占位章节（title = "第N章"）

4. 获取上一章检查报告（核心新逻辑）
   └─ 查 check_logs 取上一章 character_consistency + chapter_coherence + volume_progress 三项
   └─ 调用 buildPrevChapterAdvice() 拼装 issuesSummary 字符串
   └─ 注入 generateChapter() 的 options.issuesContext

5. 调用 generateChapter()（直接复用现有函数）

6. generateChapter() 完成后推送 post_process_chapter 消息（现有逻辑）
   post_process_chapter 完成后额外推送 batch_chapter_done 消息

7. batch_chapter_done handler：
   completed_count += 1
   └─ >= target_count → task.status = 'done'
   └─ 否则 → 推送下一章的 batch_generate_chapter 消息
```

**上一章检查报告注入格式**（`buildPrevChapterAdvice` 输出）：

```
【上一章质量检查提示 - 本章需注意规避以下问题】
▶ 角色一致性：
  - [冲突] 林枫在第3章设定为"不擅言辞"，但上一章对话流畅自然
    → 建议本章保持其简短克制的说话风格
▶ 章节连贯性：
  - [警告] 上一章未交代陈鸿去向，本章若出现需说明
    → 建议本章加入简短交代
▶ 卷进度：
  - 当前章节进度 68%，字数进度 45%，字数明显偏低
    → 建议本章适当增加情节密度和描写比重
```

若上一章无任何问题，`buildPrevChapterAdvice` 返回 `null`，不注入。

### 1.4 卷完成检测与锁定

**新增服务** `server/services/agent/volumeCompletion.ts`：

```typescript
export async function checkAndCompleteVolume(env: Env, volumeId: string): Promise<{
  completed: boolean
  reason?: 'chapter_target_reached'
}>
```

逻辑：读取 `volumes.targetChapterCount` 与实际 `chapterCount` 对比，达到目标则 `UPDATE volumes SET status = 'completed'`。未设定 `targetChapterCount` 的卷不触发自动完成。

**接入点**：
- `post_process_chapter` 完成后自动调用
- `POST /api/generate/chapter`（单章手动生成）调用前检查，已完成则返回 `403 { error: 'VOLUME_COMPLETED' }`

**前端联动**：卷 `status === 'completed'` 时隐藏"生成下一章"按钮，展示"本卷已完成"标签 + "创建新卷"入口。

### 1.5 检查处理意见统一化

当前各检查项处理意见的完整性：

| 检查项 | 有问题描述 | 有处理建议 | 状态 |
|--------|-----------|-----------|------|
| 章节连贯性 `coherence.ts` | ✅ | ✅ `suggestion` 字段 | 无需改动 |
| 卷进度 `volumeProgress.ts` | ✅ | ✅ `suggestion` 字段 | 无需改动 |
| 角色一致性 `consistency.ts` | ✅ | ⚠️ AI 自由输出，无结构化 suggestion | **需修改** |

**`consistency.ts` 修改**：在 AI prompt 中强制 `conflicts` 每条包含 `suggestion` 字段：

```
请以JSON格式返回：
{
  "conflicts": [
    {
      "characterName": "角色名",
      "dimension": "境界一致性|说话方式|性格行为|弱点表现",
      "issue": "具体问题描述",
      "suggestion": "给下一章的具体规避建议（以'建议'开头，30字以内）"
    }
  ],
  "warnings": ["轻微问题描述"]
}
```

**新增服务** `server/services/agent/prevChapterAdvice.ts`：

```typescript
export async function buildPrevChapterAdvice(
  env: Env,
  prevChapterId: string
): Promise<string | null>
```

查询 check_logs，过滤 issuesCount > 0 的项，拼装注入字符串。

### 1.6 前端入口

在小说详情页（卷/章节列表）现有位置新增，不新增独立页面：

```
批量生成  生成 [___] 章  [开始]
          ↑ 默认值 = targetChapterCount - currentChapterCount
```

状态展示（轮询 `GET /api/batch/:taskId`，每 3s）：

```
正在生成第 3 章 / 共 10 章  ████░░░░░░ 30%
[暂停]  [取消]
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

- `queue-handler.ts` 新增 `quality_check` 任务类型
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
model:     doubao-seedream-3-0-t2i-250415
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
CREATE TABLE batch_generation_tasks (...);

-- Phase 2
CREATE TABLE quality_scores (...);

-- Phase 4
CREATE TABLE plot_nodes (...);
CREATE TABLE plot_edges (...);
```

---

## 优先级排序

1. 删除工坊 `chapter_outline` 环节（清理 4 个文件）
2. `batch_generation_tasks` 表 + `/api/batch/*` 路由
3. `queue-handler.ts` 新增 `batch_generate_chapter` + `batch_chapter_done` case
4. `volumeCompletion.ts` + 卷完成检测接入单章生成防护
5. `consistency.ts` prompt 强制 `suggestion` 字段
6. `prevChapterAdvice.ts` 上下文注入服务
7. 前端：批量生成入口 + 进度展示 + 卷完成状态展示
8. `quality_scores` 表 + `quality_check` Queue 任务（Phase 2）
9. `image_gen` stage 配置入口（Phase 3）
10. `imageGen.ts` 服务 + 封面生成路由（Phase 3）
11. 小说卡片封面区域前端接入（Phase 3）
12. 多用户数据隔离（Phase 5）
13. 情节图谱 DB + 章节后自动提取（Phase 4）
14. 情节图谱前端可视化（Phase 4）

---

## 技术债务

| 项目 | 当前状态 | 建议 |
|---|---|---|
| 多用户数据隔离 | 业务表无 user_id | Phase 5 统一加字段 + 过滤 |
| Vectorize 批量写入 | 串行逐条 | 改为 `upsert` 批量接口，初始化性能提升 10x |
| 错误监控 | 无 | 接入 Cloudflare Analytics Engine 或 Sentry（Workers 版）|
| `batch_generation_tasks` 索引 | 新表需补 | 建表时加 `novel_id`、`status` 索引 |
| `post_process_chapter` 无完成回调 | fire-and-forget | 批量模式需要完成信号，新增 `batch_chapter_done` 消息类型驱动下一章 |

---

*基于 NovelForge v1.8.0 代码全量审查 | 更新日期：2026-04-27*
