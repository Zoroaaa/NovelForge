/**
 * WorkshopSidebar.tsx
 * 创意工坊会话历史侧边栏组件
 *
 * 功能（借鉴OSSshelf-main ChatSidebar）：
 * - 展示会话列表
 * - 新建对话
 * - 重命名/删除会话
 * - 移动端遮罩
 */

import { Plus, Trash2, Pencil, X, Check, BookOpen } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface SessionItem {
  id: string;
  title: string;
  updatedAt: number;
  stage?: string;
}

interface WorkshopSidebarProps {
  showSidebar: boolean;
  sessions: SessionItem[];
  currentSessionId: string | null;
  renamingId: string | null;
  renameValue: string;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onDeleteSession: (e: React.MouseEvent, id: string) => void;
  onStartRename: (session: SessionItem) => void;
  onConfirmRename: (id: string) => void;
  onCancelRename: () => void;
  onRenameValueChange: (value: string) => void;
  onCloseMobile: () => void;
}

function formatTime(dateStr: string | number): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function WorkshopSidebar({
  showSidebar,
  sessions,
  currentSessionId,
  renamingId,
  renameValue,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onRenameValueChange,
  onCloseMobile,
}: WorkshopSidebarProps) {
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [renamingId]);

  return (
    <>
      {showSidebar && (
        <div className="lg:hidden fixed inset-0 z-20 bg-black/40 backdrop-blur-sm" onClick={onCloseMobile} />
      )}

      <aside
        className={`flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex-shrink-0 ${
          showSidebar ? 'w-64' : 'w-0'
        } fixed inset-y-0 left-0 z-30 lg:relative lg:z-auto overflow-hidden`}
      >
        <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            创作历史
          </span>
          <button
            onClick={onNewChat}
            className="h-7 w-7 rounded-lg flex items-center justify-center hover:bg-violet-50 dark:hover:bg-slate-800 text-violet-600 hover:text-violet-700 transition-colors"
            title="新建对话"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 p-1.5 space-y-0.5">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
              <BookOpen className="h-8 w-8 text-slate-300 dark:text-slate-600 mb-2" />
              <p className="text-xs text-slate-400">暂无创作记录</p>
              <p className="text-[10px] text-slate-400 mt-1">开始你的第一部小说创作</p>
            </div>
          ) : (
            sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={`relative group rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                  session.id === currentSessionId
                    ? 'bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                {renamingId === session.id ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      ref={renameRef}
                      value={renameValue}
                      onChange={(e) => onRenameValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') onConfirmRename(session.id);
                        if (e.key === 'Escape') onCancelRename();
                      }}
                      className="flex-1 text-xs bg-white dark:bg-slate-700 border border-violet-300 dark:border-violet-600 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <button
                      onClick={() => onConfirmRename(session.id)}
                      className="p-1 rounded text-green-600 hover:bg-green-100"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button onClick={onCancelRename} className="p-1 rounded text-slate-400 hover:bg-slate-100">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-1">
                      <span
                        className={`text-xs font-medium truncate flex-1 leading-snug ${
                          session.id === currentSessionId
                            ? 'text-violet-700 dark:text-violet-300'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {session.title || '未命名对话'}
                      </span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartRename(session);
                          }}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
                          title="重命名"
                        >
                          <Pencil className="h-2.5 w-2.5" />
                        </button>
                        <button
                          onClick={(e) => onDeleteSession(e, session.id)}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-slate-400 hover:text-red-500"
                          title="删除"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p className="text-[10px] text-slate-400">{formatTime(session.updatedAt)}</p>
                      {session.stage && session.stage !== 'concept_development' && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-500 dark:text-violet-400">
                          {session.stage === 'character_design' && '角色设计'}
                          {session.stage === 'worldbuilding' && '世界观构建'}
                          {session.stage === 'plot_outline' && '情节大纲'}
                          {session.stage === 'chapter_planning' && '章节规划'}
                          {session.stage === 'writing' && '写作中'}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </aside>
    </>
  );
}
