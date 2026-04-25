# NovelForge 优化实施计划

## 任务概览

本计划包含10个优化任务，涵盖数据库字段扩展、AI生成参数增强、检查模块重构、功能清理等多个方面。

---

## 任务1：创作工坊与数据导入时补充卷目标字数

### 目标
在创作工坊和JSON数据导入时，自动生成并写入卷的 `targetWordCount`（目标字数）字段。

### 实施步骤

#### 1.1 修改 `server/services/formatImport.ts`
- **位置**：`MODULE_PROMPTS.volume` 定义中
- **修改**：在 volume 模块的格式化提示词中增加对 `targetWordCount` 的提取指导
- **示例**：要求 AI 根据卷的章节规划和内容复杂度推断目标字数

#### 1.2 修改 `server/routes/workshop-format-import.ts`
- **位置**：`formatImportData` 调用处
- **修改**：如果解析结果中包含 `targetWordCount`，正常写入；如果没有，AI 根据 `chapterCount` 和平均章节字数（3000-5000字）推算

#### 1.3 修改前端 `src/components/workshop/ImportDataDialog.tsx`
- **位置**：预览展示逻辑
- **修改**：当模块为 `volume` 时，预览数据中展示 `targetWordCount` 字段（如果有）
- **位置**：确认导入后的数据展示
- **修改**：在解析预览中增加对 `targetWordCount` 的展示

#### 1.4 创作工坊相关修改
- 检查 `server/services/workshop.ts` 中卷创建逻辑，确保 `targetWordCount` 被正确处理

### 验证方式
1. 通过 JSON 导入一卷数据，观察 `targetWordCount` 是否正确写入
2. 通过创作工坊创建卷时，检查 `targetWordCount` 是否被正确计算

---

## 任务2：添加小说层面的目标字数字段

### 目标
在小说表添加 `targetWordCount` 字段，用于规划小说总目标字数。

### 实施步骤

#### 2.1 数据库 Schema 修改
- **文件**：`server/db/schema.ts`
- **位置**：`novels` 表定义
- **修改**：添加 `targetWordCount: integer('target_word_count')` 字段

#### 2.2 SQL 迁移文件
- **文件**：`server/db/migrations/0013_novel_target_word_count.sql`（新建）
- **内容**：
  ```sql
  ALTER TABLE novels ADD COLUMN target_word_count INTEGER;
  ```

#### 2.3 前端类型修改
- **文件**：`src/lib/types.ts`
- **位置**：`Novel` 接口
- **修改**：添加 `targetWordCount?: number` 字段

#### 2.4 前端组件修改
- **文件**：`src/components/novel/EditNovelDialog.tsx`
- **修改**：在小说编辑对话框中添加目标字数输入框
- **文件**：`src/components/novel/CreateNovelDialog.tsx`
- **修改**：在小说创建对话框中添加目标字数输入框
- **文件**：`src/components/novel/NovelCard.tsx`
- **修改**：在小说卡片中展示目标字数进度（如果有设置）

#### 2.5 API 路由修改
- **文件**：`server/routes/novels.ts`
- **修改**：确保 `targetWordCount` 在创建和更新时被正确处理

### 验证方式
1. 创建新小说时填写目标字数
2. 编辑现有小说时修改目标字数
3. 在小说列表/详情页验证显示

---

## 任务3：AI生成章节时增加多层次目标参数

### 目标
在AI生成章节时，向提示词中注入：
- 小说层面的目标字数和当前字数
- 卷层面的目标字数、当前字数、目标章节数、当前章节数
- 提示AI注意节奏把控

### 实施步骤

#### 3.1 服务层数据获取
- **文件**：`server/services/agent/generation.ts`
- **修改位置**：`generateChapter` 函数
- **添加逻辑**：
  1. 查询小说层面的 `wordCount` 和 `targetWordCount`
  2. 查询当前卷的 `wordCount`、`targetWordCount`、`chapterCount` 和 `targetChapterCount`
  3. 查询当前章节在卷中的序号

#### 3.2 数据库 Schema 扩展
- **文件**：`server/db/schema.ts`
- **位置**：`volumes` 表
- **修改**：添加 `targetChapterCount: integer('target_chapter_count')` 字段

#### 3.3 迁移文件
- **文件**：`server/db/migrations/0014_volume_target_chapter_count.sql`（新建）
- **内容**：
  ```sql
  ALTER TABLE volumes ADD COLUMN target_chapter_count INTEGER;
  ```

#### 3.4 前端类型修改
- **文件**：`src/lib/types.ts`
- **位置**：`Volume` 接口
- **修改**：添加 `targetChapterCount?: number` 字段

#### 3.5 修改提示词构建
- **文件**：`server/services/agent/messages.ts`
- **修改位置**：`buildMessages` 函数和 `DATA_PACKAGE` 相关常量
- **添加内容**：
  ```typescript
  // 在创作要求中增加节奏把控提示
  const RHYTHM_GUIDANCE = `
  【节奏把控要求】
  - 本卷目标：${volumeTargetChapterCount}章，预计${volumeTargetWordCount}字
  - 本卷当前进度：第${currentChapterInVolume}章，已写${volumeWordCount}字
  - 小说整体进度：共${novelWordCount}字，目标${novelTargetWordCount}字
  - 注意保持节奏均衡，避免前期过于拖沓或后期赶工
  - 允许小幅偏差，但整体需符合规划
  `
  ```

#### 3.6 前端卷编辑修改
- **文件**：`src/components/volume/VolumePanel.tsx`
- **修改**：在卷编辑中增加"目标章节数"输入框

### 验证方式
1. 生成章节后检查生成日志中的 context_snapshot
2. 观察AI生成的内容是否符合节奏规划

---

## 任务4：（已废弃）排查章节检查区域自动弹出问题

> ⚠️ **此任务已废弃**
>
> 原任务4的目标是修复"章节生成完成后检查区域不再自动弹出"的问题。
>
> **最新解决方案**：该问题将通过任务6的"章节检查模块大改造"一并解决。
>
> 任务6将把章节检查功能从AI生成模块剥离为独立的一级模块（AI生成、章节检查、导出三个Tab），
> 并在章节生成完成后自动触发检查，同时自动展示检查结果，从根本上解决检查区域显示问题。

---

## 任务5：新增卷完成程度检查

### 目标
在章节生成后自动触发卷完成程度检查，评估进度是否健康。

### 实施步骤

#### 5.1 创建检查服务
- **文件**：`server/services/agent/volumeProgress.ts`（新建）
- **核心函数**：`checkVolumeProgress`
- **功能**：
  1. 获取当前卷的统计信息（当前章节数、目标章节数、当前字数、目标字数）
  2. 获取当前章节在卷中的位置
  3. 评估进度是否健康（偏差范围：目标章节数 ±5章 或 目标字数 ±10%）
  4. 返回评估结果和建议

#### 5.2 检查结果类型定义
```typescript
interface VolumeProgressResult {
  volumeId: string
  currentChapter: number        // 当前章节序号
  targetChapter: number         // 目标章节数
  currentWordCount: number       // 当前字数
  targetWordCount: number        // 目标字数
  chapterProgress: number        // 章节进度百分比
  wordProgress: number          // 字数进度百分比
  healthStatus: 'healthy' | 'ahead' | 'behind' | 'critical'
  risk: 'early_ending' | 'late_ending' | null
  suggestion: string
}
```

#### 5.3 集成到生成流程
- **文件**：`server/services/agent/generation.ts`
- **位置**：章节生成完成后的后处理部分
- **添加逻辑**：在连贯性检查之后调用卷完成程度检查

#### 5.4 集成到队列处理
- **文件**：`server/queue-handler.ts`
- **位置**：`post_process_chapter` case
- **添加逻辑**：在异步任务中增加卷完成程度检查

### 验证方式
1. 生成章节后检查日志中是否有卷完成程度信息
2. 当进度偏离规划时检查是否有风险提示

---

## 任务6：章节检查模块大改造

### 目标
将章节检查功能从 AI 生成模块剥离，成为独立的一级模块。

### 实施步骤

#### 6.1 创建新的检查组件目录
- **目录**：`src/components/chapter-health/`
- **包含文件**：
  - `ChapterHealthCheck.tsx` - 主入口组件
  - `CharacterConsistencyCheck.tsx` - 角色一致性检查
  - `ChapterCoherenceCheck.tsx` - 章节连贯性检查
  - `VolumeProgressCheck.tsx` - 卷完成程度检查
  - `index.ts` - 导出

#### 6.2 创建卷完成程度检查组件
- **文件**：`src/components/chapter-health/VolumeProgressCheck.tsx`
- **功能**：展示卷进度信息、风险提示、优化建议

#### 6.3 修改工作台页面布局
- **文件**：`src/pages/WorkspacePage.tsx`
- **修改**：
  1. 将 Tabs 从 2 个（AI生成、导出）改为 3 个（AI生成、章节检查、导出）
  2. 将 `GeneratePanel` 保留在 AI 生成 tab
  3. 将检查相关组件移到新的"章节检查" tab

#### 6.4 代码层面剥离
- 从 `GeneratePanel.tsx` 中移除检查相关状态和组件
- 保留的角色一致性检查和连贯性检查组件引用改为从新目录导入
- 将 `checkCharacterConsistency`、`checkChapterCoherence` 调用移到独立组件中

### 验证方式
1. 工作台页面显示三个 tab
2. 章节检查 tab 中可以执行所有检查功能
3. 生成完成后自动显示检查结果

---

## 任务7：异步任务增加检查和日志

### 目标
在章节生成后的异步任务中增加：
1. 角色一致性检查
2. 卷完成程度检查
3. 五个任务按类型分别记录日志到不同表

### 日志归属规则

系统有两个日志模块，边界划分如下：

| 日志类型 | 存储表 | 说明 |
|---------|-------|------|
| **伏笔提取** | `generation_logs` | 异步任务，自动执行，结果写入context_snapshot |
| **境界检测** | `generation_logs` | 异步任务，自动执行，结果写入context_snapshot |
| **角色一致性检查** | `check_logs` | 异步任务，自动执行，结果写入character_result字段 |
| **卷完成程度检查** | `check_logs` | 异步任务，自动执行，结果写入新字段 |
| **章节连贯性检查** | `check_logs` | 异步任务，自动执行，结果写入coherence_result字段 |
| **综合检查** | `check_logs` | 综合角色一致性和连贯性检查结果 |

### 实施步骤

#### 7.1 修改 check_logs 表结构（如需要）
- **文件**：`server/db/schema.ts`
- **位置**：`checkLogs` 表
- **检查**：是否需要添加卷完成程度检查结果字段
- **可能添加**：`volumeProgressResult` JSON字段

#### 7.2 修改后端生成服务
- **文件**：`server/services/agent/generation.ts`
- **修改位置**：`generateChapter` 函数中异步任务处理部分
- **修改内容**：
  1. 伏笔提取 → `logGeneration` 到 `generation_logs`
  2. 境界检测 → `logGeneration` 到 `generation_logs`
  3. 角色一致性检查 → `saveCheckLog` 到 `check_logs`
  4. 卷完成程度检查 → `saveCheckLog` 到 `check_logs`
  5. 章节连贯性检查 → `saveCheckLog` 到 `check_logs`

#### 7.3 修改队列处理器
- **文件**：`server/queue-handler.ts`
- **位置**：`post_process_chapter` case
- **修改内容**：
  1. 伏笔提取 → 调用 `logGeneration` 记录到 `generation_logs`，context_snapshot 写入详情
  2. 境界检测 → 调用 `logGeneration` 记录到 `generation_logs`，context_snapshot 写入详情
  3. 角色一致性检查 → 调用 `saveCheckLog` 记录到 `check_logs`
  4. 卷完成程度检查 → 调用 `saveCheckLog` 记录到 `check_logs`
  5. 章节连贯性检查 → 调用 `saveCheckLog` 记录到 `check_logs`

#### 7.4 修改前端日志展示
- **文件**：`src/components/generation/GenerationLogs.tsx`
- **修改**：
  1. 在日志列表中展示 `contextSnapshot` 字段
  2. 添加 `stageLabels` 映射：
     - `foreshadowing_extraction`: '伏笔提取'
     - `power_level_detection`: '境界检测'
     - `semantic_search`: '语义检索'
  3. 说明：角色一致性检查、卷完成程度检查、章节连贯性检查、综合检查的日志在 check_logs 表，通过专门的检查历史界面展示

#### 7.5 check_logs 前端展示
- **文件**：`src/components/chapter-health/` (任务6新建目录)
- **修改**：在检查组件中添加展示历史检查日志的功能

### 验证方式
1. 生成章节后查看 `generation_logs` 表中是否有伏笔提取、境界检测的日志
2. 生成章节后查看 `check_logs` 表中是否有角色一致性、卷完成程度、章节连贯性检查的日志
3. 前端 GenerationLogs 组件能正确展示 context_snapshot 信息
4. 检查历史界面能正确展示 check_logs 中的检查记录

---

## 任务8：检索系统摘要生成增加日志

### 目标
在检索系统所有触发摘要生成的地方，添加生成日志。

### 实施步骤

#### 8.1 确认检索系统中的摘要生成点
- **文件**：`server/routes/search.ts`
- **确认**：当前搜索路由中是否有触发摘要生成的逻辑

#### 8.2 添加日志记录
- **文件**：`server/routes/search.ts`
- **位置**：搜索处理完成后
- **添加逻辑**：
  ```typescript
  await logGeneration(env, {
    novelId: novelId || '',
    chapterId: null,
    stage: 'semantic_search',
    modelId: 'N/A',
    contextSnapshot: JSON.stringify({ query: q, resultsCount: results.length }),
    status: 'success',
  })
  ```

#### 8.3 其他可能触发摘要的地方
- **文件**：`server/routes/entity-index.ts`（如果存在）
- **文件**：`server/services/contextBuilder.ts`
- 检查是否有其他检索相关的摘要生成逻辑，如有则添加日志

### 验证方式
1. 执行搜索操作后查看 `generation_logs` 表
2. 确认有 `semantic_search` 类型的日志记录

---

## 任务9：删除大纲生成相关功能

### 目标
全局删除以下内容：
- 小说工作台内的"卷纲生成"、"章节大纲"功能
- 模型配置中的 `outline_gen` 分类
- 全局模型配置中 `outline_gen` 的相关描述

### 实施步骤

#### 9.1 数据库层面（如需要）
- **文件**：`server/db/schema.ts`
- **检查**：`modelConfigs` 表中 `stage` 字段是否需要移除 `outline_gen`
- **决策**：如果 `stage` 是枚举类型，保留枚举值但从 UI 移除选择；如果是非约束类型，直接移除

#### 9.2 前端模型配置
- **文件**：`src/components/model/ModelConfig.tsx`
- **修改**：
  1. 从 `stageLabels` 中移除 `'outline_gen': '大纲生成'`
  2. 从用途选择列表中移除大纲生成选项
  3. 更新说明文字，移除大纲生成相关描述

#### 9.3 移除前端大纲生成组件
- **文件**：`src/components/outline/OutlinePanel.tsx` 或类似文件
- **检查是否存在**：搜索 `outline_gen` 相关的组件
- **处理**：如果工作台中有单独的大纲生成功能，移除或禁用

#### 9.4 移除后端大纲生成路由
- **文件**：`server/routes/generate.ts`
- **检查**：以下路由是否涉及大纲生成
  - `POST /outline` - 需评估是否属于大纲生成
  - `POST /outline-batch` - 需评估是否属于大纲生成
- **处理**：如果这些是用于生成卷纲/章节大纲的，需要评估是否可以移除或保留其他用途

#### 9.5 更新前端工作台
- **文件**：`src/pages/WorkspacePage.tsx`
- **检查**：是否显示与大纲生成相关的 UI
- **处理**：移除相关 UI 元素

### 验证方式
1. 模型配置页面不再显示"大纲生成"选项
2. 工作台中不再有卷纲/章节大纲生成功能

---

## 任务10：删除视觉理解相关功能

### 目标
全局删除以下内容：
- 视觉理解 (vision) 相关功能
- 模型配置中的 `vision` 分类
- 全局模型配置中 `vision` 的相关描述

### 实施步骤

#### 10.1 检查视觉理解相关代码
- **文件**：`server/services/vision.ts`
- **内容**：确认视觉理解服务的实现

#### 10.2 前端模型配置
- **文件**：`src/components/model/ModelConfig.tsx`
- **修改**：
  1. 从 `stageLabels` 中移除 `'vision': '视觉理解'`
  2. 从用途选择列表中移除视觉理解选项
  3. 更新说明文字，移除视觉理解相关描述

#### 10.3 前端视觉相关组件
- **搜索**：查找 `vision`、`视觉`、`image` 相关的组件
- **文件**：`src/components/character/CharacterImageUpload.tsx`（如果涉及图像上传到视觉服务）
- **处理**：如果图像上传使用 vision 服务，需要修改为直接上传到 R2 存储

#### 10.4 路由处理
- **文件**：`server/routes/` 下是否有 vision 相关的路由
- **处理**：移除或禁用相关路由

#### 10.5 角色图像上传
- **文件**：`server/routes/characters.ts`
- **检查**：角色图像上传是否使用视觉服务
- **处理**：如果使用，修改为直接上传到 R2 存储

### 验证方式
1. 模型配置页面不再显示"视觉理解"选项
2. 角色图像上传功能正常工作（不使用 vision）

---

## 实施顺序建议

### 第一批次（基础数据修改）
1. 任务2 - 添加小说目标字数字段（其他任务可能依赖此字段）
2. 任务3 - AI生成章节增加多层次目标参数（需要用到新增的字段）

### 第二批次（核心功能修改）
3. 任务1 - 创作工坊与数据导入补充卷目标字数
4. 任务5 - 新增卷完成程度检查
5. 任务7 - 异步任务增加检查和日志

### 第三批次（UI和模块重构）
6. ~~任务4~~ - **已废弃**，检查区域显示问题由任务6一并解决
7. 任务6 - 章节检查模块大改造
8. 任务8 - 检索系统增加日志

### 第四批次（功能清理）
9. 任务9 - 删除大纲生成相关功能
10. 任务10 - 删除视觉理解相关功能

---

## 注意事项

1. **数据库迁移**：任务2和3涉及数据库修改，需要先执行迁移
2. **向后兼容**：删除功能时注意是否有其他功能依赖
3. **测试验证**：每个任务完成后需要验证功能正常
4. **日志监控**：新增的日志字段有助于问题排查
