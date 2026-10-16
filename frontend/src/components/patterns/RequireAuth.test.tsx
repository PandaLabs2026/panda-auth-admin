import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, test, vi } from 'vitest';
import RequireAuth from './RequireAuth';
import { sessionApi } from '@/lib/auth';

// RequireAuth 三态契约 + 守卫集成:无会话重定向 /login 并携带 from 回跳;
// 有会话透传 children;加载中渲染占位不闪登录页。

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** 读取 location.state 的探针,验证守卫写入的回跳信息。 */
function LoginSpy() {
  const location = useLocation();
  return <p data-testid="login-spy">{JSON.stringify(location.state)}</p>;
}

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/protected?x=1']}>{ui}</MemoryRouter>
  </QueryClientProvider>
);

const routes = (spy: boolean) => (
  <Routes>
    <Route path="/protected" element={<RequireAuth><p>受保护内容</p></RequireAuth>} />
    <Route path="/login" element={spy ? <LoginSpy /> : <p>登录页</p>} />
  </Routes>
);

describe('RequireAuth 守卫', () => {
  test('无会话 → 重定向 /login,state 携带来源路径与查询串', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue(null);
    render(wrap(routes(true)));
    await waitFor(() =>
      expect(screen.getByTestId('login-spy').textContent).toBe(JSON.stringify({ from: '/protected?x=1' })),
    );
    expect(screen.queryByText('受保护内容')).not.toBeInTheDocument();
  });

  test('有会话 → 透传 children,不进登录页', async () => {
    vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '测试' });
    render(wrap(routes(false)));
    expect(await screen.findByText('受保护内容')).toBeInTheDocument();
    expect(screen.queryByText('登录页')).not.toBeInTheDocument();
  });

  test('会话加载中 → 占位文案,不闪登录页', () => {
    vi.spyOn(sessionApi, 'me').mockReturnValue(new Promise(() => {}));
    render(wrap(routes(false)));
    expect(screen.getByText('正在确认登录状态…')).toBeInTheDocument();
    expect(screen.queryByText('登录页')).not.toBeInTheDocument();
  });
});
