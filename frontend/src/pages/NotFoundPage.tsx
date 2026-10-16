import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

/** 404:catch-all 路由,复用官方 empty 组件;从登录守卫前拦截,无布局依赖。 */
export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Empty className="rounded-lg border border-dashed">
        <EmptyHeader>
          <EmptyTitle>页面不存在</EmptyTitle>
          <EmptyDescription>地址可能已变更或从未存在。</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => navigate('/')}>
            回到首页
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
