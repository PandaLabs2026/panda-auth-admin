import { fireEvent, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable, { type Cell } from './DataTable';

const headers = ['名称', '浏览量'];
const rows: Cell[][] = Array.from({ length: 13 }, (_, index) => [`row-${index}`, index]);
const rowNames = (container: HTMLElement) => Array.from(container.querySelectorAll('tbody tr'), row => row.querySelector('td')?.textContent);

describe('DataTable sorting and optional pagination', () => {
  it('renders every row without pageSize, including beyond the SDK default page', () => {
    const view = render(<DataTable headers={headers} rows={rows} />);
    expect(rowNames(view.container)).toEqual(rows.map(row => row[0]));
    expect(view.queryByRole('navigation', { name: 'pagination' })).toBeNull();
  });

  it('sorts numbers descending then ascending and resets another column to descending', async () => {
    const view = render(<DataTable headers={headers} rows={rows} />);
    fireEvent.click(view.getByRole('button', { name: '浏览量' }));
    await waitFor(() => expect(rowNames(view.container)[0]).toBe('row-12'));
    expect(view.container.querySelectorAll('th')[1]).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(view.getByRole('button', { name: '浏览量' }));
    await waitFor(() => expect(rowNames(view.container)[0]).toBe('row-0'));
    expect(view.container.querySelectorAll('th')[1]).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(view.getByRole('button', { name: '名称' }));
    await waitFor(() => expect(rowNames(view.container)[0]).toBe('row-12'));
    expect(view.container.querySelectorAll('th')[0]).toHaveAttribute('aria-sort', 'descending');
    expect(view.container.querySelectorAll('th')[1]).toHaveAttribute('aria-sort', 'none');
    expect(rowNames(view.container)).toHaveLength(13);
  });

  it('paginates only when pageSize is set and preserves the final partial page', async () => {
    const view = render(<DataTable headers={headers} rows={rows} pageSize={5} />);
    expect(rowNames(view.container)).toEqual(['row-0', 'row-1', 'row-2', 'row-3', 'row-4']);
    fireEvent.click(view.getByRole('link', { name: 'Go to next page' }));
    await waitFor(() => expect(rowNames(view.container)).toEqual(['row-5', 'row-6', 'row-7', 'row-8', 'row-9']));
    fireEvent.click(view.getByRole('link', { name: 'Go to next page' }));
    await waitFor(() => expect(rowNames(view.container)).toEqual(['row-10', 'row-11', 'row-12']));
    expect(view.getByRole('link', { name: 'Go to next page' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(view.getByRole('link', { name: 'Go to previous page' }));
    await waitFor(() => expect(rowNames(view.container)[0]).toBe('row-5'));
  });

  it('retains the empty state without table or pagination controls', () => {
    const view = render(<DataTable headers={headers} rows={[]} pageSize={5} />);
    expect(view.getByText('所选范围暂无数据。')).toBeVisible();
    expect(view.queryByRole('table')).toBeNull();
    expect(view.queryByRole('navigation', { name: 'pagination' })).toBeNull();
  });
});
