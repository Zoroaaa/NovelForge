# AI 监控中心整改方案

## 一、问题根因确认

**vector_index 为空的真正原因：**

| 操作 | 是否触发索引 |
|------|------------|
| 创建/更新 novelSettings（设定） | ❌ 无 indexContent 调用 |
| 创建/更新 characters（角色） | ❌ characters 路由有 indexContent 但只在 description 字段更新时触发，且 sourceType 写的是 character 而非 setting |
| 创建/更新 masterOutline（总纲） | ❌ 无 indexContent 调用 |
| foreshadowing（伏笔） | ❌ 无 indexContent 调用 |
| 章节生成完成后（摘要） | ✅ 有，唯一触发点 |

**entity_index 为空的原因：**  
`rebuildEntityIndex` 路由存在（`POST /api/entities/rebuild`），但前端没有任何入口调用它，没有自动触发机制。

---

## 二、新增页面：AI 监控中心

### 路由与导航

**`src/App.tsx`** — 新增路由：
```tsx
import AiMonitorPage from '@/pages/AiMonitorPage'

// 在 /model-config 路由下方新增：
<Route path="/ai-monitor" element={
  <ProtectedRoute>
    <AiMonitorPage />
  </ProtectedRoute>
} />
```

**`src/components/layout/MainLayout.tsx`** — 在 `SECONDARY_NAV` 中 `模型配置` 下方新增：
```tsx
import { Activity } from 'lucide-react'

const SECONDARY_NAV: NavItem[] = [
  { icon: Cpu, label: '模型配置', href: '/model-config' },
  { icon: Activity, label: 'AI 监控中心', href: '/ai-monitor' },  // 新增
  { icon: User, label: '账号设置', href: '/account' },
]
```

---

## 三、新增后端接口

以下接口全部挂在已有路由下，**无需新增路由文件**。

### 3.1 向量索引统计（`server/routes/vectorize.ts`）

新增 `GET /vectorize/stats/:novelId`，返回：
```ts
{
  total: number,
  byType: Record<string, number>,   // { setting: 12, character: 5, summary: 30, ... }
  lastIndexedAt: number | null,      // 最近一次索引时间戳
  unindexedCounts: {                 // 有内容但未索引的数量
    settings: number,
    characters: number,
    foreshadowing: number,
  }
}
```

实现：联表查 `vector_index` 按 `sourceType` 分组统计，再查 `novelSettings/characters/foreshadowing` 中 `vectorId IS NULL` 的数量。

### 3.2 全量重建索引（`server/routes/vectorize.ts`）

新增 `POST /vectorize/reindex-all`，body: `{ novelId: string, types?: string[] }`

逻辑：
1. 查出该小说下所有 settings（有 content 的）、characters（有 description 的）、masterOutline、foreshadowing
2. 逐条调用 `indexContent`，**注意 metadata 中补写 `settingType` 和 `importance` 字段**（v3 方案的前置要求）
3. 返回 `{ indexed: number, failed: number, details: string[] }`

> ⚠️ 这个接口执行时间较长（每条需要 embed API 调用），建议前端展示进度而非等待响应，或者用 SSE 流式返回进度。

### 3.3 单条手动索引（`server/routes/vectorize.ts`）

已有 `POST /vectorize/index`，直接复用，无需新增。

### 3.4 Entity Index 重建（`server/routes/entity-index.ts`）

已有 `POST /entities/rebuild`，直接复用。

### 3.5 生成日志接口（`server/routes/generate.ts`）

已有 `GET /generate/logs`，直接复用。

---

## 四、后端补齐：自动索引触发

以下是**必须修复的缺失触发点**，否则监控页面看到的永远是过期数据。

### 4.1 `server/routes/novel-settings.ts`

在 `POST /`（创建）和 `PUT /:id`（更新）成功返回前，用 `waitUntil` 异步触发索引：

```ts
// POST 创建成功后，在 return 前插入：
if (c.env.VECTORIZE && newSetting.content) {
  safeWaitUntil(c, indexContent(
    c.env,
    'setting',
    newSetting.id,
    newSetting.novelId,
    newSetting.name,
    newSetting.content,
    // 扩展 metadata：需要修改 indexContent 签名支持 extraMetadata 参数
    { settingType: newSetting.type, importance: newSetting.importance }
  ))
}

// PUT 更新成功后，同上
```

### 4.2 `server/routes/characters.ts`

找到 create 和 update handler，在成功后触发：
```ts
if (c.env.VECTORIZE && updated.description) {
  safeWaitUntil(c, indexContent(
    c.env, 'character', updated.id, updated.novelId,
    updated.name, updated.description
  ))
}
```

### 4.3 `server/routes/master-outline.ts`

在 update handler 成功后触发：
```ts
if (c.env.VECTORIZE && updated.content) {
  safeWaitUntil(c, indexContent(
    c.env, 'outline', updated.id, updated.novelId,
    updated.title, updated.content
  ))
}
```

### 4.4 `server/routes/foreshadowing.ts`

create 和 update 后触发：
```ts
if (c.env.VECTORIZE && row.description) {
  safeWaitUntil(c, indexContent(
    c.env, 'foreshadowing', row.id, row.novelId,
    row.title, row.description,
    { importance: row.importance }
  ))
}
```

### 4.5 `server/services/embedding.ts` — indexContent 签名扩展

当前 `indexContent` 不支持传 `extraMetadata`，需要扩展签名：

```ts
export async function indexContent(
  env: Env,
  sourceType: VectorMetadata['sourceType'],
  sourceId: string,
  novelId: string,
  title: string,
  content: string | null,
  extraMetadata?: Record<string, string>  // 新增参数
): Promise<string[]>
```

在调用 `upsertVector` 时，将 `extraMetadata` 合并进 metadata：
```ts
await upsertVector(env.VECTORIZE, vectorId, values, {
  novelId, sourceType, sourceId,
  title: i === 0 ? title : `${title} (Part ${i + 1})`,
  content: chunks[i],
  ...extraMetadata,  // settingType, importance 等
})
```

---

## 五、前端页面结构：`src/pages/AiMonitorPage.tsx`

使用 `MainLayout` 包裹，页面内分 4 个 Tab。

### Tab 1：向量索引

**展示内容：**
- 统计卡片：总向量数 / 设定已索引 / 角色已索引 / 摘要已索引
- 未索引提示：「还有 X 条设定、Y 条角色未索引」红色警告条
- 按 sourceType 分类列表，每种类型显示数量和最近更新时间
- 向量搜索测试框：输入关键词 → 调用 `GET /vectorize/search` → 展示 top10 命中结果（sourceType / title / score）

**操作按钮：**
- 「全量重建索引」：调用 `POST /vectorize/reindex-all`，展示实时进度（可用轮询 stats 接口实现）
- 「重建实体树」：调用 `POST /entities/rebuild`，完成后刷新

```
┌──────────────────────────────────────┐
│ 总向量  设定  角色  摘要  其他        │  ← 统计卡片
├──────────────────────────────────────┤
│ ⚠ 还有 23 条设定、5 条角色未索引    │  ← 警告条（有未索引时展示）
├──────────────────────────────────────┤
│ 类型分布表                           │
│ setting    ██████████  45 条         │
│ character  ████        12 条         │
│ summary    ████████    38 条         │
├──────────────────────────────────────┤
│ 向量搜索测试  [输入框]  [搜索]        │
│ 结果列表...                          │
├──────────────────────────────────────┤
│ [全量重建索引]  [重建实体树]          │
└──────────────────────────────────────┘
```

### Tab 2：生成日志

直接复用已有 `<GenerationLogs novelId={undefined} />` 组件（全局模式，不传 novelId 则展示所有小说）。

已有功能：统计卡片 / 列表 / Token 趋势图，无需重写。

### Tab 3：上下文诊断

**功能：** 选择一本小说 + 一个章节，调用 `POST /generate/preview-context`（需新增此接口），展示该章节生成时会注入的上下文各层内容。

**需新增后端接口** `POST /generate/preview-context`：
- body: `{ novelId, chapterId }`
- 调用 `buildChapterContext` 但不触发 LLM 生成
- 返回 contextBundle 的 debug 信息 + 各层内容摘要

展示格式：
```
总 Token 估算：8,432
┌─ Core 层（4,120t）
│  ✓ 总纲摘要  200t
│  ✓ 卷蓝图   580t
│  ✓ 主角状态 卡  340t
│  ✓ 核心规则  3条  210t
├─ 动态层（3,200t）
│  ✓ 摘要链  5章  1,200t
│  ✓ 角色卡  3个  850t
│  ✓ 伏笔  2条  320t
│  ✓ 设定  worldRules×2, powerSystem×1  480t
│  ✓ 章节规则  2条  150t
└─ RAG 查询耗时：234ms
```

### Tab 4：手动操作

一个按小说维度的操作面板（有小说选择器）：

| 操作 | 接口 | 说明 |
|------|------|------|
| 重建全量向量索引 | `POST /vectorize/reindex-all` | 清除旧索引重建 |
| 重建实体树 | `POST /entities/rebuild` | 重建 entity_index |
| 测试向量服务 | `GET /vectorize/status` | 检查 Vectorize 是否可用 |
| 生成总纲摘要 | 已有（agent.ts 内） | 需新增路由暴露 |
| 查看原始 vector_index 表 | `GET /vectorize/stats/:novelId` | 调试用 |

---

## 六、改动文件清单

### 后端（必须改）
- `server/services/embedding.ts` — `indexContent` 增加 `extraMetadata` 参数
- `server/routes/novel-settings.ts` — POST/PUT 后触发索引
- `server/routes/characters.ts` — POST/PUT 后触发索引
- `server/routes/master-outline.ts` — PUT 后触发索引
- `server/routes/foreshadowing.ts` — POST/PUT 后触发索引
- `server/routes/vectorize.ts` — 新增 `GET /stats/:novelId` 和 `POST /reindex-all`
- `server/routes/generate.ts` — 新增 `POST /preview-context`

### 前端（新增）
- `src/pages/AiMonitorPage.tsx` — 新建页面
- `src/App.tsx` — 新增路由
- `src/components/layout/MainLayout.tsx` — 侧边栏新增入口

### 前端（无需改）
- `src/components/generation/GenerationLogs.tsx` — 直接复用
- `src/components/generate/ContextPreview.tsx` — Tab 3 可参考复用

---

## 七、优先级建议

先做第一遍：
1. **后端补触发点**（4.1-4.4）+ **indexContent 扩展 metadata**（4.5）→ 之后新录入的数据会自动索引
2. **vectorize/reindex-all 接口** → 存量数据一键补索引
3. **前端 Tab1（向量索引）+ Tab4（手动操作）** → 能看到状态、能手动触发

之后再做：
4. **前端 Tab2（生成日志）** → 直接复用组件，改动很小
5. **前端 Tab3（上下文诊断）** → 需要新增 preview-context 接口，工作量稍大但价值高
