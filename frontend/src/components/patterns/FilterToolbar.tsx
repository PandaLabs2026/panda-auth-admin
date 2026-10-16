import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

/**
 * 筛选工具栏模式（v0.5.0）：搜索 + 下拉筛选统一进 URL 查询串——可分享、可回退、
 * 刷新不丢。消费方用返回的 values 过滤数据；本组件只管 URL 状态与输入节流。
 */
export interface FilterSelectConfig {
  key: string;
  label: string;
  /** value → 展示名；value 'all' 为「全部」哨兵。 */
  options: Record<string, string>;
}

export default function FilterToolbar({
  searchKey = 'q',
  searchPlaceholder = '搜索…',
  selects = [],
  right,
}: {
  searchKey?: string;
  searchPlaceholder?: string;
  selects?: FilterSelectConfig[];
  /** 右侧插槽（如「新建」按钮）。 */
  right?: ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [term, setTerm] = useState(searchParams.get(searchKey) ?? '');
  const debounced = useDebouncedValue(term, 300);

  // 输入本地即时回显,节流后落 URL;清空时移除键,保持 URL 干净
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (debounced) next.set(searchKey, debounced);
        else next.delete(searchKey);
        return next;
      },
      { replace: true },
    );
  }, [debounced, searchKey, setSearchParams]);

  const setSelect = (key: string, value: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value && value !== 'all') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center" data-testid="filter-toolbar">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={searchPlaceholder}
        className="sm:max-w-xs"
        aria-label={searchPlaceholder}
        data-testid="filter-search"
      />
      {selects.map(({ key, label, options }) => (
        <Select key={key} value={searchParams.get(key) ?? 'all'} onValueChange={(v) => setSelect(key, v)}>
          <SelectTrigger className="w-full sm:w-40" aria-label={label}>
            <SelectValue placeholder={label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{label}：全部</SelectItem>
            {Object.entries(options).map(([value, name]) => (
              <SelectItem key={value} value={value}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {right && <div className="sm:ml-auto">{right}</div>}
    </div>
  );
}

/** 消费侧取值：从 searchParams 读出过滤值的便捷 hook（与 toolbar 键约定一致）。 */
export function useFilterValues(searchKey = 'q', selectKeys: string[] = []) {
  const [searchParams] = useSearchParams();
  const q = searchParams.get(searchKey) ?? '';
  const selects = Object.fromEntries(selectKeys.map((k) => [k, searchParams.get(k)]));
  return { q, selects };
}
