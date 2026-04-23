# NovelForge · API 参考文档

> 完整的 REST API 接口文档，包含请求格式、响应结构和错误码说明。

---

## 📋 目录

- [基础信息](#基础信息)
- [认证方式](#认证方式)
- [通用响应格式](#通用响应格式)
- **v1.5.0 新增**
  - [用户认证 (Auth)](#用户认证-auth)
  - [系统初始化 (Setup)](#系统初始化-setup)
  - [邀请码管理 (Invite Codes)](#邀请码管理-invite-codes)
  - [系统设置 (System Settings)](#系统设置-system-settings)
  - [创意工坊 (Workshop)](#创意工坊-workshop)
- **v1.6.0 新增**
  - [AI 监控中心 (AI Monitor)](#ai-监控中心-ai-monitor)
  - [向量索引增强 (Vectorize)](#向量化索引-vectorize)
  - [上下文诊断 (Context)](#上下文诊断-context)
  - [综合检查 (Check)](#综合检查-check)
- [小说管理 (Novels)](#小说管理-novels)
- [总纲管理 (Master Outline)](#总纲管理-master-outline)
- [创作规则 (Writing Rules)](#创作规则-writing-rules)
- [小说设定 (Novel Settings)](#小说设定-novel-settings)
- [卷管理 (Volumes)](#卷管理-volumes)
- [章节管理 (Chapters)](#章节管理-chapters)
- [角色管理 (Characters)](#角色管理-characters)
- [伏笔管理 (Foreshadowing)](#伏笔管理-foreshadowing)
- [AI 生成 (Generate)](#ai-生成-generate)
- [导出服务 (Export)](#导出服务-export)
- [内容搜索 (Search)](#内容搜索-search)
- [向量化索引 (Vectorize)](#向量化索引-vectorize)
- [设置服务 (Settings)](#设置服务-settings)
- [MCP 服务 (MCP)](#mcp-服务-mcp)
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
  "data": { ... },      // 响应数据（对象或数组）
  "meta": {             // 分页元数据（列表接口）
    "page": 1,
    "perPage": 20,
    "total": 100
  }
}
```

### 错误响应

```json
{
  "error": "错误消息",
  "code": "ERROR_CODE",
  "details": {          // 可选的详细信息
    "field": "问题字段"
  }
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

## v1.5.0 新增 API

### 用户认证 (Auth)

> **注意**: 以下端点**不需要 JWT 认证**

#### 用户注册

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
| username | string | ✅ | 用户名（3-32字符，字母数字下划线） |
| email | string | ✅ | 邮箱地址 |
| password | string | ✅ | 密码（8-64位，需包含大小写字母和数字） |
| inviteCode | string | 否 | 邀请码（如果注册需要） |

**成功响应 (201)**:
```json
{
  "message": "注册成功",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_abc123",
    "username": "noveluser",
    "email": "user@example.com",
    "role": "user"
  }
}
```

#### 用户登录

**POST** `/api/auth/login`

**请求体**:
```json
{
  "login": "noveluser",  // 或邮箱
  "password": "MySecurePass123"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| login | string | ✅ | 用户名或邮箱 |
| password | string | ✅ | 密码 |

**成功响应 (200)**:
```json
{
  "message": "登录成功",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_abc123",
    "username": "noveluser",
    "email": "user@example.com",
    "role": "admin"
  }
}
```

#### 获取当前用户信息

**GET** `/api/auth/me`

> **需要认证**: `Authorization: Bearer <token>`

**响应示例**:
```json
{
  "id": "usr_abc123",
  "username": "noveluser",
  "email": "user@example.com",
  "role": "admin",
  "createdAt": 1713571200,
  "updatedAt": 1713657600,
  "deletedAt": null
}
```

#### 修改密码

**PUT** `/api/auth/password`

> **需要认证**

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
  "message": "密码修改成功"
}
```

#### 删除账号

**DELETE** `/api/auth/account`

> **需要认证**

**请求体**:
```json
{
  "password": "ConfirmPassword123"
}
```

**成功响应 (200)**:
```json
{
  "message": "账号已删除"
}
```

#### 登出

**POST** `/api/auth/logout`

> **需要认证**

**成功响应 (200)**:
```json
{
  "message": "登出成功"
}
```

---

### 系统初始化 (Setup)

> **注意**: 以下端点**不需要 JWT 认证**

#### 检查初始化状态

**GET** `/api/setup/status`

**响应示例**:
```json
{
  "initialized": false
}
```

#### 创建管理员账号

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
  "message": "初始化成功",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr_admin1",
    "username": "admin",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

**错误响应 (409)**:
```json
{
  "error": "系统已经初始化，无法重复创建管理员",
  "code": "ALREADY_INITIALIZED"
}
```

---

### 邀请码管理 (Invite Codes)

> **需要认证**: 所有端点都需要 `Admin` 权限

#### 获取邀请码列表

**GET** `/api/invite-codes`

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| status | string | - | 过滤状态：active/used/expired/disabled |
| page | number | 1 | 页码 |
| perPage | number | 20 | 每页数量 |

**响应示例**:
```json
[
  {
    "id": "ic_abc123",
    "code": "INVITE2024",
    "maxUses": 10,
    "usedCount": 3,
    "status": "active",
    "expiresAt": null,
    "createdBy": "usr_admin1",
    "createdAt": 1713571200,
    "updatedAt": 1713571300
  }
]
```

#### 创建邀请码

**POST** `/api/invite-codes`

**请求体**:
```json
{
  "code": "INVITE2024",
  "maxUses": 10,
  "expiresInDays": 30
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| code | string | 否 | 自定义代码（留空自动生成） |
| maxUses | number | 否 | 最大使用次数（默认 1） |
| expiresInDays | number | 否 | 有效期天数（默认 null，永不过期） |

**成功响应 (201)**:
```json
{
  "id": "ic_abc123",
  "code": "INVITE2024",
  "maxUses": 10,
  "usedCount": 0,
  "status": "active",
  "expiresAt": 1741147200,
  "createdBy": "usr_admin1",
  "createdAt": 1713571200,
  "updatedAt": 1713571200
}
```

#### 更新邀请码

**PUT** `/api/invite-codes/:id`

**请求体**:
```json
{
  "maxUses": 20,
  "status": "disabled"
}
```

#### 删除邀请码

**DELETE** `/api/invite-codes/:id`

---

### 系统设置 (System Settings)

> **需要认证**: `GET` 需要普通用户权限，`PUT` 需要 `Admin` 权限

#### 获取系统设置

**GET** `/api/system-settings`

**响应示例**:
```json
[
  {
    "key": "registration_enabled",
    "value": "true",
    "description": "是否允许公开注册",
    "updatedAt": 1713571200
  },
  {
    "key": "admin_initialized",
    "value": "true",
    "description": "系统是否已完成管理员初始化",
    "updatedAt": 1713571200
  },
  {
    "key": "site_name",
    "value": "NovelForge",
    "description": "站点名称",
    "updatedAt": 1713571200
  }
]
```

#### 更新系统设置

**PUT** `/api/system-settings`

> **需要 Admin 权限**

**请求体**:
```json
{
  "settings": [
    {
      "key": "registration_enabled",
      "value": "false"
    }
  ]
}
```

**成功响应 (200)**:
```json
{
  "message": "更新成功",
  "updated": [
    { "key": "registration_enabled", "value": "false" }
  ]
}
```

---

### 创意工坊 (Workshop)

> **需要认证**

#### 创建会话

**POST** `/api/workshop/sessions`

**请求体**:
```json
{
  "title": "我的玄幻小说创意"
}
```

**成功响应 (201)**:
```json
{
  "id": "ws_abc123",
  "title": "我的玄幻小说创意",
  "stage": "concept",
  "data": {},
  "userId": "usr_abc123",
  "createdAt": 1713571200,
  "updatedAt": 1713571200
}
```

#### 获取会话列表

**GET** `/api/workshop/sessions`

**响应示例**:
```json
[
  {
    "id": "ws_abc123",
    "title": "我的玄幻小说创意",
    "stage": "concept",
    "data": {},
    "createdAt": 1713571200,
    "updatedAt": 1713571500
  }
]
```

#### 获取会话详情

**GET** `/api/workshop/sessions/:id`

#### 更新会话数据

**PUT** `/api/workshop/sessions/:id`

**请求体**:
```json
{
  "stage": "worldbuilding",
  "data": {
    "genre": "玄幻",
    "coreConcepts": ["修炼体系", "宗门争霸"]
  }
}
```

#### 删除会话

**DELETE** `/api/workshop/sessions/:id`

#### SSE 对话流

**GET** `/api/workshop/sessions/:id/chat?message=你好&stage=concept`

> 返回 SSE (Server-Sent Events) 流

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| message | string | ✅ | 用户消息内容 |
| stage | string | ✅ | 当前阶段：concept/worldbuilding/character/volume |

**SSE 事件格式**:
```
event: message
data: {"type":"text","content":"你好！我是你的AI创作助手..."}

event: extracted_data
data: {"genre":"玄幻","title":"混沌元尊","...":"..."}

event: done
data: {}
```

#### 提交确认（生成小说框架）

**POST** `/api/workshop/sessions/:id/submit`

**请求体**:
```json
{
  "confirmedData": {
    "title": "混沌元尊",
    "genre": "玄幻",
    "synopsis": "...",
    "worldSettings": [...],
    "characters": [...],
    "volumes": [...]
  }
}
```

**成功响应 (201)**:
```json
{
  "message": "小说创建成功",
  "novelId": "nov_abc123",
  "masterOutlineId": "mo_def456",
  "characterIds": ["char_789"],
  "volumeIds": ["vol_012"]
}
```

---

## v1.6.0 新增 API

### AI 监控中心 (AI Monitor)

> **需要认证**

#### 获取向量统计

**GET** `/api/vectorize/stats?novelId=:novelId`

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

#### 获取向量状态

**GET** `/api/vectorize/status`

**响应示例**:
```json
{
  "status": "ok",
  "message": "Vectorize service is operational",
  "embeddingModel": "@cf/baai/bge-base-zh-v1.5",
  "dimensions": 768
}
```

#### 全量重建索引

**POST** `/api/vectorize/reindex-all`

> 后台异步执行，通过队列处理

**请求体**:
```json
{
  "novelId": "novel456",
  "clearExisting": true
}
```

**响应示例**:
```json
{
  "ok": true,
  "message": "索引重建任务已提交到后台队列"
}
```

#### 增量索引未索引项

**POST** `/api/vectorize/index-missing`

**请求体**:
```json
{
  "novelId": "novel456"
}
```

**响应示例**:
```json
{
  "ok": true,
  "message": "已提交 4 条内容到索引队列"
}
```

---

### 上下文诊断 (Context)

> **需要认证**

#### 预览章节上下文

**GET** `/api/generate/preview-context?novelId=:novelId&chapterId=:chapterId`

**响应示例**:
```json
{
  "summary": {
    "totalLayers": 12,
    "coreLayerCount": 6,
    "dynamicLayerCount": 6,
    "ragResultCount": 8,
    "buildTimeMs": 234,
    "totalTokenEstimate": 45230
  },
  "slotBreakdown": {
    "masterOutlineContent": 8500,
    "volumeBlueprint": 1200,
    "volumeEventLine": 800,
    "prevChapterSummary": 450,
    "protagonistCards": 2800,
    "activeRules": 3200,
    "summaryChain": 12500,
    "characterCards": 6800,
    "foreshadowing": 2100,
    "settings": 4500,
    "chapterTypeRules": 1500
  },
  "chapterTypeHint": "combat"
}
```

---

### 综合检查 (Check)

> **需要认证**

#### 组合质量检查

**POST** `/api/generate/combined-check`

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
    "conflicts": [
      {
        "characterName": "林风",
        "conflict": "前后性格表现不一致",
        "excerpt": "林风性格坚毅，但在第15章突然变得胆小怕事"
      }
    ],
    "warnings": []
  },
  "coherenceCheck": {
    "score": 85,
    "issues": [
      {
        "severity": "warning",
        "category": "foreshadowing",
        "message": "伏笔'天雷珠之谜'尚未收尾",
        "suggestion": "建议在后续章节中揭示天雷珠的来历"
      }
    ]
  },
  "hasIssues": true
}
```

---

## 小说管理 (Novels)

### 获取小说列表

**GET** `/api/novels`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 按状态过滤：draft/writing/completed |
| genre | string | 否 | 按类型过滤：玄幻/仙侠/都市... |
| page | number | 否 | 页码，默认 1 |
| perPage | number | 否 | 每页数量，默认 20 |

**响应示例**:
```json
[
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
    "updatedAt": 1713657600,
    "deletedAt": null
  }
]
```

---

### 获取小说详情

**GET** `/api/novels/:id`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 小说 ID |

**响应示例**:
```json
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
  "updatedAt": 1713657600,
  "deletedAt": null
}
```

---

### 创建小说

**POST** `/api/novels`

**请求体**:
```json
{
  "title": "小说标题",           // 必填，1-200 字符
  "description": "简介",         // 可选
  "genre": "玄幻"               // 可选：玄幻/仙侠/都市/科幻/其他
}
```

**响应示例**:
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
  "updatedAt": 1713571200
}
```

---

### 更新小说

**PATCH** `/api/novels/:id`

**路径参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| id | string | 小说 ID |

**请求体**（所有字段可选）:
```json
{
  "title": "新标题",
  "description": "新简介",
  "genre": "仙侠",
  "status": "completed"
}
```

---

### 删除小说

**DELETE** `/api/novels/:id`

**说明**: 软删除，数据不会真正删除

**响应**:
```json
{
  "ok": true
}
```

---

## 总纲管理 (Master Outline)

### 获取总纲

**GET** `/api/v1/master-outline/:novelId`

**响应示例**:
```json
{
  "exists": true,
  "outline": {
    "id": "mo123",
    "novelId": "novel456",
    "title": "混沌元尊总纲",
    "content": "# 故事概述\n\n主角林风从一个偏僻小村庄走出...",
    "version": 3,
    "summary": "一个少年从凡人成长为元尊的故事",
    "wordCount": 5000,
    "vectorId": "vec789",
    "indexedAt": 1713571200,
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
}
```

---

### 获取总纲历史版本

**GET** `/api/v1/master-outline/:novelId/history`

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
    },
    {
      "id": "mo122",
      "version": 2,
      "title": "混沌元尊总纲",
      "summary": "修订版总纲",
      "wordCount": 4500,
      "createdAt": 1713571200
    }
  ]
}
```

---

### 创建/更新总纲

**POST** `/api/v1/master-outline`

**请求体**:
```json
{
  "novelId": "novel456",        // 必填
  "title": "混沌元尊总纲",       // 必填
  "content": "# 故事概述\n\n...", // 必填，至少10字符
  "summary": "简短摘要"          // 可选，最多500字符
}
```

**说明**: 每次创建会自动递增版本号

---

### 更新总纲内容

**PUT** `/api/v1/master-outline/:id`

**请求体**:
```json
{
  "title": "新标题",            // 可选
  "content": "新内容...",       // 可选
  "summary": "新摘要"           // 可选
}
```

---

### 删除总纲版本

**DELETE** `/api/v1/master-outline/:id`

**说明**: 软删除

---

## 创作规则 (Writing Rules)

### 获取创作规则

**GET** `/api/v1/rules/:novelId`

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

**POST** `/api/v1/rules`

**请求体**:
```json
{
  "novelId": "novel456",                              // 必填
  "category": "style",                                // 必填：style/pacing/character/plot/world/taboo/custom
  "title": "文风要求",                                 // 必填，最多100字符
  "content": "使用古风语言，避免现代词汇...",           // 必填
  "priority": 1,                                      // 可选，1-5，默认3
  "sortOrder": 0                                      // 可选，默认0
}
```

---

### 更新创作规则

**PUT** `/api/v1/rules/:id`

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

---

### 删除创作规则

**DELETE** `/api/v1/rules/:id`

**说明**: 软删除

---

### 启用/禁用规则

**PATCH** `/api/v1/rules/:id/toggle`

**响应示例**:
```json
{
  "ok": true,
  "isActive": 0
}
```

---

## 小说设定 (Novel Settings)

### 获取小说设定

**GET** `/api/v1/settings/:novelId`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| type | string | 否 | 按类型过滤：worldview/power_system/faction/geography/item_skill/misc |

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
      "attributes": "{\"levels\": 9}",
      "parentId": null,
      "importance": "high",
      "relatedIds": null,
      "vectorId": "vec789",
      "sortOrder": 0,
      "createdAt": 1713571200,
      "updatedAt": 1713657600
    }
  ]
}
```

---

### 创建小说设定

**POST** `/api/v1/settings`

**请求体**:
```json
{
  "novelId": "novel456",                              // 必填
  "type": "power_system",                             // 必填：worldview/power_system/faction/geography/item_skill/misc
  "category": "修仙境界",                              // 可选
  "name": "境界体系",                                  // 必填
  "content": "炼气期 → 筑基期 → 金丹期...",            // 必填
  "attributes": {"levels": 9},                        // 可选，JSON对象
  "parentId": null,                                   // 可选，父设定ID
  "importance": "high",                               // 可选：high/normal/low
  "relatedIds": ["set124", "set125"],                 // 可选，关联设定ID
  "sortOrder": 0                                      // 可选
}
```

---

### 更新小说设定

**PUT** `/api/v1/settings/:id`

---

### 删除小说设定

**DELETE** `/api/v1/settings/:id`

**说明**: 软删除

---

## 卷管理 (Volumes)

### 获取卷列表

**GET** `/api/volumes?novelId=:novelId`

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

### 创建卷

**POST** `/api/volumes`

**请求体**:
```json
{
  "novelId": "novel456",        // 必填
  "outlineId": "outline789",    // 可选
  "title": "第一卷：初出茅庐",   // 必填
  "sortOrder": 1                // 可选
}
```

---

### 更新卷

**PATCH** `/api/volumes/:id`

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

**说明**: 软删除，关联章节不会被删除但会解除关联

---

## 章节管理 (Chapters)

### 获取章节列表

**GET** `/api/chapters?novelId=:novelId`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 是 | 小说 ID |
| volumeId | string | 否 | 卷 ID 过滤 |
| status | string | 否 | 状态过滤 |

**响应示例**:
```json
[
  {
    "id": "chap123",
    "novelId": "novel456",
    "volumeId": "vol789",
    "outlineId": "outline101",
    "title": "第一章：少年林风",
    "sortOrder": 1,
    "content": "<p>这里是章节内容...</p>",
    "wordCount": 3500,
    "status": "generated",
    "modelUsed": "doubao-seed-2-pro",
    "promptTokens": 2500,
    "completionTokens": 3200,
    "generationTime": 8500,
    "summary": "本章介绍了主角林风的背景...",
    "summaryAt": 1713657600,
    "vectorId": "vec202",
    "indexedAt": 1713657600,
    "createdAt": 1713571200,
    "updatedAt": 1713657600,
    "deletedAt": null
  }
]
```

---

### 获取章节详情

**GET** `/api/chapters/:id`

**响应**: 同章节列表中的单个对象

---

### 创建章节

**POST** `/api/chapters`

**请求体**:
```json
{
  "novelId": "novel456",        // 必填
  "volumeId": "vol789",         // 可选
  "outlineId": "outline101",    // 可选
  "title": "第一章：少年林风",   // 必填
  "sortOrder": 1,               // 可选
  "content": null               // 可选，初始可为空
}
```

---

### 更新章节

**PATCH** `/api/chapters/:id`

**请求体**:
```json
{
  "title": "新的标题",
  "content": "<p>新的内容...</p>",
  "status": "revised"
}
```

---

### 删除章节

**DELETE** `/api/chapters/:id`

---

## 角色管理 (Characters)

### 获取角色列表

**GET** `/api/characters?novelId=:novelId`

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
    "imageR2Key": "characters/novel456/1713571200.jpg",
    "attributes": "{\"age\": 16, \"height\": 175, \"cultivation\": \"筑基初期\"}",
    "vectorId": "vec301",
    "createdAt": 1713571200,
    "updatedAt": 1713657600,
    "deletedAt": null
  }
]
```

---

### 创建角色

**POST** `/api/characters`

**请求体**:
```json
{
  "novelId": "novel456",        // 必填
  "name": "林风",               // 必填
  "aliases": ["小风", "风少"],   // 可选
  "role": "protagonist",        // 可选：protagonist/antagonist/supporting
  "description": "角色描述",     // 可选
  "attributes": {               // 可选，JSON 对象
    "age": 16,
    "height": 175
  }
}
```

---

### 上传角色图片

**POST** `/api/characters/:id/image`

**Content-Type**: `multipart/form-data`

**表单字段**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| image | File | 是 | 图片文件 |
| analyze | boolean | 否 | 是否进行 AI 分析 |

**响应示例**:
```json
{
  "url": "https://pub-xxx.r2.dev/characters/novel456/1713571200.jpg",
  "key": "characters/novel456/1713571200.jpg",
  "analysis": {
    "description": "一位黑发少年，眼神坚毅...",
    "appearance": "黑发，剑眉星目，身穿青色长衫",
    "traits": ["坚毅", "勇敢", "正直"],
    "tags": ["热血少年", "古风", "主角"],
    "confidence": 0.85
  }
}
```

---

### 重新分析角色图片

**POST** `/api/characters/:id/analyze-image`

**请求体**:
```json
{
  "imageUrl": "https://pub-xxx.r2.dev/characters/novel456/1713571200.jpg"
}
```

**响应**: 同上传图片的 `analysis` 字段

---

### 更新角色

**PATCH** `/api/characters/:id`

**请求体**:
```json
{
  "name": "新名字",
  "description": "新的描述",
  "role": "antagonist",
  "attributes": {
    "age": 20
  }
}
```

---

### 删除角色

**DELETE** `/api/characters/:id`

---

## AI 生成 (Generate)

### 生成章节

**POST** `/api/generate/chapter`

**Content-Type**: `application/json`

**请求体**:
```json
{
  "chapterId": "chap123",       // 必填
  "novelId": "novel456",        // 必填
  "config": {                   // 可选
    "maxIterations": 3,
    "enableRAG": true,
    "enableAutoSummary": true
  }
}
```

**响应类型**: `text/event-stream` (SSE 流)

**SSE 数据格式**:
```
data: 林风深吸一口气...

data: 体内的灵力开始运转...

data: [DONE]
```

**客户端示例**:
```javascript
const response = await fetch('/api/generate/chapter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chapterId: 'chap123', novelId: 'novel456' })
})

const reader = response.body.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  const text = decoder.decode(value)
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
      const content = line.slice(6)
      console.log('Received:', content)
    }
  }
}
```

---

### 取消生成

**POST** `/api/generate/cancel`

**说明**: 当前版本不支持服务端取消，客户端应使用 `AbortController`

**客户端取消示例**:
```javascript
const controller = new AbortController()

const response = await fetch('/api/generate/chapter', {
  method: 'POST',
  signal: controller.signal,
  // ...
})

// 需要取消时
controller.abort()
```

---

## 导出服务 (Export)

### 获取可用格式

**GET** `/api/export/formats`

**响应示例**:
```json
{
  "formats": [
    {
      "id": "md",
      "name": "Markdown",
      "extension": ".md",
      "mimeType": "text/markdown",
      "supportsTOC": true,
      "supportsMeta": true
    },
    {
      "id": "txt",
      "name": "纯文本",
      "extension": ".txt",
      "mimeType": "text/plain",
      "supportsTOC": true,
      "supportsMeta": true
    },
    {
      "id": "epub",
      "name": "EPUB 电子书",
      "extension": ".epub",
      "mimeType": "application/epub+zip",
      "supportsTOC": true,
      "supportsMeta": true
    },
    {
      "id": "zip",
      "name": "ZIP 打包",
      "extension": ".zip",
      "mimeType": "application/zip",
      "supportsTOC": false,
      "supportsMeta": false
    }
  ]
}
```

---

### 导出小说

**POST** `/api/export`

**请求体**:
```json
{
  "novelId": "novel456",        // 必填
  "format": "epub",             // 必填：md/txt/epub/zip
  "options": {                  // 可选
    "includeTOC": true,         // 包含目录
    "includeMeta": true,        // 包含元数据
    "volumeRange": [1, 3]       // 卷范围，不传则导出全部
  }
}
```

**响应**: 文件下载（二进制流）

**响应头**:
```http
Content-Type: application/octet-stream
Content-Disposition: attachment; filename="小说标题.epub"
X-Export-Meta: {"wordCount":125000,"chapterCount":42}
```

---

### 获取导出进度

**GET** `/api/export/progress/:taskId`

**说明**: 对于大型导出任务，可以轮询进度

**响应示例**:
```json
{
  "taskId": "task123",
  "status": "processing",       // pending/processing/completed/failed
  "progress": 0.6,              // 0-1
  "estimatedTimeRemaining": 30  // 秒
}
```

---

## 设置服务 (Settings)

### 获取模型配置列表

**GET** `/api/settings/model-configs`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| novelId | string | 否 | 小说 ID，不传则返回全局配置 |

**响应示例**:
```json
[
  {
    "id": "config123",
    "novelId": null,            // null 表示全局配置
    "scope": "global",
    "stage": "chapter_gen",
    "provider": "volcengine",
    "modelId": "doubao-seed-2-pro",
    "apiBase": "https://ark.cn-beijing.volces.com/api/v3",
    "apiKeyEnv": "VOLCENGINE_API_KEY",
    "params": "{\"temperature\":0.85,\"max_tokens\":4096}",
    "isActive": 1,
    "createdAt": 1713571200,
    "updatedAt": 1713657600
  }
]
```

---

### 创建模型配置

**POST** `/api/settings/model-configs`

**请求体**:
```json
{
  "novelId": "novel456",        // 可选，不传则为全局
  "scope": "novel",             // global/novel
  "stage": "chapter_gen",       // outline_gen/chapter_gen/summary_gen/vision
  "provider": "volcengine",     // volcengine/anthropic/openai/custom
  "modelId": "doubao-seed-2-pro",
  "apiBase": "https://ark.cn-beijing.volces.com/api/v3",
  "apiKeyEnv": "VOLCENGINE_API_KEY",
  "params": {
    "temperature": 0.85,
    "max_tokens": 4096,
    "top_p": 0.9
  }
}
```

---

### 更新模型配置

**PATCH** `/api/settings/model-configs/:id`

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

---

### 删除模型配置

**DELETE** `/api/settings/model-configs/:id`

---

## 伏笔管理 (Foreshadowing)

### 获取伏笔列表

**GET** `/api/foreshadowing/:novelId`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| status | string | 否 | 按状态过滤：open/resolved/abandoned |
| limit | number | 否 | 返回数量限制，默认50 |

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
      "resolvedChapterId": null,
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

**请求体**:
```json
{
  "novelId": "novel456",                              // 必填
  "chapterId": "chap789",                             // 可选，埋下伏笔的章节
  "title": "神秘玉佩的来历",                           // 必填，最多100字符
  "description": "主角捡到的玉佩似乎隐藏着重大秘密",    // 可选，最多1000字符
  "importance": "high"                                // 可选：high/normal/low，默认normal
}
```

---

### 更新伏笔

**PUT** `/api/foreshadowing/:id`

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

**说明**: 软删除

---

## 内容搜索 (Search)

### 搜索章节内容

**GET** `/api/search`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词，至少2字符 |
| novelId | string | 否 | 限定小说范围 |
| limit | number | 否 | 返回数量限制，默认20 |

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

**请求体**:
```json
{
  "sourceType": "chapter",         // 必填：outline/chapter/character/summary
  "sourceId": "chap123",           // 必填
  "novelId": "novel456",           // 必填
  "title": "第一章：少年林风",      // 必填
  "content": "章节内容..."          // 可选，不提供时自动从数据库获取
}
```

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

**说明**: 删除指定内容的向量索引

---

### 相似度搜索

**GET** `/api/vectorize/search`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索文本 |
| novelId | string | 否 | 限定小说范围 |

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

### 检查向量化状态

**GET** `/api/vectorize/status`

**响应示例**:
```json
{
  "status": "ok",
  "message": "Vectorize service is operational",
  "embeddingModel": "@cf/baai/bge-base-zh-v1.5",
  "dimensions": 768
}
```

---

## MCP 服务 (MCP)

### MCP 端点

**POST** `/api/mcp`

**Content-Type**: `application/json`

**支持的 MCP 方法**:
- `tools/list` - 列出可用工具
- `tools/call` - 调用工具

**可用工具**:
| 工具名 | 描述 |
|--------|------|
| `queryNovels` | 查询小说列表 |
| `queryOutlines` | 查询指定小说的大纲结构 |
| `queryChapters` | 查询指定小说的章节列表 |
| `getChapterContent` | 获取指定章节的完整内容 |
| `searchSemantic` | 语义搜索相关大纲、章节或角色 |

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

## 健康检查

### 检查服务状态

**GET** `/api/health`

**响应示例**:
```json
{
  "ok": true,
  "ts": 1713571234567,
  "phase": 4
}
```

**字段说明**:
| 字段 | 类型 | 说明 |
|------|------|------|
| ok | boolean | 服务是否正常 |
| ts | number | Unix 时间戳（毫秒） |
| phase | number | 当前功能阶段 |

---

## 错误码参考

### 通用错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `INVALID_REQUEST` | 400 | 请求格式错误或缺少必填字段 |
| `VALIDATION_ERROR` | 400 | 字段验证失败 |
| `UNAUTHORIZED` | 401 | 未提供认证令牌 |
| `FORBIDDEN` | 403 | 无权限访问 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `CONFLICT` | 409 | 资源冲突（如重名） |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 业务错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `NOVEL_NOT_FOUND` | 404 | 小说不存在 |
| `MASTER_OUTLINE_NOT_FOUND` | 404 | 总纲不存在 |
| `CHAPTER_NOT_FOUND` | 404 | 章节不存在 |
| `CHARACTER_NOT_FOUND` | 404 | 角色不存在 |
| `FORESHADOWING_NOT_FOUND` | 404 | 伏笔不存在 |
| `MODEL_CONFIG_MISSING` | 400 | 未配置模型 |
| `AI_GENERATION_FAILED` | 500 | AI 生成失败 |
| `EXPORT_FAILED` | 500 | 导出失败 |
| `UPLOAD_FAILED` | 500 | 文件上传失败 |
| `VECTORIZE_ERROR` | 500 | 向量数据库错误 |
| `VECTORIZE_NOT_CONFIGURED` | 503 | Vectorize 服务未配置 |

### 错误响应示例

```json
{
  "error": "章节不存在",
  "code": "CHAPTER_NOT_FOUND",
  "details": {
    "chapterId": "invalid_id"
  }
}
```

---

## 速率限制

### 免费额度

| 接口类别 | 限制 |
|----------|------|
| 常规 API | 100 次/分钟 |
| 文件上传 | 10 次/分钟 |
| AI 生成 | 10 次/小时 |
| 导出 | 5 次/小时 |

### 限流响应

```json
{
  "error": "请求过于频繁，请稍后再试",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60
}
```

**HTTP 状态码**: 429 Too Many Requests

**响应头**:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1713571290
Retry-After: 60
```

---

## WebSocket 接口（未来版本）

### 实时生成通知

**待实现**: 用于长任务的状态推送

```javascript
const ws = new WebSocket('wss://your-domain.pages.dev/ws/generate')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  switch (data.type) {
    case 'progress':
      console.log('生成进度:', data.progress)
      break
    case 'complete':
      console.log('生成完成:', data.chapterId)
      break
    case 'error':
      console.error('生成失败:', data.error)
      break
  }
}
```

---

## SDK 示例

### JavaScript/TypeScript

```typescript
import { NovelforgeClient } from '@novelforge/client'

const client = new NovelforgeClient({
  baseUrl: 'https://your-domain.pages.dev/api',
  apiKey: 'your-api-key' // 如需认证
})

// 获取小说列表
const novels = await client.novels.list()

// 创建小说
const novel = await client.novels.create({
  title: '我的小说',
  genre: '玄幻'
})

// 生成章节
const stream = await client.generate.chapter({
  chapterId: 'chap123',
  novelId: 'novel456'
})

for await (const chunk of stream) {
  console.log(chunk.text)
}
```

### Python（未来版本）

```python
from novelforge import NovelforgeClient

client = NovelforgeClient(api_key="your-api-key")

# 获取小说列表
novels = client.novels.list()

# 创建小说
novel = client.novels.create(
    title="我的小说",
    genre="玄幻"
)
```

---

## 附录

### A. 完整的数据类型定义

详见 [src/lib/types.ts](../src/lib/types.ts)

### B. OpenAPI 规范

完整的 OpenAPI 3.0 规范文件可在 `/openapi.yaml` 获取（开发中）。

### C. Postman 集合

导入 Postman 集合：[NovelForge API.postman_collection.json](https://example.com/NovelForge_API.postman_collection.json)（待提供）

---

<div align="center">

**API Version: 1.6.0**

</div>
