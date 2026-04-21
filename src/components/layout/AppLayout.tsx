/**
 * @file AppLayout.tsx
 * @description 应用布局组件，提供三栏式响应式布局（左侧栏、中间内容、右侧面板）
 * @version 1.0.0
 * @modified 2026-04-21 - 添加规范化注释
 */
import { useState, useEffect } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'

interface AppLayoutProps {
  left: React.ReactNode
  center: React.ReactNode
  right?: React.ReactNode
}

export function AppLayout({ left, center, right }: AppLayoutProps) {
  const [rightOpen, setRightOpen] = useState(true)
  const [leftOpen, setLeftOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // 检测屏幕尺寸
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024
      setIsMobile(mobile)
      if (mobile) {
        setRightOpen(false)
      } else {
        setRightOpen(true)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <TooltipProvider>
    <div className="flex h-full overflow-hidden bg-background">
      {/* 移动端左侧抽屉 */}
      {isMobile ? (
        <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="fixed bottom-4 left-4 z-50 lg:hidden shadow-lg"
            >
              目录
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            {left}
          </SheetContent>
        </Sheet>
      ) : (
        /* 桌面端左侧边栏 */
        <aside className="w-72 shrink-0 border-r overflow-y-auto hidden lg:block">
          {left}
        </aside>
      )}

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto min-w-0">
        {center}
      </main>

      {/* 右侧边栏 - 桌面端 */}
      {!isMobile && rightOpen && right && (
        <aside className="w-80 shrink-0 border-l overflow-y-auto relative hidden lg:block">
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 z-10"
            onClick={() => setRightOpen(false)}
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          {right}
        </aside>
      )}

      {/* 右侧边栏 - 移动端抽屉 */}
      {isMobile && right && (
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="fixed bottom-4 right-4 z-50 shadow-lg"
            >
              AI
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-80 p-0">
            {right}
          </SheetContent>
        </Sheet>
      )}

      {/* 重新打开右侧面板按钮 - 桌面端 */}
      {!isMobile && !rightOpen && right && (
        <Button
          variant="outline"
          size="sm"
          className="absolute top-2 right-2 z-10 gap-1"
          onClick={() => setRightOpen(true)}
        >
          <PanelRightOpen className="h-4 w-4" />
          AI面板
        </Button>
      )}
    </div>
    </TooltipProvider>
  )
}
