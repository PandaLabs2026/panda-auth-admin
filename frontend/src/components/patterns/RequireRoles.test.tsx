import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import RequireRoles from './RequireRoles';
import { sessionApi } from '@/lib/auth';
import { testSession } from '@/test/session';

// 角色门控契约:任一/全部语义、缺省 fallback(Navigate /403)、空角色集合放行。

afterEach(() => vi.restoreAllMocks());

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/protected']}>
      <Routes>
        <Route path="/protected" element={ui} />
        <Route path="/403" element={<p data-testid="forbidden-page">403</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>
);

describe('RequireRoles', () => {
  test('具备任一所需角色(any)→ 放行', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue({ ...testSession, roles: ['viewer'] });
    render(wrap(
      <RequireRoles roles={['admin', 'viewer']} any>
        <p>受保护内容</p>
      </RequireRoles>,
    ));
    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
  });

  test('无角色 → 缺省 fallback 路由到 /403', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue({ ...testSession, roles: [] });
    render(wrap(<RequireRoles roles={['admin']}><p>受保护内容</p></RequireRoles>));
    expect(await screen.findByTestId('forbidden-page')).toBeInTheDocument();
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  });

  test('无角色但提供自定义 fallback → 渲染降级块', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue({ ...testSession, roles: ['viewer'] });
    render(wrap(
      <RequireRoles roles={['admin']} fallback={<p data-testid="custom-fallback">无权限</p>}>
        <p>受保护内容</p>
      </RequireRoles>,
    ));
    expect(await screen.findByTestId('custom-fallback')).toBeInTheDocument();
  });

  test('空角色集合(公开区块语义)→ 放行', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue({ ...testSession, roles: [] });
    render(wrap(<RequireRoles roles={[]}><p>公开区块</p></RequireRoles>));
    expect(await screen.findByText('公开区块')).toBeInTheDocument();
  });
});
