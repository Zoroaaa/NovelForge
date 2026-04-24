# NovelForge 更新日志

所有重要的项目变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
项目遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

---

## [1.7.0] - 2026-04-24

### 🎉 重大更新：Phase 7 · 伏笔系统增强与工坊优化

#### 新增功能

##### 伏笔进度追踪 🪝
- **伏笔进度表** (`foreshadowing_progress`)
  - 追踪每个伏笔在具体章节中的收尾进度
  - 支持多章节分布收尾
  - 进度状态管理

- **伏笔管理API增强**
  - `GET /api/foreshadowing/:novelId` - 获取伏笔列表（新增进度信息）
  - `POST /api/foreshadowing` - 创建伏笔（支持进度初始化）
  - `PUT /api/foreshadowing/:id` - 更新伏笔（支持进度更新）
  - 新增伏笔进度查询接口

##### 格式化工坊导入 📥
- **Workshop Format Import** (`/api/workshop-format-import`)
  - 支持导入结构化工坊数据
  - 批量创建小说、角色、设定等
  - 数据验证和转换

- **工坊导入服务** (`/server/services/formatImport.ts`)
  - 统一的导入处理逻辑
  - 错误恢复和回滚机制
  - 导入进度追踪

##### 小说管理增强 📖
- **小说管理路由** (`/api/novels`)
  - 增强的小说CRUD操作
  - 批量操作支持
  - 小说统计信息

#### 系统架构优化

##### Agent服务模块化重构 🔧
- **`batch.ts`** - 批量生成逻辑重构
  - 优化批量处理流程
  - 错误处理增强

- **`coherence.ts`** - 连贯性检查增强
  - 改进章节衔接检测算法
  - 新增多维度检查

- **`consistency.ts`** - 一致性检查优化
  - 角色行为一致性验证
  - 世界观一致性检查

- **`constants.ts`** - 常量定义更新
  - 新增v1.7.0相关常量
  - 配置参数优化

- **`generation.ts`** - 生成逻辑优化
  - 生成策略改进
  - 性能提升

- **`messages.ts`** - 消息处理重构
  - 消息格式标准化
  - 处理效率提升

- **`summarizer.ts`** - 摘要生成优化
  - 摘要质量提升
  - 摘要链扩展支持

##### 伏笔服务增强 (`/server/services/foreshadowing.ts`)
- 伏笔提取算法优化
- 进度追踪功能
- 自动收尾检测增强

##### 工坊服务增强 (`/server/services/workshop.ts`)
- 工坊流程优化
- 数据验证增强
- 提交确认流程改进

#### 数据库变更

- 🔧 新增 `foreshadowing_progress` 表（伏笔进度追踪）
- 🔧 伏笔管理相关表结构增强
- 🔧 数据库查询优化

#### 前端组件增强

- 📝 **ChapterList** 组件改进
  - 批量操作优化
  - 排序功能增强

- 📝 **CharacterImageUpload** 组件优化
  - 图片上传体验提升
  - 错误处理改进

- 📝 **CharacterList** 组件增强
  - 角色列表展示优化
  - 筛选功能增强

- 📝 **ExportDialog** 组件改进
  - 导出选项优化
  - 进度展示改进

- 📝 **ForeshadowingPanel** 新增/增强
  - 伏笔进度可视化
  - 状态追踪UI

#### 改进

- 🔧 数据库查询性能优化
- 🔧 API响应速度提升
- 🔧 错误处理机制完善
- 🔧 前端加载状态优化
- 🔧 日志记录增强

---

## [1.6.0] - 2026-04-23

### 🎉 重大更新：Phase 6 · 智能增强与系统优化

#### 新增功能

##### AI 监控中心 🖥️
- **独立监控页面** (`/ai-monitor`)
  - 向量索引统计总览（总向量数、设定/角色/伏笔分类统计）
  - 向量索引类型分布可视化图表
  - 语义搜索测试功能
  - 生成日志查看
  - 上下文诊断工具（预览章节生成的完整上下文）
  - 服务状态检查（Vectorize可用性、模型信息）

- **手动操作工具**
  - 全量重建索引（后台队列异步执行）
  - 增量索引未索引项
  - 重建实体树

##### 实体树面板 🌳
- **树形结构展示** (`EntityTreePanel`)
  - 支持5种实体类型：小说/卷/章节/角色/设定
  - 展开/折叠操作
  - 双击章节快速定位
  - 元数据徽标展示（字数、状态、角色定位等）
  - 全部展开/全部收起快捷操作
  - 重建索引功能

##### 回收站功能 🗑️
- **回收站面板** (`TrashPanel`)
  - 查看所有软删除数据
  - 按表分类统计
  - 单条永久删除
  - 按表清空
  - 全部清空（带确认）
  - 删除时间显示

##### 综合质量检查 🛡️
- **组合检查组件** (`CombinedCheck`)
  - 角色一致性检查（检测角色行为冲突）
  - 章节连贯性检查（衔接自然性、伏笔应收尾检测）
  - 综合评分展示（100分制）
  - 问题详情展开查看
  - 修复建议提示

##### 章节连贯性检查 📝
- **章节连贯性检查组件** (`ChapterCoherenceCheck`)
  - 与前章摘要衔接检查
  - 应收伏笔是否已收尾检测
  - 主角境界突变检测
  - 问题严重程度分级（error/warning）
  - 修复建议输出

##### 文本格式化工具 ✨
- **formatContent.ts** - AI生成内容排版优化
  - Markdown转HTML（保留标题、列表、引用、对话等格式）
  - 对话行智能识别和样式化
  - 场景分隔线处理
  - 阅读器专用排版优化
  - 智能分段功能

#### 系统架构升级

##### Agent系统模块化重构 🔧
- **目录结构重组** (`/server/services/agent/`)
  - `batch.ts` - 批量大纲生成
  - `checkLogService.ts` - 检查日志服务
  - `coherence.ts` - 章节连贯性检查
  - `consistency.ts` - 角色一致性检查
  - `constants.ts` - 常量定义
  - `executor.ts` - 执行器
  - `generation.ts` - 生成逻辑
  - `index.ts` - 统一导出
  - `logging.ts` - 日志记录
  - `messages.ts` - 消息处理
  - `reactLoop.ts` - ReAct循环
  - `summarizer.ts` - 摘要生成
  - `tools.ts` - 工具定义
  - `types.ts` - 类型定义

##### 上下文构建v4优化 🚀
- **架构优化**：RAG返回ID → DB查完整卡片（替代原来的RAG直接返回碎片）
- **预算大幅增加**：Total从14k提升至55k tokens
  - Core层：≤18,000 tokens
  - Dynamic层：≤37,000 tokens
- **RAG查询优化**：从3次减少到2次（去除character content读取）
- **向量类型精简**：从6种减少到3种（character/setting/foreshadowing）
- **超时根治**：单次索引任务最大1个chunk（使用summary字段）
- **摘要链扩展**：默认从5章扩展到20章

##### 队列任务系统 ⚡
- **新增队列处理器** (`queue-handler.ts`)
  - `index_content` - 异步内容索引
  - `reindex_all` - 全量重建索引
  - `rebuild_entity_index` - 重建实体树
  - `extract_foreshadowing` - 异步伏笔提取
  - `post_process_chapter` - 章节后处理（摘要/伏笔/境界检测）
- **任务日志追踪** - `queue_task_logs`表记录任务执行状态
- **后台异步执行** - 索引重建等耗时任务不再阻塞主流程

#### 数据库变更 (v4.0)

- 🔧 新增 `queue_task_logs` 表（队列任务日志，7字段）
- 🔧 `novel_settings` 表新增 `summary` 字段（设定摘要，用于RAG索引）
- 🔧 `0010_schema.sql` - 整合所有迁移，移除ALTER语句
- 🔧 使用触发器自动维护字数/章数统计（替代手动更新）
- 🔧 索引优化 - 部分索引过滤已删除记录

#### 向量化API增强

- 新增 `POST /api/vectorize/reindex-all` - 全量重建索引（异步队列执行）
- 新增 `POST /api/vectorize/index-missing` - 增量索引未索引项
- 新增 `GET /api/vectorize/stats` - 向量统计（总数、分类统计、未索引数量）
- 新增 `GET /api/vectorize/status` - 服务状态检查
- 新增 `GET /api/generate/preview-context` - 上下文诊断

#### 前端组件增强

- 📝 **GeneratePanel** 大幅改进（1070行变更）
  - 续写/重写模式支持
  - 模式切换UI（生成/续写/重写）
  - rewrite模式支持选中文本
  - continue模式自动截取章节末尾500字
  - 更完善的SSE流处理和错误处理

- 📝 **ReaderPage** 功能增强
  - 排版优化（首行缩进、段落间距）
  - 对话内容样式化
  - 场景分隔视觉提示

- 📝 **ChapterList** 组件改进
  - 批量操作支持
  - 排序优化

#### 部署配置更新

- 📦 **wrangler.toml** 新增配置
  - Queue生产者/消费者绑定
  - 观测日志启用
  - Vectorize元数据索引注释

- 📦 **GitHub Actions** 升级
  - Node版本升级到20
  - 部署流程优化

#### 文档新增

- 📝 **context-v4-execution-guide.md** - v4上下文构建完整执行逻辑说明
  - 架构总览与数据流
  - 10个Slot详细执行逻辑
  - 向量索引精确定义
  - 超时根治机制
  - v3→v4迁移对照表

#### 改进

- 🔧 GeneratePanel模式切换逻辑优化
- 🔧 向量索引错误处理增强
- 🔧 数据库查询性能优化
- 🔧 前端加载状态处理改进
- 🔧 API错误响应格式统一

#### Bug修复

- 🐛 修复向量索引超时问题（通过summary字段和单chunk限制）
- 🐛 修复多小说场景模型串台问题
- 🐛 修复generation_logs model_id写入问题

---

## [1.5.0] - 2026-04-22

### 🎉 重大更新：Phase 5 · 用户系统与创作工坊

#### 新增功能

##### 用户认证系统 ✨
- **JWT Token 认证**
  - HS256 签名，7 天有效期
  - 自动 Token 刷新机制
  - 安全的会话管理

- **完整的用户管理**
  - 用户注册（用户名/邮箱/密码）
  - 用户登录（支持用户名或邮箱登录）
  - 修改密码（需验证当前密码）
  - 删除账号（软删除，标记为 deleted）

- **密码安全**
  - PBKDF2 + SHA-256 哈希算法
  - 100,000 次迭代，16 字节随机盐值
  - 密码复杂度要求（大小写字母+数字，8-64位）

- **邀请码系统** 🔑
  - 管理员生成邀请码（可设置最大使用次数、过期时间）
  - 注册时可选填邀请码
  - 邀请码状态管理（active/used/expired/disabled）
  - 使用次数追踪

- **角色权限控制**
  - `admin` - 管理员权限（管理邀请码、系统设置等）
  - `user` - 普通用户权限
  - Admin 权限中间件保护敏感接口

- **系统初始化向导** 🚀
  - 首次部署自动检测是否需要初始化
  - 引导创建管理员账号
  - 创建后自动登录并跳转到主页
  - 防止重复初始化保护

- **注册开关**
  - 管理员可通过 API 开关/关闭公开注册
  - 关闭后仅允许邀请码注册

##### AI 创意工坊 🎨
- **多阶段对话式创作引擎**
  - **概念构思阶段** - 确定小说类型、核心设定、目标篇幅、核心爽点
  - **世界观构建阶段** - 地理环境、力量体系、势力格局、历史背景、社会规则
  - **角色设计阶段** - 主角/配角/反派设计，包含外貌、性格、能力、关系
  - **卷纲规划阶段** - 分卷大纲、事件线、关键转折点、伏笔安排

- **SSE 流式对话**
  - 实时显示 AI 回复内容
  - 打字机效果展示
  - 支持中断和继续

- **结构化数据提取**
  - 从 AI 回复中自动提取 JSON 数据
  - 实时预览面板显示已提取的数据
  - 支持标题、流派、简介、世界观、角色、卷纲等数据类型

- **一键提交功能**
  - 将确认的创作数据写入数据库
  - 自动创建小说记录、总纲、角色卡片、卷结构
  - 提交后跳转到工作区页面

- **会话管理**
  - 创建/查看/删除会话
  - 会话历史记录
  - 多会话并行支持

##### 全局模型配置中心 ⚙️
- **独立配置页面** (`/model-config`)
  - 统一管理所有 AI 模型配置
  - 清晰的配置列表界面
  - 配置统计信息展示

- **7 种用途场景**
  | 场景 | 说明 |
  |------|------|
  | `chapter_gen` | 小说章节内容生成 |
  | `outline_gen` | 大纲/卷纲生成 |
  | `summary_gen` | 摘要生成 |
  | `embedding` | 文本向量嵌入 |
  | `vision` | 图片视觉理解 |
  | `analysis` | 智能分析（伏笔检测、一致性检查） |
  | `workshop` | 创作工坊 AI 对话 |

- **20+ AI 提供商支持**
  - 国内：百度文心、腾讯混元、阿里通义、字节豆包、智谱AI、MiniMax、月之暗面(Kimi)、硅基流动
  - 国际：OpenAI、Anthropic(Claude)、Google Gemini、Mistral AI、xAI Grok、Groq、Perplexity
  - 其他：OpenRouter、NVIDIA、模力方舟、魔搭社区、自定义接口

- **连接测试功能**
  - 实时验证 API Key 和模型 ID 是否可用
  - 显示测试结果（成功/失败）
  - 错误信息友好提示

- **配置管理**
  - 创建/编辑/删除配置
  - 启用/停用配置切换
  - 全局/小说级配置优先级

##### 全新页面布局 🎨
- **现代化侧边栏导航**
  - 分组导航（主功能/个人中心/更多功能）
  - Logo 区域 + 折叠按钮
  - 图标 + 文字标签
  - 当前页面高亮显示
  - 即将上线功能标记

- **顶栏设计**
  - 移动端菜单按钮
  - 页面标题 + 副标题
  - 自定义操作插槽
  - 用户头像下拉菜单（显示用户名/邮箱、账号设置、退出登录）

- **响应式布局**
  - 桌面端：固定侧边栏 + 内容区
  - 移动端：抽屉式侧边栏
  - 平板适配
  - 断点：lg (1024px)

- **路由守卫系统**
  - `ProtectedRoute` - 需要登录才能访问
  - `PublicRoute` - 已登录用户自动重定向
  - `SetupGuard` - 系统初始化检查
  - 加载状态处理

##### 新增页面
| 页面 | 路由 | 说明 |
|------|------|------|
| 登录页 | `/login` | 用户登录表单 |
| 注册页 | `/register` | 用户注册表单（含邀请码） |
| 账号设置页 | `/account` | 查看个人信息、修改密码、删除账号 |
| 模型配置页 | `/model-config` | 全局 AI 模型配置管理 |
| 系统初始化页 | `/setup` | 首次部署管理员创建向导 |
| 创意工坊页 | `/workshop` | AI 对话式创作引擎 |

#### 数据库变更 (v3.0)
- 🔧 新增 `users` 表（用户认证，10 字段 + 3 索引）
- 🔧 新增 `invite_codes` 表（邀请码管理，9 字段 + 2 索引）
- 🔧 新增 `system_settings` 表（系统配置，4 字段）
- 🔧 `workshop_sessions` 表添加 `deleted_at` 字段（软删除支持）
- 🔧 `entity_index` 表添加 `deleted_at` 字段（软删除支持）
- 🔧 升级多个索引为部分索引（过滤已删除记录）
- 🔧 初始化 3 条系统设置记录

#### 后端服务新增
- `/server/lib/auth.ts` - 认证与安全模块（JWT、密码哈希、中间件）
- `/server/routes/auth.ts` - 认证 API（登录/注册/修改密码/删除账号/获取用户信息）
- `/server/routes/invite-codes.ts` - 邀请码管理 API（CRUD + 状态管理）
- `/server/routes/setup.ts` - 系统初始化 API（状态检查/创建管理员）
- `/server/routes/system-settings.ts` - 系统设置 API（注册开关等）
- `/server/routes/workshop.ts` - 创意工坊 API（会话管理/SSE 对话/提交确认）
- `/server/services/workshop.ts` - 创意工坊服务层（分阶段 Prompt/数据处理）

#### 前端新增
- `src/store/authStore.ts` - Zustand 认证状态管理
- `src/pages/LoginPage.tsx` - 登录页面组件
- `src/pages/RegisterPage.tsx` - 注册页面组件
- `src/pages/AccountPage.tsx` - 账号设置页面组件
- `src/pages/ModelConfigPage.tsx` - 模型配置页面组件
- `src/pages/SetupPage.tsx` - 系统初始化页面组件
- `src/pages/WorkshopPage.tsx` - 创意工坊页面组件
- `src/components/layout/MainLayout.tsx` - 主布局组件（v1.5 重构）
- `src/components/model/ModelConfig.tsx` - 模型配置组件
- `src/lib/providers.ts` - 更新为 20+ 提供商

### 改进

#### 页面布局重构
- 🔧 全面重构应用布局系统
- 🔧 引入 MainLayout 替代旧布局
- 🔧 所有页面统一使用新布局
- 🔧 优化移动端体验

#### 路由系统升级
- 🔧 升级到 React Router v7
- 🔧 实现嵌套路由和布局路由
- 🔧 添加路由守卫（认证/公开/初始化检查）
- 🔧 优化路由结构组织

#### 模型配置增强
- 🔧 扩展支持的 AI 提供商至 20+
- 🔧 新增 7 种用途场景配置
- 🔧 添加连接测试功能
- 🔧 优化配置 UI 交互

#### 安全性提升
- 🔧 实现完整的认证授权体系
- 🔧 所有敏感接口添加 JWT 验证
- 🔧 密码采用工业级哈希算法
- 🔧 添加 Admin 权限中间件

### 文档

- 📝 全面重写 README.md，反映 v1.5.0 所有新功能
- 📝 更新项目结构说明
- 📝 添加用户系统架构图
- 📝 添加创意工坊工作流说明
- 📝 更新技术栈版本号
- 📝 添加安全特性说明

---

## [1.4.0] - 2026-04-21

### 新增

#### Phase 4 · 创作辅助系统
- ✨ **伏笔管理系统**
  - 自动从章节内容中提取伏笔
  - 伏笔状态追踪（开放/已收尾/已放弃）
  - 重要性分级（高/中/低）
  - AI 自动检测伏笔收尾

- ✨ **创作规则系统**
  - 定义写作风格、节奏、角色、情节、世界观、禁忌等规则
  - 规则优先级管理（1-5级）
  - 规则启用/禁用控制
  - 规则分类管理（style/pacing/character/plot/world/taboo/custom）

- ✨ **总纲管理**
  - 替代原多层大纲结构
  - 版本历史支持
  - 自动字数统计
  - 向量化索引支持

- ✨ **小说设定系统**
  - 统一管理世界观、境界体系、势力组织、地理、宝物功法等
  - 支持层级结构和关联关系
  - 重要性标记
  - 向量化检索支持

- ✨ **境界/战力追踪**
  - 自动检测角色境界突破事件
  - 角色成长历程记录
  - 突破历史追踪
  - 支持多种境界体系

- ✨ **内容搜索**
  - 章节内容关键词搜索
  - 搜索结果高亮预览
  - 支持限定小说范围

- ✨ **向量化索引API**
  - 独立的向量化索引管理接口
  - 支持大纲、章节、角色、摘要等类型
  - 相似度搜索功能
  - 索引状态检查

- ✨ **MCP Server 集成**
  - Claude Desktop 直接访问小说数据
  - 支持查询小说、大纲、章节、角色
  - 语义搜索功能

#### 数据库重构 (v2.0)
- 🔧 扁平化结构设计，避免深层嵌套
- 🔧 新增 `master_outline` 总纲表
- 🔧 新增 `writing_rules` 创作规则表
- 🔧 新增 `novel_settings` 小说设定表
- 🔧 新增 `foreshadowing` 伏笔追踪表
- 🔧 新增 `vector_index` 向量索引追踪表
- 🔧 新增 `entity_index` 总索引表
- 🔧 增强 `volumes` 卷表（支持卷大纲、蓝图、概要）
- 🔧 增强 `characters` 角色表（支持境界信息）
- 🔧 新增 `generation_logs` 生成任务日志表
- 🔧 新增 `exports` 导出记录表

#### 后端服务
- `/server/services/foreshadowing.ts` - 伏笔追踪服务
- `/server/services/powerLevel.ts` - 境界/战力追踪服务
- `/server/routes/foreshadowing.ts` - 伏笔管理 API
- `/server/routes/writing-rules.ts` - 创作规则 API
- `/server/routes/master-outline.ts` - 总纲管理 API
- `/server/routes/novel-settings.ts` - 小说设定 API
- `/server/routes/search.ts` - 内容搜索 API
- `/server/routes/vectorize.ts` - 向量化索引 API
- `/server/routes/mcp.ts` - MCP Server API

### 改进

- 🔧 优化数据库 Schema，采用扁平化设计
- 🔧 增强 Agent 系统，集成伏笔提取和境界检测
- 🔧 改进上下文组装，支持创作规则注入
- 🔧 优化向量检索，支持多种内容类型

### 文档

- 📝 更新 README.md，反映 Phase 4 功能
- 📝 更新 ARCHITECTURE.md，新增服务模块说明
- 📝 更新 API.md，新增 API 端点文档
- 📝 新增 MCP-SETUP.md 配置指南

---

## [1.3.0] - 2026-04-20

### 新增

#### Phase 3 · 多模态补完
- ✨ **角色图片上传**
  - 支持拖拽上传图片到 R2 存储
  - 实时预览和裁剪
  - 图片压缩和优化
  
- ✨ **AI 视觉分析**
  - 集成 LLaVA 视觉模型 (`@cf/llava-hf/llava-1.5-7b-hf`)
  - 自动生成角色外貌描述
  - 提取性格特征和标签
  - 分析置信度显示

- ✨ **多格式导出**
  - Markdown (.md) - 保留层级结构
  - 纯文本 (.txt) - 兼容性好
  - EPUB 电子书 (.epub) - 含目录和元数据
  - ZIP 打包 (.zip) - 所有章节单独文件
  - 支持卷范围选择
  - 可选包含目录和元数据

#### 前端组件
- `ExportDialog` - 导出配置对话框
- `CharacterImageUpload` - 角色图片上传组件

#### 后端服务
- `/server/services/export.ts` - 导出服务层
- `/server/services/vision.ts` - 视觉分析服务
- `/server/routes/export.ts` - 导出 API 路由
- 增强 `/api/characters/:id/image` - 图片上传端点
- 新增 `/api/characters/:id/analyze-image` - 重新分析端点

### 改进

- 🔧 优化 Character 类型，添加 `imageUrl` 字段
- 🔧 修复 EditorInstance 类型引用
- 🔧 完善 ChapterInput 必填字段验证
- 🔧 优化 Checkbox 组件类型定义

### 修复

- 🐛 修复 Export 关键字冲突（改用 namespace import）
- 🐛 修复 WorkspacePage 导入路径
- 🐛 清理未使用的 imports
- 🐛 修复 Character.role 可能为 null 的警告

### 文档

- 📝 新增完整的 README.md
- 📝 新增 ARCHITECTURE.md 架构设计文档
- 📝 新增 DEPLOYMENT.md 部署指南
- 📝 新增 API.md REST API 参考
- 📝 更新 ROADMAP.md 开发路线图

---

## [1.2.0] - 2026-04-19

### 新增

#### Phase 2 · 智能增强
- ✨ **RAG 检索增强**
  - 集成 Workers AI Embedding (`@cf/baai/bge-base-zh-v1.5`)
  - 768 维中文向量索引
  - 语义相似度检索
  - Vectorize 自动向量化

- ✨ **Agent 智能生成系统**
  - ReAct (Reasoning + Acting) 模式
  - 工具调用框架
  - 多轮对话支持
  - 自动摘要生成

- ✨ **上下文组装器**
  - `ContextBuilder` 服务
  - 强制注入策略（大纲、摘要、主角卡片）
  - Token 预算控制（12000 total / 6000 mandatory / 4000 RAG）
  - 诊断信息输出

#### 前端组件
- `ContextPreview` - 上下文使用预览组件
- 增强的 `GeneratePanel` - 支持 RAG 状态展示

#### 后端服务
- `/server/services/llm.ts` - 统一 LLM 调用层
- `/server/services/embedding.ts` - 向量化服务
- `/server/services/contextBuilder.ts` - 上下文组装
- `/server/services/agent.ts` - Agent 系统

### 改进

- 🔧 LLM 服务支持多提供商（Volcengine/Anthropic/OpenAI）
- 🔧 流式和非流式生成接口
- 🔧 模型配置优先级：小说级 > 全局 > Fallback
- 🔧 自动摘要触发机制
- 🔧 SSE 流式输出优化

### 修复

- 🐛 修复 D1 查询空结果处理
- 🐛 优化 RAG 失败降级策略
- 🐛 修复 Token 计数精度问题

---

## [1.1.0] - 2026-04-18

### 新增

#### Phase 1 · 基础创作（核心功能）
- ✨ **小说管理**
  - 创建/编辑/删除小说
  - 按类型和状态筛选
  - 封面图片占位

- ✨ **大纲管理**
  - 树形大纲编辑器
  - 拖拽排序 (@dnd-kit)
  - 多层级组织
  - 节点类型：世界观/卷/章节/自定义

- ✨ **章节编辑**
  - Novel.js 富文本编辑器
  - 自动保存（防抖 1.5s）
  - HTML 内容存储
  - 字数统计

- ✨ **AI 生成**
  - SSE 流式输出
  - 实时文字渲染
  - 生成进度指示
  - 写入编辑器功能

- ✨ **阅读器**
  - Markdown 渲染
  - 字体大小调节
  - 主题切换（白/暗/护眼）
  - 章节导航

- ✨ **模型配置**
  - 火山引擎支持
  - Anthropic 支持
  - OpenAI 支持
  - 全局/小说级配置

#### 基础设施
- D1 数据库 schema（6 张表）
- R2 存储桶绑定
- Hono 后端路由
- React Router 前端路由
- Zustand 状态管理
- TanStack Query 服务端状态

### 改进

- 🔧 优化首屏加载速度
- 🔧 改进移动端响应布局
- 🔧 增强错误提示友好性

### 修复

- 🐛 修复软删除数据泄露
- 🐛 修复分页边界条件
- 🐛 修复 XSS 潜在风险

---

## [1.0.0] - 2026-04-17

### 初始发布

#### 项目初始化
- ⚙️ Vite + React + TypeScript 模板
- ⚙️ Tailwind CSS + shadcn/ui 样式
- ⚙️ Wrangler Pages Functions 配置
- ⚙️ GitHub Actions CI/CD 模板

#### 开发工具
- ESLint + Prettier 代码规范
- TypeScript 严格模式
- Husky Git hooks
- Commitlint 提交规范

---

## [0.1.0] - 2026-04-15

### 预研阶段

- 🧪 技术选型调研
- 🧪 Cloudflare 产品评估
- 🧪 竞品分析报告
- 🧪 原型设计

---

## 版本说明

### 版本号的含义

- **MAJOR** (主版本号): 不兼容的 API 修改
- **MINOR** (次版本号): 向下兼容的功能性新增
- **PATCH** (修订号): 向下兼容的问题修正

### 本文件的标签

- **Added**: 新增功能
- **Changed**: 版本间的特性变化
- **Deprecated**: 即将移除的特性
- **Removed**: 已移除的特性
- **Fixed**: Bug 修复
- **Security**: 安全相关的修复

---

## 升级指南

### 升级到 1.5.0

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
pnpm update

# 运行数据库迁移（重要：新增用户认证相关表）
wrangler d1 migrations apply novelforge --remote

# 重新部署
pnpm build
wrangler pages deploy dist
```

**重要变更说明**：
- 新增用户认证系统，首次访问需进行系统初始化
- 新增 3 张数据库表（users, invite_codes, system_settings）
- 所有 API 接口需要 JWT 认证（除了 setup 和 auth 相关接口）
- 页面布局全面重构，建议清除浏览器缓存

### 升级到 1.4.0

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
pnpm update

# 运行数据库迁移（重要：数据库结构有重大变更）
wrangler d1 migrations apply novelforge --remote

# 创建 Vectorize 索引（如果尚未创建）
wrangler vectorize create novelforge-index --dimensions=768 --metric=cosine

# 重新部署
pnpm build
wrangler pages deploy dist
```

**重要变更说明**：
- 数据库 Schema 重构为扁平化结构
- 原 `outlines` 表被 `master_outline` 和 `novel_settings` 替代
- 新增多个功能表，需要运行迁移

### 升级到 1.3.0

```bash
# 拉取最新代码
git pull origin main

# 更新依赖
pnpm update

# 安装新依赖（Phase 3 新增）
pnpm add epub-gen-memory jszip @radix-ui/react-collapsible

# 运行数据库迁移
wrangler d1 migrations apply novelforge --remote

# 重新部署
pnpm build
wrangler pages deploy dist
```

### 升级到 1.2.0

```bash
# 确保有 Vectorize 权限
wrangler vectorize create novelforge-index --dimensions=768 --metric=cosine

# 更新依赖
pnpm update

# 运行数据库迁移
wrangler d1 migrations apply novelforge --remote
```

### 升级到 1.1.0

首次安装必需：

```bash
# 创建 D1 数据库
wrangler d1 create novelforge

# 创建 R2 存储桶
wrangler r2 bucket create novelforge-storage

# 初始化数据库
wrangler d1 migrations apply novelforge --local

# 设置 API Keys
wrangler secret put VOLCENGINE_API_KEY
```

---

## 贡献者

感谢所有为本项目做出贡献的人！

| 贡献者 | 贡献内容 |
|--------|----------|
| @yourname | 核心开发 |
| @contributor1 | Bug 修复 |
| @contributor2 | 文档改进 |

---

## 致谢

本项目使用了以下开源项目：

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Hono](https://hono.dev/)
- [Drizzle ORM](https://orm.drizzle.team/)
- [React](https://react.dev/)
- [Vite](https://vitejs.dev/)
- [shadcn/ui](https://ui.shadcn.com/)
- [Novel](https://novel.sh/)
- [TanStack Query](https://tanstack.com/query)
- [Zustand](https://zustand-demo.pmnd.rs/)

---

<div align="center">

**Made with ❤️ by the NovelForge Team**

</div>
