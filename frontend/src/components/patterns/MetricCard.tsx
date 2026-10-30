import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function MetricCard({
  title,
  value,
  note,
  delta,
  icon: Icon,
}: {
  title: string;
  value: unknown;
  note?: string;
  /** 与上一等长窗口的环比百分比(正=升、负=降);null/未传不显示,不影响下方口径文案。 */
  delta?: number | null;
  icon?: LucideIcon;
}) {
  return (
    <Card className="py-4 shadow-none">
      <CardContent className="flex items-start gap-3 px-5">
        {Icon && (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Icon className="size-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] text-muted-foreground">{title}</span>
          <strong className="text-2xl leading-tight font-semibold tabular-nums">
            {typeof value === 'number'
              ? value.toLocaleString('zh-CN')
              : typeof value === 'string' && value
                ? value
                : '—'}
          </strong>
          {delta != null && (
            <span
              className={`text-xs font-medium ${
                delta > 0 ? 'text-chart-2' : delta < 0 ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              较上期 {delta > 0 ? '+' : ''}
              {delta}%
            </span>
          )}
          {note && <small className="text-xs text-muted-foreground">{note}</small>}
        </div>
      </CardContent>
    </Card>
  );
}
