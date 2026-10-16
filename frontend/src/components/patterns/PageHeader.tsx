import { cn } from "cn"

/** 统一页头：说明 + 右侧操作区。页名由顶栏承载，
 * h1 仅保留给无障碍文档结构和测试锚点（sr-only，视觉不呈现大标题）。
 * 来自 panda-fleet-admin（v0.1 提取，零改动）。 */
export default function PageHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return <div className={cn("mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
    <div className="min-w-0">
      <h1 className="sr-only">{title}</h1>
      {description && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </div>
}
