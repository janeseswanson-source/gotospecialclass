import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search } from 'lucide-react';

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  searchKey?: string;
  searchPlaceholder?: string;
}

function DataTable<T extends Record<string, any>>({ data, columns, searchKey, searchPlaceholder = 'Search...' }: DataTableProps<T>) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search || !searchKey) return data;
    const q = search.toLowerCase();
    return data.filter((row) => String(row[searchKey] ?? '').toLowerCase().includes(q));
  }, [data, search, searchKey]);

  return (
    <div className="space-y-4">
      {searchKey && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
      )}
      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => <TableHead key={col.key}>{col.header}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-8">No data found.</TableCell></TableRow>
            ) : (
              filtered.map((row, i) => (
                <TableRow key={row.id || i}>
                  {columns.map((col) => (
                    <TableCell key={col.key}>{col.render ? col.render(row) : String(row[col.key] ?? '—')}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</p>
    </div>
  );
}

export default DataTable;
