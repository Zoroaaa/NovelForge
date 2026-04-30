# NovelForge 章节生成 — 完整使用指南

> 版本: v1.0.0 | 模块: 前端 `GeneratePanel.tsx` + 后端 `routes/generate.ts` + `routes/batch.ts`
> 相关文档: [章节上下文构建指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md)
> 创建日期: 2026-04-30 | 最后更新: 2026-04-30

---

## 一、功能概述

### 1.1 什么是章节生成

章节生成是 NovelForge 的核心创作功能，通过 AI 模型结合小说的完整上下文（总纲、卷规划、角色、设定、伏笔等），自动生成高质量的小说章节内容。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| **智能上下文构建** | 自动组装 10 槽位上下文（~100-128k tokens），确保生成内容连贯 |
| **SSE 流式输出** | 实时显示 AI 生成过程，用户体验流畅 |
| **自动质量检查** | 生成后自动进行连贯性检查，评分 < 70 时自动修复 |
| **自动修复写库** | ⭐v4.5：修复结果自动保存到数据库，不再丢失 |
| **草稿预览模式** | ⭐v4.5：跳过后处理，快速迭代多版本对比 |
| **批量生成** | 支持一次启动多章生成任务，后台队列串行执行 |
| **历史记录查询** | ⭐v4.5：可查看所有批量任务的执行历史 |

### 1.3 两种生成模式对比

```
┌─────────────────────────────────────────────────────────────┐
│                    章节生成模式对比                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐    ┌──────────────────────────┐      │
│  │   单章生成        │    │   批量生成                │      │
│  ├──────────────────┤    ├──────────────────────────┤      │
│  │ 触发方式: 手动    │    │ 触发方式: 一键启动       │      │
│  │ 执行方式: 同步SSE │    │ 执行方式: 异步队列       │      │
│  │ 后处理: 自动触发  │    │ 后处理: 队列串行         │      │
│  │ 质量检查: ✅     │    │ 质量检查: ❌             │      │
│  │ 适用场景: 精细调优│    │ 适用场景: 快速产出      │      │
│  │ 预计耗时: 1-3分钟 │    │ 预计耗时: 取决于章数    │      │
│  └──────────────────┘    └──────────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、单章生成详细流程

### 2.1 前端界面说明

**文件位置**: [GeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generate/GeneratePanel.tsx)

#### 2.1.1 界面布局

```
┌─────────────────────────────────────────────────┐
│  📝 章节生成面板                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  [生成模式选择]                                  │
│  ○ 全新生成  ○ 续写  ○ 重写                      │
│                                                 │
│  [目标字数输入框]                                │
│  目标字数: [3000] 字 (范围: 500-8000)           │
│                                                 │
│  [⭐v4.5 草稿模式开关]                          │
│  ☐ 草稿模式（跳过摘要/伏笔提取等后处理）         │
│                                                 │
│  [系统提示词输入框] (可选)                       │
│  ┌─────────────────────────────────────────┐    │
│  │ 输入额外的系统提示或约束...              │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [操作按钮区域]                                 │
│  ┌──────────┐  ┌──────────┐                    │
│  │ 🚀 生成  │  │ ⏹️ 停止  │                    │
│  └──────────┘  └──────────┘                    │
│                                                 │
│  [输出展示区域]                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ （AI 生成的实时流式内容）                 │    │
│  │                                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [插入内容按钮] (生成完成后显示)                  │
│  ┌──────────────────────────────────────┐      │
│  │ 📋 插入内容到编辑器                   │      │
│  └──────────────────────────────────────┘      │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### 2.1.2 各组件功能说明

| 组件 | 功能 | 说明 |
|------|------|------|
| **生成模式选择器** | 选择生成策略 | 全新生成 / 续写（在现有内容后继续）/ 重写（替换现有内容） |
| **目标字数输入框** | 控制生成长度 | 默认 3000 字，范围 500-8000 字 |
| **草稿模式开关** | ⭐v4.5 新增 | 开启后跳过后处理（摘要/伏笔/评分），章节状态为 `draft` |
| **系统提示词输入框** | 额外约束 | 可输入对本次生成的特殊要求或约束 |
| **生成按钮** | 启动生成 | 调用 SSE 流式 API 开始生成 |
| **停止按钮** | 中断生成 | 可随时中断正在进行的生成 |
| **输出展示区域** | 实时渲染 | 显示 AI 流式输出的内容，支持 Markdown 渲染 |
| **插入内容按钮** | 写入编辑器 | 将生成内容插入到章节编辑器中 |

### 2.2 生成参数详解

#### 2.2.1 请求参数

```typescript
interface GenerateRequest {
  chapterId: string          // 章节 ID（必填）
  novelId: string            // 小说 ID（必填）
  mode?: 'generate' | 'continue' | 'rewrite'  // 生成模式（默认 'generate'）
  targetWords?: number       // 目标字数（默认 3000，范围 500-8000）
  existingContent?: string   // 现有内容（续写/重写模式需要）
  issuesContext?: string[]   // 问题上下文（内部使用）
  options?: {
    enableRAG?: boolean      // 是否启用 RAG（默认 true）
    enableAutoSummary?: boolean  // 是否自动摘要（默认 true）
    draftMode?: boolean      // ⭐v4.5: 草稿模式（默认 false）
  }
}
```

#### 2.2.2 参数使用建议

| 场景 | 推荐配置 | 说明 |
|------|---------|------|
| **标准生成** | mode='generate', targetWords=3000 | 最常用的配置 |
| **快速迭代** | mode='generate', targetWords=1500, draftMode=true | 测试 prompt 或多版本对比 |
| **续写未完成章节** | mode='continue', existingContent=原文 | 在现有内容后继续生成 |
| **不满意重写** | mode='rewrite', existingContent=原文, targetWords=3000 | 完全重新生成该章节 |
| **长章节生成** | mode='generate', targetWords=5000-8000 | 需要更丰富内容的场景 |

### 2.3 SSE 事件流详解

**⭐v4.5 更新时序**：`[DONE]` 事件现在在连贯性检查和修复完成后才发送

#### 2.3.1 完整事件序列

```
连接建立 → SSE 流开始
    ↓
[事件 1] content 事件（多次）
    ↓ 数据格式：
data: {"content": "第一章 林岩的觉醒\n\n天玄大陆，东域..."}
data: {"content： "林岩站在悬崖边，望着远方的云海..."}
...（持续流式输出）

    ↓
[事件 2] tool_call 事件（可选，多次）
    ↓ 数据格式：
data: {"type": "tool_call", "name": "extract_title", "args": {...}, "result": "林岩的觉醒"}

    ↓
[事件 3] coherence_check 事件（生成完成后自动触发）
    ↓ 数据格式：
data: {
  "type": "coherence_check",
  "score": 65,
  "issues": [
    {"severity": "error", "message": "主角行为动机不明确"},
    {"severity": "warning", "message": "场景转换略显突兀"}
  ]
}

    ↓
[事件 4] coherence_fix 事件（仅 score < 70 时触发）
    ↓ 数据格式：
data: {
  "type": "coherence_fix",
  "repairedContent": "修改后的完整章节内容...",
  "originalScore": 65,
  "issues": [...]
}

    ↓
[事件 5] done 事件（⭐v4.5: 现在在修复完成后发送）
    ↓ 数据格式：
data: {
  "type": "done",
  "usage": {
    "prompt_tokens": 2500,
    "completion_tokens": 3200
  }
}

    ↓
[DONE] 标记（流结束）
data: [DONE]

    ↓
连接关闭
```

#### 2.3.2 事件类型说明

| 事件类型 | 触发时机 | 数据说明 | 前端处理 |
|---------|---------|---------|---------|
| `content` | AI 流式输出时 | 生成的文本片段 | 追加到输出区域 |
| `tool_call` | AI 调用工具时 | 工具名、参数、结果 | 记录工具调用日志 |
| `coherence_check` | 内容生成完成后 | 连贯性评分 + 问题列表 | 显示检查结果 Toast |
| `coherence_fix` | score < 70 时 | 修复后的完整内容 | 显示持久弹窗 + 保存修复内容 |
| `done` | 所有处理完成后 | token 使用统计 | 更新状态为 'done' |
| `[DONE]` | 流结束标记 | - | 关闭 SSE 连接 |

### 2.4 自动修复机制 ⭐v4.5 核心

#### 2.4.1 触发条件与流程

```
章节内容生成完成
    ↓
自动调用 checkChapterCoherence(chapterId, novelId)
    ↓
返回连贯性检查结果 { score, issues[] }
    ↓
┌─ score ≥ 70 ─→ 无严重问题 → 直接进入后处理流程
│
└─ score < 70 ─→ ⚠️ 发现严重问题
                    ↓
              自动调用 repairChapterByIssues()
              输入：问题列表 + 主角设定 + 原文
                    ↓
              AI 生成修复版本
                    ↓
              ✅ 修复内容写入数据库（chapters.content）
                    ↓
              推送 coherence_fix 事件给前端
                    ↓
              前端显示持久弹窗：
              "⚠️ 连贯性评分偏低（65/100），正在自动修复中..."
                    ↓
              修复完成后关闭"修复中"弹窗
              显示成功弹窗：
              "✅ 自动修复完成（原评分 65/100）"
              "修复版本已写入数据库"
                    ↓
              发送 [DONE] 事件（⭐v4.5 时序优化）
```

#### 2.4.2 三种修复类型

| 修复函数 | 触发方式 | 修复内容 | 自动写库 |
|---------|---------|---------|---------|
| `repairChapterByIssues()` | **自动**（score < 70） | 连贯性问题（情节逻辑、场景转换等） | ✅ 是 |
| `repairChapterByCharacterIssues()` | 手动（用户点击修复按钮） | 角色一致性问题（性格、行为、设定冲突） | ✅ 是 |
| `repairChapterByVolumeIssues()` | 手动（用户点击修复按钮） | 卷进度问题（字数、节奏、结构异常） | ✅ 是 |

#### 2.4.3 用户界面反馈

**修复过程中**（持久弹窗，不自动关闭）：
```
┌─────────────────────────────────────┐
│  ⚠️ 连贯性评分偏低（65/100），       │
│  正在自动修复中...                  │
│                                     │
│  发现 2 个严重问题，系统正在生成     │
│  修复版本，请稍候                    │
│                                     │
│                     [× 不自动关闭]  │
└─────────────────────────────────────┘
```

**修复完成后**（持久弹窗，需手动关闭）：
```
┌─────────────────────────────────────┐
│  ✅ 自动修复完成（原评分 65/100）    │
│                                     │
│  修复版本已写入数据库               │
│                                     │
│                     [× 关闭]       │
└─────────────────────────────────────┘
```

### 2.5 草稿模式详解 ⭐v4.5 新增

#### 2.5.1 什么是草稿模式

草稿模式是一种**轻量级生成模式**，生成章节内容后**跳过所有耗时的后处理步骤**，仅将原始生成内容写入数据库。

#### 2.5.2 草稿模式 vs 标准模式对比

| 维度 | 标准模式 | 草稿模式 |
|------|---------|---------|
| **章节状态** | `generated` | `draft` |
| **自动摘要** | ✅ 执行 | ❌ 跳过 |
| **伏笔提取** | ✅ 执行 | ❌ 跳过 |
| **质量评分** | ✅ 执行 | ❌ 跳过 |
| **图谱提取** | ✅ 执行 | ❌ 跳过 |
| **连贯性检查** | ✅ 执行 | ✅ 仍执行 |
| **自动修复** | ✅ 执行 | ✅ 仍执行 |
| **Token 消耗** | 较高（含后处理 LLM 调用） | 较低（仅生成） |
| **生成速度** | 较慢（需等待后处理） | **较快**（立即返回） |
| **适用场景** | 正式发布内容 | 快速迭代/实验 |

#### 2.5.3 使用方法

**前端操作**：
1. 在 GeneratePanel 中找到"草稿模式"复选框
2. 勾选复选框（显示提示："跳过摘要/伏笔提取等后处理"）
3. 正常点击"生成"按钮
4. 生成完成后章节状态为 `draft`

**API 调用**：
```json
POST /api/generate/chapter
{
  "chapterId": "xxx",
  "novelId": "yyy",
  "options": {
    "draftMode": true
  }
}
```

#### 2.5.4 草稿转正式流程

```
草稿生成完成（status = 'draft'）
    ↓
用户查看草稿内容
    ↓
┌─ 满意 → 手动触发后处理
│   ├─ 调用 POST /api/generate/post-process
│   ├─ 执行：摘要 + 伏笔 + 评分 + 图谱
│   └─ status 更新为 'generated'
│
└─ 不满意 → 重新生成或编辑
    ├─ 修改 prompt 后重新生成
    └─ 或手动编辑内容后转为正式
```

### 2.6 单章生成完整示例

#### 示例 1：标准生成（含自动修复）

```javascript
// 前端调用
const result = await api.streamGenerate(
  'chapter-id-123',        // chapterId
  'novel-id-456',          // novelId
  {
    mode: 'generate',
    targetWords: 3000,
    options: {
      enableRAG: true,
      enableAutoSummary: true,
      draftMode: false      // 标准模式
    }
  }
)

// SSE 事件监听
result.onMessage((event) => {
  switch (event.type) {
    case 'content':
      // 追加文本到输出区域
      appendToOutput(event.content)
      break
    case 'coherence_check':
      if (event.score < 70) {
        // 显示持久弹窗："正在自动修复..."
        showPersistentToast('warning', `评分 ${event.score}/100，正在自动修复...`)
      }
      break
    case 'coherence_fix':
      // 关闭"修复中"弹窗
      dismissToast()
      // 显示成功弹窗
      showPersistentToast('success', `✅ 修复完成（原评分 ${event.originalScore}/100）`)
      break
    case 'done':
      // 更新状态为完成
      setStatus('done')
      break
  }
})

// 流结束时
result.onDone(() => {
  console.log('生成完成')
})
```

#### 示例 2：草稿模式生成

```javascript
// 前端调用
const result = await api.streamGenerate(
  'chapter-id-123',
  'novel-id-456',
  {
    mode: 'generate',
    targetWords: 2000,          // 较短的字数
    options: {
      draftMode: true           // ⭐ 草稿模式
    }
  }
)

// 草稿模式下无后处理事件，只有 content 和 done
result.onMessage((event) => {
  if (event.type === 'content') {
    appendToOutput(event.content)
  } else if (event.type === 'done') {
    setStatus('done')
    console.log('草稿生成完成，章节状态为 draft')
  }
})
```

---

## 三、批量生成详细流程

### 3.1 前端界面说明

**文件位置**: [BatchGeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generation/BatchGeneratePanel.tsx)

#### 3.1.1 界面布局

```
┌─────────────────────────────────────────────────┐
│  📦 批量生成面板                                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  [目标小说/卷选择]                               │
│  小说: [下拉选择]                                │
│  卷:   [下拉选择]                                │
│                                                 │
│  [批量参数配置]                                  │
│  目标章节数: [20] 章                             │
│  ☑ 从下一章开始                                  │
│  ☐ 从指定章节开始: 第 [5] 章                    │
│                                                 │
│  [操作按钮]                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ ▶️ 开始  │  │ ⏸️ 暂停  │  │ 🔄 重试  │     │
│  └──────────┘  └──────────┘  └──────────┘     │
│                                                 │
│  [进度展示区域]                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 进度: ████████░░░░░░░ 12/20 章 (60%)    │    │
│  │                                         │    │
│  │ ✅ 已完成: 10 章                        │    │
│  │ ❌ 失败: 2 章                            │    │
│  │ ⏳ 进行中: 0 章                         │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  [历史记录入口] ⭐v4.5                            │
│  📋 查看历史记录                                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

#### 3.1.2 各组件功能说明

| 组件 | 功能 | 说明 |
|------|------|------|
| **小说/卷选择器** | 选择目标 | 必须先选择小说和卷才能启动批量任务 |
| **目标章节数输入** | 设置数量 | 一次生成的章节数（如 20 章） |
| **起始章节选项** | 控制起点 | 默认从下一章开始，也可指定起始章节号 |
| **开始按钮** | 启动任务 | 创建批量任务并入队执行 |
| **暂停按钮** | 暂停任务 | 暂停当前执行的批量任务 |
| **重试失败章节** | 补救失败 | 仅重试失败的章节（需要手动实现） |
| **进度条** | 可视化进度 | 显示已完成/失败/总数 |
| **历史记录** | ⭐v4.5 新增 | 查看所有批量任务的历史记录 |

### 3.2 批量生成 API 接口

#### 3.2.1 启动批量任务

**接口**: `POST /api/batch/novels/:id/start`

**请求参数**:
```typescript
interface BatchStartRequest {
  volumeId: string           // 卷 ID（必填）
  targetCount: number        // 目标章节数（必填，≥1）
  startFromNext?: boolean    // 是否从下一章开始（默认 true）
  startChapterOrder?: number // 起始章节序号（startFromNext=false 时使用）
}
```

**响应**:
```typescript
interface BatchTaskStatus {
  id: string                 // 任务 ID
  novelId: string
  volumeId: string
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
  targetCount: number        // 目标章节数
  completedCount: number     // 已完成章数
  failedCount: number        // 失败章数
  currentChapterOrder: number // 当前章节序号
  createdAt: string
  updatedAt: string
}
```

**示例请求**:
```bash
curl -X POST https://your-domain.com/api/batch/novels/novel-123/start \
  -H "Content-Type: application/json" \
  -d '{
    "volumeId": "volume-456",
    "targetCount": 20,
    "startFromNext": true
  }'
```

**响应**:
```json
{
  "ok": true,
  "task": {
    "id": "batch-task-789",
    "status": "running",
    "targetCount": 20,
    "completedCount": 0,
    "failedCount": 0,
    "currentChapterOrder": 15
  }
}
```

#### 3.2.2 查询活跃任务

**接口**: `GET /api/batch/novels/:id/active`

**响应**: 返回当前活跃的批量任务（status 为 running 或 paused）

**示例**:
```bash
curl https://your-domain.com/api/batch/novels/novel-123/active
```

**响应**:
```json
{
  "id": "batch-task-789",
  "status": "running",
  "targetCount": 20,
  "completedCount": 12,
  "failedCount": 1,
  "currentChapterOrder": 27
}
```

或无活跃任务时:
```json
null
```

#### 3.2.3 查询历史记录 ⭐v4.5 新增

**接口**: `GET /api/batch/novels/:id/history`

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | number | 10 | 返回记录数量上限 |
| `status` | string | - | 过滤状态：done / failed / cancelled |

**响应**:
```typescript
interface BatchHistoryResponse {
  tasks: BatchTaskStatus[]
}
```

**示例**:
```bash
# 查询最近 10 条历史记录
curl https://your-domain.com/api/batch/novels/novel-123/history?limit=10

# 仅查询已完成的历史记录
curl "https://your-domain.com/api/batch/novels/novel-123/history?limit=10&status=done"
```

**响应**:
```json
{
  "tasks": [
    {
      "id": "batch-task-001",
      "status": "done",
      "targetCount": 20,
      "completedCount": 19,
      "failedCount": 1,
      "createdAt": "2026-04-30T10:00:00Z",
      "updatedAt": "2026-04-30T12:30:00Z"
    },
    {
      "id": "batch-task-002",
      "status": "failed",
      "targetCount": 30,
      "completedCount": 5,
      "failedCount": 25,
      "createdAt": "2026-04-29T15:00:00Z",
      "updatedAt": "2026-04-29T16:00:00Z"
    }
  ]
}
```

### 3.3 批量生成执行流程

#### 3.3.1 后端队列处理流程

```
用户点击"开始批量生成"
    ↓
POST /api/batch/novels/:id/start
    ↓
创建 batchGenerationTasks 记录
{ status: 'running', completedCount: 0, failedCount: 0 }
    ↓
投递第一个 batch_generate_chapter 消息到 TASK_QUEUE
    ↓
┌─────────────────────────────────────────────────┐
│ Worker 处理 batch_generate_chapter 消息           │
│                                                  │
│  1. 查询当前章节信息                              │
│  2. 构建上下文 buildChapterContext()              │
│  3. 调用 generateChapter() 生成内容              │
│  4. 写入数据库 chapters 表                        │
│  5. 发送 batch_chapter_done 事件                  │
│     { taskId, success: true/false }              │
│                                                  │
│  └─ 成功 → completedCount++                     │
│  └─ 失败 → failedCount++                        │
│                                                  │
│  6. 检查是否达到 targetCount                     │
│     ├─ 未达 → 投递下一个 batch_generate_chapter │
│     └─ 达成 → 标记任务为 done                   │
│                                                  │
└─────────────────────────────────────────────────┘
    ↓
前端轮询 GET /api/batch/novels/:id/active
    ↓
实时更新进度条和统计数字
```

#### 3.3.2 批量 vs 单章的关键差异

| 差异点 | 单章生成 | 批量生成 |
|--------|---------|---------|
| **执行方式** | 同步 SSE（等待完成） | 异步队列（后台执行） |
| **后处理触发** | 自动入队 post_process_chapter | 由 quality_check 阶段触发 |
| **连贯性检查** | ✅ 自动执行 | ❌ 不执行（性能考虑） |
| **标题来源** | extractTitleFromContent() 提取 | 初始硬编码"第N章"，后由 quality_check 阶段修正 |
| **超时控制** | SSE_STREAM_TIMEOUT (300s) | Worker 超时（队列级别） |
| **错误处理** | 直接返回错误给用户 | 计入 failedCount，继续下一章 |
| **进度反馈** | 实时 SSE 事件 | 轮询 active 接口 |

### 3.4 批量生成监控与管理

#### 3.4.1 进度监控

**前端轮询示例**:
```javascript
// 每 5 秒轮询一次任务状态
const pollInterval = setInterval(async () => {
  const task = await api.batch.getActive(novelId)

  if (!task) {
    console.log('无活跃任务')
    return
  }

  // 更新 UI
  updateProgressBar(task.completedCount, task.targetCount)
  updateStats({
    completed: task.completedCount,
    failed: task.failedCount,
    total: task.targetCount
  })

  // 任务完成时停止轮询
  if (task.status === 'done' || task.status === 'failed') {
    clearInterval(pollInterval)
    showCompletionNotification(task)
  }
}, 5000)
```

#### 3.4.2 暂停与恢复

**暂停任务**:
```bash
# 调用暂停接口（需要在 batch.ts 中实现）
POST /api/batch/:taskId/pause
```

**恢复任务**:
```bash
# 调用恢复接口
POST /api/batch/:taskId/resume
```

#### 3.4.3 查看历史记录 ⭐v4.5

```javascript
// 查询最近 10 条历史记录
const history = await api.batch.getHistory(novelId, { limit: 10 })

console.log(`共 ${history.tasks.length} 条历史记录`)

history.tasks.forEach((task, index) => {
  console.log(`
  任务 #${index + 1}:
    - ID: ${task.id}
    - 状态: ${task.status}
    - 目标: ${task.targetCount} 章
    - 完成: ${task.completedCount} 章
    - 失败: ${task.failedCount} 章
    - 创建时间: ${task.createdAt}
    - 完成时间: ${task.updatedAt}
  `)
})
```

---

## 四、高级用法与技巧

### 4.1 生成质量优化

#### 4.1.1 优化上下文质量

生成质量直接取决于上下文构建的质量。以下优化建议：

1. **完善总纲内容**
   - 确保总纲内容充实且不超过 12000 字
   - 包含完整的世界观、核心设定、主线剧情走向

2. **细化卷规划**
   - eventLine 使用 JSON 数组格式（推荐）
   - 每章事件描述包含明确的类型关键词（战斗/修炼/情感等）

3. **丰富角色卡片**
   - 主角状态卡包含完整的属性、境界、性格描述
   - 配角卡片 description 控制在 300 字以内（用于 RAG 索引）

4. **合理设置创作规则**
   - 全局规则（Slot-4）：保持精简，优先级分明
   - 类型规则（Slot-8）：针对不同章节类型定制

#### 4.1.2 优化生成参数

| 场景 | 推荐参数 | 效果 |
|------|---------|------|
| **追求高质量** | targetWords=4000-5000, 标准模式 | 内容更丰富，但耗时更长 |
| **追求速度** | targetWords=1500-2000, draftMode=true | 快速出稿，适合初稿 |
| **特定风格** | systemPrompt="采用古风白话文叙事" | 通过系统提示词约束风格 |
| **续写长章节** | mode='continue', targetWords=3000 | 在现有内容基础上自然延续 |

### 4.2 错误处理与重试

#### 4.2.1 常见错误及解决方案

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| `未配置"章节生成"模型` | 未配置 chapter_gen 模型 | 在 `/model-config` 页面添加模型配置 |
| `VOLUME_COMPLETED` | 卷已达目标章节数 | 检查卷的目标章节数设置，或新建一卷 |
| `SSE stream timeout` | 生成超过 300 秒 | 减少目标字数，或简化上下文 |
| `Chapter not found` | 章节 ID 不存在 | 检查章节 ID 是否正确 |

#### 4.2.2 单章生成失败重试

单章生成失败时，前端会显示错误信息。用户可以：

1. **检查错误原因**：查看控制台或错误提示
2. **调整参数后重试**：减少目标字数、切换模式等
3. **检查模型配置**：确认 API Key 有效且额度充足

#### 4.2.3 批量生成部分失败

批量生成可能出现部分章节失败的情况：

```json
{
  "status": "done",
  "targetCount": 20,
  "completedCount": 18,
  "failedCount": 2
}
```

**处理方案**：

1. **查看历史记录**：确定哪些章节失败
2. **手动补生成**：对失败的章节使用单章生成
3. **分析失败原因**：检查 generation_logs 表获取详细错误信息

**未来计划**（FEAT-5）：提供"重试失败章节"按钮，一键重新投递失败章节。

### 4.3 性能优化建议

#### 4.3.1 减少 Token 消耗

| 优化措施 | 节省 Token | 影响程度 |
|---------|-----------|---------|
| 减少摘要链长度（20→10章） | ~15k tokens | 中等 |
| 精简创作规则（移除低优先级） | ~5k tokens | 低 |
| 缩短世界设定 summary | ~8k tokens | 中等 |
| 使用草稿模式 | ~10k tokens（后处理） | 高 |

#### 4.3.2 加速生成速度

1. **使用草稿模式**：跳过后处理可节省 50-70% 时间
2. **减少目标字数**：2000 字比 5000 字快约 2-3 倍
3. **优化 RAG 性能**：确保 Vectorize 服务可用，避免 DB 兜底路径
4. **选择更快的模型**：在 model-config 中选择速度更快的模型

---

## 五、常见问题 FAQ

### Q1: 生成的内容质量不高怎么办？

**A**: 尝试以下优化：
1. 检查上下文构建是否完整（使用 `/preview-context` 诊断）
2. 优化创作规则，增加具体的风格和质量要求
3. 在 systemPrompt 中添加更详细的约束
4. 考虑增加目标字数（更长的内容通常质量更高）
5. 使用草稿模式多次生成，选择最佳版本

### Q2: 自动修复后的内容我不满意怎么办？

**A**: 
- 修复结果已自动保存到数据库
- 你可以在编辑器中手动修改修复后的内容
- 或者删除当前内容，调整 prompt 后重新生成
- 未来版本将支持"修复前后 Diff 对比"功能（FEAT-4）

### Q3: 草稿模式生成的内容如何转为正式？

**A**: 目前需要手动触发后处理：
1. 在编辑器中打开草稿章节
2. 手动调用后处理 API（或在工坊中触发）
3. 后处理完成后章节状态从 `draft` 变为 `generated`

未来计划：在前端增加"转为正式"按钮，一键触发后处理。

### Q4: 批量生成速度太慢怎么办？

**A**: 批量生成受限于：
1. API 调用速率限制（LLM Provider 的 rate limit）
2. 队列串行执行（一章接一章）
3. 每章都需要构建上下文（~1-2秒）

优化建议：
- 减少单章目标字数
- 选择更快的模型
- 避免在高峰期启动大批量任务
- 未来支持章间延迟配置（FEAT-3）

### Q5: 如何查看某次批量生成中哪些章节失败了？

**A**: 
1. 使用历史查询 API：`GET /api/batch/novels/:id/history`
2. 查看 `failedCount` > 0 的任务记录
3. 检查 `generationLogs` 表，筛选该任务时间段内 `status=error` 的日志
4. 日志中包含 `chapterId`，可定位到具体失败章节

### Q6: SSE 连接中断怎么办？

**A**: 
- 如果是网络波动导致中断：刷新页面，章节内容可能已经保存到数据库
- 如果是超时中断（300秒）：检查章节状态，如果已经是 `generated` 则内容已保存
- 如果内容确实丢失：需要重新生成

**⭐v4.5 优化**：统一 300 秒超时，并在超时时主动检查数据库状态。

### Q7: 可以同时运行多个批量任务吗？

**A**: 
- 同一个卷同时只能有一个 running 状态的任务
- 不同卷可以并行运行批量任务
- 单章生成不受批量任务影响，可以同时进行

### Q8: 如何取消正在进行的批量任务？

**A**: 
1. 在 BatchGeneratePanel 点击"暂停"按钮
2. 调用 `POST /api/batch/:taskId/pause` 接口
3. 已完成的章节不会回滚，未开始的章节不会执行
4. 之后可以恢复任务或创建新任务

---

## 六、最佳实践总结

### 6.1 推荐工作流程

```
阶段 1：准备工作
├─ 完善总纲、卷规划、角色设定
├─ 配置创作规则（全局 + 类型特定）
├─ 配置 chapter_gen 模型
└─ 确保 Vectorize 服务可用

阶段 2：首章生成（单章模式）
├─ 使用标准模式生成前 3-5 章
├─ 检查生成质量和连贯性
├─ 根据实际情况调整规则和 prompt
└─ 确认风格和节奏符合预期

阶段 3：批量生产（批量模式）
├─ 启动批量任务（10-20 章一批）
├─ 监控进度和失败率
├─ 定期检查已生成章节质量
└─ 失败章节及时补生成

阶段 4：质量把控
├─ 使用连贯性检查 API 抽检章节
├─ 使用角色一致性检查验证关键章节
├─ 检查伏笔回收情况
└─ 根据检查结果微调后续生成
```

### 6.2 参数推荐配置

| 场景 | mode | targetWords | draftMode | 其他 |
|------|------|-------------|-----------|------|
| **首次生成** | generate | 3000 | false | 标准模式，观察质量 |
| **快速初稿** | generate | 2000 | true | 草稿模式，快速迭代 |
| **续写长篇** | continue | 3000 | false | 在现有内容上续写 |
| **不满意重写** | rewrite | 3000 | false | 完全重新生成 |
| **批量生产** | - | 3000 | false | 批量任务参数 |
| **实验测试** | generate | 1500 | true | 最小消耗 |

---

## 七、文件索引

| 文件 | 说明 |
|------|------|
| **前端核心** | |
| [GeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generate/GeneratePanel.tsx) | 单章生成面板（含草稿模式开关） |
| [BatchGeneratePanel.tsx](file:///d:/user/NovelForge/src/components/generation/BatchGeneratePanel.tsx) | 批量生成面板（含历史记录入口） |
| [useGenerate.ts](file:///d:/user/NovelForge/src/hooks/useGenerate.ts) | 生成 Hook（SSE 处理 + 持久弹窗逻辑） |
| [useBatchGenerate.ts](file:///d:/user/NovelForge/src/hooks/useBatchGenerate.ts) | 批量生成 Hook（轮询 + 状态管理） |
| **后端路由** | |
| [generate.ts (route)](file:///d:/user/NovelForge/server/routes/generate.ts) | 单章生成 API（SSE + 自动修复） |
| [batch.ts (route)](file:///d:/user/NovelForge/server/routes/batch.ts) | 批量生成 API（启动 + 历史） |
| **后端服务** | |
| [generation.ts (service)](file:///d:/user/NovelForge/server/services/agent/generation.ts) | 章节生成服务（含草稿模式） |
| [batchGenerate.ts](file:///d:/user/NovelForge/server/services/agent/batchGenerate.ts) | 批量生成服务（任务管理） |
| [coherence.ts](file:///d:/user/NovelForge/server/services/agent/coherence.ts) | 连贯性检查与自动修复 |
| [constants.ts](file:///d:/user/NovelForge/server/services/agent/constants.ts) | 全局常量（超时 300s） |
| **基础设施** | |
| [queue-handler.ts](file:///d:/user/NovelForge/server/queue-handler.ts) | 队列处理器（批量任务执行） |
| [contextBuilder.ts](file:///d:/user/NovelForge/server/services/contextBuilder.ts) | 上下文构建引擎（10 槽体系） |
| [types.ts](file:///d:/user/NovelForge/server/services/agent/types.ts) | 类型定义（GenerationOptions） |

---

## 八、版本历史

| 版本 | 日期 | 主要更新 |
|------|------|---------|
| **v1.0.0** | 2026-04-30 | 初始版本，涵盖单章+批量生成全流程 |

---

## 九、相关文档

- [章节上下文构建指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md) - 上下文构建十槽体系详解
- [创作工坊执行指南](./WORKSHOP-EXECUTION-GUIDE.md) - 对话式创作流程
- [模型使用指南](./MODEL-USAGE-GUIDE.md) - 模型配置与管理
- [API 文档](./API.md) - 完整 API 参考

---

> 文档版本：v1.0.0
> 最后更新：2026-04-30
> 维护者：NovelForge 开发团队
> 基于 v4.5 代码库编写（含自动修复写库、草稿模式、SSE 时序优化、批量历史查询等功能）
