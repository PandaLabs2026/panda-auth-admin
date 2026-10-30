import * as React from 'react';

/**
 * ContextPanel 关闭守卫(正典设计见 docs/context-panel.md §4):
 * 面板内外所有关闭请求的单一裁决点。dirty/saving 由应用按真实草稿状态传入;
 * onClose 在守卫放行后才调用,面板 open 与草稿生命周期仍归应用。
 */

export type PanelCloseReason =
  | 'close-button'
  | 'escape'
  | 'outside-press'
  | 'switch-object'
  | 'route-change'
  | 'open-full-page'
  | 'manual';

export interface PanelCloseGuard {
  /** 未保存确认卡是否打开。 */
  confirmOpen: boolean;
  /** 唯一关闭入口:无修改直接 onClose;有修改先出确认卡;保存中拒绝。 */
  requestClose: (reason?: PanelCloseReason) => void;
  /** 继续编辑:收起确认卡,保留草稿与焦点上下文。 */
  confirmContinue: () => void;
  /** 放弃修改:收起确认卡并执行 onClose。 */
  confirmDiscard: () => void;
}

export function usePanelCloseGuard({
  dirty,
  saving,
  onClose,
  onContinue,
  onReject,
}: {
  dirty: boolean;
  /** 保存进行中:关闭请求被拒绝(写入结果未知,不静默丢弃反馈通道)。 */
  saving?: boolean;
  onClose: () => void;
  /** 继续编辑后回调(面板用它把焦点送回正文)。 */
  onContinue?: () => void;
  /** 关闭被拒绝时通知(当前唯一原因:saving)。 */
  onReject?: (reason: 'saving') => void;
}): PanelCloseGuard {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const dirtyRef = React.useRef(dirty);
  dirtyRef.current = dirty;
  const savingRef = React.useRef(!!saving);
  savingRef.current = !!saving;
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const onContinueRef = React.useRef(onContinue);
  onContinueRef.current = onContinue;
  const onRejectRef = React.useRef(onReject);
  onRejectRef.current = onReject;

  // 保存开始即收起确认卡(放弃入口不得越过进行中的写入);草稿被保存清除时
  // 确认卡失去存在意义,一并收起。
  React.useEffect(() => {
    if (saving || !dirty) setConfirmOpen(false);
  }, [saving, dirty]);

  const requestClose = React.useCallback((reason?: PanelCloseReason) => {
    void reason;
    if (savingRef.current) {
      onRejectRef.current?.('saving');
      return;
    }
    if (dirtyRef.current) {
      setConfirmOpen(true);
      return;
    }
    onCloseRef.current();
  }, []);

  const confirmContinue = React.useCallback(() => {
    setConfirmOpen(false);
    onContinueRef.current?.();
  }, []);

  const confirmDiscard = React.useCallback(() => {
    if (savingRef.current) {
      onRejectRef.current?.('saving');
      return;
    }
    setConfirmOpen(false);
    onCloseRef.current();
  }, []);

  return { confirmOpen, requestClose, confirmContinue, confirmDiscard };
}

/**
 * 浏览器刷新/关闭的尽力拦截:受浏览器限制,只能出现浏览器原生确认,
 * 不能自定义文案,也不是可靠的保存通道(如实说明,不承诺无条件保存)。
 */
export function useBrowserUnloadGuard(enabled: boolean) {
  React.useEffect(() => {
    if (!enabled) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [enabled]);
}
