import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';
import ContextPanel from './ContextPanel';
import {
  useBrowserUnloadGuard,
  usePanelCloseGuard,
  type PanelCloseGuard,
} from './context-panel-guard';

// 重渲染较重(Radix 全套),放宽单测超时以容忍低并行负载机器
vi.setConfig({ testTimeout: 20_000 });

// ContextPanel 契约:桌面非模态停靠 / 移动模态 Sheet / 统一关闭守卫 /
// 确认卡不卸载正文(草稿保留) / saving 拒绝关闭。

beforeEach(() => {
  window.innerWidth = 1024;
});

afterEach(() => {
  vi.useRealTimers();
});

/** 受控 Harness:open/dirty/saving 状态提升在本层,children 输入框状态同样提升,
 *  模拟「草稿提升到面板之外」的正典契约。 */
function Harness(props: {
  dirty?: boolean;
  saving?: boolean;
  status?: 'ready' | 'loading' | 'saving' | 'error';
  mode?: 'view' | 'edit' | 'create';
  objectId?: string;
  initialOpen?: boolean;
  onRejected?: () => void;
}) {
  const [open, setOpen] = useState(props.initialOpen ?? true);
  const [draft, setDraft] = useState('原值');
  const dirty = props.dirty ?? false;
  const saving = props.saving ?? false;
  const guard: PanelCloseGuard = usePanelCloseGuard({
    dirty,
    saving,
    onClose: () => setOpen(false),
    onReject: props.onRejected,
  });
  useBrowserUnloadGuard(open && (dirty || saving));
  return (
    <div>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>
        重开
      </button>
      <span data-testid="open-state">{String(open)}</span>
      <ContextPanel
        open={open}
        guard={guard}
        title="测试对象"
        description="契约测试"
        objectId={props.objectId}
        mode={props.mode}
        status={props.status}
      >
        <input
          aria-label="草稿输入"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </ContextPanel>
    </div>
  );
}

function queryPanel() {
  return document.querySelector('[data-slot="context-panel-content"]');
}

test('桌面停靠:非模态渲染、data 属性齐全、title 关联到 dialog', () => {
  render(<Harness objectId="acc-1" mode="edit" status="ready" />);
  const dialog = screen.getByRole('dialog', { name: '测试对象' });
  expect(dialog).toBeInTheDocument();
  expect(dialog.getAttribute('data-object-id')).toBe('acc-1');
  expect(dialog.getAttribute('data-mode')).toBe('edit');
  expect(dialog.getAttribute('data-status')).toBe('ready');
  // 非模态:不渲染遮罩,aria-modal 不出现
  expect(dialog.getAttribute('aria-modal')).toBeNull();
  expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();
});

test('无修改:X 关闭走守卫直接放行', () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));
  expect(screen.getByTestId('open-state')).toHaveTextContent('false');
});

test('无修改:Esc 直接关闭', () => {
  render(<Harness />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByTestId('open-state')).toHaveTextContent('false');
});

test('有修改:X 出确认卡;继续编辑保留正文与草稿焦点;放弃修改才关闭', async () => {
  const user = userEvent.setup();
  render(<Harness dirty />);
  const input = screen.getByLabelText('草稿输入');
  await user.type(input, '改');
  expect(input).toHaveValue('原值改');

  fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));
  const confirm = screen.getByRole('alertdialog');
  expect(confirm).toHaveTextContent('有未保存的修改');
  // 确认卡打开时正文仍挂载:输入框与值都在(草稿不丢)
  expect(screen.getByLabelText('草稿输入')).toHaveValue('原值改');
  // 焦点落在安全动作「继续编辑」
  expect(document.activeElement).toHaveTextContent('继续编辑');

  await user.click(screen.getByRole('button', { name: '继续编辑' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByTestId('open-state')).toHaveTextContent('true');
  expect(screen.getByLabelText('草稿输入')).toHaveValue('原值改');
  // 继续编辑后焦点回到面板正文
  expect(document.activeElement).toBe(queryPanel()?.querySelector('[data-slot="context-panel-body"]'));

  fireEvent.click(screen.getByRole('button', { name: '关闭面板' }));
  await user.click(screen.getByRole('button', { name: '放弃修改' }));
  expect(screen.getByTestId('open-state')).toHaveTextContent('false');
});

test('有修改:Esc 出确认卡;确认卡上再按 Esc 回到编辑(不关闭)', () => {
  render(<Harness dirty />);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByTestId('open-state')).toHaveTextContent('true');
});

test('保存中:关闭按钮禁用、Esc 被拒绝且面板保持打开、有 aria-live 说明', () => {
  const onRejected = vi.fn();
  render(<Harness dirty saving status="saving" onRejected={onRejected} />);
  expect(screen.getByRole('button', { name: '关闭面板' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(onRejected).toHaveBeenCalledWith('saving');
  expect(screen.getByTestId('open-state')).toHaveTextContent('true');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('移动断点:模态 Sheet 渲染(遮罩出现)、Esc 走守卫', async () => {
  window.innerWidth = 390; // useIsMobile 按 innerWidth 判定,matchMedia 桩仅为完整性
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  );
  render(<Harness dirty />);
  // useIsMobile 挂载后才置位:等移动分支(模态遮罩)出现
  await waitFor(() => expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeInTheDocument());
  fireEvent.keyDown(screen.getByRole('dialog', { name: '测试对象' }), { key: 'Escape' });
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

test('断点切换:同一时刻只挂载一份内容,提升的草稿跨分支保留', async () => {
  const user = userEvent.setup();
  const holder: { listener: (() => void) | null } = { listener: null };
  const mediaStub = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('max-width') && window.innerWidth < 768,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_t: string, l: () => void) => {
      holder.listener = l;
    },
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  vi.stubGlobal('matchMedia', mediaStub);
  render(<Harness dirty />);

  const input = screen.getByLabelText('草稿输入');
  await user.type(input, '草稿');
  expect(input).toHaveValue('原值草稿');
  // 初始为桌面停靠分支:无遮罩
  expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();

  // 模拟断点切换:innerWidth 变化 + matchMedia 监听器触发重渲染
  window.innerWidth = 390;
  await act(async () => {
    holder.listener?.();
  });
  await waitFor(() => expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeInTheDocument());
  // 分支切换后仍只有一份输入框,且提升的草稿值原样保留
  expect(screen.getAllByLabelText('草稿输入')).toHaveLength(1);
  expect(screen.getByLabelText('草稿输入')).toHaveValue('原值草稿');
  vi.unstubAllGlobals();
});

test('关闭后焦点返回 returnFocusRef 目标', async () => {
  const user = userEvent.setup();
  function TriggerHarness() {
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const guard = usePanelCloseGuard({ dirty: false, onClose: () => setOpen(false) });
    return (
      <div>
        <button ref={triggerRef} type="button" data-testid="row-trigger">
          行触发
        </button>
        <ContextPanel
          open={open}
          guard={guard}
          title="焦点返回"
          returnFocusRef={triggerRef}
        >
          正文
        </ContextPanel>
      </div>
    );
  }
  render(<TriggerHarness />);
  await user.click(screen.getByRole('button', { name: '关闭面板' }));
  expect(screen.getByTestId('row-trigger')).toHaveFocus();
});
