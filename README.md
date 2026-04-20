# NovelForge · AI 驱动的小说创作工作台

<div align="center">

![NovelForge Logo](https://img.shields.io/badge/NovelForge-AI%20Writing%20Studio-blue?style=for-the-badge)
![Phase](https://img.shields.io/badge/Phase-3%20Complete-success?style=for-the-badge)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Pages%2BWorkers-orange?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)

</div>

> 一个基于 Cloudflare 边缘平台的智能小说创作工具，支持 RAG 增强生成、多模态角色设计和多格式导出。

---

## 🌟 核心特性

### Phase 1 · 基础创作 ✅
- **大纲管理** - 树形结构的大纲编辑器，支持拖拽排序和多层级组织
- **章节编辑** - 基于 Novel.js 的富文本编辑器，自动保存功能
- **AI 生成** - SSE 流式输出，实时看到 AI 创作过程
- **阅读器** - 自定义字体、主题、行高的专注阅读模式
- **模型配置** - 支持火山引擎、Anthropic、OpenAI 等多提供商

### Phase 2 · 智能增强 ✅
- **RAG 检索增强** - 基于 Vectorize 的语义检索，自动组装相关上下文
- **Agent 系统** - ReAct 模式的智能 Agent，支持工具调用
- **上下文预览** - 透明展示 AI 生成时使用的参考资料
- **自动摘要** - 章节生成后自动生成内容摘要
- **智能向量化** - 大纲和摘要自动索引到向量数据库

### Phase 3 · 多模态补完 ✅
- **角色图片上传** - R2 对象存储 + 拖拽上传
- **AI 视觉分析** - LLaVA 视觉模型自动生成角色描述
- **多格式导出** - 支持 Markdown/TXT/EPUB/ZIP 多种格式
- **卷范围选择** - 按卷导出部分章节内容

---

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- pnpm (推荐) 或 npm
- Cloudflare 账号

### 安装步骤

```bash
# 1. 克隆项目
git clone https://github.com/your-username/novelforge.git
cd novelforge

# 2. 安装依赖
pnpm install

# 3. 登录 Cloudflare
wrangler login

# 4. 创建 D1 数据库
wrangler d1 create novelforge

# 5. 创建 R2 存储桶
wrangler r2 bucket create novelforge-storage

# 6. 配置环境变量（本地开发）
cat > .dev.vars << 'EOF'
VOLCENGINE_API_KEY=你的火山引擎 API Key
ANTHROPIC_API_KEY=你的 Anthropic API Key
OPENAI_API_KEY=你的 OpenAI API Key
EOF

# 7. 初始化数据库
wrangler d1 migrations apply novelforge --local

# 8. 启动开发服务器
wrangler pages dev --local -- pnpm dev
```

访问 `http://localhost:8788` 开始使用。

---

## 📚 文档导航

| 文档 | 描述 |
|------|------|
| [架构设计](./docs/ARCHITECTURE.md) | 系统架构、技术选型、数据流设计 |
| [部署指南](./docs/DEPLOYMENT.md) | 生产环境部署、CI/CD 配置、环境变量 |
| [API 参考](./docs/API.md) | 完整的 REST API 文档 |
| [开发路线图](./docs/ROADMAP.md) | Phase 1-4 的详细开发计划 |
| [CHANGELOG](./CHANGELOG.md) | 版本更新记录 |

---

## 🛠 技术栈

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite 5
- **路由**: React Router v6
- **状态管理**: Zustand + TanStack Query
- **UI 组件**: shadcn/ui (Radix UI)
- **样式**: Tailwind CSS
- **编辑器**: Novel.js (Tiptap 封装)
- **图标**: Lucide React

### 后端
- **运行时**: Cloudflare Pages Functions
- **框架**: Hono v4
- **ORM**: Drizzle ORM
- **验证**: Zod + @hono/zod-validator

### 基础设施
- **数据库**: Cloudflare D1 (SQLite)
- **存储**: Cloudflare R2
- **AI**: Cloudflare Workers AI
- **向量**: Cloudflare Vectorize
- **部署**: Cloudflare Pages

---

## 📊 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Cloudflare Pages                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │   React App  │◄───────►│   Functions /api/[[route]]   │  │
│  │  (dist/)     │         │        (Hono App)            │  │
│  └──────────────┘         └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            │           │
              ┌─────────────┘           └─────────────┐
              │                                       │
      ┌───────▼────────┐                     ┌────────▼───────┐
      │    D1 Database │                     │    R2 Bucket   │
      │  (novels, ... )│                     │  (images, ... )│
      └────────────────┘                     └────────────────┘
              │
      ┌───────▼────────┐
      │   Vectorize    │
      │ (embeddings)   │
      └────────────────┘
```

详细架构图见 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)

---

## 🔧 核心服务模块

### `/server/services/llm.ts`
统一 LLM 调用层，支持多提供商（Volcengine/Anthropic/OpenAI），提供流式和非流式生成接口。

### `/server/services/agent.ts`
基于 ReAct 模式的智能 Agent，负责章节生成的完整流程：上下文组装 → LLM 调用 → 工具调用 → 摘要生成。

### `/server/services/contextBuilder.ts`
RAG 上下文组装器，强制注入关键信息（大纲、上一章摘要、主角卡片）+ 语义检索相关片段。

### `/server/services/embedding.ts`
文本向量化服务，使用 `@cf/baai/bge-base-zh-v1.5` 模型（768 维中文向量）。

### `/server/services/vision.ts`
视觉分析服务，使用 LLaVA 模型分析角色图片，自动生成外貌描述和性格标签。

### `/server/services/export.ts`
多格式导出服务，支持 MD/TXT/EPUB/ZIP，包含 HTML→Markdown 转换和目录生成。

---

## 📦 项目结构

```
novelforge/
├── src/                          # 前端代码
│   ├── components/
│   │   ├── ui/                   # shadcn 组件
│   │   ├── layout/               # 布局组件
│   │   ├── novel/                # 小说相关组件
│   │   ├── outline/              # 大纲组件
│   │   ├── chapter/              # 章节编辑器
│   │   ├── generate/             # AI 生成面板
│   │   ├── character/            # 角色管理
│   │   └── export/               # 导出对话框
│   ├── pages/                    # 页面组件
│   ├── hooks/                    # 自定义 Hooks
│   └── lib/                      # 工具库
│
├── server/                       # 后端代码
│   ├── index.ts                  # Hono app 入口
│   ├── routes/                   # API 路由
│   ├── services/                 # 业务服务
│   ├── db/                       # 数据库 schema
│   └── lib/                      # 工具函数
│
├── functions/                    # Pages Functions
│   └── api/[[route]].ts          # 通配符路由
│
├── docs/                         # 文档
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── API.md
│   └── ROADMAP.md
│
├── wrangler.toml                 # Cloudflare 配置
├── package.json
└── tsconfig.json
```

---

## 🌍 支持的 LLM 提供商

| 提供商 | 推荐模型 | API Base | 适用场景 |
|--------|----------|----------|----------|
| **火山引擎** | doubao-seed-2-pro | ark.cn-beijing.volces.com | 中文创作，性价比高 |
| **Anthropic** | claude-sonnet-4-20250514 | api.anthropic.com | 高质量创作 |
| **OpenAI** | gpt-4o | api.openai.com | 通用场景 |

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

---

## 🔗 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Hono 框架文档](https://hono.dev/)
- [Drizzle ORM 文档](https://orm.drizzle.team/)
- [shadcn/ui 组件库](https://ui.shadcn.com/)
- [Novel 编辑器](https://novel.sh/)

---

<div align="center">

**Made with ❤️ by Cloudflare Edge Platform**

</div>
