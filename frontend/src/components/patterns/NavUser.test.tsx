import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import NavUser from './NavUser';

// NavUser 身份区契约:名称/邮箱展示、首字 Fallback、下拉含退出且为末项。

const wrap = (ui: React.ReactElement) => <SidebarProvider>{ui}</SidebarProvider>;

describe('NavUser 用户身份区', () => {
  test('展示名称、邮箱与首字头像占位', () => {
    render(wrap(<NavUser name="胡佳豫" email="hjy@pandalabs.cn" onLogout={() => {}} />));
    expect(screen.getByText('胡佳豫')).toBeInTheDocument();
    expect(screen.getByText('hjy@pandalabs.cn')).toBeInTheDocument();
    expect(screen.getAllByText('胡').length).toBeGreaterThan(0);
  });

  test('下拉打开含身份头与退出登录,onLogout 触发', async () => {
    const onLogout = vi.fn();
    render(wrap(<NavUser name="胡佳豫" email="hjy@pandalabs.cn" onLogout={onLogout} />));
    await userEvent.click(screen.getByRole('button', { name: /胡佳豫/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1]).toHaveTextContent('退出登录');
    await userEvent.click(items[items.length - 1]);
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
