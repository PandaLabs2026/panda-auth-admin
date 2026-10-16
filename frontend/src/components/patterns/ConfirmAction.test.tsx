import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import ConfirmAction from './ConfirmAction';
import { notify } from '@/lib/notify';

// 危险确认契约:确认前不执行、异步执行中禁用、成功 notify、失败保持打开。

vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn(), failure: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>
);

describe('ConfirmAction', () => {
  test('点确认才执行;成功后通知并关闭', async () => {
    const onConfirm = vi.fn(async () => {});
    render(wrap(
      <ConfirmAction trigger={<button>删除</button>} title="确认删除？" onConfirm={onConfirm} successMessage="已删除" />,
    ));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('confirm-action-confirm'));
    await waitForAsync();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(notify.success).toHaveBeenCalledWith('已删除');
  });

  test('执行失败 → notify.failure 且对话框保持可重试', async () => {
    const onConfirm = vi.fn(async () => { throw new Error('boom'); });
    render(wrap(
      <ConfirmAction trigger={<button>删除</button>} title="确认删除？" onConfirm={onConfirm} />,
    ));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    const confirm = await screen.findByTestId('confirm-action-confirm');
    fireEvent.click(confirm);
    await waitForAsync();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(notify.failure).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-action-confirm'));
    await waitForAsync();
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

async function waitForAsync() {
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
