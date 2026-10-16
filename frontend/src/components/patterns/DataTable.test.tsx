import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DataTable from './DataTable';

// 宽表姿势渲染契约(v0.4.3):stickyHeader 表头钉住 + 容器 70vh 内滚;
// stickyFirstColumn 首列冻结(实底 + 分隔线)。层级契约:
// 角部表头 z-40 > 其余表头 z-30 > 首列表体 z-20,斜向滚动互不压盖。
// 默认全关:零 sticky 类、容器不纵向滚动,渲染行为与历史版本一致。
// 排序/导出/分页等行为契约见 DataTable.test.ts(纯函数层)。

const headers = ['名称', '浏览量'];
const rows = [
  ['/docs/auth', 120],
  ['/blog/hello', 7],
];

describe('DataTable 宽表姿势', () => {
  it('默认关闭:无 sticky 类,容器不纵向滚动', () => {
    const { container } = render(<DataTable headers={headers} rows={rows} />);
    expect(container.querySelector('.sticky')).toBeNull();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
  });

  it('stickyHeader:全部表头钉住(z-30),容器限高 70vh 纵向滚动', () => {
    const { container } = render(<DataTable headers={headers} rows={rows} stickyHeader />);
    const wrapper = container.querySelector('.overflow-y-auto')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.className).toContain('max-h-[70vh]');
    const ths = container.querySelectorAll('th');
    expect(ths).toHaveLength(2);
    for (const th of ths) {
      expect(th.className).toContain('sticky top-0 z-30');
      expect(th.className).toContain('bg-muted');
    }
    expect(ths[1].className).not.toContain('left-0');
  });

  it('stickyFirstColumn:首列表体冻结(z-20 实底),横向滑动有分隔线', () => {
    const { container } = render(<DataTable headers={headers} rows={rows} stickyFirstColumn />);
    const tds = container.querySelectorAll('tbody td');
    expect(tds[0].className).toContain('sticky left-0 z-20');
    expect(tds[0].className).toContain('bg-background');
    expect(tds[0].className).toContain('border-r');
    expect(tds[1].className).not.toContain('sticky');
  });

  it('双开:角部表头 top-0 left-0 z-40,层级高于首列表体与其余表头', () => {
    const { container } = render(
      <DataTable headers={headers} rows={rows} stickyHeader stickyFirstColumn />,
    );
    const corner = container.querySelectorAll('th')[0];
    // tailwind-merge 会去重重排,逐 token 断言
    expect(corner.className).toContain('sticky');
    expect(corner.className).toContain('top-0');
    expect(corner.className).toContain('left-0');
    expect(corner.className).toContain('z-40');
    expect(container.querySelectorAll('th')[1].className).toContain('z-30');
    expect(container.querySelectorAll('tbody td')[0].className).toContain('z-20');
  });
});
