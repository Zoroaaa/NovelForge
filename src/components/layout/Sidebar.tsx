import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OutlineTree } from '@/components/outline/OutlineTree'
import { ChapterList } from '@/components/chapter/ChapterList'
import { CharacterList } from '@/components/character/CharacterList'
import { useNovelStore } from '@/store/novelStore'

interface SidebarProps {
  novelId: string
  onChapterSelect?: (chapterId: string) => void
}

export function Sidebar({ novelId, onChapterSelect }: SidebarProps) {
  const { sidebarTab, setSidebarTab } = useNovelStore()

  return (
    <div className="p-4 h-full flex flex-col">
      <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as any)} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="outline">大纲</TabsTrigger>
          <TabsTrigger value="chapters">章节</TabsTrigger>
          <TabsTrigger value="characters">角色</TabsTrigger>
        </TabsList>

        <TabsContent value="outline" className="flex-1 overflow-y-auto mt-0">
          <OutlineTree novelId={novelId} />
        </TabsContent>

        <TabsContent value="chapters" className="flex-1 overflow-y-auto mt-0">
          <ChapterList novelId={novelId} onChapterSelect={onChapterSelect} />
        </TabsContent>

        <TabsContent value="characters" className="flex-1 overflow-y-auto mt-0">
          <CharacterList novelId={novelId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
