import { useMemo } from 'react';
import { cn } from 'cn';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Inbox } from 'lucide-react';
import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Button } from '@/components/ui/button';

/**
 * DataTable 是 patterns 层的 API 契约（headers/rows/exportName/pageSize）。
 * v0.1.4 起内部基于 TanStack Table（core+sorted+pagination 行模型）——
 * 升级判据即行为契约测试（*.test.ts）全绿:排序语义（首点降序/再点切换/
  点击他列重置）、CSV 导出、数值列判定与手写版逐项等价。
 * pageSize 传入即启用客户端分页（默认关闭,行为与无分页版一致）;
 * 服务端分页场景由调用方自行组合本组件与自己的取数层。
 * v0.4.3 起支持宽表姿势:stickyHeader（表体在容器内纵向滚动,表头钉住,
 * 容器限高 70vh）;stickyFirstColumn（横向滚动时首列冻结）。二者可同开,
 * 左上角单元格同时钉住。默认全关,渲染行为与历史版本一致。
 */

/** 排序用原始值、展示用任意节点;string/number 单元格两者同值。 */
export type Cell = string | number | { sort: string | number; display: React.ReactNode };

const sortValue = (cell: Cell): string | number =>
  typeof cell === 'object' && cell !== null ? cell.sort : cell;

/** RFC4180:字段含逗号/双引号/换行时整体双引号包裹,内部引号翻倍;其余原样。 */
export const csvField = (value: string | number): string => {
  const s = String(value);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/** 客户端 CSV 构造(纯函数,供导出按钮与 vitest):UTF-8 BOM 开头,首行表头,数据行取排序原始值,行尾 CRLF。 */
export function buildCsv(headers: string[], rows: Cell[][]): string {
  const line = (cells: (string | number)[]) => cells.map(csvField).join(',');
  return '\uFEFF' + [line(headers), ...rows.map((r) => line(r.map(sortValue)))].join('\r\n');
}

/** 触发浏览器下载(副作用,不参与纯函数测试)。 */
const downloadCsv = (exportName: string, csv: string) => {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = exportName + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const displayValue = (cell: Cell): React.ReactNode =>
  typeof cell === 'object' && cell !== null ? cell.display : cell;

const PLACEHOLDERS = new Set(['—', '未知', '尚无']);

/** 数值列(允许占位符)右对齐 + 等宽数字,是专业表格的基本功;导出供 vitest 复用同一判定。 */
export const numericColumns = (headers: string[], rows: Cell[][]): boolean[] =>
  headers.map((_, i) =>
    rows.length > 0 &&
    rows.every((r) => {
      const v = sortValue(r[i]);
      return typeof v === 'number' || PLACEHOLDERS.has(String(v));
    }),
  );

/** 分页信息文案的纯函数(供渲染与 vitest):当前页显示第 first–last 条,共 total 条。 */
export function paginationMeta(pageIndex: number, pageSize: number, totalRows: number) {
  const total = Math.max(1, Math.ceil(totalRows / Math.max(1, pageSize)));
  const page = Math.min(Math.max(0, pageIndex), total - 1);
  const first = totalRows === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(totalRows, (page + 1) * pageSize);
  return { totalPages: total, page, first, last, total: totalRows };
}

const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    text: sortFn_text,
  },
});

export default function DataTable({
  headers,
  rows,
  exportName,
  pageSize,
  stickyHeader,
  stickyFirstColumn,
}: {
  headers: string[];
  rows: Cell[][];
  /** 有值时在表格上方右侧显示「导出 CSV」,文件名 `${exportName}.csv`;空表走既有空态,不提供导出。 */
  exportName?: string;
  /** 传入即启用客户端分页(每页行数);缺省不分页,渲染行为与历史版本一致。 */
  pageSize?: number;
  /** 宽表姿势:表头钉在滚动容器顶部(容器限高 70vh,表体内部纵向滚动)。 */
  stickyHeader?: boolean;
  /** 宽表姿势:横向滚动时首列冻结(实底背景 + 右分隔线)。 */
  stickyFirstColumn?: boolean;
}) {
  // 行模型以「行数组下标」为 identity:每行是 Cell[],列 i 取 sortValue(row[i])。
  // 首点降序(sortDescFirst)、再点切换方向、点他列重置为降序——与手写版排序语义一致。
  // columns/data 必须 memo(TanStack 官方要求稳定引用),否则排序态变化即重建列模型。
  const columns = useMemo(
    () =>
      headers.map((h, i) => ({
        id: String(i),
        accessorFn: (row: Cell[]) => sortValue(row[i]),
        header: h,
        sortDescFirst: true,
      })),
    [headers],
  );
  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns,
    // Missing pageSize preserves the complete row set, rather than the SDK default page.
    manualPagination: !pageSize,
    ...(pageSize ? { initialState: { pagination: { pageIndex: 0, pageSize } } } : {}),
  });

  const sorting = table.state.sorting;
  const sortOf = (i: number) => sorting.find((s) => s.id === String(i));

  if (!rows.length)
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-muted-foreground">
        <Inbox className="size-5" />
        <p className="text-sm">所选范围暂无数据。</p>
      </div>
    );

  const numeric = numericColumns(headers, rows);
  const { pageIndex } = table.state.pagination;
  const meta = paginationMeta(pageIndex, pageSize ?? rows.length, rows.length);
  const rowModel = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-2">
      {exportName && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => downloadCsv(exportName, buildCsv(headers, rows))}
          >
            <Download />
            导出 CSV
          </Button>
        </div>
      )}
      <div
        className={cn(
          'overflow-x-auto rounded-lg border',
          stickyHeader && 'max-h-[70vh] overflow-y-auto',
        )}
      >
        <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            {headers.map((h, i) => (
              <TableHead
                key={h}
                aria-sort={sortOf(i) ? (sortOf(i)!.desc ? 'descending' : 'ascending') : 'none'}
                className={
                  cn(
                    numeric[i] && 'text-right',
                    // 层级契约:角部表头 > 首列单元格 > 其余表头 > 表体,斜向滚动互不压盖
                    stickyHeader && 'sticky top-0 z-30 bg-muted',
                    stickyFirstColumn &&
                      i === 0 &&
                      `sticky left-0 border-r bg-muted ${stickyHeader ? 'z-40' : 'z-30'}`,
                  ) || undefined
                }
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className={
                    '-ml-2 h-7 px-2 text-[13px] font-semibold' +
                    (numeric[i] ? ' ml-auto' : '')
                  }
                  onClick={table.getColumn(String(i))?.getToggleSortingHandler()}
                >
                  {h}
                  {sortOf(i) ? (
                    sortOf(i)!.desc ? (
                      <ArrowDown />
                    ) : (
                      <ArrowUp />
                    )
                  ) : (
                    <ArrowUpDown className="text-muted-foreground/40" />
                  )}
                </Button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowModel.map((row) => (
            <TableRow key={row.index} className="group">
              {row.original.map((v: Cell, j: number) => (
                <TableCell
                  key={j}
                  className={
                    cn(
                      numeric[j] && 'text-right tabular-nums',
                      // 首列冻结:实底遮住横滑单元格,行悬停时同步着色
                      stickyFirstColumn &&
                        j === 0 &&
                        'sticky left-0 z-20 border-r bg-background group-hover:bg-muted/50',
                    ) || undefined
                  }
                >
                  {displayValue(v)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        </Table>
      </div>
      {pageSize && meta.totalPages > 1 && (
        <div className="flex flex-col items-center gap-1 sm:flex-row sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            第 {meta.first}–{meta.last} 条,共 {meta.total} 条
          </span>
          <Pagination className="mx-0 w-auto">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  href="#"
                  aria-disabled={!table.getCanPreviousPage()}
                  className={(!table.getCanPreviousPage() && 'pointer-events-none opacity-50') || undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    table.previousPage();
                  }}
                />
              </PaginationItem>
              {Array.from({ length: meta.totalPages }, (_, p) => (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === meta.page}
                    onClick={(e) => {
                      e.preventDefault();
                      table.setPageIndex(p);
                    }}
                  >
                    {p + 1}
                  </PaginationLink>
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  href="#"
                  aria-disabled={!table.getCanNextPage()}
                  className={(!table.getCanNextPage() && 'pointer-events-none opacity-50') || undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    table.nextPage();
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
