# NovelForge MCP 配置指南

## 概述

NovelForge 现已支持 MCP (Model Context Protocol)，允许 Claude Desktop 直接访问小说数据。此功能从 v1.4.0 版本开始提供，v1.7.0 版本增强了伏笔查询功能。

## 支持的 MCP 工具

| 工具名 | 描述 | 参数 |
|--------|------|------|
| `queryNovels` | 查询小说列表 | `limit` - 返回数量限制 |
| `queryOutlines` | 查询指定小说的大纲结构 | `novelId` - 小说ID |
| `queryChapters` | 查询指定小说的章节列表 | `novelId` - 小说ID, `limit` - 返回数量 |
| `getChapterContent` | 获取指定章节的完整内容 | `chapterId` - 章节ID |
| `searchSemantic` | 语义搜索相关大纲、章节或角色 | `novelId` - 小说ID, `query` - 搜索文本, `topK` - 返回数量 |

## 前置要求

- NovelForge v1.4.0 或更高版本
- 已部署的 NovelForge 实例
- Vectorize 索引已创建（用于语义搜索功能）

## Claude Desktop 配置

### 1. 找到配置文件

根据你的操作系统，编辑 Claude Desktop 配置文件：

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### 2. 添加 MCP 服务器配置

```json
{
  "mcpServers": {
    "novelforge": {
      "command": "curl",
      "args": [
        "-X", "POST",
        "-H", "Content-Type: application/json",
        "-d", "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}",
        "https://your-domain.pages.dev/api/mcp"
      ]
    }
  }
}
```

或者使用 npx 方式（推荐开发环境）：

```json
{
  "mcpServers": {
    "novelforge": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-fetch",
        "https://your-domain.pages.dev/api/mcp"
      ]
    }
  }
}
```

### 3. 重启 Claude Desktop

保存配置后，完全退出并重新打开 Claude Desktop。

## 测试 MCP 连接

在 Claude Desktop 中，你可以这样测试：

```
请帮我列出所有小说
```

Claude 会调用 `queryNovels` 工具获取小说列表。

## MCP API 端点

### 直接调用示例

```bash
# 列出工具
curl -X POST https://your-domain.pages.dev/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }'

# 查询小说列表
curl -X POST https://your-domain.pages.dev/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "queryNovels",
      "arguments": {
        "limit": 10
      }
    }
  }'

# 语义搜索
curl -X POST https://your-domain.pages.dev/api/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "searchSemantic",
      "arguments": {
        "novelId": "your-novel-id",
        "query": "主角突破境界",
        "topK": 5
      }
    }
  }'
```

## 故障排除

### MCP 连接失败

1. 检查 `/api/mcp` 端点是否可访问：
   ```bash
   curl https://your-domain.pages.dev/api/mcp
   ```

2. 检查 Claude Desktop 日志：
   - **macOS**: `~/Library/Logs/Claude/mcp*.log`
   - **Windows**: `%APPDATA%\Claude\logs\mcp*.log`

### 工具调用失败

确保 Vectorize 索引已创建：
```bash
wrangler vectorize create novelforge-index --dimensions=768 --metric=cosine
```

## 安全注意事项

- MCP 端点目前无身份验证，建议在可信环境使用
- 生产环境建议添加 API Key 验证
- 敏感操作（如生成章节）暂不支持通过 MCP 调用
