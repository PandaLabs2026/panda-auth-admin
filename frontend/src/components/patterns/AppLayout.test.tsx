import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import AppLayout from './AppLayout';
import { sessionApi } from '@/lib/auth';

// AppLayout 骨架契约:导航项渲染、Outlet 透传、页脚版本锚点、NavUser 消费会话。

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test('navigation group label accepts the application locale and updates when it changes', () => {
  const renderLayout = (label: string) => (
    <QueryClientProvider client={new QueryClient()}><MemoryRouter>
      <AppLayout navItems={[]} navigationLabel={label} />
    </MemoryRouter></QueryClientProvider>
  );
  const { rerender } = render(renderLayout('Navigation'));
  expect(screen.getByText('Navigation')).toBeInTheDocument();
  rerender(renderLayout('导航'));
  expect(screen.getByText('导航')).toBeInTheDocument();
  expect(screen.queryByText('Navigation')).not.toBeInTheDocument();
});

test('default logo resolves under the deployment base', async () => {
  vi.stubEnv('BASE_URL', '/showcase-spa/');
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '骨架测试' });
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AppLayout navItems={[]} /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('img', { name: 'PandaLabs' })).toHaveAttribute('src', '/showcase-spa/brand/pandalabs-mark-96.png');
});

test('骨架渲染:导航项/Outlet 内容/topbar 跟随当前页/页脚版本/身份区', async () => {
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
  // topbar 跟随当前页(路由 / 匹配「首页」):nav 一处 + topbar 一处,应用名不渲染
  expect(screen.getAllByText('首页').length).toBe(2);
  expect(screen.getByText('其他')).toBeInTheDocument();
  expect(screen.queryByText('测试应用')).not.toBeInTheDocument();
  // 版本页脚默认不渲染:应用实现不带模板版本号(showcase 元素 opt-in)
  expect(screen.queryByText(/模板版本/)).not.toBeInTheDocument();
  // 默认品牌块:未传 brand 时模板双行文字照常渲染
  expect(screen.getByText('PandaLabs')).toBeInTheDocument();
  expect(screen.getByText('Web 模板')).toBeInTheDocument();
  // 身份区:NavUser 消费会话(异步解析,findBy 等待)
  expect(await screen.findByText(/骨架测试/)).toBeInTheDocument();
});

// brand 契约:整体替换品牌块。只替换图标、留下硬编码「PandaLabs/Web 模板」会让
// 应用自注品牌后侧栏出现两组文字(auth-me/fleet-hub 踩坑)。

test('brand 注入后不残留模板默认品牌文字', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '骨架测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <AppLayout
                navItems={[{ to: '/', label: '首页', end: true }]}
                brand={
                  <>
                    <span data-testid="app-brand-icon">应用图标</span>
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="font-semibold">应用品牌</span>
                      <span className="text-xs text-muted-foreground">应用副题</span>
                    </span>
                  </>
                }
              />
            }
          >
            <Route index element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('页面内容');
  expect(screen.getByText('应用品牌')).toBeInTheDocument();
  expect(screen.queryByText('PandaLabs')).not.toBeInTheDocument();
  expect(screen.queryByText('Web 模板')).not.toBeInTheDocument();
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
  // 骨架完整性:内容区横向裁剪,文档永不横向滚动(否则 sticky 顶栏会盖到 fixed 侧栏上)
  expect(content.className).toContain('overflow-x-clip');
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

test('showVersionFooter 开启时渲染模板版本页脚(showcase 专用)', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '页脚测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppLayout navItems={[{ to: '/', label: '首页', end: true }]} showVersionFooter />}>
            <Route index element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('页面内容');
  expect(screen.getByText(/模板版本/)).toBeInTheDocument();
});

test('topbar 未命中导航时回退应用名', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '回退测试' });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/nowhere']}>
        <Routes>
          <Route
            path="*"
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
            <Route path="*" element={<p>页面内容</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('页面内容')).toBeInTheDocument();
  expect(screen.getByText('测试应用')).toBeInTheDocument();
});

test('userMenu 插槽渲染应用附加账户项(账户中心),位于退出之前', async () => {
  vi.spyOn(sessionApi, 'me').mockResolvedValue({ displayName: '插槽测试' });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AppLayout navItems={[]} userMenu={<a href="https://auth.example/me/">账户中心</a>} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /插槽测试/ }));
  const items = screen.getAllByRole('menuitem');
  expect(items[items.length - 1]).toHaveTextContent('退出登录');
  expect(screen.getByRole('link', { name: '账户中心' })).toBeInTheDocument();
});
