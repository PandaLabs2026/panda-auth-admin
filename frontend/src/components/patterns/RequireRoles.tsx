import { Navigate } from 'react-router';
import { useSession } from '@/lib/auth';

/**
 * 角色门控（v0.5.0）：路由/区块级「有没有权限」。会话无任一所需角色时渲染
 * 403 页（fallback 可换 Navigate/自定义）。与 RequireAuth（登没登）分层：
 * 先认证后授权。roles 来自 BFF 会话（ userinfo role 声明透传）。
 */
export default function RequireRoles({
  roles,
  any = false,
  children,
  fallback,
}: {
  /** 允许进入的角色集合；any=false 需全部具备，true 任一即可。 */
  roles: string[];
  any?: boolean;
  children: React.ReactNode;
  /** 无权限时的渲染；缺省 Navigate 到 /403（保持可返回）。 */
  fallback?: React.ReactNode;
}) {
  const { data: session, isPending } = useSession();
  // 会话加载中按未知处理(渲染占位):加载完成前不该按「无角色」误判弹 403
  if (isPending)
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted-foreground" role="status">
        正在确认访问权限…
      </div>
    );
  const owned = session?.roles ?? [];
  const allowed = roles.length === 0 || (any ? roles.some((r) => owned.includes(r)) : roles.every((r) => owned.includes(r)));
  if (!allowed) return <>{fallback ?? <Navigate to="/403" replace />}</>;
  return <>{children}</>;
}
