/**
 * collab.ts
 *
 * 协作分享 API 服务层
 *
 * 包含模块：
 * - Share：分享链接管理（创建/查询/下载/预览/上传链接/ZIP打包）
 * - Permissions：权限管理（授予/撤销/查询/标签/用户搜索）
 * - Groups：用户群组管理（CRUD/成员管理）
 * - Webhooks：Webhook 管理（CRUD/测试/事件列表）
 * - Notifications：通知管理（列表/已读/删除/SSE流）
 */

import api from './api-client';
import { useAuthStore } from '../stores/auth';
import type { ApiResponse, Share, ShareCreateParams, FileTag } from '@osshelf/shared';

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 分享相关
// ─────────────────────────────────────────────────────────────────────────────

/** 分享链接下的子文件条目 */
export interface ShareChildFile {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  isFolder: boolean;
  updatedAt: string;
}

/** 分享信息详情 */
export interface ShareInfo {
  id: string;
  file: {
    id: string;
    name: string;
    size: number;
    mimeType: string | null;
    isFolder: boolean;
  };
  children: ShareChildFile[] | null;
  expiresAt: string | null;
  downloadLimit: number | null;
  downloadCount: number;
  hasPassword: boolean;
}

/** 分享文件夹内的子目录信息 */
export interface ShareFolderInfo {
  folder: { id: string; name: string; size: number; mimeType: string | null; isFolder: true };
  children: ShareChildFile[];
  path: Array<{ id: string; name: string; isFolder: true }>;
}

/** 分享文件预览信息 */
export interface SharePreviewInfo {
  id: string;
  name: string;
  size: number;
  mimeType: string | null;
  previewType: string;
  canPreview: boolean;
}

/** 上传链接信息 */
export interface UploadLinkInfo {
  token: string;
  folderName: string;
  expiresAt: string | null;
  hasPassword: boolean;
  maxUploadSize: number;
  allowedMimeTypes: string[] | null;
  maxUploadCount: number | null;
  uploadCount: number;
}

/** 创建上传链接的参数 */
export interface CreateUploadLinkParams {
  folderId: string;
  password?: string;
  expiresAt?: string;
  maxUploadSize?: number;
  allowedMimeTypes?: string[];
  maxUploadCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Share — 分享链接管理
// ─────────────────────────────────────────────────────────────────────────────

export const shareApi = {
  create: (params: ShareCreateParams) => api.post<ApiResponse<Share>>('/api/share', params),
  list: () => api.get<ApiResponse<any[]>>('/api/share'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/share/${id}`),
  get: (id: string, password?: string) => api.get<ApiResponse<ShareInfo>>(`/api/share/${id}`, { params: { password } }),

  /** 获取分享文件夹下的子目录内容 */
  getFolder: (shareId: string, folderId: string, password?: string) =>
    api.get<ApiResponse<ShareFolderInfo>>(`/api/share/${shareId}/folder/${folderId}`, { params: { password } }),
  download: (id: string, password?: string) =>
    api.get(`/api/share/${id}/download`, { params: { password }, responseType: 'blob' }),
  downloadUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  childDownloadUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/download${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,

  // ── ZIP 打包下载 ──
  zipUrl: (shareId: string, password?: string, fileIds?: string[]) => {
    const base = `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/zip`;
    const params = new URLSearchParams();
    if (password) params.set('password', password);
    if (fileIds?.length) params.set('fileIds', fileIds.join(','));
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  },

  // ── 预览 & 流媒体 ──
  previewUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/preview${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  streamUrl: (id: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${id}/stream${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  getRawContent: (id: string, password?: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string }>>(`/api/share/${id}/raw`, { params: { password } }),
  getPreviewInfo: (id: string, password?: string) =>
    api.get<ApiResponse<SharePreviewInfo>>(`/api/share/${id}/preview-info`, { params: { password } }),

  // ── 子文件预览/流媒体/原始内容 ──
  childPreviewUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/preview${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  childStreamUrl: (shareId: string, fileId: string, password?: string) =>
    `${import.meta.env.VITE_API_URL || ''}/api/share/${shareId}/file/${fileId}/stream${
      password ? `?password=${encodeURIComponent(password)}` : ''
    }`,
  getChildRawContent: (shareId: string, fileId: string, password?: string) =>
    api.get<ApiResponse<{ content: string; mimeType: string }>>(`/api/share/${shareId}/file/${fileId}/raw`, {
      params: { password },
    }),

  // ── 上传链接 ──
  createUploadLink: (params: CreateUploadLinkParams) =>
    api.post<
      ApiResponse<{
        id: string;
        folderId: string;
        folderName: string;
        uploadToken: string;
        expiresAt: string;
        uploadUrl: string;
      }>
    >('/api/share/upload-link', params),
  getUploadLink: (token: string, password?: string) =>
    api.get<ApiResponse<UploadLinkInfo>>(`/api/share/upload/${token}`, { params: { password } }),

  /** 通过上传链接上传文件（支持进度回调） */
  uploadViaLink: (token: string, file: File, password?: string, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    if (password) formData.append('password', password);
    return api.post<ApiResponse<{ id: string; name: string; size: number; mimeType: string; createdAt: string }>>(
      `/api/share/upload/${token}`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
        onUploadProgress: (e) => {
          if (e.total && onProgress) onProgress(Math.round((e.loaded * 100) / e.total));
        },
      }
    );
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 权限相关
// ─────────────────────────────────────────────────────────────────────────────

/** 全局权限条目 */
export interface GlobalPermission {
  id: string;
  subjectType: 'user' | 'group';
  subjectId: string | null;
  subjectName: string;
  fileId: string;
  fileName: string;
  filePath: string;
  isFolder: boolean;
  permission: 'read' | 'write' | 'admin';
  expiresAt: string | null;
  createdAt: string;
}

/** 权限解析结果 */
export interface ResolvedPermission {
  hasAccess: boolean;
  permission: string | null;
  source: 'explicit' | 'inherited' | 'owner';
  sourceFileId?: string;
  sourceFilePath?: string;
  expiresAt?: string;
}

/** 可搜索的用户（用于权限分配） */
export interface SearchableUser {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions — 文件权限管理
// ─────────────────────────────────────────────────────────────────────────────

export const permissionsApi = {
  grant: (data: {
    fileId: string;
    userId?: string;
    groupId?: string;
    permission: 'read' | 'write' | 'admin';
    subjectType?: 'user' | 'group';
    expiresAt?: string;
  }) => api.post<ApiResponse<{ message: string }>>('/api/permissions/grant', data),
  revoke: (data: { fileId: string; userId?: string; groupId?: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/revoke', data),

  /** 获取文件的完整权限列表（含继承关系） */
  getFilePermissions: (fileId: string) =>
    api.get<
      ApiResponse<{
        isOwner: boolean;
        permissions: Array<{
          id: string;
          userId: string | null;
          groupId: string | null;
          permission: string;
          userName: string | null;
          userEmail: string;
          groupName?: string;
          subjectType: 'user' | 'group';
          expiresAt: string | null;
          scope: 'explicit' | 'inherited';
          createdAt: string;
        }>;
      }>
    >(`/api/permissions/file/${fileId}`),

  checkAccess: (fileId: string) =>
    api.get<ApiResponse<{ hasAccess: boolean; permission: string | null; isOwner: boolean }>>(
      `/api/permissions/check/${fileId}`
    ),

  /** 解析文件的最终有效权限（显式/继承/所有者） */
  resolvePermission: (fileId: string) => api.get<ApiResponse<ResolvedPermission>>(`/api/permissions/resolve/${fileId}`),

  searchUsers: (query: string) =>
    api.get<ApiResponse<SearchableUser[]>>('/api/permissions/users/search', { params: { q: query } }),

  // ── 标签管理 ──
  addTag: (data: { fileId: string; name: string; color?: string }) =>
    api.post<ApiResponse<FileTag>>('/api/permissions/tags/add', data),
  removeTag: (data: { fileId: string; tagName: string }) =>
    api.post<ApiResponse<{ message: string }>>('/api/permissions/tags/remove', data),
  getFileTags: (fileId: string) => api.get<ApiResponse<FileTag[]>>(`/api/permissions/tags/file/${fileId}`),
  getUserTags: () => api.get<ApiResponse<FileTag[]>>('/api/permissions/tags/user'),
  getBatchFileTags: (fileIds: string[]) =>
    api.post<ApiResponse<Record<string, FileTag[]>>>('/api/permissions/tags/batch', { fileIds }),

  // ── 全局权限视图 ──
  getAllPermissions: () => api.get<ApiResponse<{ permissions: GlobalPermission[] }>>('/api/permissions/all'),
  revokeById: (permissionId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`),
  updatePermission: (permissionId: string, permission: 'read' | 'write' | 'admin', expiresAt?: string) =>
    api.patch<ApiResponse<{ message: string }>>(`/api/permissions/${permissionId}`, { permission, expiresAt }),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 群组相关
// ─────────────────────────────────────────────────────────────────────────────

/** 用户群组 */
export interface UserGroup {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  isOwner: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 群组成员 */
export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  role: 'member' | 'admin';
  addedBy: string | null;
  createdAt: string;
  name: string | null;
  email: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Groups — 用户群组管理
// ─────────────────────────────────────────────────────────────────────────────

export const groupsApi = {
  list: () => api.get<ApiResponse<{ owned: UserGroup[]; memberOf: UserGroup[] }>>('/api/groups'),
  create: (data: { name: string; description?: string }) => api.post<ApiResponse<UserGroup>>('/api/groups', data),
  get: (id: string) => api.get<ApiResponse<UserGroup>>(`/api/groups/${id}`),
  update: (id: string, data: { name?: string; description?: string }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/groups/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/groups/${id}`),
  getMembers: (id: string) => api.get<ApiResponse<GroupMember[]>>(`/api/groups/${id}/members`),
  addMember: (groupId: string, data: { userId: string; role?: 'member' | 'admin' }) =>
    api.post<ApiResponse<GroupMember>>(`/api/groups/${groupId}/members`, data),
  removeMember: (groupId: string, userId: string) =>
    api.delete<ApiResponse<{ message: string }>>(`/api/groups/${groupId}/members/${userId}`),
  updateMemberRole: (groupId: string, userId: string, role: 'member' | 'admin') =>
    api.put<ApiResponse<{ message: string }>>(`/api/groups/${groupId}/members/${userId}/role`, { role }),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — Webhook 相关
// ─────────────────────────────────────────────────────────────────────────────

/** Webhook 条目 */
export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string[];
  isActive: boolean;
  lastStatus: number | null;
  createdAt: string;
}

/** Webhook 事件类型 */
export interface WebhookEvent {
  value: string;
  label: string;
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhooks — Webhook 管理
// ─────────────────────────────────────────────────────────────────────────────

export const webhooksApi = {
  list: () => api.get<ApiResponse<Webhook[]>>('/api/webhooks'),
  create: (data: { url: string; events: string[]; secret?: string }) =>
    api.post<ApiResponse<Webhook & { secret: string; warning: string }>>('/api/webhooks', data),
  update: (id: string, data: { url?: string; events?: string[]; isActive?: boolean }) =>
    api.put<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`, data),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/webhooks/${id}`),
  test: (id: string) => api.post<ApiResponse<{ message: string }>>(`/api/webhooks/${id}/test`),
  getEvents: () => api.get<ApiResponse<WebhookEvent[]>>('/api/webhooks/events'),
};

// ─────────────────────────────────────────────────────────────────────────────
// 类型定义 — 通知相关
// ─────────────────────────────────────────────────────────────────────────────

/** 通知条目 */
export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: string | null;
  isRead: boolean;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications — 通知管理
// ─────────────────────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (params?: { page?: number; limit?: number; unreadOnly?: boolean }) =>
    api.get<ApiResponse<{ items: Notification[]; total: number; page: number; limit: number; totalPages: number }>>(
      '/api/notifications',
      { params }
    ),
  getUnreadCount: () => api.get<ApiResponse<{ count: number }>>('/api/notifications/unread-count'),
  markRead: (id: string) => api.put<ApiResponse<{ message: string }>>(`/api/notifications/${id}/read`),
  markAllRead: () => api.put<ApiResponse<{ message: string }>>('/api/notifications/read-all'),
  delete: (id: string) => api.delete<ApiResponse<{ message: string }>>(`/api/notifications/${id}`),
  clearRead: () => api.delete<ApiResponse<{ message: string }>>('/api/notifications/read'),

  /** SSE 实时通知流 */
  stream: (options?: { signal?: AbortSignal }) =>
    fetch(`${import.meta.env.VITE_API_URL || ''}/api/notifications/stream`, {
      method: 'GET',
      headers: {
        Authorization: useAuthStore.getState().token ? `Bearer ${useAuthStore.getState().token}` : '',
        Accept: 'text/event-stream',
      },
      credentials: 'include',
      signal: options?.signal,
    }),
};
