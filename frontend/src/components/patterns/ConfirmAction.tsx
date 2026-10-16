import { useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { notify } from '@/lib/notify';

/**
 * 危险操作确认模式（v0.5.0）：触发器 → 确认对话框（destructive 语义）→ 异步执行
 * （按钮 loading）→ 结果走全局 notify。后台删除/停用/重置类操作的统一姿势，
 * 消费仓不手拼 AlertDialog + toast 样板。
 */
export default function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = '确认执行',
  cancelLabel = '取消',
  destructive = true,
  disabled = false,
  onConfirm,
  successMessage,
}: {
  /** 触发器（button 等），会拿到 aria-haspopup 与打开态。 */
  trigger: ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive=true 时确认按钮为红色系（危险语义）。 */
  destructive?: boolean;
  disabled?: boolean;
  /** 异步确认动作；抛错自动 notify.failure，成功（未抛）自动 notify.success。 */
  onConfirm: () => Promise<void>;
  /** 成功提示文案；缺省用「操作完成」。 */
  successMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const run = async () => {
    setPending(true);
    try {
      await onConfirm();
      notify.success(successMessage ?? '操作完成');
      setOpen(false);
    } catch (error) {
      notify.failure(error);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild disabled={disabled}>
        {trigger}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
            disabled={pending}
            data-testid="confirm-action-confirm"
            onClick={(e) => {
              // 阻止默认关闭:等待异步结果,失败保持打开可重试
              e.preventDefault();
              void run();
            }}
          >
            {pending ? '执行中…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
