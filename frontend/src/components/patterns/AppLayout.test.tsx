import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import AppLayout from './AppLayout';
import { sessionApi } from '@/lib/auth';

// AppLayout 骨架契约:导航项渲染、Outlet 透传、页脚版本锚点、NavUser 消费会话。

afterEach(() => vi.restoreAllMocks());

test('骨架渲染:导航项/Outlet 内容/顶栏标题/页脚版本/身份区', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '骨架测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                navItems={[
                  { to: '/', label: '首页', end: true },
                  { to: '/other', label: '其他' },
                ]}
                title="测试应用"
              />
            }
          >
            <Route index element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('页面内容')).toBeInTheDocument();
  expect(screen.getAllByText('首页').length).toBeGreaterThan(0);
  expect(screen.getByText('其他')).toBeInTheDocument();
  expect(screen.getByText('测试应用')).toBeInTheDocument();
  expect(screen.getByText(/模板版本/)).toBeInTheDocument();
  // 身份区:NavUser 消费会话(异步解析,findBy 等待)
  expect(await screen.findByText(/骨架测试/)).toBeInTheDocument();
});

// v0.4.3 内容区全宽化:默认全宽(flex-1/gap-6,无阅读宽度上限),contentClassName 交给应用收窄。

test('内容区默认全宽:无 max-w-* 上限,纵向撑满(flex-1)', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '骨架测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppLayout navItems={[{ to: '/', label: '首页', end: true }]} />}>
            <Route index element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('页面内容');
  const content = screen.getAllByRole('main').at(-1)!;
  expect(content.className).toContain('flex-1');
  expect(content.className).toContain('gap-6');
  expect(content.className).not.toContain('max-w-');
});

test('contentClassName 合并进内容区:应用可整体收窄', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '骨架测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout navItems={[{ to: '/', label: '首页', end: true }]} contentClassName="max-w-4xl mx-auto" />
            }
          >
            <Route index element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('页面内容');
  const content = screen.getAllByRole('main').at(-1)!;
  expect(content.className).toContain('max-w-4xl');
  expect(content.className).toContain('mx-auto');
  expect(content.className).toContain('gap-6');
});
