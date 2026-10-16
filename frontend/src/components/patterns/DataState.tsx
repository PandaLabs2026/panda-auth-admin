import { CircleAlert, LoaderCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * 数据区四态渲染器：错误 / 加载 / 不可用 / 警告。
 * 泛化自 pandalabs-website-admin（v0.1 提取时去掉了 Envelope 类型依赖、
 * 登录链接与拨测观察时间行——那些属于应用层，由调用方自行组合）。
 */
export default function DataState({
  error,
  loading,
  unavailable,
  warnings,
}: {
  error?: string | null;
  loading?: boolean;
  /** true 时渲染「数据暂时不可用」——比空白更诚实的降级态。 */
  unavailable?: boolean;
  warnings?: readonly string[];
}) {
  if (error)
    return (
      <Alert variant="destructive" role="alert" className="my-4">
        <CircleAlert />
        <AlertTitle>请求失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  if (loading)
    return (
      <p role="status" className="my-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在读取数据…
      </p>
    );
  if (unavailable)
    return (
      <Alert variant="destructive" role="alert" className="my-4">
        <CircleAlert />
        <AlertTitle>数据暂时不可用</AlertTitle>
      </Alert>
    );
  return (
    <>
      {warnings?.map((x) => (
        <Alert key={x} className="my-4">
          <CircleAlert />
          <AlertDescription>{x}</AlertDescription>
        </Alert>
      ))}
    </>
  );
}
