import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import DataState from './DataState';

// DataState 四态渲染契约(jsdom 组件测试)。

describe('DataState 四态', () => {
  test('loading → role=status 加载占位', () => {
    render(<DataState loading />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取数据');
  });

  test('error → role=alert 危险告警含文案', () => {
    render(<DataState error="上游接口返回 503" />);
    expect(screen.getByRole('alert')).toHaveTextContent('请求失败');
    expect(screen.getByText('上游接口返回 503')).toBeInTheDocument();
  });

  test('unavailable → role=alert 降级不可用(非请求失败文案)', () => {
    render(<DataState unavailable />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('数据暂时不可用');
    expect(alert).not.toHaveTextContent('请求失败');
  });

  test('成功态 → 透传 warnings 渲染,无告警框标题', () => {
    render(<DataState warnings={['样本量不足', '部分渠道缺失']} />);
    expect(screen.getByText('样本量不足')).toBeInTheDocument();
    expect(screen.getByText('部分渠道缺失')).toBeInTheDocument();
    expect(screen.queryByText('请求失败')).not.toBeInTheDocument();
  });
});
