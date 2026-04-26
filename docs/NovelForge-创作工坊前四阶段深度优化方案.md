# NovelForge 创作工坊前四阶段深度优化方案

> 基于 workshop.ts 完整代码审查
> 范围：概念构思、世界观构建、角色设计、卷纲规划四个阶段
> 核心原则：创作工坊是章节生成的上游数据工厂，工坊输出的内容质量和格式直接决定章节生成的上下文质量

---

## 零、问题全景

阅读代码后发现的所有问题，按层次分类：

### 层次A：Prompt 内容约束缺失（最根本的问题）

| 阶段 | 当前状态 | 后果 |
|------|---------|------|
| concept | writingRules 无质量约束，AI 输出"文风流畅"之类废话 | 写入 writingRules 表后对章节生成无约束力 |
| concept | description 无格式要求，AI 随意发挥 | masterOutline summary 字段是一句无效简介 |
| worldbuild | 六种 type 的 content 格式完全自由 | generateSettingSummary 输入质量差，RAG 摘要质量差 |
| worldbuild | 所有势力合并成一条 faction 记录 | RAG 无法精确召回"玄灵宗"，只能召回"势力组织"整体 |
| character_design | attributes 是 `Record<string,any>`，键名完全自由 | speechPattern/goal/weakness 等章节生成必需字段缺失 |
| character_design | powerLevel 无格式约束 | 境界名称与 power_system 设定不一致，章节生成一致性校验失败 |
| volume_outline | eventLine 是粗粒度字符串数组 | contextBuilder 无法精确提取当前章对应任务 |
| volume_outline | blueprint 是自由文本段落 | Slot-1 注入整个 blueprint，AI 无法定位本章任务 |
| volume_outline | foreshadowingSetup/Resolve 字段存在但 prompt 未要求输出 | commit 只把 notes 整体作为伏笔写入，粒度极粗 |

### 层次B：commit 阶段的工程缺陷

**最严重：workshop commit 完全没有触发向量化索引。**

characters 路由（POST /characters）触发 `enqueue index_content`，novel-settings 路由触发 `generateSettingSummary`。但 workshop commit 路由只调用了 `commitWorkshopSession`，该函数内部：
- `generateSettingSummary` 有调用 ✅
- `generateVolumeSummary` 有调用 ✅
- **角色向量化：完全没有触发** ❌
- **向量化索引写入：完全没有** ❌

后果：workshop commit 后创建的角色、设定无法被 RAG 召回，章节生成时 Slot-5/6 返回空或无关内容，直到用户手动去编辑一次角色才会触发索引。

### 层次C：buildOutlineContent 是机械拼接，总纲质量极差

`buildOutlineContent` 把各字段 Markdown 拼接：
```
## 简介
data.description

## 核心看点
data.coreAppeal.join('\n')

## 世界观设定
data.worldSettings.forEach(ws => `### ${ws.title}\n${ws.content}`)
...
```

Slot-0 注入的总纲就是这个拼接物。没有叙事逻辑，没有主线脉络，AI 读到的是一堆碎片数据，不是一个有方向感的创作指引。

### 层次D：buildReadonlyContext 把全量 JSON 原样序列化为 system prompt

例如 volume_outline 阶段，readonlyCtx 包含：
- 概念信息（全量 JSON）
- worldSettings（全量 JSON，可能有几千字）
- characters（全量 JSON，含 attributes 所有键值）
- 已有 volumes（全量 JSON）

这些 JSON 全部塞进 system prompt，格式丑陋、信息冗余，AI 需要花更多"注意力"解析格式，真正有用的信息被稀释。

---

## 一、概念构思（concept）阶段优化

### 1.1 system prompt 改造

**当前问题：**
- 任务描述过于泛化，没有引导 AI 聚焦到对创作最关键的维度
- writingRules 只给了 category 参考，没有告诉 AI 什么是有价值的规则
- description 没有格式要求，AI 输出随意

**优化后 `concept` prompt：**

```typescript
concept: `你是专业的小说策划顾问，擅长帮助作者明确创作方向。你正处于【概念构思】阶段。

${readonlyCtx}

## 本阶段目标
通过对话，帮用户确定以下五个核心维度。每次只问1-2个问题，保持自然的对话节奏：

**必须明确的五个维度：**
1. **类型与基调** — 具体流派（如"东方玄幻-仙侠修真-宗门争霸"），不接受"玄幻"这种泛化回答
2. **主角起点与驱动力** — 主角的初始处境 + 推动他行动的核心动机
3. **核心爽点** — 读者追更的理由（如"低调装逼打脸流""从被废到无敌""系统流"）
4. **故事走向与终局** — 大方向，哪怕模糊也要有
5. **体量与节奏** — 预计字数/章节数，以及整体节奏风格（爽文快节奏 or 慢热世界观流）

信息收集完整后，输出结构化汇总。

---

## 输出内容约束（严格执行）

### description 必须包含四个要素：
格式：[主角身份] + [初始处境/困境] + [核心目标] + [独特钩子/差异化]
示例：`"废材少爷林岩被逐出家门，偶得上古传承，从最底层修炼者开始，以碾压式实力逐步征服天玄大陆，揭开自身身世之谜"`
❌ 禁止：`"一部热血的修仙小说，讲述主角的成长故事"` —— 这种描述没有任何信息量

### writingRules 必须是对 AI 写章节时有实际约束力的规则：

✅ 有效规则示例（具体、可执行、边界清晰）：
- taboo类：`"主角在未受到存亡威胁时不得主动杀戮无辜，违反会触发心魔，必须在后续章节体现影响"`
- style类：`"战斗描写必须包含：双方境界对比、核心招式名称、至少一次形势逆转，禁止出现'激战后获胜'的省略"`
- pacing类：`"每章结尾必须有悬念钩子或情绪留白，禁止以'一切归于平静'结束"`
- character类：`"主角对不同阶层的人说话方式必须有差异：对强者简洁直接，对弱者不卑不亢，对反派冷静鄙视"`
- plot类：`"能力提升必须有具体来源（修炼、机缘、悟道），禁止无铺垫的'突然顿悟'"`

❌ 无效规则（禁止输出）：
- `"文风要流畅自然"` — 废话，不可执行
- `"角色要立体丰满"` — 空泛，无边界
- `"情节逻辑要合理"` — 无约束力

**每条规则 content 字段长度：50-150字，必须包含边界条件和违规后果（如有）**

---

## 输出格式（信息充足时输出）
⛔ 禁止输出 worldSettings / characters / volumes / chapters 字段

\`\`\`json
{
  "title": "小说正式标题",
  "genre": "一级类型-二级类型-三级标签，如：东方玄幻-仙侠修真-宗门争霸",
  "description": "必须包含四要素的一句话简介（60-100字）",
  "coreAppeal": [
    "核心爽点（具体，如：低调装逼打脸流）",
    "独特卖点（区别于同类的差异化）",
    "情感钩子（让读者持续追更的情感动力）"
  ],
  "targetWordCount": "数字，如：500",
  "targetChapters": "数字，如：1500",
  "writingRules": [
    {
      "category": "taboo",
      "title": "主角行为禁忌",
      "content": "具体禁止行为+边界条件+违规后果（50-150字）",
      "priority": 1
    },
    {
      "category": "style",
      "title": "战斗描写规范",
      "content": "战斗场景的必要元素和禁止写法（50-150字）",
      "priority": 2
    },
    {
      "category": "pacing",
      "title": "章节节奏要求",
      "content": "章节开结尾的具体要求（50-150字）",
      "priority": 2
    },
    {
      "category": "character",
      "title": "角色语言规范",
      "content": "不同场景/对象的说话方式差异要求（50-150字）",
      "priority": 3
    },
    {
      "category": "plot",
      "title": "能力成长规范",
      "content": "境界突破、能力获得的铺垫和限制（50-150字）",
      "priority": 2
    }
  ]
}
\`\`\`

writingRules.category 可选值：style（文风）/ pacing（节奏）/ character（角色一致性）/ plot（情节）/ world（世界观）/ taboo（禁忌）/ custom（自定义）
targetWordCount 和 targetChapters 只输出数字字符串，不含"万字"等单位。`
```

### 1.2 buildReadonlyContext — concept 阶段改造

当前：把全量 JSON 序列化，信息冗余、格式丑陋。

优化：concept 阶段的只读上下文改成人类可读的结构化摘要：

```typescript
if (stage === 'concept') {
  if (!data.title && !data.genre && !data.description) return ''
  
  const lines: string[] = ['## 当前已确认的概念信息（只读，无需重复询问）']
  if (data.title) lines.push(`**标题**：${data.title}`)
  if (data.genre) lines.push(`**类型**：${data.genre}`)
  if (data.description) lines.push(`**简介**：${data.description}`)
  if (data.targetWordCount) lines.push(`**目标字数**：${data.targetWordCount}万字`)
  if (data.targetChapters) lines.push(`**目标章节**：${data.targetChapters}章`)
  if (data.coreAppeal?.length) lines.push(`**核心爽点**：${data.coreAppeal.join('；')}`)
  if (data.writingRules?.length) {
    lines.push(`**已有创作规则**（${data.writingRules.length}条）：${data.writingRules.map(r => r.title).join('、')}`)
  }
  return lines.join('\n')
}
```

---

## 二、世界观构建（worldbuild）阶段优化

### 2.1 最核心问题：设定颗粒度太粗

当前 prompt 要求 worldSettings 输出六条（每种 type 一条），但：
- `faction` 把所有势力合并成一条记录 → RAG 无法精确召回单个势力
- `power_system` 把境界列表和规则混在一段文字 → 摘要向量失去精度
- `item_skill` 把所有功法/宝物合并 → 查"某个具体功法"召回到的是所有功法的混合体

**正确的颗粒度设计：每个独立的设定实体 = 一条 worldSettings 记录**

优化后的 prompt 必须明确这一点，且为每种 type 提供 content 的内容模板。

### 2.2 优化后 `worldbuild` prompt：

```typescript
worldbuild: `你是世界构建大师。你正处于【世界观构建】阶段。

${readonlyCtx}

## 本阶段目标
帮用户完善小说的世界观体系。通过对话收集信息，最终输出结构化设定文档。

**重要**：每个独立的设定实体（每个势力、每套功法、每个地区）必须单独作为一条记录输出，不要合并。
这是因为章节生成时会按需精确召回单个设定，合并后无法准确检索。

## 各类型设定的 content 格式模板

### power_system（境界体系）— 整个体系只需一条记录
content 必须包含以下结构：
\`\`\`
【境界列表】从低到高，每个境界单独一行
炼气期（一至九层）：灵气感知与汇聚阶段，无法凌空御剑
筑基期（前中后期）：建立灵力根基，可御器飞行
金丹期：凝结金丹，寿元达500年
元婴期：神识可外放百丈
...（后续境界）

【突破条件】通用突破条件（灵气积累+机缘/感悟），特殊境界的特殊条件

【跨境界战力】同境界战力差异说明，是否存在跨级战斗可能

【独特规则】本小说境界体系的特殊规则（如有）：如废灵根的限制，特殊灵根的加成
\`\`\`

### faction（势力组织）— 每个势力单独一条记录
每条记录 title = 势力全名，content 必须包含：
\`\`\`
【性质】宗门/王朝/家族/邪道组织/...
【势力层级】在本小说世界的地位（如：三大宗门之一，掌控XX区域）
【控制区域】势力占据的地理范围
【实力标准】顶尖高手的境界水平
【与主角关系】主角初始关系（敌/友/中立/从属）及原因，后续走向
【核心矛盾】该势力内部或与外部的主要冲突（驱动剧情的矛盾点）
【重要人物】关键NPC：姓名·职位·境界（3-5人）
【特色资源】该势力独有的资源、传承或技术
\`\`\`

### geography（地理环境）— 每个重要地区/地点单独一条记录
每条记录 title = 地名，content 必须包含：
\`\`\`
【位置】在世界地图中的位置描述
【特点】地理特征和气候
【资源/危险】特有资源或危险因素
【控制势力】属于哪个势力或无主之地
【主角关联】主角何时会到达，在此发生什么重要事件（剧透式简述）
\`\`\`

### item_skill（功法/宝物）— 每套功法或重要宝物单独一条记录
每条记录 title = 功法/宝物名称，content 必须包含：
\`\`\`
【类型】功法/法宝/丹药/阵法/...
【来源/获取途径】
【效果与限制】具体效果，以及使用条件或副作用
【等级定位】对应境界体系中的档次
【主角是否拥有】是/否/将会获得（第X卷）
\`\`\`

### worldview（世界观）— 通常一条记录，包含宏观背景
content 必须包含：
\`\`\`
【世界背景】一段话的世界简介
【核心法则】影响所有角色的世界规律（天道/因果/修炼本质）
【当前格局】主要势力分布和当前时代的特征
【世界危机】驱动宏观剧情的深层危机（如有，可以是隐藏的）
【历史背景】影响当前剧情的重要历史事件（1-3个）
\`\`\`

### misc（其他设定）— 不属于以上类型的特殊设定
content 格式自由，但要求结构清晰，信息密度高。

---

## 对话建议顺序
1. 先讨论境界体系（这是整个世界的基础标尺）
2. 再讨论世界格局和主要势力
3. 然后讨论地理环境和重要地点
4. 最后讨论重要功法宝物

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "worldSettings": [
    {
      "type": "power_system",
      "title": "【境界体系名称】修炼体系",
      "content": "按上方模板格式填写，信息完整",
      "importance": "high"
    },
    {
      "type": "worldview",
      "title": "天玄大陆世界观",
      "content": "按上方模板格式填写",
      "importance": "high"
    },
    {
      "type": "faction",
      "title": "玄灵宗（每个势力单独一条）",
      "content": "按上方模板格式填写",
      "importance": "high"
    },
    {
      "type": "faction",
      "title": "血煞门（单独一条）",
      "content": "按上方模板格式填写",
      "importance": "normal"
    },
    {
      "type": "geography",
      "title": "天云城（每个地点单独一条）",
      "content": "按上方模板格式填写",
      "importance": "normal"
    },
    {
      "type": "item_skill",
      "title": "混沌诀（每套功法单独一条）",
      "content": "按上方模板格式填写",
      "importance": "high"
    }
  ]
}
\`\`\`

importance 可选值：high（高频召回，如境界体系、主角势力）/ normal（按需召回）/ low（背景参考）

输出的 worldSettings 是完整版本（替换旧版本），条数可以很多，不要合并不同实体。`
```

### 2.3 buildReadonlyContext — worldbuild 阶段改造

当前：把所有 worldSettings JSON 全量序列化，体积巨大。

优化：只显示已有设定的摘要目录，不展开全文：

```typescript
if (stage === 'worldbuild') {
  const lines: string[] = ['## 当前已有信息（只读参考）']
  
  // 概念信息：精简展示
  lines.push(`### 小说概念`)
  lines.push(`类型：${data.genre || '未定'} | 目标：${data.targetWordCount || '?'}万字 ${data.targetChapters || '?'}章`)
  lines.push(`简介：${data.description || '未定'}`)
  if (data.coreAppeal?.length) lines.push(`爽点：${data.coreAppeal.join('；')}`)
  
  // 世界设定：只展示目录，不展开
  if (data.worldSettings?.length) {
    lines.push(`\n### 已有世界设定（${data.worldSettings.length}条，本阶段可修改完善）`)
    const byType = data.worldSettings.reduce((acc, s) => {
      acc[s.type] = acc[s.type] || []
      acc[s.type].push(s.title)
      return acc
    }, {} as Record<string, string[]>)
    
    const typeLabels: Record<string, string> = {
      power_system: '境界体系', worldview: '世界观', faction: '势力',
      geography: '地理', item_skill: '功法宝物', misc: '其他'
    }
    for (const [type, titles] of Object.entries(byType)) {
      lines.push(`- ${typeLabels[type] || type}：${titles.join('、')}`)
    }
    lines.push(`\n如需查看某条设定的详细内容，请告知具体名称，我会展示给你。`)
  }
  
  return lines.join('\n')
}
```

---

## 三、角色设计（character_design）阶段优化

### 3.1 核心问题：attributes 键名无约束，章节生成必需字段缺失

contextBuilder 中 Slot-3（主角卡）和 Slot-5（配角卡）直接读 `character.attributes` 的值，并展示 `speechPattern`、`goal`、`weakness` 等字段。但当前 prompt 允许 AI 随意填 attributes 键名，导致这些字段可能以不同名称存在（如 `speaking_style` 而非 `speechPattern`）或完全缺失。

### 3.2 优化后 `character_design` prompt：

```typescript
character_design: `你是角色塑造专家。你正处于【角色设计】阶段。

${readonlyCtx}

## 本阶段目标
设计完整的角色阵容。每个角色都要有鲜明的个性和在故事中的明确作用。

**角色数量建议：**
- 主角（protagonist）：1-2人（必须设计）
- 核心配角（supporting）：3-6人（主线相关）
- 主要反派（antagonist）：1-3人（有具体目标和手段）
- 重要NPC（minor）：若干（有名有姓、对主线有影响的）

## attributes 字段规范（必须严格遵守）

attributes 是 AI 生成章节时直接读取的角色数据，键名必须使用以下标准字段，不能自创键名：

\`\`\`json
{
  "personality": "性格特点，用3-6个具体关键词描述（如：外冷内热、睚眦必报、表面随和实则腹黑、对弱者同情对强者轻蔑）",
  "speechPattern": "说话方式和语言习惯（这是章节生成时约束对话的关键字段）。示例：惜字如金，非紧急情况不超过10个字；习惯用反问代替否定；爱引用古籍；语气带轻蔑，即使赞扬也像在嘲讽",
  "appearance": "外貌特征，1-2句话，突出辨识度（不要写'英俊帅气'这种无信息量描述）",
  "background": "对当前剧情有影响的背景故事，重点写创伤/执念/隐藏秘密",
  "goal": "初始阶段的核心目标（明确、具体，如：找到杀害父母的凶手、登顶境界证道、守护某人），后续会随剧情推进",
  "weakness": "性格弱点或心理禁忌（影响角色在关键时刻的决策，越具体越好）",
  "relationships": ["与角色A：关系性质+情感基础+潜在矛盾", "与角色B：..."]
}
\`\`\`

**personality 写法要求：**
- ✅ `"外冷内热、睚眦必报、目的性极强、对弱者有隐藏的同情心"` — 具体，可指导写作
- ❌ `"性格坚强，意志坚定"` — 所有主角的通用描述，无区分度

**speechPattern 写法要求（最重要，直接影响对话质量）：**
- ✅ `"话少但精准，一句话里有两层含义；面对威胁从不急躁，反而语气更轻；称呼对方总是用'阁下'而不是'你'"`
- ❌ `"说话简洁有力"` — 无法指导 AI 写出有特色的对话

**weakness 写法要求：**
- ✅ `"对家人的软弱：任何威胁到家人的事会让他失去理智；执念于'不杀无辜'导致在灰色地带优柔寡断"`
- ❌ `"有时候太善良"` — 无操作性

## powerLevel 规范

必须使用 power_system 设定中的精确境界名称。
\`\`\`
✅ "炼气期三层"
✅ "金丹期后期"
❌ "初级修炼者"（不在境界体系中）
❌ "很强"（无意义）
\`\`\`

## description 字段规范
200字以内，包含：角色在故事中的定位 + 与主角关系的核心张力 + 读者记住这个角色的理由

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "characters": [
    {
      "name": "角色全名",
      "role": "protagonist|supporting|antagonist|minor",
      "description": "200字以内的综合定位描述",
      "aliases": ["常用称呼", "外号", "江湖称号"],
      "powerLevel": "精确境界名（与power_system一致）",
      "attributes": {
        "personality": "具体性格关键词，3-6个",
        "speechPattern": "说话方式的具体描述（2-4句）",
        "appearance": "外貌辨识特征（1-2句）",
        "background": "影响当前剧情的关键背景（创伤/秘密/执念）",
        "goal": "初始阶段明确目标",
        "weakness": "具体的性格弱点或心理禁忌",
        "relationships": ["与XXX：关系描述"]
      }
    }
  ]
}
\`\`\`

输出的 characters 是完整版本（替换旧版本）。每个有名有姓、对主线有影响的角色都要独立输出。`
```

### 3.3 buildReadonlyContext — character_design 阶段改造

```typescript
if (stage === 'character_design') {
  const lines: string[] = ['## 当前已有信息（只读参考）']
  
  // 概念摘要
  lines.push(`### 小说基础`)
  lines.push(`《${data.title}》 | ${data.genre}`)
  lines.push(`简介：${data.description}`)
  if (data.coreAppeal?.length) lines.push(`核心爽点：${data.coreAppeal.join('；')}`)
  
  // 世界设定：只展示对角色设计有直接影响的部分（境界体系+势力）
  if (data.worldSettings?.length) {
    const powerSystem = data.worldSettings.find(s => s.type === 'power_system')
    const factions = data.worldSettings.filter(s => s.type === 'faction')
    
    if (powerSystem) {
      lines.push(`\n### 境界体系（角色powerLevel必须参照此定义）`)
      // 只取境界列表部分，不输出全文
      const powerContent = powerSystem.content
      const listMatch = powerContent.match(/【境界列表】([\s\S]*?)(?=【|$)/)
      lines.push(listMatch ? `境界（从低到高）：${listMatch[1].trim().slice(0, 300)}` : powerContent.slice(0, 200))
    }
    
    if (factions.length) {
      lines.push(`\n### 主要势力（角色背景和关系需与此一致）`)
      factions.forEach(f => lines.push(`- ${f.title}`))
    }
  }
  
  // 已有角色：展示名单，不展开全部内容
  if (data.characters?.length) {
    lines.push(`\n### 已有角色（${data.characters.length}人，本阶段可修改完善）`)
    data.characters.forEach(c => {
      lines.push(`- ${c.name}（${c.role}）：${c.description?.slice(0, 50)}...`)
    })
    lines.push(`如需查看某个角色的完整设定，请告知姓名。`)
  }
  
  return lines.join('\n')
}
```

---

## 四、卷纲规划（volume_outline）阶段优化

### 4.1 eventLine 格式是整个系统最关键的联动接口

contextBuilder 在 RAG 查询时用 eventLine 构建 queryText，章节生成时用 eventLine 精确定位"本章任务"。当前 eventLine 是粗粒度字符串数组（如 `["主角入宗","修炼突破","遭遇反派"]`），完全无法支撑精确定位。

**新格式要求：每条 eventLine 对应一个章节，格式固定为：**
```
第N章：[场景标签] 核心事件（起因→结果，一句话）
```

这样 contextBuilder 可以用 `currentSortOrder` 精确匹配对应行。

### 4.2 blueprint 结构化是精确注入的前提

当前 blueprint 是自由文本，Slot-1 把整个 blueprint 注入给 AI，AI 无法快速定位"我这章对应哪段"。

**新格式：blueprint 按固定标签结构输出，contextBuilder 可解析提取。**

### 4.3 优化后 `volume_outline` prompt：

```typescript
volume_outline: `你是故事架构师。你正处于【卷纲规划】阶段。

${readonlyCtx}

## 本阶段目标
将整部小说规划为若干卷，每卷是一个完整的故事弧（有开端、发展、高潮、结局）。

**分卷建议：**
- 短篇（50-100万字）：3-5卷
- 中长篇（100-300万字）：5-10卷
- 超长篇（300万字以上）：10-20卷

每卷建议20-50章，目标字数10-30万字。

---

## 关键格式要求（与章节生成系统的接口规范）

### eventLine 格式（最重要，严格执行）

eventLine 数组的每条记录必须对应一个章节，格式：
\`"第N章：[场景标签] 事件描述（起因→结果）"\`

**格式规则：**
- N 是该章在本卷内的序号（从1开始）
- 场景标签：用方括号标注主要场景，如 [宗门大殿] [荒野] [秘境内部]
- 事件描述：必须包含起因和结果，约30-50字

✅ 正确示例：
\`\`\`json
"eventLine": [
  "第1章：[天云城·考核场] 林岩以废材身份参加灵根测试，意外激活隐藏灵根，测试长老变色",
  "第2章：[考核场外] 林岩被嫉妒的师兄当众挑衅，首次运用隐藏灵根能力击败对方，引起骚动",
  "第3章：[外门废弃院落] 林岩被分配最差住所，发现房间暗格中藏有前辈遗留的功法残卷"
]
\`\`\`

❌ 错误示例（不可接受）：
\`\`\`json
"eventLine": ["主角入宗", "遭遇刁难", "发现传承"]
\`\`\`

**eventLine 的条数必须等于 targetChapterCount**，每条对应一章，这是硬性要求。

---

### blueprint 格式（结构化，AI生成章节时精确引用）

blueprint 必须按以下固定标签结构输出（标签名称不可修改）：

\`\`\`
【本卷主题】一句话说明本卷的核心议题和叙事重心

【开卷状态】主角在本卷第一章开始时的：位置·境界·目标·处境

【核心冲突】本卷的主要矛盾（明确双方、冲突根源、利益边界）

【关键节点】
- 节点1（约第X章）：[类型：转折/高潮/揭秘] 具体事件描述
- 节点2（约第X章）：...
（3-5个关键节点，驱动本卷叙事的锚点事件）

【卷末状态】主角在本卷最后一章结束时的：位置·境界·目标·与下卷的衔接点

【情感弧线】主角在本卷经历的核心情感/心态变化（如：从自卑到自信，从复仇执念到接受命运）

【伏笔规划】
- 埋入：[伏笔名称] 第X章前后，通过[具体方式]埋入
- 埋入：[伏笔名称] ...
- 回收：[伏笔名称] 第X章，以[方式]揭露
\`\`\`

---

## 输出约束（严格执行）
⛔ 禁止输出其他阶段字段

\`\`\`json
{
  "volumes": [
    {
      "title": "第一卷：卷标题（标题要体现本卷核心主题）",
      "summary": "本卷一句话概述：主角从[状态A]到[状态B]，通过[核心事件]实现[目标或转变]（30-50字）",
      "blueprint": "按上方【本卷主题】...【伏笔规划】标签格式完整填写",
      "eventLine": [
        "第1章：[场景标签] 事件描述（起因→结果）",
        "第2章：[场景标签] 事件描述（起因→结果）"
      ],
      "foreshadowingSetup": [
        "伏笔名称（第X章埋入，通过什么方式，读者视角是什么）"
      ],
      "foreshadowingResolve": [
        "伏笔名称（第X章回收，揭露方式和对剧情的影响）"
      ],
      "notes": [
        "本卷创作注意事项1（如：本卷不能让主角境界突破超过两个小境界）",
        "本卷需要为第二卷铺垫的关键信息"
      ],
      "targetWordCount": 200000,
      "targetChapterCount": 30
    }
  ]
}
\`\`\`

**再次强调**：eventLine 的数组长度必须等于 targetChapterCount。
如 targetChapterCount=30，则 eventLine 必须有30条，从"第1章"到"第30章"。

输出的 volumes 是完整版本（替换旧版本）。`
```

### 4.4 buildReadonlyContext — volume_outline 阶段改造

卷纲阶段的只读上下文最重，需要精心裁剪：

```typescript
if (stage === 'volume_outline') {
  const lines: string[] = ['## 当前已有信息（只读参考）']
  
  // 概念摘要（精简）
  lines.push(`### 小说基础`)
  lines.push(`《${data.title}》 | ${data.genre} | 目标：${data.targetWordCount || '?'}万字 / ${data.targetChapters || '?'}章`)
  lines.push(`简介：${data.description}`)
  if (data.coreAppeal?.length) lines.push(`核心爽点：${data.coreAppeal.join('；')}`)
  
  // 世界设定：只展示关键约束（境界体系列表 + 主要势力名单）
  if (data.worldSettings?.length) {
    lines.push(`\n### 世界设定摘要`)
    const powerSystem = data.worldSettings.find(s => s.type === 'power_system')
    if (powerSystem) {
      const listMatch = powerSystem.content.match(/【境界列表】([\s\S]*?)(?=【|$)/)
      const levels = listMatch ? listMatch[1].trim() : powerSystem.content.slice(0, 200)
      lines.push(`境界体系：${levels.slice(0, 200)}`)
    }
    const factions = data.worldSettings.filter(s => s.type === 'faction')
    if (factions.length) lines.push(`主要势力：${factions.map(f => f.title).join('、')}`)
    const geographies = data.worldSettings.filter(s => s.type === 'geography')
    if (geographies.length) lines.push(`重要地点：${geographies.map(g => g.title).join('、')}`)
  }
  
  // 角色：只列名单和role，不展开
  if (data.characters?.length) {
    lines.push(`\n### 角色阵容`)
    const byRole: Record<string, string[]> = {}
    data.characters.forEach(c => {
      byRole[c.role] = byRole[c.role] || []
      byRole[c.role].push(c.name)
    })
    const roleLabels: Record<string, string> = {
      protagonist: '主角', supporting: '配角', antagonist: '反派', minor: 'NPC'
    }
    for (const [role, names] of Object.entries(byRole)) {
      lines.push(`${roleLabels[role] || role}：${names.join('、')}`)
    }
  }
  
  // 创作规则：列出约束清单（卷纲规划时需要考虑的边界）
  if (data.writingRules?.length) {
    const taboos = data.writingRules.filter(r => r.category === 'taboo' || r.priority === 1)
    if (taboos.length) {
      lines.push(`\n### 高优先级创作规则（卷纲必须遵守）`)
      taboos.forEach(r => lines.push(`- 【${r.title}】${r.content.slice(0, 80)}...`))
    }
  }
  
  // 已有卷纲：展示目录+每卷一句话概述
  if (data.volumes?.length) {
    lines.push(`\n### 已有卷纲（${data.volumes.length}卷，本阶段可修改完善）`)
    data.volumes.forEach((v, i) => {
      lines.push(`第${i+1}卷《${v.title}》：${v.summary || '暂无概述'} [${v.targetChapterCount || '?'}章/${v.targetWordCount ? Math.round(v.targetWordCount/10000)+'万字' : '?'}]`)
    })
  }
  
  return lines.join('\n')
}
```

---

## 五、commit 阶段缺失的向量化索引

**这是当前最严重的工程缺陷，影响所有章节生成的 RAG 效果。**

### 5.1 问题确认

- characters 路由 POST：触发 `enqueue index_content` ✅
- novel-settings 路由 POST：触发 `generateSettingSummary` ✅
- **workshop commit：只调用了 `generateSettingSummary` 和 `generateVolumeSummary`，角色和其他实体完全没有触发向量化** ❌

后果：用户通过工坊创建的角色，在章节生成时无法被 RAG 召回，Slot-5 配角卡是空的，直到用户手动进入角色管理页面编辑一次才会触发索引。

### 5.2 修复方案

在 `commitWorkshopSession` 的 characters 写入循环后，添加向量化触发：

```typescript
// 5. 角色 -> characters（在现有代码末尾添加向量化）
if (data.characters && data.characters.length > 0 && (isNewNovel || stage === 'character_design')) {
  // ... 现有角色写入代码不变 ...
  
  // 新增：触发角色向量化索引
  for (const character of createdCharacters) {
    try {
      // 与 characters 路由保持一致的 indexText 格式
      const indexText = [
        `${character.name}${character.role ? ` (${character.role})` : ''}`,
        (character.description || '').slice(0, 300),
        character.powerLevel ? `境界：${character.powerLevel}` : '',
      ].filter(Boolean).join('\n')
      
      await enqueue(env, {
        type: 'index_content',
        payload: {
          sourceType: 'character',
          sourceId: character.id,
          novelId: character.novelId,
          title: character.name,
          content: indexText,
        },
      })
    } catch (err) {
      console.warn(`[workshop] 角色向量化失败 ${character.name}:`, err)
    }
  }
  createdItems.characters = createdCharacters
}
```

worldSettings 已经调用了 `generateSettingSummary`，但需要确认该函数内部是否也触发了向量化。查看代码：`generateSettingSummary` 只更新了 DB 的 summary 字段，**没有触发 Vectorize 写入**。

需要在 `generateSettingSummary` 调用之后追加：

```typescript
// 在 workshop.ts commit 的 worldSettings 循环末尾
for (const setting of data.worldSettings) {
  const [novelSetting] = await db.insert(...).returning()
  createdSettings.push(novelSetting)
  
  try {
    const { generateSettingSummary } = await import('./agent/summarizer')
    await generateSettingSummary(env, novelSetting.id)
  } catch (err) {
    console.warn('[workshop] 设定摘要生成失败:', err)
  }
  
  // 新增：触发设定向量化（摘要生成后，取最新的 summary 字段）
  try {
    // 重新查询以获取 summary 字段
    const updatedSetting = await db.select().from(novelSettings).where(eq(novelSettings.id, novelSetting.id)).get()
    const indexContent = updatedSetting?.summary || novelSetting.content.slice(0, 500)
    
    await enqueue(env, {
      type: 'index_content',
      payload: {
        sourceType: 'setting',
        sourceId: novelSetting.id,
        novelId: novelSetting.novelId,
        title: novelSetting.name,
        content: indexContent,
      },
    })
  } catch (err) {
    console.warn(`[workshop] 设定向量化失败 ${novelSetting.name}:`, err)
  }
}
```

### 5.3 foreshadowingSetup/Resolve 精确拆分

当前代码把 `notes` 数组整体作为伏笔插入，粒度极粗。改为解析新格式的 `foreshadowingSetup`：

```typescript
// 在 volumes commit 循环内，替换现有的 notes->foreshadowing 逻辑
if (vol.foreshadowingSetup?.length) {
  for (const item of vol.foreshadowingSetup) {
    // 解析格式："伏笔名称（第X章埋入，通过什么方式，读者视角是什么）"
    const parenMatch = item.match(/^(.+?)（(.+)）$/)
    const title = parenMatch ? parenMatch[1].trim() : item.split('（')[0].trim()
    const desc = parenMatch ? parenMatch[2].trim() : item
    
    await db.insert(foreshadowing).values({
      novelId,
      title,
      description: `【埋入计划】${desc}\n【所属卷】${vol.title}`,
      status: 'open',
      importance: 'normal',
    }).run()
  }
}

// notes 保留用于存储创作注意事项，不再自动转为伏笔
```

---

## 六、buildOutlineContent 改为 AI 整合生成

当前机械拼接输出的总纲，是 contextBuilder Slot-0 注入的内容。改为调用模型整合一次：

```typescript
// 替换 commitWorkshopSession 中的 buildOutlineContent 调用

async function buildOutlineContentWithAI(
  env: Env,
  data: WorkshopExtractedData,
  llmConfig: any
): Promise<string> {
  const { generate } = await import('./llm')
  
  // 只传必要数据，不传全量
  const briefData = {
    title: data.title,
    genre: data.genre,
    description: data.description,
    coreAppeal: data.coreAppeal,
    targetWordCount: data.targetWordCount,
    targetChapters: data.targetChapters,
    characters: data.characters?.filter(c => c.role === 'protagonist' || c.role === 'antagonist')
      .map(c => ({ name: c.name, role: c.role, description: c.description })),
    volumes: data.volumes?.map((v, i) => ({
      index: i + 1,
      title: v.title,
      summary: v.summary,
      targetChapterCount: v.targetChapterCount,
    })),
    writingRules: data.writingRules?.filter(r => r.priority <= 2)
      .map(r => ({ title: r.title, content: r.content })),
  }

  const result = await generate(llmConfig, [
    {
      role: 'system',
      content: '你是专业的小说策划编辑，擅长将创作素材整合为简洁有力的总纲文档。只输出总纲正文，不加JSON或代码块标记。'
    },
    {
      role: 'user',
      content: `基于以下创作数据，生成一份600-1000字的小说总纲。
总纲需要体现：1）故事的核心吸引力；2）主角的成长弧线；3）各卷之间的承接逻辑；4）创作边界约束。
用叙事性文字组织，不要机械罗列。

数据：\n${JSON.stringify(briefData, null, 2)}`
    }
  ])
  
  return result.text || buildOutlineContent(data) // fallback 到原有逻辑
}
```

在 commit 中替换：
```typescript
// const outlineContent = buildOutlineContent(data)  // 旧
const outlineContent = await buildOutlineContentWithAI(env, data, llmConfig)  // 新
```

---

## 七、优先级总表

| 优先级 | 问题 | 文件位置 | 影响范围 |
|--------|------|---------|---------|
| **P0 立即** | workshop commit 未触发角色向量化 | `workshop.ts commitWorkshopSession` | 章节生成 Slot-5 RAG 全部失效 |
| **P0 立即** | workshop commit 未触发设定向量化 | `workshop.ts commitWorkshopSession` | 章节生成 Slot-6 RAG 全部失效 |
| **P1 近期** | eventLine 格式约束为"第N章：格式" | `buildSystemPrompt volume_outline` | 章节生成精确定位的前提 |
| **P1 近期** | blueprint 结构化标签格式 | `buildSystemPrompt volume_outline` | Slot-1 精确提取本章任务 |
| **P1 近期** | character attributes 标准键规范 | `buildSystemPrompt character_design` | speechPattern/goal 字段缺失影响所有对话 |
| **P1 近期** | worldSettings 颗粒度细化（势力/地点分条） | `buildSystemPrompt worldbuild` | RAG 精确召回单个势力/地点 |
| **P2 中期** | writingRules 质量约束（禁止废话规则） | `buildSystemPrompt concept` | 规则对章节生成的约束力 |
| **P2 中期** | buildReadonlyContext 改为精简摘要 | `buildReadonlyContext` 四个分支 | 减少 system prompt 冗余，提升 AI 注意力 |
| **P2 中期** | foreshadowingSetup 精确解析写入 | `commitWorkshopSession` | 伏笔管理粒度 |
| **P3 后期** | buildOutlineContent 改为 AI 整合 | `commitWorkshopSession` | Slot-0 总纲质量 |

---

## 八、改造后的数据流向图

```
创作工坊阶段                      存储格式                    章节生成消费
─────────────────────────────────────────────────────────────────────────
concept
 writingRules（具体约束规则）  →  writingRules 表           → Slot-4 全局规则
                                                            → Slot-8 类型规则
 description（四要素格式）     →  masterOutline.summary     → buildOutlineContentWithAI

worldbuild
 power_system（结构化列表）   →  novelSettings（独立记录）  → Slot-6 RAG 精确召回
 faction（每势力单独一条）    →  + Vectorize 向量化         → 查"玄灵宗"精确返回
 geography（每地点单独一条）  →  + AI 摘要（RAG索引文本）   → 查"天云城"精确返回
 item_skill（每功法单独一条） →                             → 功法设定精确召回

character_design
 attributes.speechPattern    →  characters.attributes      → Slot-3/5 对话约束
 attributes.goal             →  （标准键名，可直接读取）    → 主角当前目标
 attributes.weakness         →                             → 行为决策约束
 powerLevel（精确境界名）    →  characters.powerLevel      → 境界一致性校验
 + 向量化触发                →  Vectorize 角色索引         → Slot-5 RAG 正常召回

volume_outline
 eventLine（第N章：格式）    →  volumes.eventLine          → contextBuilder 精确提取
 blueprint（结构化标签）     →  volumes.blueprint          → Slot-1 精确注入本章任务段
 foreshadowingSetup（精确）  →  foreshadowing 表（独立记录）→ Slot-7 精确伏笔管理
```

---

> 文档版本：v2.0（前四阶段专项深度版）
> 基于代码：workshop.ts 完整审查
> 核心发现：向量化缺失（P0）+ eventLine格式（P1）+ attributes标准化（P1）是三大优先修复点
