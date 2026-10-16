import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { ActivityIcon } from 'lucide-react';
import MetricCard from './MetricCard';

// MetricCard 渲染契约:标题/数值本地化/环比色/口径注记。

describe('MetricCard', () => {
  test('数值千分位本地化,标题与图标配注齐全', () => {
    const { container } = render(<MetricCard title="页面浏览" value={63591} icon={ActivityIcon} />);
    expect(screen.getByText('页面浏览')).toBeInTheDocument();
    expect(screen.getByText('63,591')).toBeInTheDocument();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  test('正环比绿调、负环比红调,文案含较上期', () => {
    const { rerender } = render(<MetricCard title="t" value={1} delta={12.4} />);
    expect(screen.getByText('较上期 +12.4%').className).toContain('text-chart-2');
    rerender(<MetricCard title="t" value={1} delta={-2.3} />);
    expect(screen.getByText('较上期 -2.3%').className).toContain('text-destructive');
  });

  test('delta 为 null 不渲染环比;非数值渲染占位长划', () => {
    const { rerender } = render(<MetricCard title="t" value={1} delta={null} />);
    expect(screen.queryByText(/较上期/)).not.toBeInTheDocument();
    rerender(<MetricCard title="t" value="n/a" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
