import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import PageHeader from './PageHeader';

// PageHeader 契约:h1 仅存于无障碍树(sr-only),说明与操作区可见。

describe('PageHeader', () => {
  test('标题进 sr-only h1(视觉不呈现大标题),说明文案可见', () => {
    render(<PageHeader title="页面标题" description="说明文字" />);
    const h1 = screen.getByRole('heading', { name: '页面标题', level: 1 });
    expect(h1.className).toContain('sr-only');
    expect(screen.getByText('说明文字')).toBeVisible();
  });

  test('actions 渲染在右侧操作区', () => {
    render(
      <PageHeader title="t" description="d" actions={<button type="button">操作</button>} />,
    );
    expect(screen.getByRole('button', { name: '操作' })).toBeInTheDocument();
  });
});
