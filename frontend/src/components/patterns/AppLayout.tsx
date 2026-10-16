import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { cn } from 'cn';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import NavUser from './NavUser';
import CommandPalette from './CommandPalette';
import { Toaster } from '@/components/ui/sonner';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useLogout, useSession } from '@/lib/auth';

/**
 * 统一后台骨架（v0.2 整装，v0.4.3 内容区全宽化）：侧栏 + 固定顶栏 + Outlet 内容区。
 * 页面路由挂在 Outlet 下;navItems 由应用传入(数组保持单源),
 * 用户身份区固定在 SidebarFooter(NavUser 接 useSession/useLogout)。
 * 内容区默认全宽（后台表格/看板优先）,阅读型页面自行收窄:
 * 应用级用 contentClassName,页面级在页面根节点加 max-w-* mx-auto。
 */

export interface NavItem {
  to: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  /** NavLink 的 end 语义:索引路由用 true。 */
  end?: boolean;
}

export default function AppLayout({
  navItems,
  title,
  brand,
  contentClassName,
  headerActions,
  commandActions,
}: {
  navItems: NavItem[];
  title?: string;
  brand?: React.ReactNode;
  /** 内容区附加类：默认全宽，需要阅读宽度时传 `max-w-4xl mx-auto` 之类收窄。 */
  contentClassName?: string;
  /** 顶栏右侧插槽（通知铃铛等应用级常驻件）。 */
  headerActions?: React.ReactNode;
  /** 命令面板附加动作（登出/切语言等）；页面导航自动来自 navItems。 */
  commandActions?: React.ComponentProps<typeof CommandPalette>['actions'];
}) {
  const { data: session } = useSession();
  const logout = useLogout();
  const [commandOpen, setCommandOpen] = useState(false);
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                {brand ?? (
                  <img src="/brand/pandalabs-mark-96.png" alt="PandaLabs" className="size-8 rounded-lg object-contain" />
                )}
                <span className="grid flex-1 text-left leading-tight">
                  <span className="font-semibold">PandaLabs</span>
                  <span className="text-xs text-muted-foreground">Web 模板</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>导航</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map(({ to, label, icon: Icon, end }) => (
                  <SidebarMenuItem key={to}>
                    <NavLink to={to} end={end}>
                      {({ isActive }) => (
                        <SidebarMenuButton asChild isActive={isActive}>
                          <span>
                            {Icon && <Icon />}
                            <span>{label}</span>
                          </span>
                        </SidebarMenuButton>
                      )}
                    </NavLink>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <NavUser
            name={session?.displayName ?? '未登录'}
            email={session?.email}
            onLogout={() => logout.mutate()}
          >
            {/* 账号自助外链模式:身份属性(姓名/邮箱/密码/MFA)唯一正本在 IDP,
                应用只经会话下发的 accountEntryUrl 跳转;改完回应用,会话到下次刷新才更新。 */}
            {session?.accountEntryUrl && (
              <DropdownMenuItem asChild>
                <a href={session.accountEntryUrl} target="_blank" rel="noopener noreferrer">账号设置</a>
              </DropdownMenuItem>
            )}
          </NavUser>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="text-sm font-medium">{title ?? '应用名'}</span>
          <div className="ml-auto flex items-center gap-1" data-testid="header-actions">
            {headerActions}
          </div>
        </header>
        <main className={cn('flex w-full flex-1 flex-col gap-6 p-6', contentClassName)}>
          <Outlet />
        </main>
        <footer className="border-t px-4 py-2 text-[11px] text-muted-foreground">
          模板版本 {__APP_VERSION__}
        </footer>
      </SidebarInset>
      <CommandPalette navItems={navItems} actions={commandActions} open={commandOpen} onOpenChange={setCommandOpen} />
      {/* 全局反馈出口:所有 notify 调用的渲染终点,布局挂载一次 */}
      <Toaster position="top-center" />
    </SidebarProvider>
  );
}
