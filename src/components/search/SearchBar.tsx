/**
 * @file SearchBar.tsx
 * @description 全文搜索组件，提供章节内容的全文搜索功能
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState } from 'react'
import { getToken } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, Loader2, BookOpen } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface SearchResult {
  id: string
  novelId: string
  title: string
  chapterNumber: number
  summary: string | null
  snippet: string
}

interface SearchBarProps {
  novelId?: string
}

export function SearchBar({ novelId }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const navigate = useNavigate()

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim() || query.trim().length < 2) return

    setSearching(true)
    setSearched(true)

    try {
      const token = getToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`
      const url = `/api/search?q=${encodeURIComponent(query)}${novelId ? `&novelId=${novelId}` : ''}`
      const resp = await fetch(url, { headers })
      const data = await resp.json()
      setResults(data.results || [])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索章节内容..."
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Button type="submit" size="sm" className="h-9" disabled={searching || query.trim().length < 2}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : '搜索'}
        </Button>
      </form>

      {searched && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">未找到匹配内容</p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">找到 {results.length} 条结果</p>
              <ScrollArea className="max-h-80">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => navigate(`/novels/${r.novelId}`)}
                    className="w-full text-left p-2.5 border rounded hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs">
                        第{r.chapterNumber}章
                      </Badge>
                      <span className="text-xs font-medium truncate">{r.title}</span>
                    </div>
                    {r.snippet && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        ...{r.snippet}...
                      </p>
                    )}
                  </button>
                ))}
              </ScrollArea>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
