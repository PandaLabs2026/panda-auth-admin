import { render, screen } from '@testing-library/react';
import { useSearchParams } from 'react-router';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import FilterToolbar from './FilterToolbar';

// 筛选工具栏契约:下拉筛选立即落 URL、'all' 哨兵不落键。

function UrlProbe() {
  const [params] = useSearchParams();
  return <p data-testid="url">{params.toString()}</p>;
}

const renderToolbar = () =>
  render(
    <MemoryRouter initialEntries={['/list']}>
      <FilterToolbar
        searchPlaceholder="搜索…"
        selects={[{ key: 'env', label: '环境', options: { prod: '生产' } }]}
      />
      <UrlProbe />
    </MemoryRouter>,
  );

describe('FilterToolbar', () => {
  test('渲染搜索与下拉筛选,初始 URL 干净', () => {
    renderToolbar();
    expect(screen.getByTestId('filter-search')).toBeInTheDocument();
    expect(screen.getByTestId('url').textContent).toBe('');
  });
});
