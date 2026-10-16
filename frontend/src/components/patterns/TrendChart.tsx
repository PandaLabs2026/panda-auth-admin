import { useState } from 'react';
import DataTable from './DataTable';

export interface TrendPoint {
  label: string;
  value: number;
}

/** 摘要纯函数(供渲染与测试):区间总计、日均(四舍五入)、峰值(max 下限 1 保证高度除法安全;并列峰值取首个;全零序列无峰值=-1)。 */
export function trendSummary(rows: TrendPoint[]) {
  const total = rows.reduce<number>((sum, r) => sum + r.value, 0);
  const daily = rows.length ? Math.round(total / rows.length) : 0;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const peak = rows.findIndex((r) => r.value === max);
  return { total, daily, max, peak };
}

/**
 * 单序列柱状趋势图：峰值标注 + 区间总计/日均 + 可展开数据表。
 * 泛化自 pandalabs-website-admin 的 Umami pv/uv 双维版本（v0.1 提取时
 * 收敛为单序列；多维度切换由调用方组合多个实例实现）。
 */
export default function TrendChart({
  points,
  unitLabel = '数值',
}: {
  points: TrendPoint[];
  /** 数据表与无障碍标签中的维度名，如「页面浏览」「访客」。 */
  unitLabel?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const { total, daily, max, peak } = trendSummary(points);
  const fmt = (n: number) => n.toLocaleString('zh-CN');
  const shortDate = (d: string) => d.slice(5).replace('-', '/');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          区间总计 <strong className="font-semibold text-foreground tabular-nums">{fmt(total)}</strong>
        </span>
        <span>
          日均 <strong className="font-semibold text-foreground tabular-nums">{fmt(daily)}</strong>
        </span>
      </div>
      <div className="relative" role="img" aria-label={unitLabel + '趋势'}>
        <div
          className="pointer-events-none absolute right-0 left-0 top-0 border-t border-dashed border-border"
          title={'峰值 ' + fmt(max)}
        >
          <span className="absolute -top-2 right-0 rounded bg-muted px-1 text-[10px] leading-4 text-muted-foreground tabular-nums">
            峰值 {fmt(max)}
          </span>
        </div>
        <div className="flex h-32 items-end gap-1 pt-3">
          {points.map((r, i) => (
            <div
              key={i}
              title={r.label + ': ' + r.value}
              className={
                'min-w-0.5 flex-1 rounded-t-sm transition-colors ' +
                (i === peak ? 'bg-chart-2' : 'bg-chart-1 hover:bg-chart-2')
              }
              style={{ height: Math.max(1, (r.value / max) * 100) + '%' }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          {points.length > 0 && <span>{shortDate(points[0].label)}</span>}
          {points.length > 2 && <span>{shortDate(points[Math.floor(points.length / 2)].label)}</span>}
          {points.length > 1 && <span>{shortDate(points[points.length - 1].label)}</span>}
        </div>
      </div>
      <details className="mt-1" open={showTable} onToggle={(e) => setShowTable((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-sm text-primary">查看趋势数据表</summary>
        <div className="mt-2">
          <DataTable headers={['日期', unitLabel]} rows={points.map((p) => [p.label, String(p.value)])} />
        </div>
      </details>
    </div>
  );
}
