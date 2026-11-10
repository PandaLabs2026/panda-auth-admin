import { render, screen, within } from '@testing-library/react';
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


describe('UX-03 account summary and menu', () => {
  test('does not render an empty group before logout', async () => {
    render(wrap(<NavUser name="Example" onLogout={() => {}}>{''}{false}{undefined}</NavUser>));
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(within(screen.getByRole('menu')).getAllByRole('separator')).toHaveLength(1);
  });
  test('missing identity values use neutral text without inventing an email', () => {
    render(wrap(<NavUser name="  " onLogout={() => {}} />));
    expect(screen.getByText('用户')).toBeInTheDocument();
    expect(screen.getByText('邮箱暂不可用')).toBeInTheDocument();
  });
  test('application translation changes presentation without invoking logout', async () => {
    const onLogout = vi.fn();
    const messages: Record<string, string> = { '退出登录': 'Sign out', '邮箱暂不可用': 'Email unavailable' };
    const translate = (message: string) => messages[message] ?? message;
    const { rerender } = render(wrap(<NavUser name="Example" onLogout={onLogout} translate={translate} />));
    expect(screen.getByText('Email unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    rerender(wrap(<NavUser name="Example" onLogout={onLogout} />));
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument();
    expect(onLogout).not.toHaveBeenCalled();
  });
  test('empty translations retain the source label', async () => {
    render(wrap(<NavUser name="Example" onLogout={() => {}} translate={() => '  '} />));
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument();
  });
});

describe('UX-03 authorized account entries', () => {
  test('orders owner-supplied entries consistently and keeps logout last', async () => {
    const links = {
      help: { href: '/help' }, notifications: { href: '/preferences' },
      organization: { href: '/workspaces' }, security: { href: '/security' }, profile: { href: '/me' },
    };
    render(wrap(<NavUser name="Example" links={links} onLogout={() => {}} />));
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '个人资料', '账号与安全', '组织与工作区', '通知偏好', '帮助与反馈', '退出登录',
    ]);
    expect(screen.getByRole('menuitem', { name: '个人资料' })).toHaveAttribute('href', '/me');
  });

  test('omits unavailable links instead of rendering disabled or empty settings', async () => {
    render(wrap(<NavUser name="Example" links={{ profile: { href: '/me' }, security: null, help: { href: '  ' } }} onLogout={() => {}} />));
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    expect(screen.queryByRole('menuitem', { name: '账号与安全' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '帮助与反馈' })).not.toBeInTheDocument();
  });

  test('only presents an explicit owner-authorized context without translating identity values', () => {
    const translate = vi.fn((message: string) => message);
    render(wrap(<NavUser name="Example" context={{ organization: 'Workspace A', role: 'Reviewer' }} translate={translate} onLogout={() => {}} />));
    expect(screen.getByText(/当前组织.*Workspace A/)).toBeInTheDocument();
    expect(screen.getByText(/当前角色.*Reviewer/)).toBeInTheDocument();
    expect(translate.mock.calls.flat()).not.toContain('Workspace A');
    expect(translate.mock.calls.flat()).not.toContain('Reviewer');
  });

  test('blank authorized entries and an empty fragment do not leave an empty menu group', async () => {
    render(wrap(<NavUser name="Example" links={{ help: { href: '' } }} onLogout={() => {}}><>{false}{''}</></NavUser>));
    await userEvent.click(screen.getByRole('button', { name: /Example/ }));
    expect(within(screen.getByRole('menu')).getAllByRole('separator')).toHaveLength(1);
  });
});
