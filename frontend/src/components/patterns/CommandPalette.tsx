import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import type { NavItem } from '@/components/patterns/AppLayout';

/**
 * 命令面板（v0.5.0）：Ctrl/Cmd+K 全局呼出。导航动作来自布局 navItems（单源），
 * 额外动作（登出、语言切换等）经 actions 注入。挂载一次于 AppLayout。
 */
export interface CommandAction {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  run(): void;
}

export default function CommandPalette({
  navItems,
  actions = [],
  open,
  onOpenChange,
}: {
  navItems: NavItem[];
  actions?: CommandAction[];
  /** 受控开关（AppLayout 持有,便于全局快捷键）。 */
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  const [navGroupLabel] = useState('页面导航');

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="输入命令或搜索页面…" />
      <CommandList>
        <CommandEmpty>没有匹配的命令</CommandEmpty>
        <CommandGroup heading={navGroupLabel}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} value={`${label} ${to}`} onSelect={() => go(to)}>
              {Icon && <Icon />}
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        {actions.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="操作">
              {actions.map(({ id, label, icon: Icon, shortcut, run }) => (
                <CommandItem
                  key={id}
                  value={label}
                  onSelect={() => {
                    onOpenChange(false);
                    run();
                  }}
                >
                  {Icon && <Icon />}
                  {label}
                  {shortcut && <span className="text-muted-foreground ml-auto text-xs tracking-widest">{shortcut}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
