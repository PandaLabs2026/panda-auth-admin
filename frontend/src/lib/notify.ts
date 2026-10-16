import { toast } from 'sonner';

/**
 * 全局反馈约定（v0.5.0）：所有 mutation 结果统一经 notify 出口，不直接调 toast——
 * 图标、时长、文案风格单源，消费仓改风格只动这里。成功 3s 自动消失；错误驻留至手动关闭。
 */
export const notify = {
  success(message: string, description?: string) {
    toast.success(message, { description, duration: 3000 });
  },
  error(message: string, description?: string) {
    toast.error(message, { description, duration: Infinity });
  },
  info(message: string, description?: string) {
    toast.info(message, { description, duration: 3000 });
  },
  /** 从 ApiError/unknown 归一的失败文案；服务端 Envelope 错误语义交给调用方组织。 */
  failure(error: unknown, fallback = '操作失败') {
    const message = error instanceof Error && error.message ? error.message : fallback;
    this.error(message);
  },
};
