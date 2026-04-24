/**
 * @file Sidebar.tsx
 * @description 侧边栏组件，提供章节、角色、设定、规则等功能的标签页切换
 * @version 3.0.0
 * @modified 2026-04-23 - 重构为Tabs+紧凑导航布局，解决内容拥挤问题，统一UI规范
 */
import { ChapterList } from '@/components/chapter/ChapterList'
import { CharacterList } from '@/components/character/CharacterList'
import { NovelSettingsPanel } from '@/components/novelsetting/NovelSettingsPanel'
import { RulesPanel } from '@/components/rules/RulesPanel'
import { OutlinePanel } from '@/components/outline/OutlinePanel'
import { ForeshadowingPanel } from '@/components/foreshadowing/ForeshadowingPanel'
import { PowerLevelPanel } from '@/components/powerlevel/PowerLevelPanel'
import { VolumePanel } from '@/components/volume/VolumePanel'
import { EntityTreePanel } from '@/components/entitytree/EntityTreePanel'
import { TrashPanel } from '@/components/trash/TrashPanel'
import { useNovelStore } from '@/store/novelStore'
import {
  BookOpen,
  Users,
  Layers,
  ScrollText,
  AlignLeft,
  Library,
  Bookmark,
  Swords,
  TreePine,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useState, useMemo } from 'react'

interface SidebarProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

interface TabGroup {
  id: string
  label: string
  items: readonly {
    value: string
    label: string
    icon: React.ElementType
  }[]
}

const TAB_GROUPS: TabGroup[] = [
  {
    id: 'content',
    label: '内容',
    items: [
      { value: 'chapters', label: '章节', icon: BookOpen },
      { value: 'characters', label: '角色', icon: Users },
      { value: 'settings', label: '设定', icon: Layers },
    ] as const,
  },
  {
    id: 'structure',
    label: '结构',
    items: [
      { value: 'volumes', label: '卷', icon: Library },
      { value: 'outline', label: '总纲', icon: AlignLeft },
      { value: 'foreshadowing', label: '伏笔', icon: Bookmark },
      { value: 'power-level', label: '境界', icon: Swords },
      { value: 'rules', label: '规则', icon: ScrollText },
    ] as const,
  },
  {
    id: 'management',
    label: '管理',
    items: [
      { value: 'entity-tree', label: '实体树', icon: TreePine },
      { value: 'trash', label: '回收站', icon: Trash2 },
    ] as const,
  },
]

export function Sidebar({ novelId, onChapterSelect }: SidebarProps) {
  const { sidebarTab, setSidebarTab } = useNovelStore()

  // 计算当前激活的Tab分组
  const activeGroup = useMemo(
    () => TAB_GROUPS.find(g => g.items.some(item => item.value === sidebarTab)) ?? TAB_GROUPS[0],
    [sidebarTab]
  )

  const [activeTabId, setActiveTabId] = useState(activeGroup.id)

  // 切换Tab分组时，若当前子功能不在新分组内，自动选中该分组第一个子功能
  const handleTabChange = (groupId: string) => {
    setActiveTabId(groupId)
    const group = TAB_GROUPS.find(g => g.id === groupId)
    if (group && !group.items.some(item => item.value === sidebarTab)) {
      setSidebarTab(group.items[0].value as typeof sidebarTab)
    }
  }

  const renderContent = () => {
    switch (sidebarTab) {
      case 'chapters':
        return <ChapterList novelId={novelId} onChapterSelect={onChapterSelect} />
      case 'characters':
        return <CharacterList novelId={novelId} />
      case 'settings':
        return <NovelSettingsPanel novelId={novelId} />
      case 'rules':
        return <RulesPanel novelId={novelId} />
      case 'outline':
        return <OutlinePanel novelId={novelId} />
      case 'volumes':
        return <VolumePanel novelId={novelId} onChapterSelect={onChapterSelect} />
      case 'foreshadowing':
        return <ForeshadowingPanel novelId={novelId} onChapterSelect={onChapterSelect} />
      case 'power-level':
        return <PowerLevelPanel novelId={novelId} />
      case 'entity-tree':
        return <EntityTreePanel novelId={novelId} onChapterSelect={onChapterSelect} />
      case 'trash':
        return <TrashPanel novelId={novelId} />
      default:
        return null
    }
  }

  const currentGroup = TAB_GROUPS.find(g => g.id === activeTabId) ?? TAB_GROUPS[0]

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 顶部Tab导航 */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg">
          {TAB_GROUPS.map(group => {
            const isActive = activeTabId === group.id
            return (
              <button
                key={group.id}
                onClick={() => handleTabChange(group.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all duration-200',
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                )}
              >
                <span className="truncate">{group.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 子功能导航 - 紧凑网格 */}
      <div className="px-3 pb-2">
        <div
          className={cn(
            'grid gap-1',
            currentGroup.items.length <= 3 ? 'grid-cols-3' : 'grid-cols-4'
          )}
        >
          {currentGroup.items.map(item => {
            const Icon = item.icon
            const isActive = sidebarTab === item.value
            return (
              <button
                key={item.value}
                onClick={() => setSidebarTab(item.value as typeof sidebarTab)}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 px-1 py-2 rounded-md text-xs transition-all duration-150',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 分隔线 */}
      <div className="mx-3 border-t border-border/40" />

      {/* 内容区域 - 占据剩余全部空间 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  )
}
