/**
 * @file MainLayout.tsx
 * @description 主应用布局组件：左侧导航 + 顶栏 + 内容区
 * @version 1.0.0
 */
import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/authStore'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  BookOpen,
  Wand2,
  Settings,
  User,
  LogOut,
  ChevronLeft,
  Menu,
  Sparkles,
  LayoutDashboard,
  BarChart3,
  FileText,
  MessageSquare,
  HelpCircle,
  Cpu,
} from 'lucide-react'

interface NavItem {
  icon: React.ElementType
  label: string
  href: string
  badge?: string | number
  disabled?: boolean
  comingSoon?: boolean
}

const MAIN_NAV: NavItem[] = [
  { icon: BookOpen, label: '小说管理', href: '/novels' },
  { icon: Wand2, label: 'AI 创作工坊', href: '/workshop' },
]

const SECONDARY_NAV: NavItem[] = [
  { icon: Cpu, label: '模型配置', href: '/model-config' },
  { icon: User, label: '账号设置', href: '/account' },
]

const COMING_SOON_NAV: NavItem[] = [
  { icon: BarChart3, label: '数据统计', href: '#', disabled: true, comingSoon: true },
  { icon: FileText, label: '模板市场', href: '#', disabled: true, comingSoon: true },
  { icon: MessageSquare, label: '创作社区', href: '#', disabled: true, comingSoon: true },
  { icon: HelpCircle, label: '帮助中心', href: '#', disabled: true, comingSoon: true },
]

interface MainLayoutProps {
  children: React.ReactNode
  headerActions?: React.ReactNode
  headerTitle?: string
  headerSubtitle?: string
}

export function MainLayout({ children, headerActions, headerTitle, headerSubtitle }: MainLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const isActive = (href: string) => {
    if (href === '#') return false
    return location.pathname === href || location.pathname.startsWith(href + '/')
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const NavItemComponent = ({ item, collapsed }: { item: NavItem; collapsed: boolean }) => {
    const active = isActive(item.href)
    
    if (item.disabled) {
      return (
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <div className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground/50 cursor-not-allowed transition-colors',
              collapsed && 'justify-center px-2'
            )}>
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {!collapsed && (
                <>
                  <span className="text-sm flex-1">{item.label}</span>
                  {item.comingSoon && (
                    <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                      即将上线
                    </span>
                  )}
                </>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {item.comingSoon ? `${item.label}（即将上线）` : item.label}
          </TooltipContent>
        </Tooltip>
      )
    }

    return (
      <Link
        to={item.href}
        onClick={() => setMobileMenuOpen(false)}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group',
          active
            ? 'bg-primary text-primary-foreground shadow-md shadow-primary/25'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent',
          collapsed && 'justify-center px-2'
        )}
      >
        <item.icon className={cn(
          'h-[18px] w-[18px] shrink-0 transition-transform',
          !collapsed && 'group-hover:scale-110'
        )} />
        {!collapsed && (
          <span className="text-sm font-medium flex-1">{item.label}</span>
        )}
      </Link>
    )
  }

  const SidebarContent = ({ collapsed }: { collapsed: boolean }) => (
    <div className="flex flex-col h-full py-4">
      {/* Logo 区域 */}
      <div className={cn(
        'px-4 mb-6 flex items-center gap-3',
        collapsed && 'justify-center px-2'
      )}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <h1 className="text-lg font-bold tracking-tight text-foreground">NovelForge</h1>
            <p className="text-[10px] text-muted-foreground -mt-0.5">智能创作平台</p>
          </div>
        )}
      </div>

      {/* 主导航 */}
      <div className={cn('px-3 mb-2', collapsed && 'px-2')}>
        {!collapsed && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">
            主功能
          </p>
        )}
        <nav className="space-y-1">
          {MAIN_NAV.map((item) => (
            <NavItemComponent key={item.href} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </div>

      {/* 次要导航 */}
      <div className={cn('px-3 mt-4 mb-2', collapsed && 'px-2')}>
        {!collapsed && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 px-1">
            个人中心
          </p>
        )}
        <nav className="space-y-1">
          {SECONDARY_NAV.map((item) => (
            <NavItemComponent key={item.href} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </div>

      {/* 扩展区 - 预留给未来功能 */}
      <div className="mt-auto px-3 pt-4 border-t border-border/50 mx-3">
        {!collapsed && (
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2 px-1">
            更多功能
          </p>
        )}
        <nav className="space-y-1">
          {COMING_SOON_NAV.map((item) => (
            <NavItemComponent key={item.label} item={item} collapsed={collapsed} />
          ))}
        </nav>
      </div>

      {/* 折叠按钮 */}
      <div className="hidden lg:block px-3 mt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSidebarCollapsed(!collapsed)}
          className={cn(
            'w-full justify-center text-muted-foreground hover:text-foreground',
            collapsed && 'px-2'
          )}
        >
          <ChevronLeft className={cn(
            'h-4 w-4 transition-transform duration-200',
            collapsed && 'rotate-180'
          )} />
          {!collapsed && <span className="ml-2 text-xs">收起</span>}
        </Button>
      </div>
    </div>
    </TooltipProvider>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* 移动端遮罩层 */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* 桌面端侧边栏 */}
      <aside
        className={cn(
          'hidden lg:flex flex-col border-r bg-card/30 backdrop-blur-sm transition-all duration-300 z-50',
          sidebarCollapsed ? 'w-[68px]' : 'w-64'
        )}
      >
        <SidebarContent collapsed={sidebarCollapsed} />
      </aside>

      {/* 移动端侧边栏抽屉 */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-card border-r transform transition-transform duration-300 ease-in-out lg:hidden',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent collapsed={false} />
      </aside>

      {/* 主内容区域 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 顶部导航栏 */}
        <header className="h-16 border-b bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 lg:px-6 shrink-0 gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* 移动端菜单按钮 */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden shrink-0"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            {/* 页面标题 */}
            {(headerTitle || headerSubtitle) && (
              <div className="min-w-0">
                {headerTitle && (
                  <h2 className="text-lg font-semibold truncate">{headerTitle}</h2>
                )}
                {headerSubtitle && (
                  <p className="text-xs text-muted-foreground truncate hidden sm:block">{headerSubtitle}</p>
                )}
              </div>
            )}
          </div>

          {/* 右侧操作区 */}
          <div className="flex items-center gap-2 shrink-0">
            {/* 自定义操作插槽 */}
            {headerActions}

            {/* 用户信息下拉菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 rounded-full hover:bg-accent"
                >
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium shadow-md">
                    {user?.username?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.username}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                
                <DropdownMenuItem asChild>
                  <Link to="/account" className="cursor-pointer">
                    <User className="mr-2 h-4 w-4" />
                    账号设置
                  </Link>
                </DropdownMenuItem>
                
                <DropdownMenuSeparator />
                
                <DropdownMenuItem 
                  onClick={handleLogout}
                  className="text-red-600 focus:text-red-600 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* 内容滚动区 */}
        <main className="flex-1 overflow-y-auto">
          <div className="h-full">
            {children}
          </div>
        </main>
      </div>
    </div>
    </TooltipProvider>
  )
}
