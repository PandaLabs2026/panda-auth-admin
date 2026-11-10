import { Children, Fragment, isValidElement, type ReactNode } from 'react';
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

/** Links and context are supplied only after the owning service authorizes them. */
export type AccountLinks = Partial<Record<'profile' | 'security' | 'organization' | 'notifications' | 'help', {
  href: string;
  label?: string;
  newWindow?: boolean;
} | null>>;
export interface UserContext { organization?: string; role?: string }

const accountOrder = [
  ['profile', '个人资料'], ['security', '账号与安全'], ['organization', '组织与工作区'],
  ['notifications', '通知偏好'], ['help', '帮助与反馈'],
] as const;

function hasMenuContent(node: ReactNode): boolean {
  return Children.toArray(node).some(child => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) return hasMenuContent(child.props.children);
    return typeof child !== 'string' || child.trim().length > 0;
  });
}

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
  translate,
  links,
  context,
}: {
  name: string;
  email?: string;
  /** 通常来自会话;无值时显示缺省头像(default-avatar.svg)。 */
  avatarUrl?: string;
  onLogout: () => void;
  /** 额外菜单项（如个人资料、设置），插在身份头与退出之间。 */
  children?: ReactNode;
  /** Reuse the application dictionary; does not create a locale store. */
  translate?: (message: string) => string;
  links?: AccountLinks;
  context?: UserContext;
}) {
  const { isMobile } = useSidebar();
  const t = (message: string) => translate?.(message)?.trim() || message;
  const displayName = name.trim() || t('用户');
  const displayEmail = email?.trim() || t('邮箱暂不可用');
  const initial = displayName.charAt(0).toUpperCase();
  const entries = accountOrder.flatMap(([id, label]) => {
    const entry = links?.[id];
    return entry?.href.trim() ? [{ id, href: entry.href.trim(), label: entry.label?.trim() || t(label), newWindow: entry.newWindow }] : [];
  });
  const hasMenuItems = entries.length > 0 || hasMenuContent(children);
  const summaryContext = <>
    {context?.organization?.trim() && <span className="truncate text-xs">{t('当前组织')}：{context.organization}</span>}
    {context?.role?.trim() && <span className="truncate text-xs">{t('当前角色')}：{context.role}</span>}
  </>;

  const avatar = (className?: string) => (
    <Avatar className={className ?? 'size-8 rounded-lg'}>
      <AvatarImage src={avatarUrl ?? `${import.meta.env.BASE_URL}brand/default-avatar.svg`} alt={displayName} />
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
              className="h-auto min-h-12 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatar()}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-xs">{displayEmail}</span>
                {summaryContext}
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
                  <span className="truncate font-medium">{displayName}</span>
                  <span className="truncate text-xs">{displayEmail}</span>
                  {summaryContext}
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasMenuItems && <>
              {entries.map(entry => <DropdownMenuItem key={entry.id} asChild>
                <a href={entry.href} target={entry.newWindow ? '_blank' : undefined} rel={entry.newWindow ? 'noopener noreferrer' : undefined}>{entry.label}</a>
              </DropdownMenuItem>)}
              {children}
              <DropdownMenuSeparator />
            </>}
            <DropdownMenuItem variant="destructive" onSelect={() => onLogout()}>
              <LogOut />
              {t('退出登录')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
