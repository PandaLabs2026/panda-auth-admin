import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { SidebarProvider } from './sidebar';

// 侧栏宽度契约(2026-10-30 统一):桌面展开默认 13.75rem = 220px(16px 根字号),
// 经应用侧 --app-sidebar-width token 覆盖,不随主题配色变量联动。

test('展开宽度默认 13.75rem,以 --app-sidebar-width token 间接引用', () => {
  const { container } = render(
    <SidebarProvider>
      <div>内容</div>
    </SidebarProvider>,
  );
  const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement;
  expect(wrapper.style.getPropertyValue('--sidebar-width')).toBe(
    'var(--app-sidebar-width, 13.75rem)',
  );
});
