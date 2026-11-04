import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSearchParams } from 'react-router';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import FilterToolbar from './FilterToolbar';

// 筛选工具栏契约:下拉筛选立即落 URL、'all' 哨兵不落键;disabled 冻结期 URL 不写。

function UrlProbe() {
  const [params] = useSearchParams();
  return <p data-testid="url">{params.toString()}</p>;
}

const toolbar = (disabled?: boolean) => (
  <MemoryRouter initialEntries={['/list']}>
    <FilterToolbar
      searchPlaceholder="搜索…"
      disabled={disabled}
      selects={[{ key: 'env', label: '环境', options: { prod: '生产' } }]}
    />
    <UrlProbe />
  </MemoryRouter>
);

const renderToolbar = () => render(toolbar());

describe('FilterToolbar', () => {
  test('渲染搜索与下拉筛选,初始 URL 干净', () => {
    renderToolbar();
    expect(screen.getByTestId('filter-search')).toBeInTheDocument();
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  test('disabled 时输入与下拉禁用,节流中的待落盘值不写 URL,解冻后统一落盘', () => {
    vi.useFakeTimers();
    try {
      const view = renderToolbar();
      // 冻结前输入(节流 300ms 未到):待落盘。
      fireEvent.change(screen.getByTestId('filter-search'), { target: { value: 'ab' } });

      // 冻结开始:输入与下拉禁用;待落盘值不得写 URL(忙期 URL 冻结)。
      view.rerender(toolbar(true));
      act(() => { vi.advanceTimersByTime(400); });
      expect(screen.getByTestId('filter-search')).toBeDisabled();
      expect(screen.getByRole('combobox', { name: '环境' })).toBeDisabled();
      expect(screen.getByTestId('url').textContent).not.toContain('q=');

      // 解冻:冻结前已输入的值统一落盘。
      view.rerender(toolbar(false));
      act(() => { vi.advanceTimersByTime(0); });
      expect(screen.getByTestId('filter-search')).toBeEnabled();
      expect(screen.getByTestId('url').textContent).toContain('q=ab');
    } finally {
      vi.useRealTimers();
    }
  });

  test('冻结期不可输入;解冻后可输入并照常落盘', () => {
    vi.useFakeTimers();
    try {
      const view = renderToolbar();
      view.rerender(toolbar(true));
      const search = screen.getByTestId('filter-search');
      expect(search).toBeDisabled();
      view.rerender(toolbar(false));
      fireEvent.change(search, { target: { value: 'cd' } });
      act(() => { vi.advanceTimersByTime(300); });
      expect(screen.getByTestId('url').textContent).toContain('q=cd');
    } finally {
      vi.useRealTimers();
    }
  });
});
