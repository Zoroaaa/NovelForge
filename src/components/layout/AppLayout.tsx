import { useState, useEffect } from 'react'
import { PanelRightClose, PanelRightOpen, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'

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
      setIsMobile(window.innerWidth < 1024)
      if (window.innerWidth < 1024) {
        setRightOpen(false)
      }
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 移动端左侧抽屉 */}
      {isMobile ? (
        <>
          <Sheet open={leftOpen} onOpenChange={setLeftOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="fixed top-4 left-4 z-50 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              {left}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        /* 桌面端左侧边栏 */
        <aside className="w-64 shrink-0 border-r overflow-y-auto hidden lg:block">
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
              variant="ghost"
              size="icon"
              className="fixed top-4 right-4 z-50"
            >
              <PanelRightOpen className="h-5 w-5" />
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
          variant="ghost"
          size="icon"
          className="fixed top-4 right-4 z-10"
          onClick={() => setRightOpen(true)}
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
}
