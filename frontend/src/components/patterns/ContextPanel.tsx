import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from 'cn';
import { TriangleAlertIcon, XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { SheetContent } from '@/components/ui/sheet';
import type { PanelCloseGuard } from './context-panel-guard';

/**
 * 对象 ContextPanel(v0.6.8 正典):列表页右侧对象面板容器。
 *
 * 布局:桌面(≥768px,与侧栏同一断点)为非模态右侧停靠——无遮罩、不锁滚动、
 * 不锁焦点,主列表保持可操作;移动/窄屏复用 ui/sheet(Radix Dialog modal),
 * 具备遮罩、焦点陷阱、滚动锁与关闭后焦点恢复。两个分支共用同一个 Dialog Root
 * 和同一份 children——同一时刻只挂载一份内容,但分支切换会重挂载子树,因此
 * 编辑草稿等易失状态必须提升到面板之外的页面层(见 docs/context-panel.md 契约)。
 *
 * 关闭协议:所有关闭入口(X/Esc/移动遮罩点击/应用内切换对象/路由变化/浏览器
 * 返回/打开完整页)统一走 guard.requestClose(守卫在 context-panel-guard.ts);
 * 有未保存修改时先出面板内确认卡(表单保持挂载,草稿/校验错误/滚动位置不丢),
 * saving 期间一律拒绝关闭。
 */

export interface ContextPanelProps {
  open: boolean;
  /** usePanelCloseGuard 的返回值;守卫放行后由 guard.onClose 收口(含关闭),
      面板是纯受控容器,打开与关闭都由应用持有。 */
  guard: PanelCloseGuard;
  title: string;
  description?: string;
  /** 对象标识:进 data-object-id 供测试与样式定位;新建态可省略。 */
  objectId?: string;
  /** 语义标记(数据属性),查看/编辑/新建的表单逻辑归应用。 */
  mode?: 'view' | 'edit' | 'create';
  /** ready 之外:data-status 暴露给应用样式;saving 期间关闭被拒绝。 */
  status?: 'ready' | 'loading' | 'saving' | 'error';
  /** 顶栏操作插槽(编辑/打开完整页等),位于标题与关闭按钮之间。 */
  headerActions?: React.ReactNode;
  /** 底部操作插槽(保存/取消等应用动作)。 */
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** 关闭后焦点返回目标(通常持触发行的按钮引用)。 */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

const UNSAVED_TITLE = '有未保存的修改';
const UNSAVED_BODY = '关闭将放弃当前修改。';

export function ContextPanel({
  open,
  guard,
  title,
  description,
  objectId,
  mode,
  status = 'ready',
  headerActions,
  footer,
  children,
  returnFocusRef,
  className,
}: ContextPanelProps) {
  const isMobile = useIsMobile();
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const continueButtonRef = React.useRef<HTMLButtonElement>(null);

  const saving = status === 'saving';

  // 确认卡打开 → 焦点落在「继续编辑」(安全动作优先);继续编辑 → 焦点回正文。
  React.useEffect(() => {
    if (guard.confirmOpen) continueButtonRef.current?.focus();
  }, [guard.confirmOpen]);

  const handleContinue = React.useCallback(() => {
    guard.confirmContinue();
    bodyRef.current?.focus();
  }, [guard]);

  const closeHandler = React.useMemo(
    () => () => guard.requestClose('close-button'),
    [guard],
  );

  const escapeKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      if (guard.confirmOpen) handleContinue();
      else guard.requestClose('escape');
    },
    [guard, handleContinue],
  );

  const guardOverlay = guard.confirmOpen && (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby="context-panel-unsaved-title"
      aria-describedby="context-panel-unsaved-body"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 p-4"
      data-slot="context-panel-unsaved"
    >
      <div className="w-full max-w-xs rounded-lg border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-2.5">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="grid gap-1">
            <h3 id="context-panel-unsaved-title" className="text-sm font-semibold leading-none">
              {UNSAVED_TITLE}
            </h3>
            <p id="context-panel-unsaved-body" className="text-sm text-muted-foreground">
              {UNSAVED_BODY}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={continueButtonRef} variant="outline" size="sm" onClick={handleContinue}>
            继续编辑
          </Button>
          <Button variant="destructive" size="sm" onClick={guard.confirmDiscard}>
            放弃修改
          </Button>
        </div>
      </div>
    </div>
  );

  const header = (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <DialogPrimitive.Title className="truncate text-sm font-semibold leading-none">
          {title}
        </DialogPrimitive.Title>
        {description && (
          <DialogPrimitive.Description className="truncate text-xs text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        )}
      </div>
      {headerActions && (
        <div className="flex shrink-0 items-center gap-1" data-testid="context-panel-header-actions">
          {headerActions}
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        onClick={closeHandler}
        aria-label="关闭面板"
      >
        <XIcon aria-hidden />
      </Button>
    </header>
  );

  const body = (
    <div
      ref={bodyRef}
      tabIndex={-1}
      data-slot="context-panel-body"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 outline-none"
    >
      {children}
    </div>
  );

  const footerNode = footer && (
    <footer className="flex shrink-0 items-center gap-2 border-t px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]" data-testid="context-panel-footer">
      {footer}
    </footer>
  );

  const ariaLive = (
    <div aria-live="polite" className="sr-only">
      {saving ? '正在保存，暂时无法关闭面板' : ''}
    </div>
  );

  return (
    // modal 跟随断点:桌面停靠=false(无焦点陷阱/滚动锁/外部 aria-hidden,
    // 列表保持可交互),移动 Sheet=true(Radix 提供完整模态行为)。
    <DialogPrimitive.Root open={open} modal={isMobile}>
      {isMobile ? (
        // 移动/窄屏:Radix Sheet 模态——遮罩、焦点陷阱、滚动锁、Esc 均由 Radix 保证;
        // 关闭入口全部改道守卫,遮罩点击等同显式关闭请求。
        <SheetContent
          showCloseButton={false}
          className={cn('fixed w-full gap-0 bg-background text-foreground data-[side=right]:h-[100dvh]', className)}
          data-object-id={objectId}
          data-mode={mode}
          data-status={status}
          onEscapeKeyDown={escapeKeyDown}
          onInteractOutside={(event) => {
            event.preventDefault();
            if (!guard.confirmOpen) guard.requestClose('outside-press');
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target = returnFocusRef?.current;
            if (target && typeof target.focus === 'function') target.focus();
          }}
        >
          {header}
          {body}
          {footerNode}
          {guardOverlay}
          {ariaLive}
        </SheetContent>
      ) : (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Content
            tabIndex={-1}
            className={cn(
              'fixed right-0 bottom-0 z-40 flex flex-col gap-0 border-l bg-background text-foreground shadow-lg outline-none',
              // 默认占满视口高度;需要避开固定顶部区域的应用可覆盖此 token。
              'top-(--context-panel-top,0px)',
              'w-(--context-panel-width,25rem) max-w-full',
              'data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-right-3 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-right-3',
              className,
            )}
            data-slot="context-panel-content"
            data-object-id={objectId}
            data-mode={mode}
            data-status={status}
            onEscapeKeyDown={escapeKeyDown}
            onInteractOutside={(event) => {
              // 非模态停靠:外部点击不关闭(列表点击=切换对象,归应用管),
              // 关闭只走显式入口。
              event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = returnFocusRef?.current;
              if (target && typeof target.focus === 'function') target.focus();
            }}
          >
            {header}
            {body}
            {footerNode}
            {guardOverlay}
            {ariaLive}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      )}
    </DialogPrimitive.Root>
  );
}

export default ContextPanel;
