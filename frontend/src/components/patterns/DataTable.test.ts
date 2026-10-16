import { describe, it, expect } from 'vitest';
import { csvField, buildCsv, numericColumns, paginationMeta, type Cell } from './DataTable';

// numericColumns(DataTable.tsx):列被视为数值列需「至少一行,且每行取 sortValue 后
// 为 number 或占位符(—/未知/尚无)」,用于右对齐 + 等宽数字渲染。

describe('numericColumns 数值列判定', () => {
  it('全数字列 → true,字符串列(如路径)→ false', () => {
    const rows: Cell[][] = [
      ['/docs/auth', 120, 42],
      ['/blog/hello', 7, 3],
    ];
    expect(numericColumns(['页面', '浏览量', '访客'], rows)).toEqual([false, true, true]);
  });

  it('数字 + —/未知 占位混合的列仍判为数值列', () => {
    const rows: Cell[][] = [
      [120, '—'],
      ['未知', 3],
      ['尚无', 0],
    ];
    expect(numericColumns(['浏览量', '访客'], rows)).toEqual([true, true]);
  });

  it('占位符以外的普通文本混入 → 混合列判为 false', () => {
    const rows: Cell[][] = [
      [120, 'direct'],
      [7, 'github'],
    ];
    expect(numericColumns(['浏览量', '来源'], rows)).toEqual([true, false]);
  });

  it('空表(无数据行)所有列判 false,不误配样式', () => {
    expect(numericColumns(['页面', '浏览量'], [])).toEqual([false, false]);
  });

  it('Cell 对象按 sort 值参与判定:{sort:number} 计入数值列', () => {
    const rows: Cell[][] = [
      [
        { sort: 5, display: '5s' },
        { sort: 12, display: '12 次' },
      ],
      [
        { sort: 9, display: '9s' },
        { sort: '—', display: '—' },
      ],
    ];
    expect(numericColumns(['耗时', '次数'], rows)).toEqual([true, true]);
  });
});

// csvField / buildCsv(DataTable.tsx:20-29):RFC4180 转义 + UTF-8 BOM + 首行表头 + CRLF 行尾,
// 单元格取排序原始值(sort)而非展示节点。

describe('csvField RFC4180 转义', () => {
  it('普通字符串与数字原样输出', () => {
    expect(csvField('/docs/auth')).toBe('/docs/auth');
    expect(csvField(42)).toBe('42');
  });

  it('含逗号/双引号/换行的字段整体加引号,内部引号翻倍', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('a\nb')).toBe('"a\nb"');
    expect(csvField('a\r\nb')).toBe('"a\r\nb"');
  });
});

describe('buildCsv 客户端构造', () => {
  it('UTF-8 BOM 开头、首行表头、数据行以 CRLF 相接', () => {
    const csv = buildCsv(['日期', '浏览量'], [['2026-10-01', 42]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toBe('\uFEFF日期,浏览量\r\n2026-10-01,42');
  });

  it('多行数据逐行 CRLF 连接', () => {
    expect(buildCsv(['a', 'b'], [[1, 2], [3, 4]])).toBe('\uFEFFa,b\r\n1,2\r\n3,4');
  });

  it('表头或单元格含特殊字符时同样走引号包裹', () => {
    expect(buildCsv(['维度,明细', '值'], [['utm_source,付费', 1]])).toBe(
      '\uFEFF"维度,明细",值\r\n"utm_source,付费",1',
    );
  });

  it('Cell{sort,display} 导出取 sort 原始值而非展示节点', () => {
    const cell: Cell = { sort: 7, display: '≈7 次' };
    expect(buildCsv(['次数'], [[cell]])).toBe('\uFEFF次数\r\n7');
  });
});

// paginationMeta(DataTable.tsx):分页信息文案——总页数向上取整(至少 1);
// 页码夹取到有效区间;首末条目序号 = 页界与总行的 min/max;空数据 first=0。

describe('paginationMeta 分页文案', () => {
  it('常规:53 行每页 10 → 6 页,第 0 页显示 1–10', () => {
    expect(paginationMeta(0, 10, 53)).toEqual({ totalPages: 6, page: 0, first: 1, last: 10, total: 53 });
  });

  it('末页:53 行第 5 页(索引)显示 51–53', () => {
    expect(paginationMeta(5, 10, 53)).toEqual({ totalPages: 6, page: 5, first: 51, last: 53, total: 53 });
  });

  it('页码越界被夹取:pageIndex 9 → 夹到末页 5', () => {
    expect(paginationMeta(9, 10, 53).page).toBe(5);
  });

  it('整除:50 行每页 10 → 恰 5 页,末页显示 41–50', () => {
    expect(paginationMeta(4, 10, 50)).toEqual({ totalPages: 5, page: 4, first: 41, last: 50, total: 50 });
  });

  it('空数据:0 行 → 1 页,first=0 last=0', () => {
    expect(paginationMeta(0, 10, 0)).toEqual({ totalPages: 1, page: 0, first: 0, last: 0, total: 0 });
  });
});
