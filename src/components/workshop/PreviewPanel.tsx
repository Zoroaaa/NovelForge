import { BookOpen, FileText } from 'lucide-react'
import type { ExtractedData } from './types'
import { PreviewBasicInfo } from './PreviewBasicInfo'
import { PreviewWritingRules } from './PreviewWritingRules'
import { PreviewWorldSettings } from './PreviewWorldSettings'
import { PreviewCharacters } from './PreviewCharacters'
import { PreviewVolumes } from './PreviewVolumes'
import { PreviewChapters } from './PreviewChapters'

interface PreviewPanelProps {
  extractedData: ExtractedData
}

export function PreviewPanel({ extractedData }: PreviewPanelProps) {
  const hasData = Object.keys(extractedData).length > 0

  return (
    <div className="hidden lg:flex flex-col w-80 xl:w-96 border-l bg-muted/30 overflow-auto">
      <div className="p-6 space-y-6 sticky top-0">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          实时预览 - 已提取的数据
        </h3>

        {!hasData ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">暂无提取数据</p>
            <p className="text-xs mt-1">与 AI 对话后，这里会显示结构化的创作数据</p>
          </div>
        ) : (
          <div className="space-y-4">
            <PreviewBasicInfo data={extractedData} />
            <PreviewWritingRules rules={extractedData.writingRules || []} />
            <PreviewWorldSettings settings={extractedData.worldSettings || []} />
            <PreviewCharacters characters={extractedData.characters || []} />
            <PreviewVolumes volumes={extractedData.volumes || []} />
            <PreviewChapters chapters={extractedData.chapters || []} />
          </div>
        )}
      </div>
    </div>
  )
}
