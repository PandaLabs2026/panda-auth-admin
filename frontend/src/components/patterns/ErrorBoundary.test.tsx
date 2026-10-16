import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// 收编自 panda-fleet-admin(零依赖底稿),jsdom 下 location 不可伪造,
// 故断言降级界面存在与按钮可用,不实际触发 reload。

function Boom(): React.ReactElement {
  throw new Error('synthetic render failure');
}

describe('ErrorBoundary 渲染边界', () => {
  test('抛错时渲染可恢复的告警降级界面', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '页面出现了问题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeEnabled();
  });

  test('无异常时透传 children 且无降级', () => {
    render(
      <ErrorBoundary>
        <p>正常内容</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('正常内容')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
