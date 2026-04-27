import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { ExtractedData } from './types'
import { getStageName } from './types'

interface CommitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  extractedData: ExtractedData
  sessionNovelId: string | null
  stage: string
  onCommit: () => void
  isCommitting: boolean
}

export function CommitDialog({
  open,
  onOpenChange,
  extractedData,
  sessionNovelId,
  stage,
  onCommit,
  isCommitting,
}: CommitDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>确认提交创作数据？</DialogTitle>
          <DialogDescription>
            {sessionNovelId ? '确认后将更新已有小说项目的相关数据' : '确认后将创建新的小说项目并写入数据库'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <p className="text-sm text-muted-foreground">
            {sessionNovelId ? '以下数据将被更新到已有小说项目：' : '以下数据将被写入数据库并创建新的小说项目：'}
          </p>

          <div className="grid grid-cols-2 gap-2 text-sm">
            {sessionNovelId ? (
              <>
                {stage === 'concept' && (
                  <>
                    {extractedData.title && (
                      <div className="p-2 bg-primary/5 rounded">
                        <span className="text-muted-foreground">标题：</span>
                        <span className="font-medium">{extractedData.title}</span>
                      </div>
                    )}
                    {extractedData.genre && (
                      <div className="p-2 bg-primary/5 rounded">
                        <span className="text-muted-foreground">流派：</span>
                        <span className="font-medium">{extractedData.genre}</span>
                      </div>
                    )}
                    {extractedData.coreAppeal && extractedData.coreAppeal.length > 0 && (
                      <div className="p-2 bg-primary/5 rounded">
                        <span className="text-muted-foreground">核心看点：</span>
                        <span className="font-medium">{extractedData.coreAppeal.length} 项</span>
                      </div>
                    )}
                    {extractedData.writingRules && extractedData.writingRules.length > 0 && (
                      <div className="p-2 bg-orange-50 dark:bg-orange-950 rounded">
                        <span className="text-muted-foreground">创作规则：</span>
                        <span className="font-medium">{extractedData.writingRules.length} 条</span>
                      </div>
                    )}
                  </>
                )}
                {stage === 'worldbuild' && (
                  <div className="p-2 bg-green-50 dark:bg-green-950 rounded col-span-2">
                    <span className="text-muted-foreground">世界观设定：</span>
                    <span className="font-medium">{extractedData.worldSettings?.length || 0} 项</span>
                  </div>
                )}
                {stage === 'character_design' && (
                  <div className="p-2 bg-purple-50 dark:bg-purple-950 rounded col-span-2">
                    <span className="text-muted-foreground">角色：</span>
                    <span className="font-medium">{extractedData.characters?.length || 0} 个</span>
                  </div>
                )}
                {stage === 'volume_outline' && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded col-span-2">
                    <span className="text-muted-foreground">卷纲：</span>
                    <span className="font-medium">{extractedData.volumes?.length || 0} 卷</span>
                  </div>
                )}
                {stage === 'chapter_outline' && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950 rounded col-span-2">
                    <span className="text-muted-foreground">章节大纲：</span>
                    <span className="font-medium">{extractedData.chapters?.length || 0} 章</span>
                  </div>
                )}
              </>
            ) : (
              <>
                {extractedData.title && (
                  <div className="p-2 bg-primary/5 rounded">
                    <span className="text-muted-foreground">标题：</span>
                    <span className="font-medium">{extractedData.title}</span>
                  </div>
                )}
                {extractedData.genre && (
                  <div className="p-2 bg-primary/5 rounded">
                    <span className="text-muted-foreground">流派：</span>
                    <span className="font-medium">{extractedData.genre}</span>
                  </div>
                )}
                {extractedData.coreAppeal && extractedData.coreAppeal.length > 0 && (
                  <div className="p-2 bg-primary/5 rounded">
                    <span className="text-muted-foreground">核心看点：</span>
                    <span className="font-medium">{extractedData.coreAppeal.length} 项</span>
                  </div>
                )}
                {extractedData.writingRules && extractedData.writingRules.length > 0 && (
                  <div className="p-2 bg-orange-50 dark:bg-orange-950 rounded">
                    <span className="text-muted-foreground">创作规则：</span>
                    <span className="font-medium">{extractedData.writingRules.length} 条</span>
                  </div>
                )}
                {extractedData.worldSettings && extractedData.worldSettings.length > 0 && (
                  <div className="p-2 bg-green-50 dark:bg-green-950 rounded">
                    <span className="text-muted-foreground">世界观设定：</span>
                    <span className="font-medium">{extractedData.worldSettings.length} 项</span>
                  </div>
                )}
                {extractedData.characters && extractedData.characters.length > 0 && (
                  <div className="p-2 bg-purple-50 dark:bg-purple-950 rounded">
                    <span className="text-muted-foreground">角色：</span>
                    <span className="font-medium">{extractedData.characters.length} 个</span>
                  </div>
                )}
                {extractedData.volumes && extractedData.volumes.length > 0 && (
                  <div className="p-2 bg-blue-50 dark:bg-blue-950 rounded">
                    <span className="text-muted-foreground">卷纲：</span>
                    <span className="font-medium">{extractedData.volumes.length} 卷</span>
                  </div>
                )}
                {extractedData.chapters && extractedData.chapters.length > 0 && (
                  <div className="p-2 bg-amber-50 dark:bg-amber-950 rounded">
                    <span className="text-muted-foreground">章节大纲：</span>
                    <span className="font-medium">{extractedData.chapters.length} 章</span>
                  </div>
                )}
              </>
            )}
          </div>

          <p className="text-xs text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 p-2 rounded">
            ⚠️ 提交后将{sessionNovelId ? '更新' : '创建'}数据库中的{sessionNovelId ? getStageName(stage) + '数据' : '小说、总纲、角色、卷等记录'}。此操作不可撤销。
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onCommit} disabled={isCommitting}>
            {isCommitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                确认提交
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
