/**
 * @file Sidebar.tsx
 * @description 侧边栏组件，提供章节、角色、设定、规则等功能的标签页切换
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { ChapterList } from '@/components/chapter/ChapterList'
import { CharacterList } from '@/components/character/CharacterList'
import { NovelSettingsPanel } from '@/components/novelsetting/NovelSettingsPanel'
import { RulesPanel } from '@/components/rules/RulesPanel'
import { OutlinePanel } from '@/components/outline/OutlinePanel'
import { ForeshadowingPanel } from '@/components/foreshadowing/ForeshadowingPanel'
import { VolumePanel } from '@/components/volume/VolumePanel'
import { useNovelStore } from '@/store/novelStore'
import {
  BookOpen,
  Users,
  Layers,
  ScrollText,
  AlignLeft,
  Library,
  Bookmark,
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface SidebarProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

const NAV_ITEMS = [
  { value: 'chapters',      icon: BookOpen,   label: '章节' },
  { value: 'characters',    icon: Users,       label: '角色' },
  { value: 'settings',      icon: Layers,      label: '设定' },
  { value: 'rules',         icon: ScrollText,  label: '规则' },
  { value: 'outline',       icon: AlignLeft,   label: '总纲' },
  { value: 'volumes',       icon: Library,     label: '卷' },
  { value: 'foreshadowing', icon: Bookmark,    label: '伏笔' },
] as const

export function Sidebar({ novelId, onChapterSelect }: SidebarProps) {
  const { sidebarTab, setSidebarTab } = useNovelStore()

  const activeItem = NAV_ITEMS.find(item => item.value === sidebarTab)

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左侧图标导航栏 */}
      <nav className="w-12 shrink-0 flex flex-col items-center py-3 gap-1 border-r bg-muted/30">
        {NAV_ITEMS.map(({ value, icon: Icon, label }) => (
          <Tooltip key={value} delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setSidebarTab(value)}
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150',
                  sidebarTab === value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {label}
            </TooltipContent>
          </Tooltip>
        ))}
      </nav>

      {/* 右侧内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 面板标题 */}
        <div className="px-4 py-4 border-b bg-background/80 shrink-0">
          <h2 className="text-sm font-semibold tracking-wide text-foreground">
            {activeItem?.label ?? ''}
          </h2>
        </div>

        {/* 内容滚动区 */}
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === 'chapters' && (
            <ChapterList novelId={novelId} onChapterSelect={onChapterSelect} />
          )}
          {sidebarTab === 'characters' && (
            <CharacterList novelId={novelId} />
          )}
          {sidebarTab === 'settings' && (
            <NovelSettingsPanel novelId={novelId} />
          )}
          {sidebarTab === 'rules' && (
            <RulesPanel novelId={novelId} />
          )}
          {sidebarTab === 'outline' && (
            <OutlinePanel novelId={novelId} />
          )}
          {sidebarTab === 'volumes' && (
            <VolumePanel novelId={novelId} onChapterSelect={onChapterSelect} />
          )}
          {sidebarTab === 'foreshadowing' && (
            <ForeshadowingPanel novelId={novelId} onChapterSelect={onChapterSelect} />
          )}
        </div>
      </div>
    </div>
  )
}