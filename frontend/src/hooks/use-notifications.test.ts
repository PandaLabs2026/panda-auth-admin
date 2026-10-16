import { act, renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useNotifications } from './use-notifications';

// 通知 store 契约:种子加载、未读计数、单条/全部已读。

describe('useNotifications', () => {
  test('加载种子并统计未读', async () => {
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.loading).toBe(false);
    expect(result.current.items.length).toBeGreaterThan(0);
    expect(result.current.unread).toBe(2);
  });

  test('单条已读降低未读数;全部已读清零', async () => {
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const first = result.current.items.find((n) => !n.read)!;
    const before = result.current.unread;
    act(() => result.current.markRead(first.id));
    expect(result.current.unread).toBe(before - 1);
    act(() => result.current.markAllRead());
    expect(result.current.unread).toBe(0);
    expect(result.current.items.every((n) => n.read)).toBe(true);
  });
});
