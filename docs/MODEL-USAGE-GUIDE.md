# NovelForge 模型使用指南

## 一、概述

NovelForge 采用多用途模型配置系统，支持为不同的 AI 生成任务配置不同的模型。所有模型配置通过 `model_configs` 表管理，采用 **小说级配置优先于全局配置** 的策略。

### 配置优先级

```
小说级配置(novelId) > 全局配置(global) > 抛出错误
```

---

## 二、模型用途分类

NovelForge 共支持 **4 种模型用途**：

| 用途标识 | 名称 | 说明 | 配置范围 |
|---------|------|------|---------|
| `chapter_gen` | 章节生成 | 生成小说章节正文内容、修复章节 | 全局/小说级 |
| `summary_gen` | 摘要生成 | 章节摘要、总纲摘要、卷摘要、设定摘要 | 全局/小说级 |
| `analysis` | 智能分析 | 角色一致性、伏笔检测、战力分析、卷进度检查等 | 全局/小说级 |
| `workshop` | 创作工坊 | AI创作助手对话引擎 | **仅全局** |

---

## 三、用途详解与配置要求

### 1. chapter_gen - 章节生成

**用途说明**：生成小说章节正文内容，是核心的创作功能。

**调用位置**：

| 文件 | 行号 | 功能 |
|------|------|------|
| `server/services/agent/generation.ts` | L60 | 章节内容生成 |
| `server/services/agent/generation.ts` | L349 | 生成下一章标题摘要 |
| `server/services/agent/consistency.ts` | L106 | 章节修复(流式) |
| `server/mcp/index.ts` | L599 | MCP工具触发生成 |
| `server/services/workshop.ts` | L396 | 创作工坊备选调用 |
| `server/services/formatImport.ts` | L392 | 格式化导入备选调用 |

**相关API路由**：

- `POST /generate/chapter` - 生成章节

**配置遗漏影响**：❌ 无法生成章节内容

---

### 2. summary_gen - 摘要生成

**用途说明**：生成各类摘要内容，包括章节摘要、总纲摘要、卷摘要、设定摘要。

**调用位置**：

| 文件 | 行号 | 功能 |
|------|------|------|
| `server/services/agent/summarizer.ts` | L84 | 章节摘要 (triggerAutoSummary) |
| `server/services/agent/summarizer.ts` | L137 | 总纲摘要 (generateMasterOutlineSummary) |
| `server/services/agent/summarizer.ts` | L191 | 卷摘要 (generateVolumeSummary) |
| `server/services/agent/summarizer.ts` | L242 | 设定摘要 (generateSettingSummary) |

**相关API路由**：

- `POST /generate/summary` - 章节摘要生成
- `POST /generate/master-outline-summary` - 总纲摘要生成
- `POST /generate/volume-summary` - 卷摘要生成

**配置遗漏影响**：❌ 无法生成任何摘要内容

---

### 3. analysis - 智能分析

**用途说明**：执行各类智能分析任务，包括角色一致性检查、伏笔检测、战力分析、卷进度检查等。

**调用位置**：

| 文件 | 行号 | 功能 |
|------|------|------|
| `server/services/agent/consistency.ts` | L38 | 角色一致性检查 |
| `server/services/agent/volumeProgress.ts` | L79 | 卷完成度检查 |
| `server/services/powerLevel.ts` | L106 | 战力等级检测 |
| `server/routes/power-level.ts` | L387 | 战力验证 |
| `server/services/foreshadowing.ts` | L119 | 伏笔提取分析 |
| `server/services/foreshadowing.ts` | L421 | 伏笔健康检查 |
| `server/services/foreshadowing.ts` | L609 | 伏笔建议生成 |

**相关API路由**：

- `POST /generate/check` - 角色一致性检查
- `POST /generate/coherence-check` - 章节连贯性检查
- `POST /generate/volume-progress-check` - 卷进度检查
- `POST /power-level/detect` - 战力检测
- `POST /power-level/validate` - 战力验证
- `POST /foreshadowing/extract` - 伏笔提取
- `POST /foreshadowing/health` - 伏笔健康检查
- `POST /foreshadowing/suggest` - 伏笔建议生成

**配置遗漏影响**：❌ 无法执行各类智能分析任务

---

### 4. workshop - 创作工坊

**用途说明**：AI创作助手对话引擎，用于创意工坊页面的对话式创作。

**调用位置**：

| 文件 | 行号 | 功能 |
|------|------|------|
| `server/services/workshop.ts` | L389 | 创作工坊对话(优先调用) |
| `server/services/formatImport.ts` | L388 | 格式化导入(优先调用) |

**相关API路由**：

- `POST /workshop/message` - 创作工坊对话

**配置遗漏影响**：⚠️ 会 fallback 到 `chapter_gen` 配置

**注意**：`workshop` 用途**仅支持全局配置**，不可以在小说工作台中设置。

---

## 四、推荐配置方案

### 最低配置（4种用途全配置）

| 用途 | 推荐模型 | 说明 |
|------|---------|------|
| `chapter_gen` | GPT-4o / Claude 3.5 Sonnet / DeepSeek-V3 | 需要较强的创意写作能力 |
| `summary_gen` | GPT-4o / Claude 3.5 | 摘要生成需要理解能力 |
| `analysis` | GPT-4o / Claude 3 | 需要逻辑推理能力 |
| `workshop` | Claude 3.5 / GPT-4o | 需要长对话和多轮交互能力 |

### 经济配置（复用模型）

| 用途 | 推荐模型 | 说明 |
|------|---------|------|
| `chapter_gen` | GPT-4o / DeepSeek-V3 | 核心创作 |
| `summary_gen` | **复用 chapter_gen** | 摘要任务 |
| `analysis` | **复用 chapter_gen** | 分析任务 |
| `workshop` | GPT-4o / Claude 3.5 | 对话能力要求高 |

### 高端配置（分开配置）

| 用途 | 推荐模型 | 说明 |
|------|---------|------|
| `chapter_gen` | GPT-4o / Claude 3.5 Sonnet | 顶级创意写作 |
| `summary_gen` | GPT-4o-mini / Claude 3 Haiku | 摘要任务较简单 |
| `analysis` | GPT-4o / Claude 3 | 逻辑推理 |
| `workshop` | Claude 3.5 Sonnet / GPT-4o | 对话体验 |

---

## 五、支持的模型提供商

| 提供商 | API Base | 说明 |
|-------|----------|------|
| OpenAI | `https://api.openai.com/v1` | GPT系列 |
| Anthropic | `https://api.anthropic.com/v1` | Claude系列 |
| DeepSeek | `https://api.deepseek.com/v1` | DeepSeek系列 |
| 百度 | `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop` | 文心一言 |
| 阿里云 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 通义千问 |
| 腾讯 | `https://api.hunyuan.cloud.tencent.com/v1` | 混元大模型 |
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/v3` | 豆包/扣子 |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | GLM系列 |
| MiniMax | `https://api.minimax.chat/v1` | MiniMax系列 |
| Moonshot | `https://api.moonshot.cn/v1` | Kimi系列 |
| SiliconFlow | `https://api.siliconflow.cn/v1` | 聚合API |
| Google | `https://generativelanguage.googleapis.com/v1beta` | Gemini系列 |
| Mistral | `https://api.mistral.ai/v1` | Mistral系列 |
| XAI | `https://api.x.ai/v1` | Grok系列 |
| Groq | `https://api.groq.com/openai/v1` | Groq系列 |
| Perplexity | `https://api.perplexity.ai` | Perplexity系列 |
| OpenRouter | `https://openrouter.ai/api/v1` | 聚合API |
| NVIDIA | `https://integrate.api.nvidia.com/v1` | NVIDIA系列 |
| Gitee | `https://ai.gitee.com/v1` | 智普AI |
| ModelScope | `https://api-inference.modelscope.cn/v1` | 魔搭系列 |
| Custom | 自定义 | 支持私有部署 |

---

## 六、配置检查清单

配置模型时，请确保以下所有用途都已正确配置：

- [ ] `chapter_gen` - 章节生成（**必填**）
- [ ] `summary_gen` - 摘要生成（**必填**）
- [ ] `analysis` - 智能分析（**必填**）
- [ ] `workshop` - 创作工坊（**仅全局必填**）

---

## 七、错误排查

### 错误：未配置"章节生成"模型

**原因**：未配置 `chapter_gen` 用途的模型

**解决**：在 `/model-config` 页面添加 `chapter_gen` 用途的模型配置

### 错误：未配置"智能分析"模型

**原因**：未配置 `analysis` 用途的模型

**解决**：在 `/model-config` 页面添加 `analysis` 用途的模型配置

### 错误：未配置"创作工坊"模型

**原因**：未配置 `workshop` 用途的模型

**解决**：在 `/model-config` 全局配置页面添加 `workshop` 用途的模型配置（注意：仅支持全局配置）

### 错误：摘要生成失败

**原因**：未配置 `summary_gen` 用途的模型

**解决**：在 `/model-config` 页面添加 `summary_gen` 用途的模型配置

---

## 八、日志与监控

所有模型调用都会记录到 `generation_logs` 表，可以通过以下字段追踪：

| 字段 | 说明 |
|------|------|
| `stage` | 生成阶段标识 |
| `model_id` | 实际使用的模型ID |
| `prompt_tokens` | 输入token数 |
| `completion_tokens` | 输出token数 |
| `duration_ms` | 耗时(毫秒) |
| `status` | 状态(success/error) |

**注意**：`generation_logs` 中的 `stage` 字段值（如 `auto_summary`、`foreshadowing_extraction`）是**日志分类用途**，它们分别复用 `summary_gen` 和 `analysis` 的模型配置，不需要单独配置。

---

## 九、相关文档

- [章节生成上下文指南](./CHAPTER-GENERATION-CONTEXT-GUIDE.md)
- [创作工坊执行指南](./WORKSHOP-EXECUTION-GUIDE.md)
- [架构文档](./ARCHITECTURE.md)
