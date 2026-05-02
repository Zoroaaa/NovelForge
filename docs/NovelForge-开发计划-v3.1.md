# NovelForge 开发计划 v3.1

> 基于代码全量审查 · 更新日期：2026-05-02
> 当前版本：v1.8.0 → 目标版本：v2.0
> 扫描范围：schema.ts（24张表）、15个服务模块、23条路由文件、11个页面、queue-handler.ts（17种消息类型）
> **说明**：Phase D（跨章一致性管理）已剥离至独立文档《NovelForge-跨章一致性完整方案》

---

## 一、全盘扫描结论

### 1.1 四大支柱完成状态

| 支柱 | 描述 | 状态 |
|------|------|------|
| 🏗️ **支柱一：创作工坊全环节构思** | concept → worldbuild → character_design → volume_outline · 对话式AI · 流式输出 · 增量提取 · 容错JSON解析器 | ✅ 已实现 |
| 📥 **支柱二：创作工坊数据导入** | formatImport（7种模块）· ImportDataDialog · 格式化解析 · 直接注入工坊 extractedData | ✅ 已实现 |
| ⚡ **支柱三：章节单个/批量生成全环节** | 单章：SSE流式 + ReAct循环 + 工具调用(8个) + 生成/续写/重写三模式 · 批量：Queue串行 + pause/resume/cancel + 卷完成检测 | ✅ 已实现 |
| 🧠 **支柱四：章节生成上下文管理工程** | contextBuilder v4 · 10槽精准分配 · DB主+向量辅 · 128k预算 · 9种RAG策略 · 节奏统计 · prevChapterAdvice注入 | ✅ 已实现 |

---

### 1.2 v2.1 计划完成状态速查

| Phase | 功能 | 状态 | 证据 |
|-------|------|------|------|
| Phase 1.0 | 删除 chapter_outline 环节 | ✅ 已完成 | 前端 STAGES 仅4个阶段 |
| Phase 1.1 | batch_generation_tasks 表 | ✅ 已完成 | schema.ts 18.1节 |
| Phase 1.2 | /api/batch/* 路由 | ✅ 已完成 | routes/batch.ts |
| Phase 1.3 | Queue串行批量生成 | ✅ 已完成 | batchGenerate.ts |
| Phase 1.4 | 卷完成检测 volumeCompletion | ✅ 已完成 | volumeCompletion.ts |
| Phase 1.5 | prevChapterAdvice 注入 | ✅ 已完成 | prevChapterAdvice.ts |
| Phase 1.6 | 前端批量生成入口 | ✅ 已完成 | WorkspacePage 内 |
| Phase 2.1 | quality_scores 表 + 质量评分 | ✅ 已完成 | qualityCheck.ts |
| Phase 3.1 | image_gen stage | ✅ 已完成 | imageGen.ts |
| Phase 3.3 | 封面生成前端接入 | ✅ 已完成 | NovelsPage |
| Phase 4.1 | 情节图谱（DB + 提取 + 前端） | ✅ 已完成 | plotGraph.ts + GraphPage.tsx |
| Phase 4.2 | 写作风格克隆 | ❌ 未实现 | 无 style/analyze 路由 |
| Phase 5.1 | 多用户数据隔离 | ❌ 未实现 | novels等核心表无 user_id |
| Phase 5.2 | RAG知识库扩展（用户上传） | ❌ 未实现 | 无文件上传接入向量化 |
| Phase 5.3 | 模板市场 | ❌ 未实现 | 无模板相关路由/DB |
| Phase 5.4 | 公开分享与语音朗读 | ❌ 未实现 | 无 shareCode 路由 |

---

### 1.3 审查发现的新增功能点（v2.1 未收录）

以下功能存在于代码中，v2.1 计划文档未收录：

- **成本分析模块**：`routes/cost-analysis.ts`，含Token统计/成本趋势/模型对比，AI监控中心已集成
- **workshop_gen_system_prompt**：工坊提交后自动生成 `novel.systemPrompt`，注入章节生成的 genre-specific 写作指令
- **工坊5类异步后处理**：`workshop_gen_outline / workshop_gen_setting_summary / workshop_gen_volume_summary / workshop_gen_master_summary`，已在 queue-handler.ts 实现
- **伏笔推进记录**（`foreshadowing_progress` 表）：追踪伏笔在各章节的渐进推进状态，postProcess 已写入
- **MCP服务**（`server/mcp/`）：已有独立 MCP 入口，可供外部工具调用
- **draft模式**（`draftMode`）：生成时跳过 PostProcess，用于快速预览
- **ReaderPage v2.0**：支持段落缩进/对话高亮/一键排版/多主题/字体设置

---

## 二、v3.1 开发计划总览

**设计原则**：四大支柱已夯实，v3.1 专注补完产品化缺口（用户隔离、风格克隆、模板）+ 两大新支柱（一致性引擎/多模态脚本/协作发布）+ 跨章一致性（独立文档）。

| 阶段 | 优先级 | 功能方向 | 核心理由 |
|------|--------|----------|----------|
| Phase A | 必须先做 | 多用户数据隔离 | 对外开放的前提，阻断性问题 |
| Phase B | 高价值补完 | 写作风格克隆 + RAG知识库扩展 | v2.1 未实现的两项高质量功能 |
| Phase C | 产品化完整度 | 模板市场 + 公开分享 + TTS朗读 | 让项目具备对外展示条件 |
| Phase D | ⭐ 第五支柱 | **跨章一致性管理（角色状态机）** | 已剥离至独立文档 |
| Phase E | ⭐ 第六支柱 | 多模态剧本/漫画脚本生成 | 差异化大功能，从写作工具到内容IP工厂 |
| Phase F | 平台级 | 协作写作 + 版本控制 + 发布中心 | 从工具到平台的跃迁 |

---

## Phase A · 多用户数据隔离

**为什么是第一优先**：novels/chapters/characters 等14张核心表均无 `user_id` 字段，所有用户共享数据。这是对外开放的硬性阻断，必须在任何分享/公开功能之前完成。

### A.1 数据库变更

受影响的表（14张），均新增 `user_id TEXT NOT NULL`：

`novels` · `master_outline` · `writing_rules` · `novel_settings` · `volumes` · `chapters` · `characters` · `foreshadowing` · `foreshadowing_progress` · `exports` · `workshop_sessions` · `batch_generation_tasks` · `quality_scores` · `generation_logs`

**迁移策略**：新增 `user_id` 字段设置 `DEFAULT 'system'`（兼容存量数据），再通过 Migration 脚本将现有数据归属给第一个 admin 用户。

### A.2 中间件层改造

`jwtAuthMiddleware` 已注入 `c.get('user')`，在 `protectedApi` 下统一注入 `userId` 到所有 CRUD 操作的 WHERE 子句：

- 新增 `getUserId(c)` 工具函数，从 JWT payload 提取 userId
- 所有路由的 SELECT/UPDATE/DELETE 加 `.where(eq(table.userId, userId))`
- INSERT 操作统一注入 `userId` 字段

### A.3 影响范围评估

| 文件/模块 | 改动内容 | 风险等级 |
|-----------|----------|----------|
| routes/novels.ts | 所有查询加 userId 过滤 | 高 |
| routes/chapters.ts | 通过 novelId 间接关联，需二次验证小说归属 | 高 |
| routes/workshop.ts | 工坊会话归属用户 | 中 |
| routes/batch.ts | 批量任务归属 | 中 |
| services/contextBuilder.ts | 不受影响（内部服务已有 novelId） | 无 |
| services/workshop/*.ts | loadNovelContextData 加归属校验 | 中 |

---

## Phase B · 写作风格克隆 + RAG知识库扩展

### B.1 写作风格克隆（v2.1 Phase 4.2）

**核心价值**：用户上传参考文章 → AI提取风格DNA → 写入 `writing_rules`（`category=style_clone`）→ 所有后续生成自动继承该风格。

#### B.1.1 API变更

无需新增表，`writing_rules.category=style_clone` 复用现有结构。新增路由：

- `POST /api/style/analyze` — 接收参考文本（最多3篇），调用 analysis stage 模型提取风格规则
- `GET  /api/style/:novelId` — 查询当前小说的风格规则
- `DELETE /api/style/:novelId/:ruleId` — 删除特定风格规则

#### B.1.2 风格提取维度

| 维度 | 提取内容 | 生成影响 |
|------|----------|----------|
| 句子结构 | 平均句长、长短句比例、句式偏好（排比/倒装/感叹） | 影响句子节奏感 |
| 对话密度 | 对话/叙述文字比例、对话格式风格 | 影响行文紧凑度 |
| 描写密度 | 环境/心理/动作描写占比 | 影响沉浸感层次 |
| 用词偏好 | 高频动词/形容词、文言词汇倾向、修辞密度 | 影响文字质感 |
| 章节收尾 | 钩子类型（悬念/情感/行动）、收尾句式模式 | 影响读者黏性 |

#### B.1.3 注入机制

`style_clone` 规则优先级设为 1（最高），`contextBuilder.fetchAllActiveRules` 自动纳入。**无需修改生成流程，天然接入。**

---

### B.2 RAG知识库扩展（用户上传参考资料）

**核心价值**：用户可上传世界观参考书/历史文献/技术手册等，自动向量化后被章节生成的 RAG 检索命中，极大丰富设定精准度。

#### B.2.1 数据库变更

新增表：`user_documents`（fileId, novelId, fileName, r2Key, status, chunkCount, createdAt）

`vector_index` 表已支持 `sourceType`，新增 `sourceType='user_doc'` 即可，无需额外表改动。

#### B.2.2 处理流程

- 前端上传文件（PDF/TXT/DOCX）→ `POST /api/knowledge/upload` → 写R2
- Queue异步：text_extract（解析文本）→ chunking（按1500字切块）→ 批量 vectorize 写入
- contextBuilder 的 Slot-6 设定槽：追加 `sourceType='user_doc'` 的向量检索
- AI监控中心：知识库统计面板（`ServiceStatusCheck` 已预留扩展点）

---

## Phase C · 产品化完整度

### C.1 模板市场

**核心价值**：降低冷启动成本。新用户一键加载模板直接进入工坊精调，而不是面对空白工坊。

**数据库**：新增 `novel_templates` 表，`presetData` 结构与 workshop `extractedData` 完全对齐，可直接注入工坊会话。

**内置模板规划（10类）**：

1. 东方玄幻-宗门争霸-装逼打脸流
2. 都市修仙-低调高手-商业帝国
3. 末世废土-系统流-生存竞争
4. 星际文明-战争史诗-个人成长
5. 古言言情-权谋争斗-虐恋
6. 悬疑推理-密室连环杀-烧脑解谜
7. 游戏世界-策略经营-无敌流
8. 科幻惊悚-AI觉醒-人类存亡
9. 历史穿越-朝堂谋略-改写历史
10. 异世大陆-双修-团队冒险

**工坊集成**：WelcomeView 新增"模板库"入口 → 选择模板自动创建会话注入 extractedData → 进入 concept 阶段精调。任意小说可导出为模板。

---

### C.2 公开分享

- `novels` 表新增 `shareCode`（唯一串）+ `shareStatus`（private/public）
- `GET /read/:shareCode` — 公开只读路由，无需 JWT
- 前端 `/read/:shareCode` 路由：复用 ReaderPage，去掉编辑入口
- R2 签名URL 复用 exports 表现有机制

### C.3 TTS 语音朗读

- `POST /api/chapters/:id/tts` — 调用 Workers AI TTS 生成音频，写入R2
- `chapters` 表新增 `ttsR2Key` 字段
- ReaderPage 顶部工具栏新增播放器组件（进度条 + 倍速 + 上下章）
- Queue 异步生成，避免阻塞

---

## Phase D · 跨章一致性管理（已剥离）

> **Phase D 已剥离至独立文档《NovelForge-跨章一致性完整方案》**
>
> 该文档包含：
> - 角色状态机（character_states）
> - 世界动态状态追踪（stateLog）
> - 剧情一致性全局检查器
> - 实体自动提取与固化（step7/8/9）
> - 矛盾检测系统
> - 前端实体管理中心

---

## Phase E · ⭐ 第六支柱：多模态叙事脚本生成

> **为什么这是第六支柱？**
>
> 网文/小说是内容源头，但当下内容消费已深度多模态化：短视频/漫画/有声书/剧本都是高价值衍生。第六支柱让 NovelForge 从"写小说的工具"进化为**内容IP工厂**——同一套世界观/角色/情节，一键输出多种格式的专业脚本。这是差异化护城河，也是B端商业价值的核心入口。

### E.1 漫画/短视频分镜脚本

**输入**：已生成的章节正文 + 角色卡 + 世界设定
**输出**：标准分镜脚本格式（镜号/景别/内容/对白/备注）

**数据库**：新增 `script_outputs` 表（id, novelId, chapterId, scriptType, content, status, r2Key, createdAt），`scriptType` 枚举：`storyboard | audio_drama | screenplay`

**后端**：
- `POST /api/scripts/generate` — 触发脚本生成（Queue异步）
- 新增 `scriptGen` stage 模型配置（复用 ModelConfigPage 现有框架）

**输出示例**：

```
【第1镜】
景别：远景
画面：荒山之巅，林枫孤身矗立，背后是断壁残垣
对白：（无）
备注：交代主角孤立无援的处境，奠定悲壮基调

【第2镜】
景别：近景
画面：林枫右手微微颤抖，掌心凝聚若隐若现的灵力涟漪
对白：（林枫内心）"就算境界被封，今日也绝不退步。"
备注：表现主角意志与身体状态的对比张力
```

### E.2 有声剧本（播客/有声书）

- 输出标准播音稿格式：角色标记（`[林枫-坚定]`）+ 旁白标记（`[旁白]`）+ 音效提示（`[BGM:紧张]`）
- 对话量不足时 AI 自动补充，描写段落转为旁白配音稿
- 与 TTS 模块联动：生成剧本后可一键调用多角色 TTS 合成

### E.3 影视剧本（screenwriting格式）

- 输出标准 Final Draft 格式：场景标头/动作/对话/人物各级格式
- 自动提取每章的戏剧性拱形结构（幕启/冲突升级/高潮/幕落）
- 前端提供格式预览，区分不同元素类型

---

## Phase F · 平台级功能（协作 + 版本控制 + 发布）

### F.1 协作写作

- `novels` 表新增 `ownerUserId` + `collaborators JSON`（协作者列表 + 权限级别）
- 权限级别：`owner`（全权）/ `editor`（可编辑）/ `reviewer`（只读+评论）
- ChapterEditor 新增评论/批注侧边栏（参考 Google Docs 模式）
- 实时协作基于 Cloudflare Durable Objects（WebSocket），作为后续迭代

### F.2 章节版本控制

**问题**：`chapters.snapshotKeys` 已有快照机制，但无法在 UI 层对比版本差异。

- 章节编辑每次保存触发快照（写R2），最多保留20个版本
- ChapterEditor 新增"版本历史"Tab：时间线展示 + Diff 对比视图
- 支持从任意历史版本恢复

### F.3 发布中心

- `novels` 新增 `publishedAt`、`publishVersion`、`publishR2Key`
- 一键"发布"：导出当前所有 generated 章节为 EPUB + 生成公开访问链接
- 发布历史：维护多次发布记录，读者看到的始终是最后一次发布版本
- 前端 `/library` 路由：展示用户发布的公开小说库

---

## 三、技术债务清单

| 优先级 | 问题 | 影响 | 修复时机 |
|--------|------|------|----------|
| 🔴 紧急 | novels等核心表无 user_id | 多用户数据越权访问 | Phase A |
| 🔴 紧急 | consistency.ts conflicts 缺少 suggestion 字段 | 上一章建议注入质量差 | Phase A 前立即修 |
| 🟡 高 | Vectorize批量写入串行 | 重建索引性能差（10x瓶颈） | Phase B 同步 |
| 🟡 高 | 情节图谱前端G6渲染 | 百节点以上性能未验证 | Phase D 前验证 |
| 🟡 高 | contextBuilder 无向量降级容错 | 向量服务不可用时静默失败 | Phase A 同步 |
| 🟢 中 | quality_scores 无前端展示 | 评分已生成但用户看不到 | Phase B |
| 🟢 中 | postProcess 6步骤无并行 | 依赖关系允许部分并发 | Phase B 优化 |
| 🟢 中 | 无错误监控 | Queue失败静默，无告警 | Phase C 前 |
| 🔵 低 | MODEL_PRICING 硬编码 | 新模型无法计价 | Phase C |
| 🔵 低 | 导出格式无 EPUB 前端配置 | export.ts 支持但 UI 未暴露 | Phase C |

---

## 四、执行优先级完整排序

| # | 任务 | 估时 | 所属阶段 |
|---|------|------|----------|
| **1** | **consistency.ts 强制 suggestion 字段** | 30min | 立即 |
| **2** | **Phase A：所有核心表新增 user_id + 路由过滤** | 2-3天 | Phase A |
| 3 | quality_scores 前端接入（AI监控 + WorkspacePage） | 4h | Phase A 后 |
| 4 | Phase B.1：写作风格克隆（/api/style/analyze + 前端入口） | 1天 | Phase B |
| 5 | Phase B.2：RAG知识库扩展（上传 + 向量化 + 检索） | 2天 | Phase B |
| 6 | Vectorize 批量写入改为 upsert 批量接口 | 2h | Phase B 同步 |
| 7 | Phase C.1：模板市场（DB + 内置模板 + 工坊接入） | 2天 | Phase C |
| 8 | Phase C.2：公开分享（shareCode + /read路由） | 1天 | Phase C |
| 9 | Phase C.3：TTS朗读（Workers AI + ReaderPage播放器） | 1天 | Phase C |
| 10 | **Phase D：跨章一致性管理（见独立文档）** | - | 独立文档 |
| **11** | **Phase E.1：分镜脚本生成（scriptGen stage + /api/scripts）** | 2天 | Phase E |
| 12 | Phase E.2：有声剧本 + TTS 多角色联动 | 1.5天 | Phase E |
| 13 | Phase E.3：影视剧本（screenwriting格式） | 1天 | Phase E |
| 14 | Phase F.1：协作写作基础（权限模型 + 评论） | 3天 | Phase F |
| 15 | Phase F.2：版本控制 Diff 视图 | 2天 | Phase F |
| 16 | Phase F.3：发布中心 | 1.5天 | Phase F |

---

*NovelForge v3.1 开发计划 · 剥离Phase D · 2026-05-02*
