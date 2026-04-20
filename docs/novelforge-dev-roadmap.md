# NovelForge · 开发路线图

## Phase 1 · 核心可用（2~3 周）
目标：能管理大纲、手动生成章节、阅读

- [ ] D1 Schema 迁移 + Drizzle 初始化
- [ ] Hono 路由：novels / outlines / chapters / volumes CRUD
- [ ] React 前端：小说列表、大纲树编辑、章节编辑器（Novel.js）
- [ ] 基础阅读器（Markdown 渲染 + 字体/主题）
- [ ] 模型配置页（全局 + 按小说覆盖）
- [ ] 最简 LLM 调用：手动触发章节生成（SSE 流式输出）

## Phase 2 · 智能化（2~3 周）
目标：Agent 自动组装上下文、摘要自动生成

- [ ] Workers AI embedding + Vectorize 索引
- [ ] RAG 检索 + 上下文组装器（contextBuilder.ts）
- [ ] Agent ReAct 循环（工具调用：queryOutline / queryCharacter / searchSemantic）
- [ ] 章节生成后自动写摘要（summary_gen）
- [ ] 前端 ContextPreview 组件（展示本次用了哪些上下文）
- [ ] 大纲/摘要自动向量化队列（写入触发）

## Phase 3 · 补完（1~2 周）
目标：多模态 + MCP + 导出

- [ ] 角色卡图片上传 → 视觉模型分析 → 自动填写描述
- [ ] 导出模块：epub / md / txt / zip（epub-gen-memory + JSZip）
- [ ] PDF 导出（Cloudflare Browser Rendering）
- [ ] MCP Server：暴露 5 个核心工具，Claude Desktop 可直接接
- [ ] 小说打包下载（整部 / 按卷范围）

## Phase 4 · SaaS 化预留（需要时再做）
- [ ] 用户系统（Cloudflare Access 或自建 JWT）
- [ ] 多用户数据隔离（novel_id 加 user_id 外键）
- [ ] 用量计费（generation_logs 已记录 token 数）
- [ ] 公开分享（已有 exports 表 + R2 签名 URL）

---

## 关键依赖版本锁定
```
hono:              ^4.4
drizzle-orm:       ^0.30
@hono/zod-validator: ^0.2
novel (tiptap):    ^0.5  (editor)
epub-gen-memory:   ^1.0
jszip:             ^3.10
zustand:           ^4.5
react-query:       ^5.0
```

## Vectorize 初始化命令
```bash
# 创建索引（768 维对应 bge-base-zh）
wrangler vectorize create novelforge-index --dimensions=768 --metric=cosine

# 查看索引状态
wrangler vectorize get novelforge-index
```
