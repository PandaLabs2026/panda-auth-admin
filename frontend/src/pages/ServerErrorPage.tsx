import { Link } from 'react-router';
import { ServerCrashIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

/** 500 页（v0.5.0）：服务端错误的路由化出口（ErrorBoundary 之外的显式形态，如维护页跳转）。 */
export default function ServerErrorPage() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <ServerCrashIcon className="size-12 text-muted-foreground" aria-hidden />
      <div>
        <h1 className="text-3xl font-bold">{t('500 · 服务暂不可用')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('服务遇到意外错误，请稍后重试；持续异常请查看状态页或联系运维。')}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t('重新加载')}
        </Button>
        <Button asChild>
          <Link to="/">{t('返回首页')}</Link>
        </Button>
      </div>
    </div>
  );
}
