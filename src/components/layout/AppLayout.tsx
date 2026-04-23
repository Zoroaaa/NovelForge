/**
 * @file AppLayout.tsx
 * @description 应用布局组件，提供三栏式响应式布局（左侧栏、中间内容、右侧面板）
 * @version 3.0.0
 * @modified 2026-04-23 - 严格实现2:4:1比例布局，优化响应式表现
 */
import { useState, useEffect } from 'react'
import { PanelRightClose, PanelRightOpen, PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface AppLayoutProps {
  left: React.ReactNode
  center: React.ReactNode
  right?: React.ReactNode
}

export function AppLayout({ left, center, right }: AppLayoutProps) {
  const [rightOpen, setRightOpen] = useState(true)
  const [leftOpen, setLeftOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (mobile) {
        setRightOpen(false)
        setLeftOpen(false)
      } else {
        setRightOpen(true)
        setLeftOpen(true)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <TooltipProvider>
      <div className="flex h-full overflow-hidden bg-background">
        {/* 左侧栏 - 2份比例 */}
        {isMobile ? (
          <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="fixed bottom-4 left-4 z-50 shadow-lg rounded-full h-10 w-10 p-0"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] max-w-[360px] p-0">
              {left}
            </SheetContent>
          </Sheet>
        ) : (
          <aside
            className={cn(
              'shrink-0 border-r border-border/60 bg-card/30 backdrop-blur-sm overflow-hidden flex flex-col transition-all duration-300 ease-in-out hidden lg:flex shadow-[1px_0_2px_rgba(0,0,0,0.02)]',
              leftOpen ? 'flex-[2] basis-[28.571%] min-w-[300px] max-w-[420px]' : 'w-0 border-0 opacity-0'
            )}
          >
            {leftOpen && left}
          </aside>
        )}

        {/* 中间内容区 - 4份比例 */}
        <main className="flex-[4] basis-[57.143%] min-w-0 overflow-y-auto bg-background relative">
          {center}
        </main>

        {/* 右侧栏 - 1份比例 */}
        {!isMobile && (
          <aside
            className={cn(
              'shrink-0 border-l border-border/60 bg-muted/20 backdrop-blur-sm overflow-hidden flex flex-col transition-all duration-300 ease-in-out hidden lg:flex shadow-[-1px_0_2px_rgba(0,0,0,0.02)]',
              rightOpen && right ? 'flex-[1] basis-[14.286%] min-w-[200px] max-w-[280px]' : 'w-0 border-0 opacity-0'
            )}
          >
            {rightOpen && right && (
              <>
                <div className="flex items-center justify-end px-2 py-1.5 border-b border-border/40">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md"
                    onClick={() => setRightOpen(false)}
                    title="收起右侧面板"
                  >
                    <PanelRightClose className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  {right}
                </div>
              </>
            )}
          </aside>
        )}

        {/* 移动端右侧面板 */}
        {isMobile && right && (
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="fixed bottom-4 right-4 z-50 shadow-lg rounded-full h-10 w-10 p-0"
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85vw] max-w-[360px] p-0">
              {right}
            </SheetContent>
          </Sheet>
        )}

        {/* 桌面端收起状态 - 快速展开按钮 */}
        {!isMobile && !rightOpen && right && (
          <Button
            variant="outline"
            size="sm"
            className="absolute top-3 right-3 z-30 gap-1.5 h-8 px-3 rounded-md shadow-sm border-border/60 bg-background/80 backdrop-blur-sm hover:bg-accent"
            onClick={() => setRightOpen(true)}
          >
            <PanelRightOpen className="h-4 w-4" />
            <span className="text-xs">AI面板</span>
          </Button>
        )}

        {!isMobile && !leftOpen && (
          <Button
            variant="outline"
            size="sm"
            className="absolute top-3 left-3 z-30 gap-1.5 h-8 px-3 rounded-md shadow-sm border-border/60 bg-background/80 backdrop-blur-sm hover:bg-accent"
            onClick={() => setLeftOpen(true)}
          >
            <PanelLeftOpen className="h-4 w-4" />
            <span className="text-xs">目录</span>
          </Button>
        )}
      </div>
    </TooltipProvider>
  )
}
