# NovelForge · API 参考文档

> 完整的 REST API 接口文档，包含请求格式、响应结构和错误码说明。

---

## 📋 目录

- [基础信息](#基础信息)
- [认证方式](#认证方式)
- [通用响应格式](#通用响应格式)
- [公开接口](#公开接口)
- **用户认证 (Auth)**
  - [用户登录](#用户登录)
  - [用户注册](#用户注册)
  - [获取当前用户信息](#获取当前用户信息)
  - [修改密码](#修改密码)
  - [删除账号](#删除账号)
- **系统初始化 (Setup)**
  - [检查初始化状态](#检查初始化状态)
  - [创建管理员账号](#创建管理员账号)
- **邀请码管理 (Invite Codes)**
  - [获取邀请码列表](#获取邀请码列表)
  - [创建邀请码](#创建邀请码)
  - [更新邀请码状态](#更新邀请码状态)
  - [删除邀请码](#删除邀请码)
- **系统设置 (System Settings)**
  - [获取系统设置](#获取系统设置)
  - [更新注册开关](#更新注册开关)
- **小说管理 (Novels)**
  - [获取小说列表](#获取小说列表)
  - [获取小说详情](#获取小说详情)
  - [创建小说](#创建小说)
  - [更新小说](#更新小说)
  - [删除小说](#删除小说)
  - [恢复已删除小说](#恢复已删除小说)
  - [上传小说封面](#上传小说封面)
  - [获取回收站列表](#获取回收站列表)
  - [永久删除小说](#永久删除小说)
  - [获取小说回收站](#获取小说回收站)
  - [清空小说回收站](#清空小说回收站)
- **总纲管理 (Master Outline)**
  - [获取总纲](#获取总纲)
  - [获取总纲历史版本](#获取总纲历史版本)
  - [创建总纲](#创建总纲)
  - [更新总纲](#更新总纲)
  - [删除总纲](#删除总纲)
- **创作规则 (Writing Rules)**
  - [获取创作规则](#获取创作规则)
  - [创建创作规则](#创建创作规则)
  - [更新创作规则](#更新创作规则)
  - [删除创作规则](#删除创作规则)
  - [启用/禁用规则](#启用禁用规则)
- **小说设定 (Novel Settings)**
  - [获取设定树形结构](#获取设定树形结构)
  - [获取小说设定列表](#获取小说设定列表)
  - [获取单个设定](#获取单个设定)
  - [创建小说设定](#创建小说设定)
  - [AI生成设定摘要](#ai生成设定摘要)
  - [更新小说设定](#更新小说设定)
  - [删除小说设定](#删除小说设定)
- **卷管理 (Volumes)**
  - [获取卷列表](#获取卷列表)
  - [获取卷详情](#获取卷详情)
  - [创建卷](#创建卷)
  - [更新卷](#更新卷)
  - [删除卷](#删除卷)
- **章节管理 (Chapters)**
  - [获取章节列表](#获取章节列表)
  - [获取章节详情](#获取章节详情)
  - [创建章节](#创建章节)
  - [更新章节](#更新章节)
  - [删除章节](#删除章节)
  - [获取章节快照列表](#获取章节快照列表)
  - [恢复章节快照](#恢复章节快照)
- **角色管理 (Characters)**
  - [获取角色列表](#获取角色列表)
  - [获取角色详情](#获取角色详情)
  - [创建角色](#创建角色)
  - [更新角色](#更新角色)
  - [删除角色](#删除角色)
  - [上传角色图片](#上传角色图片)
- **伏笔管理 (Foreshadowing)**
  - [获取伏笔列表](#获取伏笔列表)
  - [创建伏笔](#创建伏笔)
  - [更新伏笔](#更新伏笔)
  - [删除伏笔](#删除伏笔)
  - [获取伏笔进度](#获取伏笔进度)
  - [获取沉寂伏笔](#获取沉寂伏笔)
  - [伏笔健康检查](#伏笔健康检查)
  - [伏笔推荐](#伏笔推荐)
  - [伏笔统计](#伏笔统计)
- **AI 生成 (Generate)**
  - [生成章节](#生成章节)
  - [生成章节摘要](#生成章节摘要)
  - [获取生成日志](#获取生成日志)
  - [角色一致性检查](#角色一致性检查)
  - [连贯性检查](#连贯性检查)
  - [组合检查](#组合检查)
  - [卷进度检查](#卷进度检查)
  - [预览上下文](#预览上下文)
  - [总纲摘要生成](#总纲摘要生成)
  - [卷摘要生成](#卷摘要生成)
  - [后台生成章节](#后台生成章节)
  - [获取最新检查日志](#获取最新检查日志)
  - [获取检查日志历史](#获取检查日志历史)
- **批量生成 (Batch)** - v2.1.0新增
  - [开始批量生成](#开始批量生成)
  - [获取批量任务详情](#获取批量任务详情)
  - [暂停批量任务](#暂停批量任务)
  - [恢复批量任务](#恢复批量任务)
  - [取消批量任务](#取消批量任务)
  - [获取小说活跃任务](#获取小说活跃任务)
- **质量评分 (Quality)** - v2.1.0新增
  - [获取章节评分](#获取章节评分)
  - [获取小说评分列表](#获取小说评分列表)
  - [获取质量检查汇总](#获取质量检查汇总) - v2.3.0新增
- **成本分析 (Cost Analysis)** - v2.3.0新增
  - [获取消耗统计总览](#获取消耗统计总览)
  - [获取每日消耗明细](#获取每日消耗明细)
  - [获取消耗趋势数据](#获取消耗趋势数据)
  - [获取分类分项明细](#获取分类分项明细)
- **境界管理 (Power Level)**
  - [检测境界突破](#检测境界突破)
  - [批量检测境界](#批量检测境界)
  - [获取境界历史](#获取境界历史)
  - [获取角色境界](#获取角色境界)
  - [验证境界一致性](#验证境界一致性)
  - [应用境界建议](#应用境界建议)
- **导出服务 (Export)**
  - [获取可用格式](#获取可用格式)
  - [导出小说](#导出小说)
- **内容搜索 (Search)**
  - [搜索章节内容](#搜索章节内容)
- **向量化索引 (Vectorize)**
  - [创建向量化索引](#创建向量化索引)
  - [删除向量化索引](#删除向量化索引)
  - [相似度搜索](#相似度搜索)
  - [获取向量统计](#获取向量统计)
  - [全量重建索引](#全量重建索引)
  - [增量索引未索引项](#增量索引未索引项)
- **实体索引 (Entity Index)**
  - [重建实体索引](#重建实体索引)
  - [获取子实体](#获取子实体)
  - [获取实体树](#获取实体树)
- **创意工坊 (Workshop)**
  - [创建会话](#创建会话)
  - [获取会话列表](#获取会话列表)
  - [获取会话详情](#获取会话详情)
  - [更新会话](#更新会话)
  - [发送消息](#发送消息)
  - [提交确认](#提交确认)
  - [删除会话](#删除会话)
- **工坊导入 (Workshop Import)**
  - [获取导入列表](#获取导入列表)
  - [导入数据](#导入数据)
  - [格式化导入](#格式化导入)
- **模型配置 (Model Config)**
  - [获取模型配置列表](#获取模型配置列表)
  - [创建模型配置](#创建模型配置)
  - [更新模型配置](#更新模型配置)
  - [启用/停用配置](#启用停用配置)
  - [删除模型配置](#删除模型配置)
- **MCP 服务 (MCP)**
  - [MCP 端点](#mcp-端点)
- [错误码参考](#错误码参考)

---

## 基础信息

### Base URL

```
开发环境：http://localhost:8788/api
生产环境：https://your-domain.pages.dev/api
```

### 请求头

```http
Content-Type: application/json
Authorization: Bearer <token>  # 如需认证
```

### 响应格式

所有 API 返回 JSON 格式数据。

---

## 通用响应格式

### 成功响应

```json
{
  "success": true,
  "data": { ... }
}
```

### 错误响应

```json
{
  "error": "错误消息",
  "code": "ERROR_CODE",
  "message": "详细错误信息"
}
```

### HTTP 状态码

| 状态码 | 含义 | 使用场景 |
|--------|------|----------|
| 200 | OK | 成功 |
| 201 | Created | 资源创建成功 |
| 204 | No Content | 删除成功 |
| 400 | Bad Request | 请求参数错误 |
| 401 | Unauthorized | 未授权 |
| 403 | Forbidden | 禁止访问 |
| 404 | Not Found | 资源不存在 |
| 409 | Conflict | 资源冲突 |
| 500 | Internal Server Error | 服务器错误 |

---

## 公开接口

> 以下接口**不需要认证**

### 用户登录

**POST** `/api/auth/login`

**请求体**:
```json
{
  "username": "noveluser",
  "password": "MySecurePass123"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名或邮箱 |
| password | string | ✅ | 密码 |

**成功响应 (200)**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "usr_abc123",
      "username": "noveluser",
      "email": "user@example.com",
      "role": "admin"
    }
  }
}
```

---

### 用户注册

**POST** `/api/auth/register`

**请求体**:
```json
{
  "username": "noveluser",
  "email": "user@example.com",
  "password": "MySecurePass123",
  "inviteCode": "optional-invite-code"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | ✅ | 用户名（3-20字符，字母数字下划线） |
| email | string | ✅ | 邮箱地址 |
| password | string | ✅ | 密码（至少8位，需包含大小写字母和数字） |
| inviteCode | string | 否 | 邀请码 |

**成功响应 (201)**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "usr_abc123",
      "username": "noveluser",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

---

### 获取注册状态

**GET** `/api/system-settings/registration`

**响应示例**:
```json
{
  "success": true,
  "data": {
    "registrationEnabled": true
  }
}
```

---

### 向量服务状态

**GET** `/api/vectorize/status`

**响应示例**:
```json
{
  "status": "ok",
  "message": "所有服务正常运行",
  "embeddingModel": "@cf/baai/bge-m3",
  "dimensions": 1024
}
```

---

### 健康检查

**GET** `/api/health`

**响应示例**:
```json
{
  "status": "ok",
  "version": "3.1"
}
```

---

## 用户认证 (Auth)

> 以下端点**需要 JWT 认证**（除登录和注册外）

### 获取当前用户信息

**GET** `/api/auth/me`

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "usr_abc123",
    "username": "noveluser",
    "email": "user@example.com",
    "role": "admin",
    "status": "active",
    "created_at": 1713571200,
    "last_login_at": 1713657600
  }
}
```

---

### 修改密码

**PUT** `/api/auth/password`

**请求体**:
```json
{
  "currentPassword": "OldPassword123",
  "newPassword": "NewPassword456"
}
```

**成功响应 (200)**:
```json
{
  "success": true,
  "message": "密码修改成功"
}
```

---

### 删除账号

**DELETE** `/api/auth/account`

**成功响应 (200)**:
```json
{
  "success": true,
  "message": "账号已成功删除"
}
```

---

## 系统初始化 (Setup)

> 需要 API Key 认证

### 检查初始化状态

**GET** `/api/setup/status`

**响应示例**:
```json
{
  "success": true,
  "data": {
    "initialized": true,
    "adminExists": true
  }
}
```

---

### 创建管理员账号

**POST** `/api/setup`

**请求体**:
```json
{
  "username": "admin",
  "email": "admin@example.com",
  "password": "AdminPassword123"
}
```

**成功响应 (201)**:
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "usr_admin1",
      "username": "admin",
      "email": "admin@example.com",
      "role": "admin"
    }
  },
  "message": "管理员账号创建成功！欢迎来到 NovelForge"
}
```

---

## 邀请码管理 (Invite Codes)

> **需要认证**: 所有端点都需要 `Admin` 权限

### 获取邀请码列表

**GET** `/api/invite-codes`

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| status | string | - | 过滤状态：active/used/expired/disabled |
| page | number | 1 | 页码 |
| pageSize | number | 20 | 每页数量（最大100） |

**响应示例**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "ic_abc123",
        "code": "ABCD1234",
        "maxUses": 10,
        "usedCount": 3,
        "status": "active",
        "expiresAt": null,
        "createdBy": "usr_admin1",
        "created_at": 1713571200,
        "updated_at": 1713571300
      }
    ],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

---

### 创建邀请码

**POST** `/api/invite-codes`

**请求体**:
```json
{
  "maxUses": 10,
  "expiresInDays": 30
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| maxUses | number | 否 | 最大使用次数（默认 1） |
| expiresInDays | number | 否 | 有效期天数（默认 null，永不过期） |

**成功响应 (201)**:
```json
{
  "success": true,
  "data": {
    "id": "ic_abc123",
    "code": "ABCD1234",
    "maxUses": 10,
    "usedCount": 0,
    "status": "active",
    "expiresAt": 1741147200,
    "createdBy": "usr_admin1",
    "created_at": 1713571200,
    "updated_at": 1713571200
  }
}
```

---

### 更新邀请码状态

**PATCH** `/api/invite-codes/:id/status`

**请求体**:
```json
{
  "status": "disabled"
}
```

**成功响应 (200)**:
```json
{
  "success": true,
  "message": "邀请码已禁用"
}
```

---

### 删除邀请码

**DELETE** `/api/invite-codes/:id`

**成功响应 (200)**:
```json
{
  "success": true,
  "message": "邀请码已删除"
}
```

---

## 系统设置 (System Settings)

### 获取系统设置

**GET** `/api/system-settings`

> **需要认证**

**响应示例**:
```json
{
  "success": true,
  "data": [
    {
      "key": "registration_enabled",
      "value": "true",
      "description": "是否允许公开注册",
      "updated_at": 1713571200
    }
  ]
}
```

---

### 更新注册开关

**PUT** `/api/system-settings/registration`

> **需要 Admin 权限**

**请求体**:
```json
{
  "enabled": true
}
```

**成功响应 (200)**:
```json
{
  "success": true,
  "data": {
    "registrationEnabled": true
  },
  "message": "注册功能已开启"
}
```

---

## 小说管理 (Novels)

### 获取小说列表

**GET** `/api/novels`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| page | number | 1 | 页码 |
| perPage | number | 20 | 每页数量（1-100） |
| status | string | - | 状态过滤：draft/writing/completed/archived |
| genre | string | - | 类型过滤 |

**响应示例**:
```json
{
  "data": [
    {
      "id": "abc123def456",
      "title": "混沌元尊",
      "description": "一个关于修炼与成神的故事...",
      "genre": "玄幻",
      "status": "writing",
      "coverR2Key": null,
      "wordCount": 125000,
      "chapterCount": 42,
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ],
  "total": 10,
  "page": 1,
  "perPage": 20
}
```

---

### 获取小说详情

**GET** `/api/novels/:id`

> **需要认证**

**响应**: 同小说列表中的单个对象

---

### 创建小说

**POST** `/api/novels`

> **需要认证**

**请求体**:
```json
{
  "title": "小说标题",
  "description": "简介",
  "genre": "玄幻",
  "status": "draft",
  "targetWordCount": 100000,
  "systemPrompt": "可选的小说专属System Prompt，用于章节生成时的额外约束"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | ✅ | 小说标题（1-200字符） |
| description | string | 否 | 小说简介 |
| genre | string | 否 | 小说类型 |
| status | string | 否 | 状态：draft/writing/completed/archived |
| targetWordCount | number | 否 | 目标字数 |
| systemPrompt | string | 否 | 小说专属System Prompt（v1.10.0新增） |

**成功响应 (201)**:
```json
{
  "id": "new123novel456",
  "title": "小说标题",
  "description": "简介",
  "genre": "玄幻",
  "status": "draft",
  "wordCount": 0,
  "chapterCount": 0,
  "createdAt": 1713571200,
  "updatedAt": 1713657600
}
```

---

### 更新小说

**PATCH** `/api/novels/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新标题",
  "description": "新简介",
  "genre": "仙侠",
  "status": "completed",
  "systemPrompt": "可选的小说专属System Prompt（v1.10.0新增）"
}
```

**更新字段说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 否 | 小说标题 |
| description | string | 否 | 小说简介 |
| genre | string | 否 | 小说类型 |
| status | string | 否 | 状态：draft/writing/completed/archived |
| targetWordCount | number | 否 | 目标字数 |
| targetChapterCount | number | 否 | 目标章节数 |
| systemPrompt | string | 否 | 小说专属System Prompt（v1.10.0新增） |

---

### 删除小说

**DELETE** `/api/novels/:id`

> **需要认证**

**说明**: 软删除，数据不会真正删除

**响应**:
```json
{
  "ok": true
}
```

---

### 恢复已删除小说

**PATCH** `/api/novels/:id/restore`

> **需要认证**

**响应**:
```json
{
  "id": "abc123def456",
  "title": "混沌元尊",
  "status": "writing",
  "deletedAt": null,
  "updatedAt": 1713657600
}
```

---

### 上传小说封面

**POST** `/api/novels/:id/cover`

> **需要认证**

**Content-Type**: `multipart/form-data`

**表单字段**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | File | ✅ | 图片文件 |

**响应示例**:
```json
{
  "ok": true,
  "coverUrl": "/api/novels/abc123def456/cover"
}
```

---

### 获取回收站列表

**GET** `/api/novels/trash`

> **需要认证**

**响应示例**:
```json
{
  "ok": true,
  "novels": [
    {
      "id": "deleted123",
      "title": "已删除的小说",
      "genre": "玄幻",
      "status": "writing",
      "wordCount": 50000,
      "chapterCount": 20,
      "deletedAt": 1713657600,
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ],
  "total": 1
}
```

---

### 永久删除小说

**DELETE** `/api/novels/trash?id=novelId`

> **需要认证**

**说明**: 彻底删除小说本身，并级联清理所有关联数据

**响应**:
```json
{
  "ok": true,
  "deleted": 1
}
```

---

### 获取小说回收站

**GET** `/api/novels/:id/trash`

> **需要认证**

**响应示例**:
```json
{
  "ok": true,
  "tables": [
    { "key": "chapters", "label": "章节", "icon": "BookOpen", "count": 5, "items": [...] },
    { "key": "characters", "label": "角色", "icon": "Users", "count": 3, "items": [...] }
  ],
  "total": 8
}
```

---

### 清空小说回收站

**DELETE** `/api/novels/:id/trash`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| table | string | 可选，指定表名（chapters/characters/settings/outlines/volumes/foreshadowing/rules） |

**响应**:
```json
{
  "ok": true,
  "deleted": 8
}
```

---

## 总纲管理 (Master Outline)

### 获取总纲

**GET** `/api/master-outline/:novelId`

> **需要认证**

**响应示例**:
```json
{
  "exists": true,
  "outline": {
    "id": "mo123",
    "novelId": "novel456",
    "title": "混沌元尊总纲",
    "content": "# 故事概述\n\n主角林风...",
    "version": 3,
    "summary": "一个少年从凡人成长为元尊的故事",
    "wordCount": 5000,
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
}
```

---

### 获取总纲历史版本

**GET** `/api/master-outline/:novelId/history`

> **需要认证**

**响应示例**:
```json
{
  "history": [
    {
      "id": "mo123",
      "version": 3,
      "title": "混沌元尊总纲",
      "summary": "一个少年从凡人成长为元尊的故事",
      "wordCount": 5000,
      "createdAt": 1713657600
    }
  ]
}
```

---

### 创建总纲

**POST** `/api/master-outline`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "title": "混沌元尊总纲",
  "content": "# 故事概述\n\n...",
  "summary": "简短摘要"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| title | string | ✅ | 总纲标题（1-200字符） |
| content | string | ✅ | 总纲内容（至少10字符） |
| summary | string | 否 | 总纲摘要（最多500字符） |

**说明**: 每次创建会自动递增版本号

**成功响应 (201)**:
```json
{
  "ok": true,
  "outline": {
    "id": "mo123",
    "novelId": "novel456",
    "title": "混沌元尊总纲",
    "version": 1,
    "createdAt": 1713571200
  }
}
```

---

### 更新总纲

**PUT** `/api/master-outline/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新标题",
  "content": "新内容...",
  "summary": "新摘要"
}
```

**成功响应 (200)**:
```json
{
  "ok": true,
  "outline": { ... }
}
```

---

### 删除总纲

**DELETE** `/api/master-outline/:id`

> **需要认证**

**说明**: 软删除

**响应**:
```json
{
  "ok": true
}
```

---

## 创作规则 (Writing Rules)

### 获取创作规则

**GET** `/api/rules/:novelId`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 按类别过滤：style/pacing/character/plot/world/taboo/custom |
| activeOnly | boolean | 否 | 仅返回启用的规则 |

**响应示例**:
```json
{
  "rules": [
    {
      "id": "rule123",
      "novelId": "novel456",
      "category": "style",
      "title": "文风要求",
      "content": "使用古风语言，避免现代词汇",
      "priority": 1,
      "isActive": 1,
      "sortOrder": 0,
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ]
}
```

---

### 创建创作规则

**POST** `/api/rules`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "category": "style",
  "title": "文风要求",
  "content": "使用古风语言，避免现代词汇...",
  "priority": 1,
  "sortOrder": 0
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| category | string | ✅ | 类别：style/pacing/character/plot/world/taboo/custom |
| title | string | ✅ | 规则标题（1-100字符） |
| content | string | ✅ | 规则内容 |
| priority | number | 否 | 优先级（1-5，默认3） |
| sortOrder | number | 否 | 排序顺序（默认0） |

**成功响应 (201)**:
```json
{
  "ok": true,
  "rule": { ... }
}
```

---

### 更新创作规则

**PUT** `/api/rules/:id`

> **需要认证**

**请求体**:
```json
{
  "category": "style",
  "title": "新标题",
  "content": "新内容",
  "priority": 2,
  "isActive": 1
}
```

**成功响应 (200)**:
```json
{
  "ok": true,
  "rule": { ... }
}
```

---

### 删除创作规则

**DELETE** `/api/rules/:id`

> **需要认证**

**说明**: 软删除

**响应**:
```json
{
  "ok": true
}
```

---

### 启用/禁用规则

**PATCH** `/api/rules/:id/toggle`

> **需要认证**

**响应示例**:
```json
{
  "ok": true,
  "isActive": 0
}
```

---

## 小说设定 (Novel Settings)

### 获取设定树形结构

**GET** `/api/settings/tree/:novelId`

> **需要认证**

**响应示例**:
```json
{
  "tree": [
    {
      "id": "set123",
      "novelId": "novel456",
      "type": "power_system",
      "name": "境界体系",
      "children": [
        {
          "id": "set124",
          "name": "炼气期",
          "children": []
        }
      ]
    }
  ],
  "stats": {
    "power_system": 5,
    "worldview": 2
  },
  "total": 10
}
```

---

### 获取小说设定列表

**GET** `/api/settings/:novelId`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 设定类型：worldview/power_system/faction/geography/item_skill/misc |
| category | string | 否 | 分类过滤 |
| importance | string | 否 | 重要程度：high/normal/low |
| limit | number | 否 | 返回数量限制（默认50） |
| offset | number | 否 | 偏移量（默认0） |

**响应示例**:
```json
{
  "settings": [
    {
      "id": "set123",
      "novelId": "novel456",
      "type": "power_system",
      "category": "修仙境界",
      "name": "境界体系",
      "content": "炼气期 → 筑基期 → 金丹期 → 元婴期...",
      "summary": "炼气期 → 筑基期 →...",
      "importance": "high",
      "sortOrder": 0,
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ],
  "total": 10,
  "limit": 50,
  "offset": 0
}
```

---

### 获取单个设定

**GET** `/api/settings/:novelId/:id`

> **需要认证**

**响应示例**:
```json
{
  "setting": {
    "id": "set123",
    "novelId": "novel456",
    "type": "power_system",
    "name": "境界体系",
    "content": "炼气期 → 筑基期 → ...",
    ...
  }
}
```

---

### 创建小说设定

**POST** `/api/settings`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "type": "power_system",
  "category": "修仙境界",
  "name": "境界体系",
  "content": "炼气期 → 筑基期 → 金丹期...",
  "summary": "炼气期 → 筑基期 → ...",
  "attributes": "{\"levels\": 9}",
  "parentId": null,
  "importance": "high",
  "relatedIds": "[\"set124\", \"set125\"]"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| type | string | ✅ | 设定类型 |
| name | string | ✅ | 设定名称（1-100字符） |
| content | string | ✅ | 设定内容 |
| category | string | 否 | 分类 |
| attributes | string | 否 | 属性JSON |
| parentId | string | 否 | 父设定ID |
| importance | string | 否 | 重要程度：high/normal/low |
| relatedIds | string | 否 | 关联ID列表JSON |

**成功响应 (201)**:
```json
{
  "ok": true,
  "setting": { ... }
}
```

---

### AI生成设定摘要

**POST** `/api/settings/:id/generate-summary`

> **需要认证**

**响应示例**:
```json
{
  "ok": true,
  "summary": "这是一个关于修仙境界的设定，包含从炼气期到元婴期的完整修炼体系..."
}
```

---

### 更新小说设定

**PUT** `/api/settings/:id`

> **需要认证**

**请求体**:
```json
{
  "type": "power_system",
  "category": "修仙境界",
  "name": "新名称",
  "content": "新内容...",
  "importance": "normal"
}
```

**成功响应 (200)**:
```json
{
  "ok": true,
  "setting": { ... }
}
```

---

### 删除小说设定

**DELETE** `/api/settings/:id`

> **需要认证**

**说明**: 软删除

**响应**:
```json
{
  "ok": true
}
```

---

## 卷管理 (Volumes)

### 获取卷列表

**GET** `/api/volumes?novelId=:novelId`

> **需要认证**

**响应示例**:
```json
[
  {
    "id": "vol123",
    "novelId": "novel456",
    "title": "第一卷：初出茅庐",
    "sortOrder": 1,
    "outline": "# 第一卷大纲\n\n本卷讲述主角的出身...",
    "blueprint": "{\"chapters\": 20, \"targetWords\": 50000}",
    "summary": "本章讲述了主角的出身...",
    "wordCount": 50000,
    "chapterCount": 20,
    "targetWordCount": 60000,
    "status": "writing",
    "notes": "作者笔记",
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
]
```

---

### 获取卷详情

**GET** `/api/volumes/:id`

> **需要认证**

---

### 创建卷

**POST** `/api/volumes`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "title": "第一卷：初出茅庐",
  "sortOrder": 1,
  "eventLine": "[\"主角出生\", \"发现天赋\", \"拜入宗门\"]",
  "blueprint": "{\"chapters\": 20, \"targetWords\": 50000}",
  "summary": "本章讲述了主角的出身...",
  "notes": "作者笔记",
  "status": "draft",
  "targetWordCount": 60000
}
```

---

### 更新卷

**PATCH** `/api/volumes/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新的卷名",
  "summary": "新的摘要",
  "status": "completed"
}
```

---

### 删除卷

**DELETE** `/api/volumes/:id`

> **需要认证**

**说明**: 软删除，关联章节不会被删除但会解除关联

**响应**:
```json
{
  "ok": true
}
```

---

## 章节管理 (Chapters)

### 获取章节列表

**GET** `/api/chapters?novelId=:novelId`

> **需要认证**

**响应示例**:
```json
[
  {
    "id": "chap123",
    "novelId": "novel456",
    "volumeId": "vol789",
    "title": "第一章：少年林风",
    "sortOrder": 1,
    "content": "<p>这里是章节内容...</p>",
    "wordCount": 3500,
    "status": "generated",
    "modelUsed": "doubao-seed-2-pro",
    "summary": "本章介绍了主角林风的背景...",
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
]
```

---

### 获取章节详情

**GET** `/api/chapters/:id`

> **需要认证**

---

### 创建章节

**POST** `/api/chapters`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "volumeId": "vol789",
  "title": "第一章：少年林风",
  "sortOrder": 1,
  "content": null
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 所属小说ID |
| volumeId | string | 否 | 所属卷ID |
| title | string | ✅ | 章节标题 |
| sortOrder | number | 否 | 排序顺序 |
| content | string | 否 | 章节内容（初始可为空） |

**成功响应 (201)**:
```json
{
  "id": "chap123",
  "novelId": "novel456",
  ...
}
```

---

### 更新章节

**PATCH** `/api/chapters/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新的标题",
  "content": "<p>新的内容...</p>",
  "status": "revised",
  "summary": "章节摘要..."
}
```

---

### 删除章节

**DELETE** `/api/chapters/:id`

> **需要认证**

**响应**:
```json
{
  "ok": true
}
```

---

### 获取章节快照列表

**GET** `/api/chapters/:id/snapshots`

> **需要认证**

**响应示例**:
```json
{
  "snapshots": [
    {
      "key": "snapshots/novel456/chap123/1713571200000.txt",
      "timestamp": 1713571200000,
      "preview": "这里是章节内容的前200个字符..."
    }
  ]
}
```

---

### 恢复章节快照

**POST** `/api/chapters/:id/restore`

> **需要认证**

**请求体**:
```json
{
  "key": "snapshots/novel456/chap123/1713571200000.txt"
}
```

**响应**:
```json
{
  "ok": true,
  "content": "恢复的章节内容..."
}
```

---

## 角色管理 (Characters)

### 获取角色列表

**GET** `/api/characters?novelId=:novelId`

> **需要认证**

**响应示例**:
```json
[
  {
    "id": "char123",
    "novelId": "novel456",
    "name": "林风",
    "aliases": "['小风', '风少']",
    "role": "protagonist",
    "description": "一位天赋异禀的少年...",
    "imageR2Key": "characters/novel456/char123/1713571200.jpg",
    "attributes": "{\"age\": 16, \"height\": 175, \"cultivation\": \"筑基初期\"}",
    "powerLevel": null,
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
]
```

---

### 获取角色详情

**GET** `/api/characters/:id`

> **需要认证**

---

### 创建角色

**POST** `/api/characters`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "name": "林风",
  "aliases": "['小风', '风少']",
  "role": "protagonist",
  "description": "角色描述",
  "attributes": "{\"age\": 16, \"height\": 175}",
  "powerLevel": "{\"system\":\"修仙\",\"current\":\"筑基初期\"}"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| name | string | ✅ | 角色名称 |
| aliases | string | 否 | 角色别名（JSON数组字符串） |
| role | string | 否 | 角色定位 |
| description | string | 否 | 角色描述 |
| attributes | string | 否 | 角色属性（JSON对象字符串） |
| powerLevel | string | 否 | 境界信息（JSON对象字符串） |

---

### 更新角色

**PATCH** `/api/characters/:id`

> **需要认证**

**请求体**:
```json
{
  "name": "新名字",
  "description": "新的描述",
  "role": "antagonist",
  "powerLevel": "{\"system\":\"修仙\",\"current\":\"金丹初期\"}"
}
```

---

### 删除角色

**DELETE** `/api/characters/:id`

> **需要认证**

**响应**:
```json
{
  "ok": true
}
```

---

### 上传角色图片

**POST** `/api/characters/:id/image`

> **需要认证**

**Content-Type**: `multipart/form-data`

**表单字段**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image | File | ✅ | 图片文件（最大5MB，支持 jpeg/png/gif/webp） |

**响应示例**:
```json
{
  "ok": true,
  "imageUrl": "https://pub-xxx.r2.dev/characters/novel456/char123/1713571200.jpg",
  "imageKey": "characters/novel456/char123/1713571200.jpg"
}
```

---

## 伏笔管理 (Foreshadowing)

### 获取伏笔列表

**GET** `/api/foreshadowing/:novelId`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 按状态过滤：open/resolved/abandoned |
| limit | number | 否 | 返回数量限制（默认50） |

**响应示例**:
```json
{
  "foreshadowing": [
    {
      "id": "fs123",
      "novelId": "novel456",
      "chapterId": "chap789",
      "title": "神秘玉佩的来历",
      "description": "主角捡到的玉佩似乎隐藏着重大秘密",
      "status": "open",
      "importance": "high",
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ]
}
```

---

### 创建伏笔

**POST** `/api/foreshadowing`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "chapterId": "chap789",
  "title": "神秘玉佩的来历",
  "description": "主角捡到的玉佩似乎隐藏着重大秘密",
  "importance": "high"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| chapterId | string | 否 | 埋下伏笔的章节 |
| title | string | ✅ | 伏笔标题（1-100字符） |
| description | string | 否 | 伏笔描述（最多1000字符） |
| importance | string | 否 | 重要程度：high/normal/low（默认normal） |

---

### 更新伏笔

**PUT** `/api/foreshadowing/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新标题",
  "description": "新描述",
  "importance": "normal",
  "status": "resolved",
  "resolvedChapterId": "chap800"
}
```

---

### 删除伏笔

**DELETE** `/api/foreshadowing/:id`

> **需要认证**

**说明**: 软删除

**响应**:
```json
{
  "ok": true
}
```

---

### 获取伏笔进度

**GET** `/api/foreshadowing/:id/progress`

> **需要认证**

**响应示例**:
```json
{
  "progresses": [
    {
      "id": "fp123",
      "chapterId": "chap789",
      "chapterTitle": "第三章：突破筑基",
      "progressType": "mention",
      "summary": "林风开始怀疑天雷珠的来历",
      "createdAt": 1713763200
    }
  ]
}
```

---

### 获取沉寂伏笔

**GET** `/api/foreshadowing/:novelId/stale`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| threshold | number | 10 | N章无推进被视为沉寂 |

**响应示例**:
```json
{
  "foreshadowing": [
    {
      "id": "fs123",
      "title": "神秘玉佩的来历",
      "description": "...",
      "importance": "high",
      "status": "open",
      "chapterId": "chap100",
      "createdAt": 1713571200
    }
  ],
  "threshold": 10
}
```

---

### 伏笔健康检查

**POST** `/api/foreshadowing/:novelId/check`

> **需要认证**

**请求体**:
```json
{
  "recentChaptersCount": 5,
  "staleThreshold": 10
}
```

**响应示例**:
```json
{
  "total": 15,
  "open": 10,
  "resolved": 3,
  "abandoned": 2,
  "resolutionRate": 60,
  "staleCount": 2,
  "healthScore": 85
}
```

---

### 伏笔推荐

**POST** `/api/foreshadowing/:novelId/suggest`

> **需要认证**

**请求体**:
```json
{
  "chapterContext": "林风与师妹在山谷中遭遇妖兽袭击...",
  "topK": 5
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapterContext | string | ✅ | 当前章节场景描述（至少5字符） |
| topK | number | 否 | 返回推荐数量（默认5） |

**响应示例**:
```json
{
  "suggestions": [
    {
      "id": "fs123",
      "title": "神秘玉佩的来历",
      "importance": "high",
      "score": 0.85
    }
  ],
  "query": "林风与师妹在山谷中..."
}
```

---

### 伏笔统计

**GET** `/api/foreshadowing/:novelId/stats`

> **需要认证**

**响应示例**:
```json
{
  "overview": {
    "total": 15,
    "open": 10,
    "resolved": 3,
    "abandoned": 2,
    "resolutionRate": 60,
    "avgLifespan": 8
  },
  "byImportance": {
    "high": { "total": 5, "open": 3, "resolved": 2 },
    "normal": { "total": 8, "open": 6, "resolved": 1 },
    "low": { "total": 2, "open": 1, "resolved": 0 }
  },
  "byAge": [
    { "range": "1-3章", "count": 5, "ids": ["fs1", "fs2"] },
    { "range": "4-10章", "count": 4, "ids": ["fs3"] },
    { "range": "11-20章", "count": 3, "ids": [] },
    { "range": "20章+", "count": 3, "ids": [] }
  ],
  "hotChapters": [
    {
      "chapterId": "chap50",
      "chapterTitle": "决战前夕",
      "plantedCount": 3,
      "resolvedCount": 1,
      "progressedCount": 2
    }
  ]
}
```

---

## AI 生成 (Generate)

### 生成章节

**POST** `/api/generate/chapter`

> **需要认证**

**Content-Type**: `application/json`

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456",
  "mode": "generate",
  "existingContent": "",
  "targetWords": 3000,
  "issuesContext": [],
  "options": {
    "enableRAG": true,
    "enableAutoSummary": true
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapterId | string | ✅ | 章节ID |
| novelId | string | ✅ | 小说ID |
| mode | string | 否 | 生成模式：generate/continue/rewrite（默认generate） |
| existingContent | string | 否 | 现有内容（续写/重写模式需要） |
| targetWords | number | 否 | 目标字数（500-8000） |
| issuesContext | string[] | 否 | 问题上下文 |
| options.enableRAG | boolean | 否 | 是否启用RAG（默认true） |
| options.enableAutoSummary | boolean | 否 | 是否自动生成摘要（默认true） |

**响应类型**: `text/event-stream` (SSE 流)

**SSE 数据格式**:
```
data: {"content": "林风深吸一口气..."}

data: {"type":"tool_call","name":"search_context","args":{...},"result":"..."}

data: {"type":"done","usage":{"prompt_tokens":2500,"completion_tokens":3200}}

data: [DONE]
```

---

### 生成章节摘要

**POST** `/api/generate/summary`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456"
}
```

**响应**:
```json
{
  "ok": true,
  "message": "Summary generation triggered"
}
```

---

### 获取生成日志

**GET** `/api/generate/logs`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 否 | 小说ID过滤 |
| limit | number | 否 | 返回条数限制（默认50） |

**响应示例**:
```json
{
  "logs": [
    {
      "id": "log123",
      "novelId": "novel456",
      "chapterId": "chap123",
      "stage": "chapter_gen",
      "modelId": "doubao-seed-2-pro",
      "promptTokens": 2500,
      "completionTokens": 3200,
      "durationMs": 8500,
      "status": "success",
      "createdAt": 1713657600
    }
  ]
}
```

---

### 角色一致性检查

**POST** `/api/generate/check`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "characterIds": ["char1", "char2"],
  "novelId": "novel456"
}
```

**响应示例**:
```json
{
  "conflicts": [],
  "warnings": [
    {
      "characterName": "林风",
      "warning": "性格表现略有前后不一致",
      "excerpt": "林风性格坚毅，但在第15章..."
    }
  ]
}
```

---

### 连贯性检查

**POST** `/api/generate/coherence-check`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456"
}
```

**响应示例**:
```json
{
  "score": 85,
  "issues": [
    {
      "severity": "warning",
      "category": "foreshadowing",
      "message": "伏笔'天雷珠之谜'尚未收尾",
      "suggestion": "建议在后续章节中揭示天雷珠的来历"
    }
  ]
}
```

---

### 组合检查

**POST** `/api/generate/combined-check`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456",
  "characterIds": ["char1", "char2", "char3"]
}
```

**响应示例**:
```json
{
  "score": 78,
  "characterCheck": {
    "conflicts": [],
    "warnings": []
  },
  "coherenceCheck": {
    "score": 85,
    "issues": [...]
  },
  "hasIssues": true
}
```

---

### 卷进度检查

**POST** `/api/generate/volume-progress-check`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456"
}
```

**响应示例**:
```json
{
  "healthStatus": "warning",
  "currentChapter": 15,
  "targetChapters": 20,
  "currentWords": 45000,
  "targetWords": 50000,
  "issues": [
    {
      "type": " pacing",
      "message": "当前卷节奏偏慢，建议加快剧情推进"
    }
  ]
}
```

---

### 预览上下文

**POST** `/api/generate/preview-context`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "chapterId": "chap123"
}
```

**响应示例**:
```json
{
  "ok": true,
  "buildTimeMs": 234,
  "summary": {
    "totalLayers": 12,
    "coreLayerCount": 6,
    "dynamicLayerCount": 6,
    "ragResultCount": 8
  }
}
```

---

### 总纲摘要生成

**POST** `/api/generate/master-outline-summary`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456"
}
```

**响应**:
```json
{
  "ok": true,
  "summary": "一个少年从凡人成长为元尊的故事..."
}
```

---

### 卷摘要生成

**POST** `/api/generate/volume-summary`

> **需要认证**

**请求体**:
```json
{
  "volumeId": "vol123",
  "novelId": "novel456"
}
```

**响应**:
```json
{
  "ok": true,
  "summary": "本卷讲述了主角从炼气期突破到筑基期的过程..."
}
```

---

### 后台生成章节

**POST** `/api/generate/chapter/queue`

> **需要认证**

**说明**: 将章节生成任务提交到后台队列，立即返回，用户可关闭页面

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456",
  "mode": "generate",
  "targetWords": 3000,
  "options": {
    "enableRAG": true,
    "enableAutoSummary": true
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapterId | string | ✅ | 章节ID |
| novelId | string | ✅ | 小说ID |
| mode | string | 否 | 生成模式：generate/continue/rewrite（默认generate） |
| targetWords | number | 否 | 目标字数（500-8000） |
| options.enableRAG | boolean | 否 | 是否启用RAG（默认true） |
| options.enableAutoSummary | boolean | 否 | 是否自动生成摘要（默认true） |

**响应示例**:
```json
{
  "ok": true,
  "message": "章节生成任务已提交到后台队列",
  "taskId": "queue_task_abc123"
}
```

---

### 获取最新检查日志

**GET** `/api/generate/check-logs/latest`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapterId | string | ✅ | 章节ID |
| checkType | string | 否 | 检查类型过滤 |

**响应**:
```json
{
  "log": {
    "id": "log123",
    "chapterId": "chap123",
    "checkType": "combined",
    "score": 78,
    "status": "success",
    "createdAt": 1713657600
  }
}
```

---

### 获取检查日志历史

**GET** `/api/generate/check-logs/history`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| chapterId | string | ✅ | 章节ID |
| checkType | string | 否 | 检查类型过滤 |
| limit | number | 否 | 返回条数限制（默认20） |

**响应**:
```json
{
  "logs": [...]
}
```

---

## 批量生成 (Batch)

> v2.1.0 新增 - 批量章节生成系统

### 开始批量生成

**POST** `/api/batch/start`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "volumeId": "vol123",
  "targetCount": 5,
  "startFromNext": true,
  "startChapterOrder": 10
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| volumeId | string | ✅ | 卷ID |
| targetCount | number | ✅ | 要生成的章节数（1-200） |
| startFromNext | boolean | 否 | 是否从下一章开始（默认true） |
| startChapterOrder | number | 否 | 指定起始章节序号 |

**响应示例**:
```json
{
  "id": "batch_task_abc123",
  "novelId": "novel456",
  "volumeId": "vol123",
  "status": "pending",
  "targetCount": 5,
  "completedCount": 0,
  "createdAt": 1714348800
}
```

---

### 获取批量任务详情

**GET** `/api/batch/:taskId`

> **需要认证**

**响应示例**:
```json
{
  "id": "batch_task_abc123",
  "novelId": "novel456",
  "volumeId": "vol123",
  "status": "running",
  "targetCount": 5,
  "completedCount": 2,
  "failedCount": 0,
  "createdAt": 1714348800,
  "startedAt": 1714348801,
  "completedAt": null,
  "lastError": null
}
```

**任务状态说明**:
| 状态 | 说明 |
|------|------|
| `pending` | 等待执行 |
| `running` | 执行中 |
| `paused` | 已暂停 |
| `done` | 已完成 |
| `cancelled` | 已取消 |
| `failed` | 失败 |

---

### 暂停批量任务

**POST** `/api/batch/:taskId/pause`

> **需要认证**

**响应示例**:
```json
{
  "ok": true
}
```

---

### 恢复批量任务

**POST** `/api/batch/:taskId/resume`

> **需要认证**

**响应示例**:
```json
{
  "ok": true
}
```

---

### 取消批量任务

**DELETE** `/api/batch/:taskId`

> **需要认证**

**响应示例**:
```json
{
  "ok": true
}
```

---

### 获取小说活跃任务

**GET** `/api/batch/novels/:id/active`

> **需要认证**

**响应示例**:
```json
{
  "id": "batch_task_abc123",
  "status": "running",
  "volumeId": "vol123",
  "targetCount": 5,
  "completedCount": 2,
  "createdAt": 1714348800
}
```

> 如果没有活跃任务，返回 `null`

---

## 质量评分 (Quality)

> v2.1.0 新增 - 多维度章节质量评分系统

### 获取章节评分

**GET** `/api/quality/chapter/:chapterId`

> **需要认证**

**响应示例**:
```json
{
  "id": "qs_abc123",
  "chapterId": "chap123",
  "novelId": "novel456",
  "totalScore": 82,
  "plotScore": 85,
  "consistencyScore": 80,
  "foreshadowingScore": 78,
  "pacingScore": 83,
  "fluencyScore": 84,
  "details": {...},
  "createdAt": 1714348800
}
```

> 如果章节没有评分，返回 `null`

---

### 获取小说评分列表

**GET** `/api/quality/novel/:novelId`

> **需要认证**

**响应示例**:
```json
[
  {
    "id": "qs_abc123",
    "chapterId": "chap123",
    "novelId": "novel456",
    "totalScore": 82,
    "createdAt": 1714348800
  }
]
```

---

### 获取质量检查汇总

**GET** `/api/quality/summary`

> v2.3.0 新增 - 聚合多章质量检查结果

> **需要认证**

**查询参数**:
- `novelId` (必填) - 小说ID
- `limit` (可选) - 返回章节数限制，默认 10，最大 50

**响应示例**:
```json
{
  "chapters": [
    {
      "id": "chap123",
      "chapterNumber": 10,
      "title": "第十章 宗门试炼",
      "coherenceScore": 85,
      "characterScore": 78,
      "progressScore": 82,
      "overallScore": 82,
      "issueCount": 2,
      "lastCheckedAt": 1714348800,
      "issues": [
        {
          "severity": "warning",
          "category": "character_consistency",
          "message": "角色'林风'在前后描述中境界不一致"
        }
      ]
    }
  ],
  "averages": {
    "coherence": 83,
    "character": 79,
    "progress": 81,
    "overall": 81
  }
}
```

---

## 成本分析 (Cost Analysis)

> v2.3.0 新增 - AI 消耗成本追踪与分析系统

### 获取消耗统计总览

**GET** `/api/cost-analysis/overview`

> **需要认证**

**响应示例**:
```json
{
  "totalTokens": 1250000,
  "totalCost": 3.75,
  "dailyStats": [
    {
      "date": "2026-04-30",
      "tokens": 450000,
      "cost": 1.35
    }
  ],
  "categoryBreakdown": {
    "generation": 2.50,
    "quality": 0.80,
    "other": 0.45
  }
}
```

---

### 获取每日消耗明细

**GET** `/api/cost-analysis/daily`

> **需要认证**

**查询参数**:
- `startDate` (可选) - 开始日期，格式 YYYY-MM-DD
- `endDate` (可选) - 结束日期，格式 YYYY-MM-DD
- `novelId` (可选) - 小说ID筛选

**响应示例**:
```json
{
  "daily": [
    {
      "date": "2026-04-30",
      "totalTokens": 450000,
      "totalCost": 1.35,
      "byCategory": {
        "generation": 1.00,
        "quality": 0.25,
        "context": 0.10
      }
    }
  ]
}
```

---

### 获取消耗趋势数据

**GET** `/api/cost-analysis/trend`

> **需要认证**

**查询参数**:
- `period` (可选) - 趋势周期: `7d`, `30d`, `90d` (默认: `30d`)

**响应示例**:
```json
{
  "trend": [
    {
      "date": "2026-04-30",
      "tokens": 450000,
      "cost": 1.35
    }
  ],
  "averageDailyCost": 1.20,
  "predictedMonthlyCost": 36.00
}
```

---

### 获取分类分项明细

**GET** `/api/cost-analysis/breakdown`

> **需要认证**

**响应示例**:
```json
{
  "byOperation": [
    {
      "operation": "章节生成",
      "count": 45,
      "tokens": 800000,
      "cost": 2.40
    },
    {
      "operation": "质量评分",
      "count": 120,
      "tokens": 300000,
      "cost": 0.90
    }
  ],
  "byModel": [
    {
      "model": "gpt-4o",
      "tokens": 900000,
      "cost": 2.70
    }
  ],
  "optimizationSuggestions": [
    {
      "type": "高频操作",
      "description": "质量评分请求可考虑合并批量处理",
      "potentialSavings": "15%"
    }
  ]
}
```

---

## 境界管理 (Power Level)

### 检测境界突破

**POST** `/api/power-level/detect`

> **需要认证**

**请求体**:
```json
{
  "chapterId": "chap123",
  "novelId": "novel456"
}
```

**响应示例**:
```json
{
  "ok": true,
  "hasBreakthrough": true,
  "updates": [
    {
      "characterId": "char123",
      "characterName": "林风",
      "from": "炼气初期",
      "to": "炼气中期"
    }
  ],
  "chapterTitle": "第三章：突破"
}
```

---

### 批量检测境界

**POST** `/api/power-level/batch-detect`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "chapterIds": ["chap1", "chap2", "chap3"]
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| chapterIds | string[] | 否 | 指定章节ID列表，不传则检测所有有内容的章节 |

**响应示例**:
```json
{
  "ok": true,
  "totalChapters": 10,
  "totalBreakthroughs": 3,
  "errorCount": 0,
  "results": [
    {
      "chapterId": "chap3",
      "chapterTitle": "第三章：突破",
      "hasBreakthrough": true,
      "updatesCount": 1
    }
  ]
}
```

---

### 获取境界历史

**GET** `/api/power-level/history/:novelId`

> **需要认证**

**响应示例**:
```json
{
  "history": [
    {
      "characterId": "char123",
      "characterName": "林风",
      "system": "修仙体系",
      "currentLevel": "金丹中期",
      "nextMilestone": "金丹后期",
      "breakthroughs": [
        {
          "chapterId": "chap10",
          "chapterTitle": "第十章",
          "from": "筑基初期",
          "to": "筑基中期",
          "note": "服用筑基丹后突破",
          "timestamp": 1713657600
        }
      ],
      "totalBreakthroughs": 5
    }
  ]
}
```

---

### 获取角色境界

**GET** `/api/power-level/character/:id`

> **需要认证**

**响应示例**:
```json
{
  "characterId": "char123",
  "characterName": "林风",
  "hasData": true,
  "data": {
    "system": "修仙体系",
    "current": "金丹中期",
    "breakthroughs": [...],
    "nextMilestone": "金丹后期"
  }
}
```

---

### 验证境界一致性

**POST** `/api/power-level/validate`

> **需要认证**

**请求体**:
```json
{
  "characterId": "char123",
  "novelId": "novel456",
  "recentChapterCount": 3
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| characterId | string | ✅ | 角色ID |
| novelId | string | ✅ | 小说ID |
| recentChapterCount | number | 否 | 分析最近章节数（1-10，默认3） |

**响应示例**:
```json
{
  "ok": true,
  "characterId": "char123",
  "characterName": "林风",
  "isConsistent": true,
  "dbLevel": {
    "system": "修仙体系",
    "current": "金丹中期"
  },
  "assessedLevel": {
    "system": "修仙体系",
    "current": "金丹中期"
  },
  "confidence": "high",
  "reasoning": "最近章节多次明确提及角色处于金丹中期修为"
}
```

---

### 应用境界建议

**POST** `/api/power-level/apply-suggestion`

> **需要认证**

**请求体**:
```json
{
  "characterId": "char123",
  "novelId": "novel456",
  "suggestedCurrent": "金丹后期",
  "suggestedSystem": "修仙体系",
  "note": "根据第20章剧情更新"
}
```

**响应示例**:
```json
{
  "ok": true,
  "characterId": "char123",
  "characterName": "林风",
  "previousLevel": "金丹中期",
  "newLevel": "金丹后期"
}
```

---

## 导出服务 (Export)

### 获取可用格式

**GET** `/api/export/formats`

> **需要认证**

**响应示例**:
```json
{
  "formats": [
    { "id": "md", "name": "Markdown", "extension": ".md", "mimeType": "text/markdown" },
    { "id": "txt", "name": "纯文本", "extension": ".txt", "mimeType": "text/plain" },
    { "id": "epub", "name": "EPUB 电子书", "extension": ".epub", "mimeType": "application/epub+zip" },
    { "id": "html", "name": "可打印 HTML", "extension": ".html", "mimeType": "text/html" },
    { "id": "zip", "name": "ZIP 打包", "extension": ".zip", "mimeType": "application/zip" }
  ]
}
```

---

### 导出小说

**POST** `/api/export`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "format": "epub",
  "volumeIds": ["vol1", "vol2"],
  "includeTOC": true,
  "includeMeta": true
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |
| format | string | ✅ | 导出格式：md/txt/epub/html/zip |
| volumeIds | string[] | 否 | 卷ID列表，不传则导出全部 |
| includeTOC | boolean | 否 | 是否包含目录（默认true） |
| includeMeta | boolean | 否 | 是否包含元信息（默认true） |

**响应**: 文件下载（二进制流）

**响应头**:
```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="小说标题.epub"
X-Export-Id: export_abc123
```

---

## 内容搜索 (Search)

### 搜索章节内容

**GET** `/api/search`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | ✅ | 搜索关键词（至少2字符） |
| novelId | string | 否 | 限定小说范围 |
| limit | number | 否 | 返回结果数量限制（默认20） |

**响应示例**:
```json
{
  "query": "林风",
  "total": 15,
  "results": [
    {
      "id": "chap123",
      "novelId": "novel456",
      "title": "第一章：少年林风",
      "chapterNumber": 1,
      "summary": "本章介绍了主角林风的背景...",
      "snippet": "...林风深吸一口气，体内的灵力开始..."
    }
  ]
}
```

---

## 向量化索引 (Vectorize)

### 创建向量化索引

**POST** `/api/vectorize/index`

> **需要认证**

**请求体**:
```json
{
  "sourceType": "chapter",
  "sourceId": "chap123",
  "novelId": "novel456",
  "title": "第一章：少年林风",
  "content": "章节内容...",
  "settingType": "power_system",
  "importance": "high"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| sourceType | string | ✅ | 来源类型：outline/chapter/character/summary/setting/foreshadowing |
| sourceId | string | ✅ | 来源ID |
| novelId | string | ✅ | 小说ID |
| title | string | ✅ | 标题 |
| content | string | 否 | 内容（不提供时自动从数据库获取） |
| settingType | string | 否 | 设定类型（当sourceType为setting时） |
| importance | string | 否 | 重要程度 |

**响应示例**:
```json
{
  "ok": true,
  "vectorIds": ["vec123", "vec124"],
  "message": "Indexed 2 vectors for chapter:chap123"
}
```

---

### 删除向量化索引

**DELETE** `/api/vectorize/:type/:id`

> **需要认证**

**说明**: 删除指定内容的向量索引

**响应**:
```json
{
  "ok": true,
  "message": "Deleted vectors for chapter:chap123"
}
```

---

### 相似度搜索

**GET** `/api/vectorize/search`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | ✅ | 搜索文本 |
| novelId | string | 否 | 限定小说范围 |
| sourceTypes | string | 否 | 来源类型过滤（逗号分隔） |

**响应示例**:
```json
{
  "ok": true,
  "query": "主角突破境界",
  "resultsCount": 5,
  "results": [
    {
      "id": "vec123",
      "score": 0.892,
      "title": "第三章：突破筑基",
      "sourceType": "chapter",
      "preview": "林风终于突破了筑基期的瓶颈..."
    }
  ]
}
```

---

### 获取向量统计

**GET** `/api/vectorize/stats/:novelId`

> **需要认证**

**响应示例**:
```json
{
  "total": 156,
  "byType": {
    "setting": 45,
    "character": 89,
    "foreshadowing": 22
  },
  "lastIndexedAt": 1713763200,
  "unindexedCounts": {
    "settings": 3,
    "characters": 0,
    "foreshadowing": 1
  }
}
```

---

### 全量重建索引

**POST** `/api/vectorize/reindex-all`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "types": ["setting", "character", "outline", "foreshadowing"],
  "clearExisting": true
}
```

**响应**:
```json
{
  "ok": true,
  "message": "全量索引重建任务已提交到后台队列，请稍后查看索引统计",
  "novelId": "novel456"
}
```

---

### 增量索引未索引项

**POST** `/api/vectorize/index-missing`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "types": ["setting", "character", "foreshadowing"]
}
```

**响应**:
```json
{
  "ok": true,
  "message": "发现 4 条未索引记录，已提交增量索引任务",
  "novelId": "novel456",
  "stats": {
    "settings": 2,
    "characters": 1,
    "foreshadowing": 1
  }
}
```

---

## 实体索引 (Entity Index)

### 重建实体索引

**POST** `/api/entities/rebuild`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456"
}
```

**响应**:
```json
{
  "ok": true,
  "message": "实体索引重建任务已提交"
}
```

---

### 获取子实体

**GET** `/api/entities/:novelId/children/:parentId`

> **需要认证**

**响应示例**:
```json
{
  "children": [
    {
      "id": "set124",
      "name": "炼气期",
      "type": "power_system",
      "childCount": 0
    }
  ]
}
```

---

### 获取实体树

**GET** `/api/entities/:novelId`

> **需要认证**

**响应示例**:
```json
{
  "tree": [...],
  "stats": {...}
}
```

---

## 创意工坊 (Workshop)

### 创建会话

**POST** `/api/workshop/session`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "stage": "concept"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 否 | 小说ID |
| stage | string | 否 | 阶段：concept/worldbuilding/character/volume（默认concept） |

**响应**:
```json
{
  "ok": true,
  "session": {
    "id": "ws_abc123",
    "stage": "concept",
    "status": "active",
    "createdAt": 1713571200
  }
}
```

---

### 获取会话列表

**GET** `/api/workshop/sessions`

> **需要认证**

**响应**:
```json
{
  "ok": true,
  "sessions": [
    {
      "id": "ws_abc123",
      "title": "我的玄幻小说创意",
      "stage": "concept",
      "status": "active",
      "updatedAt": 1713571200
    }
  ]
}
```

---

### 获取会话详情

**GET** `/api/workshop/session/:id`

> **需要认证**

**响应**:
```json
{
  "ok": true,
  "session": {
    "id": "ws_abc123",
    "novelId": "novel456",
    "stage": "concept",
    "status": "active",
    "messages": [...],
    "extractedData": {...},
    "createdAt": 1713571200,
    "updatedAt": 1713571500
  }
}
```

---

### 更新会话

**PATCH** `/api/workshop/session/:id`

> **需要认证**

**请求体**:
```json
{
  "title": "新的会话标题",
  "stage": "worldbuilding"
}
```

**响应**:
```json
{
  "ok": true,
  "message": "会话已更新"
}
```

---

### 发送消息

**POST** `/api/workshop/session/:id/message`

> **需要认证**

**请求体**:
```json
{
  "message": "我想写一个关于修仙的故事",
  "stage": "concept"
}
```

**响应类型**: `text/event-stream` (SSE 流)

---

### 提交确认

**POST** `/api/workshop/session/:id/commit`

> **需要认证**

**响应**:
```json
{
  "ok": true,
  "novelId": "novel456",
  "message": "创作数据已成功提交到数据库！"
}
```

---

### 删除会话

**DELETE** `/api/workshop/session/:id`

> **需要认证**

**响应**:
```json
{
  "ok": true,
  "message": "会话已删除"
}
```

---

## 工坊导入 (Workshop Import)

### 获取导入列表

**GET** `/api/workshop-import/list/:module`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | ✅ | 小说ID |

**路径参数**: module - 可选值为 chapter/volume/setting/character/rule/foreshadowing/master_outline

**响应**:
```json
{
  "ok": true,
  "items": [
    { "id": "char123", "name": "林风", "role": "protagonist" }
  ]
}
```

---

### 导入数据

**POST** `/api/workshop-import/import`

> **需要认证**

**请求体**:
```json
{
  "module": "character",
  "data": {
    "name": "林风",
    "role": "protagonist",
    "description": "一位天赋异禀的少年"
  },
  "novelId": "novel456",
  "importMode": "upsert"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| module | string | ✅ | 模块类型 |
| data | object/array | ✅ | 导入数据 |
| novelId | string | ✅ | 小说ID |
| importMode | string | 否 | 导入模式：create/update/upsert（默认upsert） |

**响应**:
```json
{
  "ok": true,
  "results": [
    { "action": "created", "id": "char123", "name": "林风", "existed": false }
  ],
  "summary": { "created": 1, "updated": 0, "skipped": 0, "total": 1 },
  "message": "导入完成：新建 1，更新 0，跳过 0"
}
```

---

### 格式化导入

**POST** `/api/workshop-format-import/format-import`

> **需要认证**

**请求体**:
```json
{
  "content": "第一章 少年林风\n\n林风深吸一口气...",
  "module": "chapter",
  "novelId": "novel456"
}
```

**响应**:
```json
{
  "ok": true,
  "parseStatus": "success",
  "data": {
    "title": "第一章 少年林风",
    "content": "林风深吸一口气..."
  },
  "rawContent": "第一章 少年林风\n\n林风深吸一口气..."
}
```

---

## 模型配置 (Model Config)

### 获取模型配置列表

**GET** `/api/config`

> **需要认证**

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 否 | 小说ID（不传则返回全局配置） |
| stage | string | 否 | 生成阶段 |

**响应示例**:
```json
[
  {
    "id": "config123",
    "novelId": null,
    "scope": "global",
    "stage": "chapter_gen",
    "provider": "volcengine",
    "modelId": "doubao-seed-2-pro",
    "apiBase": "https://ark.cn-beijing.volces.com/api/v3",
    "apiKey": "env:VOLCENGINE_API_KEY",
    "params": "{\"temperature\":0.85,\"max_tokens\":4096}",
    "isActive": 1,
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
]
```

---

### 创建模型配置

**POST** `/api/config`

> **需要认证**

**请求体**:
```json
{
  "novelId": "novel456",
  "scope": "novel",
  "stage": "chapter_gen",
  "provider": "volcengine",
  "modelId": "doubao-seed-2-pro",
  "apiBase": "https://ark.cn-beijing.volces.com/api/v3",
  "apiKey": "env:VOLCENGINE_API_KEY",
  "params": {
    "temperature": 0.85,
    "max_tokens": 4096
  }
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 否 | 小说ID（不填则为全局配置） |
| scope | string | ✅ | 配置范围：global/novel |
| stage | string | ✅ | 生成阶段 |
| provider | string | ✅ | 模型提供商 |
| modelId | string | ✅ | 模型ID |
| apiBase | string | 否 | API基础URL |
| apiKey | string | 否 | API密钥 |
| params | object | 否 | 模型参数 |

**成功响应 (201)**:
```json
{
  "id": "config_new",
  "novelId": "novel456",
  "scope": "novel",
  "stage": "chapter_gen",
  ...
}
```

---

### 更新模型配置

**PATCH** `/api/config/:id`

> **需要认证**

**请求体**:
```json
{
  "modelId": "doubao-pro-32k",
  "params": {
    "temperature": 0.7
  },
  "isActive": false
}
```

**响应**:
```json
{
  "id": "config123",
  ...
}
```

---

### 启用/停用配置

**PATCH** `/api/config/:id/toggle`

> **需要认证**

**请求体**:
```json
{
  "isActive": true
}
```

**响应**:
```json
{
  "id": "config123",
  "isActive": 1,
  ...
}
```

---

### 删除模型配置

**DELETE** `/api/config/:id`

> **需要认证**

**响应**:
```json
{
  "ok": true
}
```

---

## MCP 服务 (MCP)

### MCP 端点

**POST** `/api/mcp`

> **需要认证**

**Content-Type**: `application/json`

**支持的 MCP 方法**:
- `tools/list` - 列出可用工具
- `tools/call` - 调用工具

**请求示例 - 列出工具**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

**请求示例 - 调用工具**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "queryNovels",
    "arguments": {
      "limit": 10
    }
  }
}
```

**响应示例**:
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "[{\"id\":\"novel456\",\"title\":\"混沌元尊\",...}]"
      }
    ]
  }
}
```

---

### MCP 服务状态

**GET** `/api/mcp`

**响应示例**:
```json
{
  "ok": true,
  "service": "NovelForge MCP",
  "version": "1.1.0",
  "protocolVersion": "2024-11-05",
  "tools": 14
}
```

---

## 错误码参考

### 通用错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `VALIDATION_ERROR` | 400 | 请求格式错误或缺少必填字段 |
| `INVALID_CREDENTIALS` | 401 | 用户名或密码错误 |
| `ACCOUNT_DISABLED` | 403 | 账号已被禁用 |
| `REGISTRATION_DISABLED` | 403 | 注册功能已关闭 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `USER_EXISTS` | 409 | 用户名或邮箱已被使用 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 业务错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `NOVEL_NOT_FOUND` | 404 | 小说不存在 |
| `CHAPTER_NOT_FOUND` | 404 | 章节不存在 |
| `CHARACTER_NOT_FOUND` | 404 | 角色不存在 |
| `FORESHADOWING_NOT_FOUND` | 404 | 伏笔不存在 |
| `SETUP_FAILED` | 500 | 初始化失败 |
| `EXPORT_FAILED` | 500 | 导出失败 |
| `VECTORIZE_ERROR` | 500 | 向量数据库错误 |
| `VECTORIZE_UNAVAILABLE` | 503 | Vectorize 服务不可用 |

---

<div align="center">

**API Version: 3.2.0**

</div>
