import { Link } from 'react-router';
import { ShieldXIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 403 页（v0.5.0）：已登录但无权限。RequireRoles 的默认 fallback。 */
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <ShieldXIcon className="size-12 text-muted-foreground" aria-hidden />
      <div>
        <h1 className="text-3xl font-bold">403 · 无权访问</h1>
        <p className="mt-2 text-sm text-muted-foreground">当前账号没有访问该页面的权限。如需开通，请联系管理员。</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">返回首页</Link>
      </Button>
    </div>
  );
}
