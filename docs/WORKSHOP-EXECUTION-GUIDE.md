# NovelForge 创作工坊 — 完整执行指南

> 版本: 1.1.0 | 模块: `server/services/workshop/` (v1.11.0 模块化)
> 前端页面: [WorkshopPage.tsx](file:///d:/开发项目/NovelForge/src/pages/WorkshopPage.tsx)
> 创建日期: 2026-04-25 | 更新日期: 2026-04-27

---

## 一、功能概述

### 1.1 什么是创作工坊

创作工坊是 NovelForge 的**对话式 AI 创作引擎**，通过多轮自然语言对话，帮助作者从零开始构建完整的小说框架。与传统的大纲工具不同，创作工坊采用**渐进式引导**方式，通过 AI 主动提问和互动，逐步完善小说的核心设定、世界观、角色、卷纲和章节大纲。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| **多阶段创作** | 支持概念构思 → 世界观构建 → 角色设计 → 卷纲规划 → 章节大纲五个阶段 |
| **智能数据提取** | 从对话中自动提取结构化数据（JSON 格式） |
| **实时预览** | 右侧面板实时显示已提取的创作数据 |
| **数据导入** | 支持导入 JSON/TXT/MD 格式的已有数据 |
| **一键提交** | 将对话成果一键写入数据库，创建完整小说项目 |

### 1.3 创作阶段详解

```
┌─────────────────────────────────────────────────────────────────┐
│                    创作工坊五阶段流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ① 概念构思  →  ② 世界观构建  →  ③ 角色设计  →  ④ 卷纲规划  →  ⑤ 章节大纲  │
│  (concept)      (worldbuild)      (character_      (volume_     (chapter_    │
│                                   design)         outline)      outline)     │
│                                                                 │
│  起点：         携带：            携带：           携带：         携带：        │
│  无上下文       concept数据        concept+         concept+      所有前期       │
│                                worldbuild数据     worldbuild+    数据          │
│                                               character数据                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、前端界面布局

### 2.1 整体布局（三栏式）

```
┌─────────────┬────────────────────────────┬──────────────────┐
│             │                            │                  │
│  左侧边栏    │        中央对话区           │   右侧预览面板    │
│  (会话管理)  │     (AI 对话 + 输入)        │   (实时数据)     │
│             │                            │                  │
│  - 会话列表  │  - 消息历史展示             │  - 基本信息卡片  │
│  - 新建对话  │  - 流式 AI 回复             │  - 世界设定卡片  │
│  - 重命名    │  - 消息输入框               │  - 角色卡片      │
│  - 删除      │  - 发送按钮                 │  - 卷纲卡片      │
│             │  - 阶段选择器               │  - 章节卡片      │
│             │                            │                  │
└─────────────┴────────────────────────────┴──────────────────┘
```

### 2.2 开始界面

未创建会话时显示引导页面，包含：
- 创作工坊图标和简介
- 五阶段流程图示
- **开始新的创作对话**按钮

点击按钮后自动创建新会话并进入对话界面。

### 2.3 对话界面

- **消息气泡**：用户消息（右侧，主题色背景）和 AI 消息（左侧，灰色背景）
- **流式响应**：AI 回复支持 SSE 流式输出，显示加载动画
- **输入框**：支持 Enter 发送，Shift+Enter 换行
- **阶段选择器**：右上角下拉菜单，可随时切换创作阶段

### 2.4 右侧预览面板

实时显示从对话中提取的结构化数据，包含：

| 数据类型 | 显示内容 |
|----------|----------|
| 基本信息 | 标题、流派、简介、核心看点 |
| 世界设定 | 6 类设定（世界观/境界体系/势力组织/地理环境/宝物功法/其他） |
| 角色设计 | 角色名、定位（主角/配角/反派）、描述 |
| 卷纲规划 | 卷标题、概述、事件线、章节数 |
| 章节大纲 | 章节标题、摘要、出场角色、伏笔操作 |

---

## 三、API 接口详解

### 3.1 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/workshop/session` | 创建新会话 |
| `GET` | `/api/workshop/session/:id` | 获取会话详情 |
| `POST` | `/api/workshop/session/:id/message` | 发送消息（SSE 流式） |
| `POST` | `/api/workshop/session/:id/commit` | 提交会话到数据库 |
| `GET` | `/api/workshop/sessions` | 列出所有活跃会话 |
| `DELETE` | `/api/workshop/session/:id` | 删除会话 |
| `PATCH` | `/api/workshop/session/:id` | 更新会话（标题/阶段） |

### 3.2 创建会话

**请求**
```json
POST /api/workshop/session
{
  "novelId": "可选，关联已有小说ID",
  "stage": "concept | worldbuild | character_design | volume_outline | chapter_outline"
}
```

**响应**
```json
{
  "ok": true,
  "session": {
    "id": "会话ID",
    "stage": "concept",
    "status": "active",
    "createdAt": 1747118662000
  }
}
```

**说明**：
- 不传 `novelId` 表示从零开始创作
- 传入 `novelId` 时，AI 会自动加载该小说的已有数据作为上下文参考
- `stage` 决定带入哪些阶段的数据（见下表）

| stage 参数 | 带入的数据 |
|------------|------------|
| `concept` | 无（起点） |
| `worldbuild` | 小说概念（标题、总纲） |
| `character_design` | 小说概念 + 世界观设定 |
| `volume_outline` | 小说概念 + 世界观 + 角色 |
| `chapter_outline` | 所有前期数据 + 卷 + 章节 |

### 3.3 发送消息（核心接口）

**请求**
```json
POST /api/workshop/session/:id/message
{
  "message": "用户输入的文本",
  "stage": "可选，覆盖会话阶段"
}
```

**响应**：SSE 流式响应

```
data: {"content": "AI 回复的第一段文字"}

data: {"content": "AI 回复的第二段文字"}

data: {"type": "done", "extractedData": {...}}

data: [DONE]
```

**extractedData 结构示例**（concept 阶段）：
```json
{
  "title": "《仙逆》",
  "genre": "玄幻修仙",
  "description": "一个平凡少年逆天改命的修仙故事",
  "coreAppeal": ["废柴逆袭", "热血战斗", "感人情义"],
  "targetWordCount": "500000",
  "targetChapters": "300",
  "writingRules": [
    {"category": "pacing", "title": "节奏要求", "content": "每章至少一个爽点..."}
  ]
}
```

**错误响应**：
```json
data: {"type": "error", "error": "未配置模型..."}
```

### 3.4 提交会话

**请求**
```json
POST /api/workshop/session/:id/commit
```

**响应**
```json
{
  "ok": true,
  "novelId": "新建小说的ID",
  "createdItems": {
    "novel": {...},
    "outline": {...},
    "worldSettings": [...],
    "characters": [...],
    "volumes": [...],
    "chapters": [...]
  },
  "message": "创作数据已成功提交到数据库！"
}
```

**说明**：提交后会创建完整的小说项目，包括：
- `novels` 表记录
- `masterOutline` 表记录
- `novelSettings` 表记录（如有世界设定）
- `characters` 表记录（如有角色）
- `volumes` 表记录（如有卷纲）
- `chapters` 表记录（如有章节大纲）
- `writingRules` 表记录（如有创作规则）
- `entityIndex` 实体索引更新

---

## 四、各阶段输出约束

### 4.1 概念构思阶段 (concept)

**AI 角色**：专业小说策划顾问

**任务**：完善小说的基本概念

**输出约束**：只允许输出以下字段
```json
{
  "title": "小说标题",
  "genre": "流派",
  "description": "一句话简介",
  "coreAppeal": ["核心爽点1", "核心爽点2"],
  "targetWordCount": "预计总字数",
  "targetChapters": "预计章节数",
  "writingRules": [
    {"category": "类别", "title": "规则标题", "content": "规则内容"}
  ]
}
```

**禁止输出**：`worldSettings`、`characters`、`volumes`、`chapters`

**writingRules.category 可选值**：
| 值 | 说明 |
|----|------|
| `style` | 文风要求 |
| `pacing` | 节奏控制 |
| `character` | 角色一致性 |
| `plot` | 情节要求 |
| `world` | 世界观规则 |
| `taboo` | 禁忌事项 |
| `custom` | 自定义规则 |

### 4.2 世界观构建阶段 (worldbuild)

**AI 角色**：世界构建大师

**任务**：完善世界观设定

**输出约束**：只允许输出以下字段
```json
{
  "worldSettings": [
    {"type": "worldview", "title": "世界观", "content": "..."},
    {"type": "power_system", "title": "境界体系", "content": "..."},
    {"type": "faction", "title": "势力组织", "content": "..."},
    {"type": "geography", "title": "地理环境", "content": "..."},
    {"type": "item_skill", "title": "宝物功法", "content": "..."},
    {"type": "misc", "title": "其他设定", "content": "..."}
  ]
}
```

**说明**：
- `type` 必须是六种类型之一
- 输出是**完整版本**，会替换旧版本而非追加
- 设定要求自洽，与 concept 阶段的数据保持一致

### 4.3 角色设计阶段 (character_design)

**AI 角色**：角色塑造专家

**任务**：设计主角、配角、反派

**输出约束**：只允许输出以下字段
```json
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist | supporting | antagonist | minor",
      "description": "详细描述（外貌、性格、背景等）",
      "aliases": ["别名1", "别名2"],
      "attributes": {
        "relationships": ["与其他角色的关系"],
        "其他属性": "值"
      },
      "powerLevel": "战斗力等级（玄幻/修仙类）"
    }
  ]
}
```

**role 可选值**：
| 值 | 说明 |
|----|------|
| `protagonist` | 主角 |
| `supporting` | 配角 |
| `antagonist` | 反派 |
| `minor` | 次要角色 |

### 4.4 卷纲规划阶段 (volume_outline)

**AI 角色**：故事架构师

**任务**：将故事分成 3-8 卷，制定每卷的详细规划

**输出约束**：只允许输出以下字段
```json
{
  "volumes": [
    {
      "title": "第一卷标题",
      "summary": "本卷主要内容概述（1-2句话）",
      "blueprint": "详细的情节蓝图...",
      "eventLine": ["关键事件1", "重要转折点"],
      "notes": ["伏笔1", "备注信息"],
      "targetWordCount": 50000,
      "targetChapterCount": 15
    }
  ]
}
```

### 4.5 章节大纲阶段 (chapter_outline)

**AI 角色**：细化的故事编辑

**任务**：将卷纲拆分为具体章节

**输出约束**：只允许输出以下字段
```json
{
  "chapters": [
    {
      "title": "第X章 标题",
      "summary": "本章简要概述",
      "outline": "本章大纲...",
      "characters": ["出场角色"],
      "foreshadowingActions": [
        {"action": "setup | resolve", "target": "伏笔名称", "description": "如何操作"}
      ],
      "keyScenes": ["场景1", "场景2"]
    }
  ]
}
```

**foreshadowingActions.action 说明**：
| 值 | 说明 |
|----|------|
| `setup` | 埋下伏笔 |
| `resolve` | 回收伏笔 |

---

## 五、数据导入功能

### 5.1 入口

点击右上角 **导入数据** 按钮，打开导入对话框。

### 5.2 支持的模块

| 模块 | 说明 |
|------|------|
| `master_outline` | 总纲/大纲 |
| `setting` | 世界观、势力、地理等设定 |
| `character` | 角色信息 |
| `rule` | 创作规则 |
| `volume` | 卷/部结构 |
| `foreshadowing` | 伏笔线索 |
| `chapter` | 章节内容 |

### 5.3 导入方式

#### 方式一：粘贴数据
- 直接在文本框中粘贴 JSON、TXT 或 Markdown 格式的内容
- 支持多段内容（用空行分隔）

#### 方式二：上传文件
- 拖拽或点击选择文件
- 支持 `.json`、`.txt`、`.md`、`.markdown` 格式
- 支持多文件同时上传

### 5.4 AI 格式化

导入内容后，点击 **解析数据** 按钮，AI 会：
1. 自动识别内容格式（JSON / Markdown / 纯文本）
2. 提取关键信息并转换为标准 JSON 结构
3. 返回解析预览供确认

### 5.5 导入模式

| 模式 | 说明 |
|------|------|
| `create` | 仅新建（跳过已存在的） |
| `update` | 仅更新（需要选择目标记录） |
| `upsert` | 智能导入（存在则更新，不存在则新建）**默认** |

### 5.6 批量导入

支持一次导入多个文件/段落，流程：
1. 上传多个文件 → 自动合并内容
2. 点击解析 → AI 分别解析每个文件
3. 预览所有解析结果
4. 确认导入 → 批量写入数据库

---

## 六、模型配置要求

### 6.1 必须配置

创作工坊依赖 AI 模型进行对话和格式化。需要配置以下任一用途的模型：

| 优先级 | 用途标识 | 说明 |
|--------|----------|------|
| 推荐 | `workshop` | 创作工坊专用模型 |
| 备选 | `chapter_gen` | 章节生成模型（作为备选） |

### 6.2 配置位置

在全局模型配置页面（`/model-config`）添加配置。

### 6.3 配置内容

- **提供商**（如 OpenAI / Claude / 自定义）
- **模型 ID**（如 `gpt-4o`、`claude-sonnet-4-20250514`）
- **API Key**
- **用途**选择 `workshop`

### 6.4 错误处理

如果未配置模型，API 会返回详细错误信息：
```
❌ 未配置"创作工坊"模型！

请在全局模型配置页面（/model-config）添加以下任一配置：
1. 用途选择"创作工坊"(workshop) - 推荐
2. 或用途选择"章节生成"(chapter_gen) 作为备选
```

---

## 七、工作流程示例

### 7.1 从零开始创作新小说

```
步骤 1：创建会话
   └─ 点击"开始新的创作对话"
   └─ 选择阶段：概念构思

步骤 2：对话创作
   └─ AI："欢迎来到创作工坊！让我们开始打造你的小说。"
   └─ 用户："我想写一个废柴逆袭的修仙故事"
   └─ AI：（继续提问完善设定）

步骤 3：提取并预览
   └─ 对话完成后，右侧预览显示提取的数据
   └─ 可随时查看当前阶段的成果

步骤 4：切换阶段
   └─ 完成概念构思后，切换到"世界观构建"
   └─ AI 自动加载概念阶段的数据作为上下文

步骤 5：重复创作
   └─ 依次完成：世界观 → 角色 → 卷纲 → 章节

步骤 6：提交创建
   └─ 点击"提交创建小说"
   └─ 确认对话框显示将创建的内容
   └─ 确认后，数据写入数据库
   └─ 自动跳转到小说工作区
```

### 7.2 继续已有小说创作

```
步骤 1：从小说工作区进入
   └─ 在小说详情页点击"继续世界观构建"等按钮
   └─ URL 参数携带 session ID

步骤 2：自动加载会话
   └─ 前端解析 URL 参数
   └─ 自动加载对应会话的内容

步骤 3：继续对话
   └─ 基于已有数据继续创作
```

### 7.3 导入已有数据

```
步骤 1：准备数据
   └─ 整理已有的角色设定/大纲等

步骤 2：打开导入
   └─ 点击"导入数据"按钮

步骤 3：选择模块和文件
   └─ 模块：角色
   └─ 模式：智能导入（upsert）

步骤 4：解析确认
   └─ AI 解析数据
   └─ 预览解析结果
   └─ 确认无误后点击导入

步骤 5：导入完成
   └─ 数据写入数据库
   └─ 可以在小说工作区看到导入的内容
```

---

## 八、会话管理

### 8.1 会话列表

左侧边栏显示所有活跃会话，按更新时间倒序排列。

### 8.2 会话操作

| 操作 | 说明 |
|------|------|
| 新建 | 点击侧边栏顶部 + 按钮 |
| 切换 | 点击会话项切换当前会话 |
| 重命名 | 点击铅笔图标，输入新名称 |
| 删除 | 点击垃圾桶图标，确认后删除 |

### 8.3 AI 自动命名

当会话没有标题时，AI 会在首次回复后自动生成标题：
- 规则：8-12 个中文字概括对话主题
- 格式：只输出标题，不加标点和解释

---

## 九、技术实现细节

### 9.1 系统提示词构建

每个阶段的系统提示词由以下部分组成：

```
1. 角色定义：你是一个专业的小说策划顾问/世界构建大师/...
2. 阶段任务：本阶段的任务说明
3. 只读上下文：当前阶段可以参考的已有数据
4. 输出约束：严格定义允许输出的字段
5. 格式要求：JSON 代码块的格式规范
```

### 9.2 只读上下文机制

| 阶段 | 可参考的数据 |
|------|-------------|
| `concept` | 无（起点） |
| `worldbuild` | title, genre, description, coreAppeal, targetWordCount, targetChapters |
| `character_design` | concept + worldSettings |
| `volume_outline` | concept + worldSettings + characters |
| `chapter_outline` | concept + worldSettings + characters + volumes + chapters |

**重要**：只读数据只能参考，不能在 JSON 输出中修改。

### 9.3 SSE 流式响应

消息接口采用 Server-Sent Events（SSE）实现流式输出：

```typescript
// 前端处理
const response = await api.workshop.sendMessage(sessionId, { message, stage });
const reader = response.body?.getReader();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = decoder.decode(value);
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const data = JSON.parse(line.slice(5));
    
    if (data.content) {
      // 追加 AI 回复内容
    }
    if (data.type === 'done') {
      // 处理提取的数据
    }
    if (data.type === 'error') {
      // 处理错误
    }
  }
}
```

### 9.4 数据持久化

- **消息历史**：每次对话后保存到 `workshopSessions.messages`
- **提取数据**：每次 AI 回复后保存到 `workshopSessions.extractedData`
- **提交后**：从会话提取数据写入正式表（novels, characters 等）

### 9.5 错误恢复

- **生成中断**：即使 AI 回复中断，已生成的部分内容也会保存
- **标题生成失败**：不影响主流程，仅记录警告日志
- **会话不存在**：返回 404 错误

---

## 十、最佳实践

### 10.1 对话技巧

| 技巧 | 说明 |
|------|------|
| 循序渐进 | 按照阶段顺序创作，不要跳阶段 |
| 明确具体 | 描述设定时尽量具体，帮助 AI 理解 |
| 及时确认 | AI 提取数据后，确认是否符合预期 |
| 多次迭代 | 可以多次修改同一阶段的内容 |

### 10.2 数据导入建议

| 建议 | 说明 |
|------|------|
| 结构化优先 | JSON 格式最容易解析 |
| Markdown 次之 | 带有标题标记的文档 AI 也能较好识别 |
| 纯文本谨慎 | 纯文本可能需要更多解析时间 |
| 批量导入分批 | 大量数据建议分批导入 |

### 10.3 模型选择

| 场景 | 推荐模型 |
|------|----------|
| 创意构思 | GPT-4o / Claude Sonnet 4 |
| 细节填充 | GPT-4o / Claude Sonnet 4 |
| 世界观构建 | Claude 3.5 Sonnet（创意能力强） |
| 格式化导入 | 任意模型均可 |

---

## 十一、常见问题

### Q1: 提示"未配置模型"怎么办？
**A**: 在 `/model-config` 页面添加 `workshop` 用途的模型配置。

### Q2: AI 回复中断怎么办？
**A**: 已生成的部分会自动保存。可以继续发送消息，AI 会基于上下文继续回复。

### Q3: 可以修改已提取的数据吗？
**A**: 可以。继续对话，告诉 AI 需要修改的内容，AI 会更新提取的数据。

### Q4: 提交后发现内容有误怎么办？
**A**: 提交是一次性写入。如需修改，可以进入小说工作区手动编辑。

### Q5: 支持多端同时编辑吗？
**A**: 支持。会话数据存储在服务器端，多端可同步访问。

### Q6: 导入的 JSON 格式有要求吗？
**A**: 只需要包含关键字段即可。AI 会尝试理解并标准化。

### Q7: 可以导入到已有小说吗？
**A**: 可以。创建会话时传入 `novelId`，或在导入时选择目标小说。

---

## 十二、文件索引 (v1.11.0)

### 后端服务模块 (server/services/workshop/)

| 文件 | 说明 |
|------|------|
| [index.ts](file:///d:/开发项目/NovelForge/server/services/workshop/index.ts) | 统一导出入口 (198行) |
| [commit.ts](file:///d:/开发项目/NovelForge/server/services/workshop/commit.ts) | commit逻辑增强 (580行) |
| [extract.ts](file:///d:/开发项目/NovelForge/server/services/workshop/extract.ts) | 数据提取服务 (100行) |
| [helpers.ts](file:///d:/开发项目/NovelForge/server/services/workshop/helpers.ts) | 辅助函数 (116行) |
| [prompt.ts](file:///d:/开发项目/NovelForge/server/services/workshop/prompt.ts) | 分阶段Prompt (660行) |
| [session.ts](file:///d:/开发项目/NovelForge/server/services/workshop/session.ts) | 会话管理 (264行) |
| [types.ts](file:///d:/开发项目/NovelForge/server/services/workshop/types.ts) | 类型定义 (65行) |

### 前端组件 (src/components/workshop/)

| 文件 | 说明 |
|------|------|
| [WorkshopPage.tsx](file:///d:/开发项目/NovelForge/src/pages/WorkshopPage.tsx) | 主页面 (v1.11.0大幅精简) |
| [WorkshopSidebar.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WorkshopSidebar.tsx) | 侧边栏组件 |
| [ChatInput.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ChatInput.tsx) | 聊天输入 (v1.11.0新增) |
| [ChatMessageList.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ChatMessageList.tsx) | 消息列表 (v1.11.0新增) |
| [CommitDialog.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/CommitDialog.tsx) | 提交确认 (v1.11.0新增) |
| [PreviewPanel.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewPanel.tsx) | 预览面板 (v1.11.0新增) |
| [PreviewBasicInfo.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewBasicInfo.tsx) | 基本信息预览 (v1.11.0新增) |
| [PreviewChapters.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewChapters.tsx) | 章节预览 (v1.11.0新增) |
| [PreviewCharacters.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewCharacters.tsx) | 角色预览 (v1.11.0新增) |
| [PreviewVolumes.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewVolumes.tsx) | 卷预览 (v1.11.0新增) |
| [PreviewWorldSettings.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewWorldSettings.tsx) | 世界设定预览 (v1.11.0新增) |
| [PreviewWritingRules.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewWritingRules.tsx) | 规则预览 (v1.11.0新增) |
| [WelcomeView.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WelcomeView.tsx) | 欢迎视图 (v1.11.0新增) |
| [WorkshopHeaderActions.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WorkshopHeaderActions.tsx) | 头部操作 (v1.11.0新增) |
| [ImportDataDialog.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ImportDataDialog.tsx) | 导入对话框 |
| [types.ts](file:///d:/开发项目/NovelForge/src/components/workshop/types.ts) | 前端类型定义 (v1.11.0新增) |

### API路由

| 文件 | 说明 |
|------|------|
| [routes/workshop.ts](file:///d:/开发项目/NovelForge/server/routes/workshop.ts) | 创意工坊API路由 |
| [services/formatImport.ts](file:///d:/开发项目/NovelForge/server/services/formatImport.ts) | 导入格式化服务 |
| [routes/workshop-import.ts](file:///d:/开发项目/NovelForge/server/routes/workshop-import.ts) | 导入API路由 |
| [routes/workshop-format-import.ts](file:///d:/开发项目/NovelForge/server/routes/workshop-format-import.ts) | 格式化导入API |
| [services/agent/constants.ts](file:///d:/开发项目/NovelForge/server/services/agent/constants.ts) | Agent系统常量 |

---

> 文档版本：1.1.0
> 最后更新：2026-04-27
> 维护者：NovelForge 开发团队
