import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';

/** Shared 404 presentation; the host owns authentication and layout placement. */
export default function NotFoundPage({ embedded = false, translate }: {
  /** Use inside the host main landmark without adding another main. */
  embedded?: boolean;
  translate?: (message: string) => string;
} = {}) {
  const navigate = useNavigate();
  const t = (message: string) => translate?.(message)?.trim() || message;
  const Container = embedded ? 'div' : 'main';
  return (
    <Container className={embedded ? "flex flex-1 items-center justify-center" : "flex min-h-svh items-center justify-center p-4"}>
      <Empty className="rounded-lg border border-dashed">
        <EmptyHeader>
          <EmptyTitle><h1>{t('页面不存在')}</h1></EmptyTitle>
          <EmptyDescription>{t('地址可能已变更或从未存在。')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => navigate('/')}>
            {t('回到首页')}
          </Button>
        </EmptyContent>
      </Empty>
    </Container>
  );
}
