import { describe, it, expect } from 'vitest';
import { trendSummary } from './TrendChart';

// trendSummary(TrendChart.tsx):总计 = 求和;日均 = 四舍五入(总数/天数);
// max 下限 1(全零/空序列高度除法安全);peak = 首个最大值下标,无峰值(全零/空)为 -1。
// 本测试是 TrendChart 的行为契约:内部实现变化(如换图表方案)时保持全绿即等价。

describe('trendSummary 摘要', () => {
  it('总计/日均/峰值下标:常规序列', () => {
    const s = trendSummary([
      { label: '2026-10-01', value: 3 },
      { label: '2026-10-02', value: 5 },
      { label: '2026-10-03', value: 1 },
    ]);
    expect(s.total).toBe(9);
    expect(s.daily).toBe(3);
    expect(s.max).toBe(5);
    expect(s.peak).toBe(1);
  });

  it('日均四舍五入:9/2 → 5,3/2 → 2', () => {
    expect(trendSummary([{ label: 'a', value: 4 }, { label: 'b', value: 5 }]).daily).toBe(5);
    expect(trendSummary([{ label: 'a', value: 1 }, { label: 'b', value: 2 }]).daily).toBe(2);
  });

  it('并列峰值取首个下标', () => {
    const s = trendSummary([
      { label: 'a', value: 5 },
      { label: 'b', value: 5 },
      { label: 'c', value: 1 },
    ]);
    expect(s.max).toBe(5);
    expect(s.peak).toBe(0);
  });

  it('全零序列:max 抬到下限 1,无峰值 peak=-1', () => {
    const s = trendSummary([
      { label: 'a', value: 0 },
      { label: 'b', value: 0 },
    ]);
    expect(s.total).toBe(0);
    expect(s.max).toBe(1);
    expect(s.peak).toBe(-1);
  });

  it('空序列:total=0, daily=0, max=1, peak=-1', () => {
    const s = trendSummary([]);
    expect(s).toEqual({ total: 0, daily: 0, max: 1, peak: -1 });
  });
});
