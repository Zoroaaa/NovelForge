# NovelForge 更新日志

所有重要的项目变更都将记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)，
项目遵循 [语义化版本](https://semver.org/spec/v2.0.0.html)。

---

## [未发布]

### 计划功能 (Phase 4)

#### 新增
- [ ] 用户认证系统（Cloudflare Access / JWT）
- [ ] 多用户数据隔离
- [ ] 用量统计和计费接口
- [ ] 公开分享功能（签名 URL）
- [ ] MCP Server 集成（Claude Desktop）
- [ ] PDF 导出（Cloudflare Browser Rendering）
- [ ] 语音朗读（Workers AI TTS）

#### 改进
- [ ] 大纲编辑器支持 Markdown 快捷输入
- [ ] 章节对比视图（版本历史）
- [ ] 批量导入章节（从 Word/Markdown）
- [ ] 智能拼写检查
- [ ] 写作统计（字数趋势、写作时间）

#### 性能
- [ ] 前端代码分割优化
- [ ] 数据库查询缓存
- [ ] CDN 静态资源加速
- [ ] SSE 连接池管理

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
