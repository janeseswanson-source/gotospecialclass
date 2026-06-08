import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { DollarSign } from 'lucide-react';

const costItems = [
  { label: 'Hosting (monthly)', placeholder: '29.00' },
  { label: 'Database (monthly)', placeholder: '25.00' },
  { label: 'Edge Functions (monthly)', placeholder: '10.00' },
  { label: 'Storage (monthly)', placeholder: '5.00' },
  { label: 'Domain & DNS (monthly)', placeholder: '1.50' },
  { label: 'Other (monthly)', placeholder: '0.00' },
];

const AdminCostsPage = () => (
  <div className="space-y-6 animate-fade-in">
    <div>
      <h1 className="text-2xl font-bold text-foreground">Costs</h1>
      <p className="text-sm text-muted-foreground">Platform operational cost estimates.</p>
    </div>
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" /> Infrastructure Costs</CardTitle></CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-2">
          {costItems.map(item => (
            <div key={item.label} className="space-y-1">
              <label className="text-sm text-muted-foreground">{item.label}</label>
              <Input type="number" placeholder={item.placeholder} className="max-w-xs" />
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">These are manual estimates — not connected to live billing data.</p>
      </CardContent>
    </Card>
  </div>
);

export default AdminCostsPage;
