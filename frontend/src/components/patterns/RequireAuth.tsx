import { Navigate, useLocation } from 'react-router';
import { useSession } from '@/lib/auth';

/**
 * 路由守卫:会话加载中渲染占位(不闪登录页),无会话跳登录并携带
 * 来源路径(from)——登录成功后回跳,过期重登 UX 的关键一环。
 * 门禁形态二(模板 usage.md 2026-11-07 条款):本应用 adapter 语义自有
 * (AdminAuthBoundary 全字段同会话比较+draft 绑定),不消费 canonical
 * RequireAuth 的 bff 接线;canonical 的 isError 重试态在本应用栈内由
 * SessionGate 前置覆盖(同一 useSession 查询先判错),故此处刻意不加。
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession();
  const location = useLocation();
  if (isPending)
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        正在确认登录状态…
      </div>
    );
  if (!data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}
