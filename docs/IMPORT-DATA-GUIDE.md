# 导入数据功能使用指南

> **所属系统**: 创意工坊 (Workshop)  
> **文档版本**: v1.0  
> **最后更新**: 2026-04-30  
> **相关文档**: [创意工坊执行指南](./WORKSHOP-EXECUTION-GUIDE.md) | [章节生成上下文指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md) | [API 文档](./API.md)

---

## 📖 功能概述

**导入数据**是创意工坊的核心子功能之一，允许用户将外部数据（JSON、Markdown、纯文本）批量导入到小说项目中，支持 7 大模块的数据导入。

### 🎯 核心价值

1. **快速初始化项目**: 从其他工具/平台迁移数据
2. **批量操作效率**: 一次性导入多个角色、章节、设定等
3. **AI 智能解析**: 支持非结构化文本自动转换为结构化数据
4. **智能关联匹配**: 通过名称自动匹配 ID（卷标题→卷ID、章节标题→章节ID）
5. **灵活的导入模式**: 支持 create/update/upsert 三种模式

---

## 🚀 快速开始

### 基本使用流程

```
1. 打开创意工坊 → 选择目标小说项目
2. 点击"导入数据"按钮
3. 选择要导入的模块类型（章节/角色/卷/设定/规则/伏笔/总纲）
4. 输入或粘贴数据内容
5. 选择导入模式（create/update/upsert）
6. 可选：使用 AI 格式化优化数据
7. 预览并确认导入结果
8. 执行导入
```

### 支持的数据格式

| 格式 | 说明 | 适用场景 |
|------|------|---------|
| **JSON** | 结构化数据对象 | 已有标准格式的数据 |
| **Markdown** | Markdown 文档 | 从笔记软件导出的内容 |
| **纯文本** | 自由格式文本 | 手写的内容描述 |
| **数组 JSON** | 多个对象的数组 | 批量导入多条数据 |

---

## 📚 各模块详细说明

### 1️⃣ 总纲 (Master Outline)

**用途**: 导入小说的整体大纲和世界观设定

**支持字段**:
```typescript
{
  title: string           // 必填 - 总纲标题
  summary?: string        // 可选 - 总纲摘要（100-200字概括核心内容）
  content: string         // 必填 - 完整的总纲正文（支持 Markdown）
}
```

**示例输入**:
```json
{
  "title": "修仙之路总纲",
  "summary": "本文讲述了一个平凡少年林萧在机缘巧合下踏入修仙世界，历经磨难最终成为一代宗师的故事",
  "content": "# 世界观\n\n这是一个修仙世界，分为凡人界和仙界...\n\n# 主角设定\n\n林萧，18岁，出身贫寒村落..."
}
```

**特殊行为**:
- ✅ 自动递增 `version` 字段（基于现有最大版本号 +1）
- ✅ 自动计算 `wordCount`（基于 content 字符数）

**导入模式说明**:
- **create**: 总是创建新版本（推荐用于迭代优化总纲）
- **update**: 更新指定 ID 的已有版本
- **upsert**: 如果 title 相同则更新，否则创建新版本

---

### 2️⃣ 设定 (Setting)

**用途**: 导入世界观、势力组织、地理环境、宝物功法等设定信息

**支持字段**:
```typescript
{
  name: string              // 必填 - 设定名称
  type: string              // 设定类型（见下方枚举）
  category?: string         // 可选 - 分类（默认与 type 相同）
  content: string           // 详细内容（支持 Markdown）
  importance?: string       // 重要程度: 'high' | 'normal' | 'low'
}
```

**type 枚举值**:
| 值 | 含义 | 示例 |
|----|------|------|
| `worldview` | 世界观 | 修炼体系概述 |
| `power_system` | 境界体系 | 炼气→筑基→金丹 |
| `faction` | 势力组织 | 青云宗、魔煞门 |
| `geography` | 地理环境 | 东荒大陆、无尽海 |
| `item_skill` | 宝物功法 | 上古玉佩、九转神功 |
| `misc` | 其他 | 杂项设定 |

**示例输入**:
```json
{
  "name": "青云宗",
  "type": "faction",
  "category": "正道势力",
  "content": "青云宗是东荒大陆三大宗门之一，以剑道闻名...",
  "importance": "high"
}
```

**批量导入示例**:
```json
[
  {"name": "青云宗", "type": "faction", "category": "正道势力", "content": "..."},
  {"name": "魔煞门", "type": "faction", "category": "邪道势力", "content": "..."},
  {"name": "炼气期", "type": "power_system", "content": "修仙第一境界..."}
]
```

**特殊行为**:
- ✅ 自动计算 `sortOrder`（基于当前设定数量）
- ✅ `category` 默认值 = `type`（可独立设置实现更细粒度分类）

---

### 3️⃣ 角色 (Character)

**⭐ 重点说明**: 角色的详细信息存储在 `attributes` JSON 对象中！

**支持字段**:
```typescript
{
  name: string              // 必填 - 角色姓名
  role: string              // 角色定位（见下方枚举）
  description: string       // 综合描述（简要版，2-3句话概括）
  aliases?: string[]        // 别名列表
  powerLevel?: string       // 战斗力等级（玄幻/修仙类必填）
  relationships?: string[]  // 角色关系列表（存入 attributes JSON）
  attributes?: object       // 详细属性对象（包含外貌/性格/背景等）
}
```

**role 枚举值**:
| 值 | 含义 | 使用场景 |
|----|------|---------|
| `protagonist` | 主角 | 故事核心人物 |
| `supporting` | 配角 | 重要配角 |
| `antagonist` | 反派 | 对抗角色 |
| `minor` | 次要角色 | 路人甲等 |

**attributes 对象结构** (重要!):
```typescript
{
  appearance?: string      // 外貌描述（身高、体型、容貌特征等）
  personality?: string     // 性格特点（行为模式、价值观、优缺点等）
  backgroundStory?: string // 背景故事（出身、经历、动机等）
  age?: string             // 年龄
  gender?: string          // 性别
  occupation?: string      // 职业
  // ... 其他自定义属性
}
```

**完整示例**:
```json
{
  "name": "林萧",
  "role": "protagonist",
  "description": "青云宗外门弟子，天赋异禀，性格坚毅沉稳",
  "aliases": ["小林", "林师兄"],
  "powerLevel": "筑基初期",
  "relationships": [
    "苏婉儿(青梅竹马/恋人)",
    "赵长老(授业恩师)",
    "王师姐(同门师姐)"
  ],
  "attributes": {
    "appearance": "身高175cm，剑眉星目，身穿青色长袍，气质清冷",
    "personality": "性格坚毅沉稳，重情重义，不畏强权，有强烈的正义感",
    "backgroundStory": "出身东荒大陆边缘的小山村，父母早亡，被路过的修士发现灵根资质",
    "age": "18",
    "gender": "男",
    "occupation": "修士/学生"
  }
}
```

**实际存储结果**:
- `description`: "青云宗外门弟子，天赋异禀，性格坚毅沉稳"
- `aliases`: `["小林", "林师兄"]` (JSON 数组)
- `powerLevel`: "筑基初期"
- `attributes` (JSON):
  ```json
  {
    "appearance": "身高175cm，剑眉星目...",
    "personality": "性格坚毅沉稳...",
    "backgroundStory": "出身东荒大陆边缘...",
    "age": "18",
    "gender": "男",
    "occupation": "修士/学生",
    "relationships": ["苏婉儿(青梅竹马/恋人)", "赵长老(授业恩师)", "王师姐(同门师姐)"]
  }
  ```

**⚠️ 关键注意事项**:
1. ❌ 不要把 `appearance`, `personality`, `backgroundStory` 当作顶级字段
2. ✅ 它们必须放在 `attributes` 对象内部
3. ✅ `relationships` 会自动合并到 `attributes` 中（与创意工坊 commit 行为一致）
4. ✅ AI 格式化时会自动处理这个转换

---

### 4️⃣ 规则 (Rule)

**用途**: 导入创作规则（风格、节奏、人物塑造、剧情要求等）

**支持字段**:
```typescript
{
  title: string            // 必填 - 规则标题
  category: string         // 规则类别（见下方枚举）
  content: string          // 规则详细内容
  priority?: number        // 优先级 (1-5, 数字越小优先级越高)
}
```

**category 枚举值**:
| 值 | 含义 | 示例 |
|----|------|------|
| `style` | 写作风格 | 第三人称叙事、文风要求 |
| `pacing` | 节奏控制 | 章节长度、高潮分布 |
| `character` | 人物塑造 | 角色成长弧线 |
| `plot` | 剧情结构 | 三幕式、伏笔密度 |
| `world` | 世界观一致性 | 设定冲突检查 |
| `taboo` | 禁忌事项 | 不能出现的内容 |
| `custom` | 自定义规则 | 其他 |

**示例输入**:
```json
{
  "title": "第三人称限制视角",
  "category": "style",
  "content": "全文采用第三人称限制视角，只描写主角林萧的所见所闻所想，不切换到其他角色的视角",
  "priority": 1
}
```

**特殊行为**:
- ✅ 新建规则默认 `isActive: 1`（启用状态）
- ✅ 自动计算 `sortOrder`
- ✅ `priority` 默认值为 3

---

### 5️⃣ 卷 (Volume)

**⭐ 重点说明**: 卷支持伏笔计划字段，可用于自动创建伏笔记录！

**支持字段**:
```typescript
{
  title: string                    // 必填 - 卷标题
  summary?: string                 // 卷概要（1-2句话）
  blueprint?: string               // 详细蓝图（起承转合结构）
  eventLine?: string[] | string    // 事件线数组（或 JSON 字符串）
  notes?: string[] | string        // 备注数组（或 JSON 字符串）
  chapterCount?: number            // 预计章节数
  targetWordCount?: number | null  // 目标字数（单位：字）
  targetChapterCount?: number | null // 目标章节数
  foreshadowingSetup?: string[]    // 伏笔埋设计划数组 ⭐
  foreshadowingResolve?: string[]  // 伏笔回收计划数组 ⭐
}
```

**完整示例**:
```json
{
  "title": "第一卷：觉醒之路",
  "summary": "讲述主角从普通人成长为修士的历程，包含入门测试和初次历练",
  "blueprint": "第一幕：平凡少年获得神秘玉佩（第1-5章）\n第二幕：踏上修行之路（第6-15章）\n第三幕：初露锋芒（第16-30章）",
  "eventLine": [
    "获得神秘玉佩",
    "通过入门测试",
    "拜入青云宗",
    "初遇苏婉儿",
    "第一次下山历练"
  ],
  "notes": [
    "注意节奏，前期铺垫要充分",
    "埋下血海深仇的伏笔",
    "苏婉儿的出场要自然"
  ],
  "chapterCount": 30,
  "targetWordCount": 300000,
  "targetChapterCount": 30,
  "foreshadowingSetup": [
    "【高】神秘玉佩（主角童年获得的玉佩，内藏上古功法残页）",
    "【中】血海深仇（反派与主角家族的血债，十年前灭门惨案）",
    "【低】隐藏身份（主角身世之谜）"
  ],
  "foreshadowingResolve": [
    "【高】玉佩之谜（第二十章：玉佩真相大白，开启上古传承）",
    "【中】复仇之路（第五十章：找到灭门真凶）"
  ]
}
```

**⚠️ 关于 foreshadowingSetup / foreshadowingResolve**:

这两个字段在**创意工坊 commit 时会自动创建对应的伏笔记录**！导入时也会保存这些字段，但**不会自动创建伏笔**（需要手动在工坊中执行 commit 或单独导入伏笔）。

建议的使用方式：
1. 先导入卷（含伏笔计划）
2. 再导入具体的伏笔数据（带 chapterId/resolvedChapterId 关联）

---

### 6️⃣ 伏笔 (Foreshadowing)

**⭐ 重点说明**: 伏笔支持三层智能关联匹配！

**支持字段**:
```typescript
{
  title: string                      // 必填 - 伏笔标题
  description: string                // 详细描述
  status?: string                    // 状态（见下方枚举）
  importance?: string                // 重要程度: 'high' | 'normal' | 'low'
  volumeId?: string                  // 所属卷 ID（可选，可用 volumeTitle 替代）
  volumeTitle?: string               // 所属卷标题【智能匹配✨】
  chapterId?: string                 // 触发章节 ID（可选，可用 chapterTitle 替代）
  chapterTitle?: string              // 触发章节标题【智能匹配✨】
  resolvedChapterId?: string         // 回收章节 ID（可选，可用 resolvedChapterTitle 替代）
  resolvedChapterTitle?: string      // 回收章节标题【智能匹配✨】
}
```

**status 枚举值**:
| 值 | 含义 | 使用场景 |
|----|------|---------|
| `open` | 开放状态 | 已埋设，尚未回收 |
| `resolved` | 已回收 | 伏笔已揭示 |
| `abandoned` | 已放弃 | 不再使用此伏笔 |
| `resolve_planned` | 计划回收 | 已计划回收时机 |

**完整示例（使用标题智能匹配）**:
```json
{
  "title": "神秘玉佩",
  "description": "主角林萧在童年时期获得的神秘玉佩，内藏上古功法《九转混沌诀》的残页。此玉佩是其父母遗物，也是后续剧情的关键道具。",
  "status": "open",
  "importance": "high",
  "volumeTitle": "第一卷：觉醒之路",
  "chapterTitle": "第一章：童年",
  "resolvedChapterTitle": "第二十章：玉佩之谜"
}
```

**智能匹配机制** 🧠:

当提供 `volumeTitle` / `chapterTitle` / `resolvedChapterTitle` 时，系统会：
1. 在数据库中查找相同标题的卷/章节
2. 自动获取对应的 ID
3. 存储到 `volumeId` / `chapterId` / `resolvedChapterId` 字段

**容错处理**:
- ✅ 如果找不到匹配的卷/章节，不会报错
- ✅ 对应字段设置为 `null`
- ✅ 在控制台输出警告日志（方便调试）

**使用 ID 的示例（高级用户）**:
```json
{
  "title": "神秘玉佩",
  "description": "...",
  "volumeId": "vol_abc123",
  "chapterId": "chap_def456",
  "resolvedChapterId": "chap_xyz789"
}
```

---

### 7️⃣ 章节 (Chapter)

**用途**: 导入小说章节正文内容

**支持字段**:
```typescript
{
  title: string            // 必填 - 章节标题
  content: string          // 正文内容
  summary?: string         // 章节摘要（可选）
  volumeId?: string        // 卷 ID（可选，可用 volumeTitle 替代）
  volumeTitle?: string     // 卷标题【智能匹配✨】
}
```

**示例输入**:
```json
{
  "title": "第一章：觉醒",
  "content": "清晨的阳光透过破旧的窗棂洒进屋内，林萧缓缓睁开双眼。\n\n今天是他十八岁的生日，也是他命运转折的一天...",
  "summary": "林萧十八岁生日当天，意外激活了随身佩戴的神秘玉佩",
  "volumeTitle": "第一卷：觉醒之路"
}
```

**批量导入示例**:
```json
[
  {"title": "第一章：觉醒", "content": "...", "volumeTitle": "第一卷"},
  {"title": "第二章：测试", "content": "...", "volumeTitle": "第一卷"},
  {"title": "第三章：入门", "content": "...", "volumeTitle": "第一卷"}
]
```

**特殊行为**:
- ✅ 自动计算 `wordCount`（基于 content 字符数）
- ✅ 自动计算 `sortOrder`（基于当前章节数量）
- ✅ 默认 `status: 'draft'`
- ✅ 如果未指定 volumeId/volumeTitle，自动关联到第一个卷

---

## 🔧 高级功能

### AI 格式化 (Format Import)

**功能**: 使用 AI 将非结构化文本转换为标准的 JSON 格式

**触发条件**:
- 输入的内容不是有效的 JSON
- 用户点击"AI 格式化"按钮

**工作流程**:
```
原始文本 → AI 分析 → 提取关键字段 → 生成标准化 JSON → 预览确认 → 导入
```

**支持的输入格式**:
- ✅ 纯文本段落
- ✅ Markdown 文档
- ✅ 不完整的 JSON
- ✅ 自然语言描述

**示例**:
**输入** (纯文本):
```
角色：张三
身份：主角
外貌：身高180cm，相貌英俊
性格：坚毅沉稳
背景：出身贫寒村落
关系：苏婉儿（青梅竹马）、赵长老（师父）
```

**AI 输出** (标准化 JSON):
```json
{
  "name": "张三",
  "role": "protagonist",
  "description": "主角角色",
  "attributes": {
    "appearance": "身高180cm，相貌英俊",
    "personality": "坚毅沉稳",
    "backgroundStory": "出身贫寒村落"
  },
  "relationships": ["苏婉儿(青梅竹马)", "赵长老(师父)"]
}
```

**注意事项**:
- ⏱️ AI 格式化需要额外的 API 调用时间（通常 2-5 秒）
- 💰 会消耗 AI Token 配额
- ✅ 格式化后仍可手动编辑预览结果
- ✅ 可以多次尝试不同表述以获得更好的结果

---

### 三种导入模式详解

#### 1. Create 模式（仅新建）
```
行为: 总是创建新记录
适用: 初始化全新数据
特点: 即使同名也创建新的（适合历史版本管理）
```

**示例**: 导入 10 个角色，全部新建，即使有重名的也会创建

#### 2. Update 模式（仅更新）
```
行为: 只更新已存在的记录（必须提供 id）
适用: 批量修改已有数据
特点: 未提供 id 的数据会被跳过
```

**示例**:
```json
[
  {"id": "char_abc123", "name": "林萧", "powerLevel": "金丹期"},  // 更新
  {"id": "char_def456", "name": "苏婉儿", "description": "新描述"}   // 更新
  {"name": "新角色"}  // ❌ 会被跳过（缺少 id）
]
```

#### 3. Upsert 模式（智能合并）⭐ 推荐
```
行为: 存在则更新，不存在则创建
适用: 日常使用的大部分场景
特点: 基于唯一标识符判断（如角色名、伏笔标题等）
```

**各模块的唯一标识符**:
| 模块 | 唯一标识符 | 匹配逻辑 |
|------|-----------|---------|
| Character | `name` + `deletedAt=null` | 同名角色视为同一人 |
| Volume | `title` + `deletedAt=null` | 同名卷视为同一个 |
| Setting | `name` + `deletedAt=null` | 同名设定视为同一个 |
| Rule | `title` + `deletedAt=null` | 同名规则视为同一个 |
| Foreshadowing | `title` | 同名伏笔视为同一个 |
| Chapter | 无（总是新建） | 基于 sortOrder |
| MasterOutline | 无（总是新建） | 基于 version |

**Upsert 示例**:
```json
[
  {"name": "林萧", "powerLevel": "金丹期"},  // ✅ 更新已有的林萧
  {"name": "新角色A", "role": "supporting"},  // ✅ 创建新角色
  {"name": "林萧", "description": "新描述"}     // ✅ 再次更新林萧
]
```

---

### 智能匹配机制详解

**支持的匹配类型**:

#### 1️⃣ 卷标题 → 卷ID
```json
// 输入
{"volumeTitle": "第一卷：觉醒之路"}

// 系统自动查询
SELECT id FROM volumes WHERE novel_id=? AND title='第一卷：觉醒之路'

// 结果
{"volumeId": "vol_abc123"}
```

**应用模块**: Chapter, Foreshadowing

#### 2️⃣ 章节标题 → 章章ID
```json
// 输入
{"chapterTitle": "第一章：童年"}

// 系统自动查询
SELECT id FROM chapters WHERE novel_id=? AND title='第一章：童年'

// 结果
{"chapterId": "chap_def456"}
```

**应用模块**: Foreshadowing

#### 3️⃣ 回收章节标题 → 回收章节ID
```json
// 输入
{"resolvedChapterTitle": "第二十章：玉佩之谜"}

// 系统自动查询
SELECT id FROM chapters WHERE novel_id=? AND title='第二十章：玉佩之谜'

// 结果
{"resolvedChapterId": "chap_xyz789"}
```

**应用模块**: Foreshadowing

**容错策略**:
- ✅ 找不到匹配时不报错，字段设为 `null`
- ✅ 控制台输出警告日志
- ✅ 不影响其他字段的正常导入

---

## 🎨 UI 组件说明

### 导入对话框界面 (ImportDataDialog)

**位置**: 创意工坊 → 工具栏 → "导入数据" 按钮

**主要区域**:

#### 1️⃣ 模块选择区
- 7 个模块图标+文字说明
- 点击切换不同模块
- 显示当前选中模块的描述

#### 2️⃣ 数据输入区 (Tabs)
- **粘贴模式**: 直接粘贴文本/JSON
- **文件上传模式**: 上传 .json/.txt/.md 文件
- **模板模式**: 查看和使用预设模板

**动态提示**: 
- 根据 selectedModule 显示不同的 placeholder
- 包含完整的字段列表和示例代码
- 新增字段标记 【✨】

#### 3️⃣ 导入选项区
- **导入模式选择**: Create / Update / Upsert
- **AI 格式化开关**: 是否使用 AI 解析非 JSON 内容
- **预览按钮**: 解析并展示将要导入的数据

#### 4️⃣ 预览展示区
- **JSON 原始视图**: 展示解析后的完整 JSON
- **字段表格视图** ⭐: 
  - 表格形式展示每个字段
  - 列名: 字段 | 值 | 状态
  - 新增字段绿色高亮 【新增✨】
  - 字段覆盖率统计 ("X 个字段, Y 个新增")

#### 5️⃣ 操作按钮区
- **取消**: 关闭对话框
- **预览**: 解析但不导入
- **确认导入**: 执行导入操作

---

## 📊 数据验证规则

### 必填字段检查
- 所有模块的标识字段（name/title）为必填
- 缺少必填字段时使用默认值（如 "未命名角色"、"未命名章节"）

### 类型验证
- `importMode`: 必须是 create/update/upsert 之一
- `module`: 必须是 7 种模块之一
- `novelId`: 必须是有效的 UUID

### 数据清理
- 自动 trim 字符串首尾空格
- 空字符串转为 null（可选字段）
- JSON 序列化前验证格式

### 错误处理
- 单条数据失败不影响其他数据的导入
- 返回详细的错误信息和跳过原因
- 控制台输出完整错误堆栈

---

## 🔍 常见问题 FAQ

### Q1: 导入的数据在哪里查看？

**A**: 导入成功后，数据直接写入对应模块的数据库表中：
- 总纲 → 创意工坊 → 总纲标签页
- 设定 → 创意工坊 → 设定标签页
- 角色 → 创意工坊 → 角色标签页
- 规则 → 创意工坊 → 规则标签页
- 卷 → 创意工坊 → 卷标签页
- 伏笔 → 创意工坊 → 伏笔标签页
- 章节 → 创意工坊 → 章节标签页

### Q2: 导入的数据能否参与 AI 生成？

**A**: ✅ **完全可以！** 导入的数据与手动创建的数据完全一致：
- 角色的 attributes 信息会在生成章节时作为上下文
- 伏笔的 chapterId/resolvedChapterId 用于追踪伏笔状态
- 卷的 foreshadowingSetup/foreshadowingResolve 用于规划伏笔
- 规则会在每次生成时被强制遵守

### Q3: 如何导入大量数据？

**A**: 推荐以下方式：

**方式 1: JSON 数组批量导入**
```json
[
  {"name": "角色1", ...},
  {"name": "角色2", ...},
  {"name": "角色3", ...},
  ...
  {"name": "角色100", ...}
]
```

**方式 2: 分模块分批导入**
1. 先导入总纲和设定（建立基础）
2. 再导入角色和关系
3. 然后导入卷和章节框架
4. 最后导入伏笔和具体章节内容

**方式 3: 使用文件上传**
- 准备好 .json 文件
- 直接上传文件（支持大文件）

### Q4: AI 格式化不准确怎么办？

**A**: 可以尝试：

1. **调整输入格式**:
   - 使用更明确的分隔符（如冒号、换行）
   - 添加字段标签（如 "姓名："、"外貌："）
   - 提供更多上下文信息

2. **手动修正**:
   - 在预览界面直接编辑 JSON
   - 修改不满意的部分
   - 再次点击"确认导入"

3. **分步导入**:
   - 先导入基础信息
   - 再通过 update 模式补充细节

### Q5: 导入时遇到重复数据怎么处理？

**A**: 取决于选择的导入模式：

- **Create 模式**: 全部新建，允许重复
- **Update 模式**: 只更新有 id 的，其余跳过
- **Upsert 模式** (推荐): 
  - 有唯一标识符（如同名角色）→ 更新
  - 无唯一标识符 → 新建

**建议**: 使用 upsert 模式最安全，既能更新又能新建

### Q6: 能否从其他写作软件导入？

**A**: ✅ **可以！** 支持从以下来源导入：

- **Scrivener**: 导出为 .txt 或 .docx，然后复制粘贴
- **Word/Pages**: 复制内容直接粘贴
- **Notion/Obsidian**: 导出 Markdown 格式
- **Excel/Google Sheets**: 另存为 CSV，转为 JSON
- **其他小说写作软件**: 导出为文本文件

**提示**: 对于复杂格式，建议先使用 AI 格式化功能进行转换

### Q7: 导入的数据能否撤销？

**A**: 目前没有内置的"撤销导入"功能，但可以通过以下方式处理：

1. **手动删除**: 在对应模块界面删除不需要的数据
2. **重新导入**: 使用 update/upsert 模式覆盖错误数据
3. **数据库回滚**: 如果刚导入且未做其他操作，可联系管理员回滚数据库

**建议**: 导入前先备份重要数据，或在测试项目中先试导入

### Q8: 字段中的中文括号 vs 英文括号？

**A**: 系统统一使用**英文标点符号**：
- ✅ `"relationships": ["苏婉儿(恋人)"]`
- ❌ `"relationships": ["苏婉儿（恋人）"]`

**原因**: JSON 标准不支持中文标点作为语法元素，可能导致解析错误

---

## 💡 最佳实践建议

### 1️⃣ 数据准备阶段

**推荐的数据组织方式**:

```
📁 我的小说项目/
├── 📄 outline.json          # 总纲
├── 📁 settings/             # 设定
│   ├── factions.json        # 势力
│   ├── geography.json       # 地理
│   └── power_system.json    # 修炼体系
├── 📁 characters/           # 角色
│   ├── protagonist.json     # 主角
│   └── supporting.json      # 配角
├── 📁 volumes/              # 卷
│   ├── vol1.json
│   └── vol2.json
├── 📁 chapters/             # 章节
│   ├── vol1-chapters.json
│   └── vol2-chapters.json
└── 📁 foreshadowings/       # 伏笔
    ├── open.json
    └── resolved.json
```

### 2️⃣ 导入顺序建议

**推荐的导入顺序**（按依赖关系）:

```
1. 总纲 (Master Outline)
   ↓
2. 设定 (Settings) - 世界观、势力、地理等
   ↓
3. 角色 (Characters) - 主角、配角、反派
   ↓
4. 规则 (Rules) - 创作约束
   ↓
5. 卷 (Volumes) - 结构框架（含伏笔计划）
   ↓
6. 伏笔 (Foreshadowings) - 具体伏笔（关联章节）
   ↓
7. 章节 (Chapters) - 具体内容（关联卷）
```

**原因**:
- 后续导入可能引用前面的数据（如章节引用卷、伏笔引用章节）
- 智能匹配需要目标数据已存在

### 3️⃣ JSON 编写规范

**推荐的 JSON 格式**:

```json
{
  "字段名": "值",
  "可选字段": "如果有就填",
  "嵌套对象": {
    "子字段": "值"
  },
  "数组字段": [
    "元素1",
    "元素2"
  ]
}
```

**注意事项**:
- ✅ 使用双引号（不用单引号）
- ✅ 注意逗号的位置（最后一个元素后不要逗号）
- ✅ 中文内容不需要额外转义（除非包含引号本身）
- ✅ 使用在线 JSON 验证工具检查格式

### 4️⃣ 利用 AI 格式化的技巧

**让 AI 更准确地解析你的内容**:

✅ **好的写法**:
```
姓名：林萧
身份：主角，青云宗弟子
外貌：身高175cm，剑眉星目
性格：坚毅沉稳，重情重义
背景：出身小山村，父母早亡
关系：
- 苏婉儿：青梅竹马，恋人
- 赵长老：授业恩师
```

❌ **不好的写法**:
```
林萧是个帅哥，性格很好，有很多朋友比如苏婉儿和赵长老...
```

**技巧**:
1. 使用明确的字段标签（姓名、外貌、性格等）
2. 用换行或符号分隔不同信息
3. 提供足够的上下文
4. 对于关系，明确说明关系类型

---

## 🔄 与创意工坊其他功能的集成

### 与 Commit 功能的关系

**Commit** 是创意工坊的核心功能，用于将工作区的修改提交到正式数据表。

**导入数据 vs Commit**:

| 方面 | 导入数据 | Commit |
|------|---------|--------|
| **数据来源** | 外部文件/粘贴 | 工作区编辑 |
| **数据处理** | AI 格式化（可选） | 直接提交 |
| **伏笔创建** | ❌ 不自动创建 | ✅ 自动从卷计划创建 |
| **版本管理** | 无 | ✅ 总纲支持版本 |
| **使用场景** | 初始化/批量导入 | 日常编辑 |

**典型工作流**:
```
1. 导入数据（初始化项目）
   ↓
2. 在工坊中编辑完善
   ↓
3. Commit 提交修改
   ↓
4. 循环步骤 2-3
```

### 与章节生成的集成

**导入的数据如何参与章节生成**:

1. **角色信息**:
   - `attributes.appearance` → 描写角色外貌
   - `attributes.personality` → 决定角色行为
   - `attributes.backgroundStory` → 回忆/闪回素材
   - `relationships` → 角色互动依据

2. **伏笔追踪**:
   - `chapterId` → 当前章节应埋设哪些伏笔
   - `resolvedChapterId` → 当前章节应回收哪些伏笔
   - `volumeId` → 伏笔所属的情节阶段

3. **设定约束**:
   - World/Geography/Faction → 场景描写的依据
   - Power System → 战斗/升级的参考
   - Rules → 强制遵守的创作规则

4. **卷结构**:
   - `blueprint` → 当前章节在整体结构中的位置
   - `eventLine` → 本章应推进哪个事件
   - `foreshadowingSetup/Resolve` → 伏笔规划参考

---

## 📈 性能与限制

### 单次导入限制

- **最大条数**: 建议 ≤ 100 条/次（避免超时）
- **单条大小**: 建议 ≤ 50KB（纯文本）/ ≤ 1MB（含内容）
- **AI 格式化**: 建议 ≤ 10 条/次（Token 限制）

### 批量导入建议

**大数据量导入方案** (> 500 条):

1. **分批导入**: 每次导入 50-100 条
2. **关闭 AI 格式化**: 确保 JSON 格式正确后直接导入
3. **使用文件上传**: 避免浏览器内存溢出
4. **错峰操作**: 避开高峰期（减少服务器压力）

### 错误恢复

- **部分失败**: 已成功的记录不受影响
- **重复导入**: 使用 upsert 模式避免重复
- **格式错误**: AI 格式化可修复大部分问题

---

## 🔗 相关资源

### 内部文档
- [创意工坊执行指南](./WORKSHOP-EXECUTION-GUIDE.md) - 工坊主功能说明
- [章节生成上下文指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md) - 了解数据如何被使用
- [API 文档](./API.md) - 技术接口文档
- [模型使用指南](./MODEL-USAGE-GUIDE.md) - AI 模型配置

### 代码文件
- 后端路由: `server/routes/workshop-import.ts`
- 服务层: `server/services/formatImport.ts`
- 前端组件: `src/components/workshop/ImportDataDialog.tsx`
- Schema 定义: `server/db/schema.ts`

### 外部工具
- [JSON 验证器](https://jsonlint.com/) - 检查 JSON 格式
- [Markdown 编辑器](https://typora.io/) - 编写 Markdown 内容
- [在线表格转 JSON](https://www.convertcsv.com/csv-to-json.htm) - Excel 转 JSON

---

## 📝 版本历史

### v1.0 (2026-04-30)
- ✅ 初始版本发布
- ✅ 支持 7 大模块导入
- ✅ AI 格式化功能
- ✅ 智能匹配机制（名称→ID）
- ✅ 三种导入模式（create/update/upsert）
- ✅ 前端预览和字段高亮
- ✅ 完整的字段帮助提示
- ✅ 与 commit.ts 写入方式完全对齐

---

## 🆘 技术支持

如果遇到问题，请按以下顺序排查：

1. **查看控制台日志** (F12 → Console)
2. **检查网络请求** (F12 → Network)
3. **验证 JSON 格式** (使用 jsonlint.com)
4. **简化输入数据** (减少条数/字段)
5. **切换导入模式** (尝试 upsert)
6. **联系技术支持** (提供错误日志截图)

---

**文档维护者**: NovelForge 开发团队  
**最后审核**: 2026-04-30  
**下一步计划**: 
- [ ] 支持从 Scrivener/Word 直接导入
- [ ] 添加导入模板库
- [ ] 支持导入预览的可视化编辑
- [ ] 添加导入历史记录和回滚功能
