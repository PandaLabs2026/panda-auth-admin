import type { ReactNode } from 'react';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

/**
 * 侧栏底部用户身份区：头像 + 名称/邮箱 + 下拉菜单，退出为末项（destructive）。
 * 头像三级策略：avatarUrl 有值用真实头像;缺省用品牌缺省头像图;图挂时首字兜底。
 * 泛化自 panda-asst-webapp 的 shadcn sidebar-07 NavUser（v0.1.1 提取时去掉
 * i18n/路由/Profile 类型/主题语言切换——那些是应用层，经 children 注入额外菜单项）。
 */
export default function NavUser({
  name,
  email,
  avatarUrl,
  onLogout,
  children,
}: {
  name: string;
  email?: string;
  /** 通常来自会话;无值时显示缺省头像(default-avatar.svg)。 */
  avatarUrl?: string;
  onLogout: () => void;
  /** 额外菜单项（如个人资料、设置），插在身份头与退出之间。 */
  children?: ReactNode;
}) {
  const { isMobile } = useSidebar();
  const initial = name.trim().charAt(0).toUpperCase();

  const avatar = (className?: string) => (
    <Avatar className={className ?? 'size-8 rounded-lg'}>
      <AvatarImage src={avatarUrl ?? '/brand/default-avatar.svg'} alt={name} />
      <AvatarFallback className="rounded-lg">{initial}</AvatarFallback>
    </Avatar>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatar()}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                {email && <span className="truncate text-xs">{email}</span>}
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                {avatar('h-8 w-8 rounded-lg')}
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{name}</span>
                  {email && <span className="truncate text-xs">{email}</span>}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {children}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onLogout()}>
              <LogOut />
              退出登录
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
