import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChapterList } from '@/components/chapter/ChapterList'
import { CharacterList } from '@/components/character/CharacterList'
import { SettingsPanel } from '@/components/settings/SettingsPanel'
import { RulesPanel } from '@/components/settings/RulesPanel'
import { MasterOutlinePanel } from '@/components/settings/MasterOutlinePanel'
import { ForeshadowingPanel } from '@/components/settings/ForeshadowingPanel'
import { useNovelStore } from '@/store/novelStore'

interface SidebarProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

export function Sidebar({ novelId, onChapterSelect }: SidebarProps) {
  const { sidebarTab, setSidebarTab } = useNovelStore()

  return (
    <div className="p-4 h-full flex flex-col">
      <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as any)} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid w-full grid-cols-6 mb-4 h-auto gap-1">
          <TabsTrigger value="chapters" className="text-xs py-1.5">章节</TabsTrigger>
          <TabsTrigger value="characters" className="text-xs py-1.5">角色</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs py-1.5">设定</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs py-1.5">规则</TabsTrigger>
          <TabsTrigger value="outline" className="text-xs py-1.5">总纲</TabsTrigger>
          <TabsTrigger value="foreshadowing" className="text-xs py-1.5">伏笔</TabsTrigger>
        </TabsList>

        {/* 章节管理 */}
        <TabsContent value="chapters" className="flex-1 overflow-y-auto mt-0">
          <ChapterList novelId={novelId} onChapterSelect={onChapterSelect} />
        </TabsContent>

        {/* 角色管理 */}
        <TabsContent value="characters" className="flex-1 overflow-y-auto mt-0">
          <CharacterList novelId={novelId} />
        </TabsContent>

        {/* v2.0: 小说设定管理（完整功能） */}
        <TabsContent value="settings" className="flex-1 overflow-y-auto mt-0">
          <SettingsPanel novelId={novelId} />
        </TabsContent>

        {/* v2.0: 创作规则管理（完整功能） */}
        <TabsContent value="rules" className="flex-1 overflow-y-auto mt-0">
          <RulesPanel novelId={novelId} />
        </TabsContent>

        {/* v2.0: 总纲编辑器（版本控制） */}
        <TabsContent value="outline" className="flex-1 overflow-y-auto mt-0">
          <MasterOutlinePanel novelId={novelId} />
        </TabsContent>

        {/* Phase 1.2 / v2.0: 伏笔追踪面板 */}
        <TabsContent value="foreshadowing" className="flex-1 overflow-y-auto mt-0">
          <ForeshadowingPanel novelId={novelId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
