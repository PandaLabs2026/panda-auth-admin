import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * 语义档徽章（success/warning）：模板 ui/badge 正典不含这两个变体（拷贝本体禁改），
 * 在应用层用 className 组合出同款视觉。success=正常/在线，warning=降级/需关注。
 */
const SEMANTIC_CLASS = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
} as const

export default function SemanticBadge({
  variant,
  className,
  children,
}: {
  variant: keyof typeof SEMANTIC_CLASS
  className?: string
  children: React.ReactNode
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent", SEMANTIC_CLASS[variant], className)}>
      {children}
    </Badge>
  )
}
