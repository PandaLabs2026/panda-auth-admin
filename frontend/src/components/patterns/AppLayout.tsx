import { UserRoundCog } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
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
import { notify } from '@/lib/notify';

/**
 * 统一后台骨架（v0.2 整装，v0.4.3 内容区全宽化）：侧栏 + 固定顶栏 + Outlet 内容区。
 * 页面路由挂在 Outlet 下;navItems 由应用传入(数组保持单源),
 * 用户身份区固定在 SidebarFooter(NavUser 接 useSession/useLogout)。
 * 内容区默认全宽（后台表格/看板优先）,阅读型页面自行收窄:
 * 应用级用 contentClassName,页面级在页面根节点加 max-w-* mx-auto。
 * 内容区隔离层级,顶栏与固定列不能越过侧栏。
 * overflow-x-clip 约束文档宽度,横向溢出只允许发生在页面自己的
 * 滚动容器内(DataTable/pre 等),超宽杂散内容在内容区边缘裁剪而不撑宽文档。
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
  /** 品牌槽:整体替换侧栏头部品牌块(默认图标+「PandaLabs/Web 模板」双行文字),应用传完整品牌块。 */
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
  const { pathname } = useLocation();
  const active = navItems.find(({ to, end }) => end ? pathname === to : pathname === to || pathname.startsWith(to + '/'));
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="z-40">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                {/* brand 整体替换品牌块(图标+双行文字),不留模板硬编码文字——
                    否则应用自注品牌后侧栏出现两组文字(auth-me/fleet-hub 踩坑)。 */}
                {brand ?? (
                  <>
                    <img src={`${import.meta.env.BASE_URL}brand/pandalabs-mark-96.png`} alt="PandaLabs" className="size-8 rounded-lg object-contain" />
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="font-semibold">PandaLabs</span>
                      <span className="text-xs text-muted-foreground">Web 模板</span>
                    </span>
                  </>
                )}
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
            onLogout={() =>
              logout.mutate(undefined, {
                onError: (error) => notify.failure(error, "退出登录失败；当前会话未确认已注销。"),
              })
            }
          >
            {/* 账号自助外链模式:身份属性(姓名/邮箱/密码/MFA)唯一正本在 IDP,
                应用只经会话下发的 accountEntryUrl 跳转;改完回应用,会话到下次刷新才更新。 */}
            {session?.accountEntryUrl && (
              <DropdownMenuItem asChild>
                <a href={session.accountEntryUrl} target="_blank" rel="noopener noreferrer"><UserRoundCog aria-hidden="true" />账号设置</a>
              </DropdownMenuItem>
            )}
          </NavUser>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 isolate">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b bg-background px-4 md:[body:has([data-slot=context-panel-content])_&]:pr-[calc(var(--context-panel-width,25rem)+1rem)]">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-4" />
          <span className="min-w-0 truncate text-sm font-medium">{active?.label ?? title ?? '应用名'}</span>
          <div className="ml-auto flex items-center gap-1" data-testid="header-actions">
            {headerActions}
          </div>
        </header>
        <main className={cn('flex w-full min-w-0 flex-1 flex-col gap-6 overflow-x-clip p-6', contentClassName)}>
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette navItems={navItems} actions={commandActions} open={commandOpen} onOpenChange={setCommandOpen} />
      {/* 全局反馈出口:所有 notify 调用的渲染终点,布局挂载一次 */}
      <Toaster position="top-center" />
    </SidebarProvider>
  );
}
