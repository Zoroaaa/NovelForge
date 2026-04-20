import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OutlineTree } from '@/components/outline/OutlineTree'
import { ChapterList } from '@/components/chapter/ChapterList'
import { useNovelStore } from '@/store/novelStore'

interface SidebarProps {
  novelId: string
}

export function Sidebar({ novelId }: SidebarProps) {
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
          <ChapterList novelId={novelId} />
        </TabsContent>

        <TabsContent value="characters" className="flex-1 overflow-y-auto mt-0">
          <div className="text-center text-muted-foreground py-8">
            <p>角色管理功能开发中...</p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
