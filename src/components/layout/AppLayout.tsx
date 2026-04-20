import { useState } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AppLayoutProps {
  left: React.ReactNode
  center: React.ReactNode
  right?: React.ReactNode
}

export function AppLayout({ left, center, right }: AppLayoutProps) {
  const [rightOpen, setRightOpen] = useState(true)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="w-64 shrink-0 border-r overflow-y-auto">
        {left}
      </aside>

      <main className="flex-1 overflow-y-auto">
        {center}
      </main>

      {rightOpen && right && (
        <aside className="w-80 shrink-0 border-l overflow-y-auto relative">
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

      {!rightOpen && right && (
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
