# NovelForge 创作工坊 — 完整执行指南

> 版本: v4.4.0 | 模块: `server/services/workshop/` 全目录 + `src/pages/WorkshopPage.tsx`
> 前端页面: [WorkshopPage.tsx](file:///d:/user/NovelForge/src/pages/WorkshopPage.tsx)
> 创建日期: 2026-04-28 | 最后更新: 2026-04-30

---

## 一、功能概述

### 1.1 什么是创作工坊

创作工坊是 NovelForge 的**对话式 AI 创作引擎**，通过多轮自然语言对话，帮助作者从零开始构建完整的小说框架。与传统的大纲工具不同，创作工坊采用**渐进式引导**方式，通过 AI 主动提问和互动，逐步完善小说的核心设定、世界观、角色和卷纲。

### 1.2 核心能力

| 能力 | 说明 |
|------|------|
| **多阶段创作** | 支持概念构思 → 世界观构建 → 角色设计 → 卷纲规划四个阶段 |
| **智能数据提取** | 从对话中自动提取结构化数据（JSON 格式） |
| **实时预览** | 右侧面板实时显示已提取的创作数据 |
| **数据导入** | 支持导入 JSON/TXT/MD 格式的已有数据 |
| **一键提交** | 将对话成果一键写入数据库，创建完整小说项目 |
| **重新提取** | 支持从已有消息历史中手动重新提取数据 |

### 1.3 创作阶段详解

```
┌─────────────────────────────────────────────────────────────────┐
│                    创作工坊四阶段流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ① 概念构思  →  ② 世界观构建  →  ③ 角色设计  →  ④ 卷纲规划    │
│  (concept)      (worldbuild)      (character_      (volume_     │
│                                   design)         outline)      │
│                                                                 │
│  起点：         携带：            携带：           携带：       │
│  无上下文       concept数据        concept+         concept+      │
│                                worldbuild数据     worldbuild+    │
│                                               character数据     │
└─────────────────────────────────────────────────────────────────┘
```

**说明**：章节大纲（chapter_outline）阶段已整合到卷纲规划阶段中，在规划卷纲时同步输出各卷的章节事件线，无需单独阶段。

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
│             │  - 阶段选择器               │  - 规则卡片      │
│             │                            │                  │
└─────────────┴────────────────────────────┴──────────────────┘
```

### 2.2 开始界面

未创建会话时显示引导页面，包含：
- 创作工坊图标和简介
- 四阶段流程图示
- **开始新的创作对话**按钮

点击按钮后自动创建新会话并进入对话界面。

### 2.3 对话界面

- **消息气泡**：用户消息（右侧，主题色背景）和 AI 消息（左侧，灰色背景）
- **流式响应**：AI 回复支持 SSE 流式输出，显示加载动画
- **输入框**：支持 Enter 发送，Shift+Enter 换行
- **阶段选择器**：右上角下拉菜单，可随时切换创作阶段
- **重新提取**：当 AI 回复格式有误时，可手动触发从消息历史中重新提取数据

### 2.4 右侧预览面板

实时显示从对话中提取的结构化数据，包含：

| 数据类型 | 显示内容 |
|----------|----------|
| 基本信息 | 标题、流派、简介、核心看点、目标字数/章节数 |
| 世界设定 | 6 类设定（世界观/境界体系/势力组织/地理环境/宝物功法/其他） |
| 角色设计 | 角色名、定位（主角/配角/反派）、描述、别名、境界、属性 |
| 卷纲规划 | 卷标题、概述、事件线、伏笔规划、章节数字数目标 |
| 创作规则 | 规则分类、标题、内容、优先级 |

---

## 三、API 接口详解

### 3.1 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/workshop/session` | 创建新会话 |
| `GET` | `/api/workshop/session/:id` | 获取会话详情 |
| `POST` | `/api/workshop/session/:id/message` | 发送消息（SSE 流式） |
| `POST` | `/api/workshop/session/:id/re-extract` | 从消息历史重新提取数据 |
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
  "stage": "concept | worldbuild | character_design | volume_outline"
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
  "genre": "东方玄幻-仙侠修真-宗门争霸",
  "description": "废材少爷林岩被逐出家门，偶得上古传承，从最底层修炼者开始，以碾压式实力逐步征服天玄大陆，揭开自身身世之谜",
  "coreAppeal": ["低调装逼打脸流", "废柴逆袭热血战斗", "感人情义"],
  "targetWordCount": "500",
  "targetChapters": "1500",
  "writingRules": [
    {
      "category": "taboo",
      "title": "主角行为禁忌",
      "content": "主角在未受到存亡威胁时不得主动杀戮无辜，违反会触发心魔，必须在后续章节体现影响",
      "priority": 1
    }
  ]
}
```

**错误响应**：
```
data: {"type": "error", "error": "未配置模型..."}
```

### 3.4 重新提取数据

**请求**
```json
POST /api/workshop/session/:id/re-extract
```

**响应**
```json
{
  "ok": true,
  "extractedData": {...},
  "message": "重新提取完成，提取到字段: title, genre, description..."
}
```

**说明**：当 AI 回复格式有误或需要重新解析时，触发此接口从消息历史中重新提取数据。

**⭐v4.4 增强 — 数组字段 upsert 语义**：
- `worldSettings` / `characters` / `volumes` 数组字段改为 **upsert 合并**（按唯一键：title / name / title）
- 早期轮次的数据不会被后续轮次覆盖，只修改同键值字段
- 非数组字段仍保持"后覆盖前"行为

### 3.5 提交会话（异步队列模式）

**请求**
```json
POST /api/workshop/session/:id/commit
```

**响应**
```json
{
  "ok": true,
  "queued": true,
  "message": "创作数据已成功提交到数据库！"
}
```

**前端行为**：Toast "✅ 提交已加入队列，请稍后在小说列表查看"

**⭐执行架构 — 两阶段队列**：

| 阶段 | 队列消息 | 说明 |
|------|----------|------|
| 第一阶段 | `commit_workshop` | 纯 DB 写入，快速完成，无 AI 调用 |
| 第二阶段 | `workshop_post_commit` | AI 摘要生成，异步处理 |

**第一阶段 `commit_workshop` 处理内容**：
- `novels` 表记录创建
- `masterOutline` 表记录（**模板生成**，非 AI）
- `novelSettings` 表记录 + 向量化入队
- `characters` 表记录 + 向量化入队
- `writingRules` 表记录
- `volumes` 表记录（含 foreshadowing 伏笔记录）
- `entityIndex` 实体索引
- 设置 `workshopSessions.status = 'committed'`
- 入队 `workshop_post_commit`

**第二阶段 `workshop_post_commit` 处理内容**（按顺序）：
1. 生成 genre 专属 `systemPrompt`（AI）
2. AI 流式生成总纲内容（覆盖模板版本）
3. 生成设定摘要（AI，每个设定）
4. 生成卷摘要（AI，每卷）
5. 生成总纲摘要（AI，基于 AI 生成后的总纲内容）

**防重机制**：
- `commit_workshop` 执行前检查 `session.status === 'committed'`，已提交则跳过
- `workshop_post_commit` 执行前检查 `session.status !== 'committed'`，未提交则跳过
- 所有写入操作均为 upsert，不会创建重复记录

**说明**：提交后会创建完整的小说项目，包括：
- `novels` 表记录
- `masterOutline` 表记录（**模板版本**，AI 版本由 `workshop_post_commit` 异步生成覆盖）
- `novelSettings` 表记录 + 向量化（如有世界设定）
- `characters` 表记录 + 向量化（如有角色）
- `volumes` 表记录（如有卷纲）
- `writingRules` 表记录（如有创作规则）
- `foreshadowing` 表记录（从卷纲的伏笔规划中提取）：三态区分（open / resolve_planned）
- `entityIndex` 实体索引
- `workshopSessions.status` 标记为 `'committed'`

---

## 四、各阶段输出约束

### 4.1 概念构思阶段 (concept)

**AI 角色**：专业小说策划顾问

**任务**：完善小说的基本概念

**输出模式**：
- **新建小说**：全量输出，输出完整的故事策划案
- **已有小说**：增量输出模式，只输出本次修改的字段

**输出约束**：只允许输出以下字段
```json
{
  "title": "小说标题",
  "genre": "一级类型-二级类型-三级标签，如：东方玄幻-仙侠修真-宗门争霸",
  "description": "必须包含四要素的一句话简介（60-100字）：[主角身份] + [初始处境/困境] + [核心目标] + [独特钩子/差异化]",
  "coreAppeal": [
    "核心爽点（具体，如：低调装逼打脸流）",
    "独特卖点（区别于同类的差异化）",
    "情感钩子（让读者持续追更的情感动力）"
  ],
  "targetWordCount": "数字，如：500",
  "targetChapters": "数字，如：1500",
  "writingRules": [
    {
      "category": "taboo|style|character|plot|pacing|world|custom",
      "title": "规则标题",
      "content": "具体规则内容（50-150字），必须包含边界条件和违规后果",
      "priority": 1
    }
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

**输出模式**：
- **新建小说**：全量输出，输出完整的 worldSettings
- **已有小说**：增量输出模式，只输出本次新增或修改的设定

**输出约束**：只允许输出以下字段
```json
{
  "worldSettings": [
    {
      "type": "power_system|worldview|faction|geography|item_skill|misc",
      "title": "设定名称",
      "content": "按模板格式填写，内容完整",
      "importance": "high|normal|low"
    }
  ]
}
```

**各类型 content 模板**：

**power_system（境界体系）** — 整个体系只需一条记录：
```
【境界列表】从低到高，每个境界单独一行
炼气期（一至九层）：灵气感知与汇聚阶段，无法凌空御剑
筑基期（前中后期）：建立灵力根基，可御器飞行
...

【突破条件】通用突破条件（灵气积累+机缘/感悟），特殊境界的特殊条件

【跨境界战力】同境界战力差异说明，是否存在跨级战斗可能

【独特规则】本小说境界体系的特殊规则（如有）
```

**faction（势力组织）** — 每个势力单独一条记录：
```
【性质】宗门/王朝/家族/邪道组织/...
【势力层级】在本小说世界的地位
【控制区域】势力占据的地理范围
【实力标准】顶尖高手的境界水平
【与主角关系】主角初始关系及原因，后续走向
【核心矛盾】该势力内部或与外部的主要冲突
【重要人物】关键NPC：姓名·职位·境界（3-5人）
【特色资源】该势力独有的资源、传承或技术
```

**geography（地理环境）** — 每个重要地区单独一条记录：
```
【位置】在世界地图中的位置描述
【特点】地理特征和气候
【资源/危险】特有资源或危险因素
【控制势力】属于哪个势力或无主之地
【主角关联】主角何时会到达，在此发生什么重要事件
```

**item_skill（功法/宝物）** — 每套功法或宝物单独一条记录：
```
【类型】功法/法宝/丹药/阵法/...
【来源/获取途径】
【效果与限制】具体效果，以及使用条件或副作用
【等级定位】对应境界体系中的档次
【主角是否拥有】是/否/将会获得（第X卷）
```

**worldview（世界观）** — 通常一条记录：
```
【世界背景】一段话的世界简介
【核心法则】影响所有角色的世界规律
【当前格局】主要势力分布和当前时代的特征
【世界危机】驱动宏观剧情的深层危机（如有）
【历史背景】影响当前剧情的重要历史事件（1-3个）
```

**importance 可选值**：
| 值 | 说明 |
|----|------|
| `high` | 高频召回，如境界体系、主角势力 |
| `normal` | 按需召回 |
| `low` | 背景参考 |

### 4.3 角色设计阶段 (character_design)

**AI 角色**：角色塑造专家

**任务**：设计主角、配角、反派

**输出模式**：
- **新建小说**：全量输出，输出完整的角色阵容
- **已有小说**：增量输出模式，只输出本次新增或修改的角色

**输出约束**：只允许输出以下字段
```json
{
  "characters": [
    {
      "name": "角色全名",
      "role": "protagonist | supporting | antagonist | minor",
      "description": "200字以内的综合定位描述",
      "aliases": ["常用称呼", "外号", "江湖称号"],
      "powerLevel": "精确境界名（与power_system一致）",
      "attributes": {
        "personality": "性格特点，用3-6个具体关键词描述",
        "speechPattern": "说话方式和语言习惯的具体描述（2-4句）",
        "appearance": "外貌辨识特征（1-2句）",
        "background": "对当前剧情有影响的关键背景（创伤/秘密/执念）",
        "goal": "初始阶段明确目标",
        "weakness": "具体的性格弱点或心理禁忌",
        "relationships": ["与XXX：关系描述"]
      }
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

**attributes 字段规范**：
- `personality`：必须具体，如"外冷内热、睚眦必报、目的性极强"
- `speechPattern`：直接影响对话质量，如"话少但精准，一句话里有两层含义；称呼对方总是用'阁下'而不是'你'"
- `weakness`：必须有操作性，如"对家人的软弱：任何威胁到家人的事会让他失去理智"

### 4.4 卷纲规划阶段 (volume_outline)

**AI 角色**：故事架构师

**任务**：将故事分成 3-8 卷，制定每卷的详细规划

**输出模式**：
- **新建小说**：全量输出，输出完整的卷纲
- **已有小说**：增量输出模式，只输出本次新增或修改的卷

**字数与章节数约束**：
- 每章字数固定为 3000-5000 字
- targetWordCount / targetChapterCount 必须符合约 4000 字/章的比例
- eventLine 条数必须等于 targetChapterCount（硬性要求）

**【换算公式（硬性执行）】
该卷 targetChapterCount = round(该卷 targetWordCount ÷ 4000)
eventLine 条数 = targetChapterCount**

**输出约束**：只允许输出以下字段
```json
{
  "volumes": [
    {
      "title": "第一卷：卷标题（标题要体现本卷核心主题）",
      "summary": "本卷一句话概述：主角从[状态A]到[状态B]，通过[核心事件]实现[目标或转变]（30-50字）",
      "blueprint": "按【本卷主题】...【伏笔规划】标签格式完整填写",
      "eventLine": [
        "第1章：[场景标签] 事件描述（起因→结果）",
        "第2章：[场景标签] 事件描述（起因→结果）"
      ],
      "foreshadowingSetup": ["伏笔埋入计划"],
      "foreshadowingResolve": ["伏笔回收计划"],
      "notes": ["本卷创作注意事项"],
      "targetWordCount": 200000,
      "targetChapterCount": 50
    }
  ]
}
```

**eventLine 格式要求** ⭐v4.4 增强：
- **存储格式**：JSON 数组 `["第1章：...","第2章：..."]`（⭐v4.4 统一标准）
- 展示格式：`"第N章：[场景标签] 事件描述（起因→结果）"`
- 场景标签：用方括号标注主要场景，如 `[宗门大殿]` `[荒野]` `[秘境内部]`
- 事件描述：必须包含起因和结果，约30-50字
- **条数必须等于 targetChapterCount**
- **⭐v4.4**：生成侧 `extractCurrentChapterEvent` 支持按索引 O(1) 访问，零歧义

**blueprint 格式（结构化）**：
```
【本卷主题】一句话说明本卷的核心议题和叙事重心

【开卷状态】主角在本卷第一章开始时的：位置·境界·目标·处境

【核心冲突】本卷的主要矛盾（明确双方、冲突根源、利益边界）

【关键节点】
- 节点1（约第X章）：[类型：转折/高潮/揭秘] 具体事件描述
- 节点2（约第X章）：...

【卷末状态】主角在本卷最后一章结束时的：位置·境界·目标·与下卷的衔接点

【情感弧线】主角在本卷经历的核心情感/心态变化

【伏笔规划】
- 埋入：[伏笔名称] 第X章前后，通过[具体方式]埋入
- 回收：[伏笔名称] 第X章，以[方式]揭露
```

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
   └─ 依次完成：世界观 → 角色 → 卷纲

步骤 6：提交创建
   └─ 点击"提交创建小说"
   └─ 确认对话框显示将创建的内容
   └─ 确认后，数据写入数据库，提交加入队列
   └─ Toast 提示"✅ 提交已加入队列，请稍后在小说列表查看"
   └─ AI 总纲/摘要由队列异步生成，可在小说工作区稍后查看
```

### 7.2 继续已有小说创作 ⭐v4.4 增强

```
步骤 1：从小说工作区进入
   └─ 在小说详情页点击"继续世界观构建"等按钮
   └─ URL 参数携带 session ID

步骤 2：自动加载会话
   └─ 前端解析 URL 参数
   └─ 自动加载对应会话的内容
   └─ ⭐v4.4：eventLine 字段兼容 JSON 数组和纯文本两种格式

步骤 3：继续对话
   └─ 基于已有数据继续创作
   └─ ⭐v4.4：跨阶段修改不再被跳过（阶段门控已移除 worldSettings/characters/volumes）
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
3. 输出模式判断：新建小说（全量）vs 已有小说（增量）
4. 只读上下文：当前阶段可以参考的已有数据
5. 输出约束：严格定义允许输出的字段
6. 格式要求：各字段的详细格式规范
```

### 9.2 只读上下文机制

| 阶段 | 可参考的数据 |
|------|-------------|
| `concept` | 无（起点） |
| `worldbuild` | title, genre, description, coreAppeal, targetWordCount, targetChapters, writingRules |
| `character_design` | concept + worldSettings |
| `volume_outline` | concept + worldSettings + characters |

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
- **提交后 AI 处理**：通过两阶段队列（`commit_workshop` → `workshop_post_commit`）异步生成总纲及各类摘要

### 9.5 错误恢复与容错

- **生成中断**：即使 AI 回复中断，已生成的部分内容也会保存
- **JSON 截断**：当 AI 输出因长度限制被截断时，`extract.ts` 提供了兜底提取逻辑
- **卷纲截断检测** ⭐v4.4 增强：多维度检测（末尾 ``` + JSON 解析 + 章节数一致性校验）
  - 无 ``` 且 JSON 解析失败 → 报"输出可能被截断"
  - JSON 解析成功但 `eventLine.length !== targetChapterCount` → 报"章节数不一致"
  - 都正常 → 无提示
- **标题生成失败**：不影响主流程，仅记录警告日志

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

> 📖 **详细指南**: 导入数据功能是创意工坊的重要子功能，支持 7 大模块的批量数据导入、AI 智能格式化、名称→ID 自动匹配等高级功能。
> - 📄 完整使用文档: [**导入数据功能使用指南**](./IMPORT-DATA-GUIDE.md)
> - 🔧 支持模块: 总纲/设定/角色/规则/卷/伏笔/章节
> - ⭐ 核心特性: AI 格式化、智能匹配、三种导入模式（create/update/upsert）
> - 💡 推荐阅读: 了解如何高效地批量初始化小说项目数据

### 10.3 模型选择

| 场景 | 推荐模型 |
|------|----------|
| 创意构思 | GPT-4o / Claude Sonnet 4 |
| 细节填充 | GPT-4o / Claude Sonnet 4 |
| 世界观构建 | Claude 3.5 Sonnet（创意能力强） |
| 卷纲输出 | 推荐增大 max_tokens（32000 以上） |

---

## 十一、常见问题

### Q1: 提示"未配置模型"怎么办？
**A**: 在 `/model-config` 页面添加 `workshop` 用途的模型配置。

### Q2: AI 回复中断怎么办？
**A**: 已生成的部分会自动保存。可以继续发送消息，AI 会基于上下文继续回复。

### Q3: 可以修改已提取的数据吗？
**A**: 可以。继续对话，告诉 AI 需要修改的内容，AI 会更新提取的数据（增量模式）。

### Q4: 提交后发现内容有误怎么办？
**A**: 提交是一次性写入。如需修改，可以进入小说工作区手动编辑。

### Q5: 支持多端同时编辑吗？
**A**: 支持。会话数据存储在服务器端，多端可同步访问。

### Q6: 导入的 JSON 格式有要求吗？
**A**: 只需要包含关键字段即可。AI 会尝试理解并标准化。

### Q7: 可以导入到已有小说吗？
**A**: 可以。创建会话时传入 `novelId`，或在导入时选择目标小说。

### Q8: 卷纲数据提取失败怎么办？
**A**: 可以使用"重新提取"功能，从消息历史中重新解析数据。也可尝试在模型配置中增大 max_tokens。

---

## 十二、文件索引

### 后端服务模块 (server/services/workshop/)

| 文件 | 说明 |
|------|------|
| [index.ts](file:///d:/开发项目/NovelForge/server/services/workshop/index.ts) | 统一导出入口 |
| [commit.ts](file:///d:/user/NovelForge/server/services/workshop/commit.ts) | commit 逻辑 + workshopPostCommit AI 后处理（两阶段队列） |
| [generateGenreSystemPrompt.ts](file:///d:/user/NovelForge/server/services/workshop/generateGenreSystemPrompt.ts) | AI 生成小说 genre 专属 systemPrompt |
| [extract.ts](file:///d:/user/NovelForge/server/services/workshop/extract.ts) | 数据提取服务，含 JSON 容错、兜底提取、数组 upsert 合并 |
| [helpers.ts](file:///d:/开发项目/NovelForge/server/services/workshop/helpers.ts) | 辅助函数：总纲模板构建 + AI 流式生成总纲 |
| [prompt.ts](file:///d:/开发项目/NovelForge/server/services/workshop/prompt.ts) | 分阶段 Prompt，含详细格式模板 |
| [session.ts](file:///d:/开发项目/NovelForge/server/services/workshop/session.ts) | 会话管理，加载小说上下文 |
| [types.ts](file:///d:/开发项目/NovelForge/server/services/workshop/types.ts) | 类型定义 |

### 前端组件 (src/components/workshop/)

| 文件 | 说明 |
|------|------|
| [WorkshopPage.tsx](file:///d:/开发项目/NovelForge/src/pages/WorkshopPage.tsx) | 主页面 (v3.0 重构版) |
| [WorkshopSidebar.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WorkshopSidebar.tsx) | 侧边栏组件 |
| [ChatInput.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ChatInput.tsx) | 聊天输入组件 |
| [ChatMessageList.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ChatMessageList.tsx) | 消息列表组件 |
| [CommitDialog.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/CommitDialog.tsx) | 提交确认对话框 |
| [PreviewPanel.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewPanel.tsx) | 预览面板容器 |
| [PreviewBasicInfo.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewBasicInfo.tsx) | 基本信息预览 |
| [PreviewChapters.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewChapters.tsx) | 章节预览 |
| [PreviewCharacters.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewCharacters.tsx) | 角色预览 |
| [PreviewVolumes.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewVolumes.tsx) | 卷预览 |
| [PreviewWorldSettings.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewWorldSettings.tsx) | 世界设定预览 |
| [PreviewWritingRules.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/PreviewWritingRules.tsx) | 规则预览 |
| [WelcomeView.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WelcomeView.tsx) | 欢迎视图 |
| [WorkshopHeaderActions.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/WorkshopHeaderActions.tsx) | 头部操作按钮 |
| [ImportDataDialog.tsx](file:///d:/开发项目/NovelForge/src/components/workshop/ImportDataDialog.tsx) | 导入对话框 |
| [types.ts](file:///d:/开发项目/NovelForge/src/components/workshop/types.ts) | 前端类型定义 |

### API 路由

| 文件 | 说明 |
|------|------|
| [routes/workshop.ts](file:///d:/开发项目/NovelForge/server/routes/workshop.ts) | 创作工坊 API 路由 |
| [services/formatImport.ts](file:///d:/开发项目/NovelForge/server/services/formatImport.ts) | 导入格式化服务 |
| [routes/workshop-import.ts](file:///d:/开发项目/NovelForge/server/routes/workshop-import.ts) | 导入 API 路由 |
| [routes/workshop-format-import.ts](file:///d:/开发项目/NovelForge/server/routes/workshop-format-import.ts) | 格式化导入 API |

---

> 文档版本：1.3.0
> 最后更新：2026-04-29
> 维护者：NovelForge 开发团队
