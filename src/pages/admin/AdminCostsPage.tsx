import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DollarSign } from 'lucide-react';

const COST_KEYS = [
  { key: 'hosting', label: 'Hosting (monthly)', placeholder: '29.00' },
  { key: 'database', label: 'Database (monthly)', placeholder: '25.00' },
  { key: 'edge', label: 'Edge Functions (monthly)', placeholder: '10.00' },
  { key: 'storage', label: 'Storage (monthly)', placeholder: '5.00' },
  { key: 'domain', label: 'Domain & DNS (monthly)', placeholder: '1.50' },
  { key: 'other', label: 'Other (monthly)', placeholder: '0.00' },
];

const STORAGE_KEY = 'admin.cost.estimates';

// Manual cost estimates persisted locally per admin browser. The old version
// rendered inert inputs (no value/onChange/save) — typing did nothing.
const AdminCostsPage = () => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setValues(JSON.parse(raw));
    } catch { /* corrupted store — start fresh */ }
  }, []);

  const update = (key: string, v: string) => {
    const next = { ...values, [key]: v };
    setValues(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  const total = COST_KEYS.reduce((sum, c) => sum + (parseFloat(values[c.key] || '') || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Costs</h1>
        <p className="text-sm text-muted-foreground">Platform operational cost estimates.</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> Infrastructure Costs</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {COST_KEYS.map(item => (
              <div key={item.key} className="space-y-1">
                <label className="text-sm text-muted-foreground" htmlFor={`cost-${item.key}`}>{item.label}</label>
                <Input
                  id={`cost-${item.key}`}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={item.placeholder}
                  value={values[item.key] ?? ''}
                  onChange={(e) => update(item.key, e.target.value)}
                  className="max-w-xs"
                />
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Manual estimates, saved in this browser — not connected to live billing data.</p>
            <p className="text-sm font-semibold text-foreground">Total: ${total.toFixed(2)}/mo</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminCostsPage;
