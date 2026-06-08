import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Key, CreditCard, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

const BillingPage = () => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [licenseKey, setLicenseKey] = useState('');

  // Get user's workspace
  const { data: membership } = useQuery({
    queryKey: ['workspace-membership'],
    queryFn: async () => {
      const { data } = await supabase
        .from('workspace_members')
        .select('workspace_id, workspaces(id, name, is_active, access_source)')
        .eq('user_id', session!.user.id)
        .limit(1)
        .single();
      return data;
    },
    enabled: !!session,
  });

  const workspaceId = membership?.workspace_id;

  // Get subscription
  const { data: subscription } = useQuery({
    queryKey: ['subscription', workspaceId],
    queryFn: async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('workspace_id', workspaceId!)
        .single();
      return data;
    },
    enabled: !!workspaceId,
  });

  // Get redeemed license keys
  const { data: licenses } = useQuery({
    queryKey: ['my-licenses'],
    queryFn: async () => {
      const { data } = await supabase
        .from('license_keys')
        .select('*')
        .eq('redeemed_by', session!.user.id);
      return data || [];
    },
    enabled: !!session,
  });

  const redeemMutation = useMutation({
    mutationFn: async (key: string) => {
      const { data, error } = await supabase.functions.invoke('redeem-license', {
        body: { license_key: key, workspace_id: workspaceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast.success(`License redeemed! Plan: ${data.plan}`);
      setLicenseKey('');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['my-licenses'] });
      queryClient.invalidateQueries({ queryKey: ['workspace-membership'] });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to redeem license');
    },
  });

  const workspace = membership?.workspaces as any;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing & License</h1>
        <p className="text-sm text-muted-foreground">Manage your subscription and license keys.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Subscription Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Subscription</CardTitle>
            <CardDescription>Current plan and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {subscription ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <Badge variant="secondary" className="capitalize">{subscription.plan}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant={subscription.status === 'active' ? 'default' : 'destructive'} className="capitalize">{subscription.status}</Badge>
                </div>
                {subscription.current_period_start && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Period</span>
                    <span className="text-sm">{format(new Date(subscription.current_period_start), 'MMM d, yyyy')} — {subscription.current_period_end ? format(new Date(subscription.current_period_end), 'MMM d, yyyy') : '∞'}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">No active subscription. Redeem a license key to get started.</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Workspace Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5" /> Workspace</CardTitle>
            <CardDescription>Workspace activation status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm font-medium">{workspace?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active</span>
              <Badge variant={workspace?.is_active ? 'default' : 'outline'}>{workspace?.is_active ? 'Yes' : 'No'}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Access Source</span>
              <span className="text-sm capitalize">{workspace?.access_source || '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Redeem License */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5" /> Redeem License Key</CardTitle>
          <CardDescription>Enter a license key to activate your workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Input
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
              className="max-w-sm font-mono"
            />
            <Button
              onClick={() => redeemMutation.mutate(licenseKey)}
              disabled={!licenseKey.trim() || redeemMutation.isPending || !workspaceId}
            >
              {redeemMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Redeem
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Redeemed Keys */}
      {licenses && licenses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Redeemed Licenses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {licenses.map((lic) => (
                <div key={lic.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div>
                    <span className="font-mono text-sm">{lic.key.slice(0, 8)}...{lic.key.slice(-4)}</span>
                    <p className="text-xs text-muted-foreground capitalize">{lic.plan} plan</p>
                  </div>
                  <div className="text-right">
                    <Badge variant="outline" className="capitalize">{lic.status}</Badge>
                    {lic.expires_at && <p className="text-xs text-muted-foreground mt-1">Expires {format(new Date(lic.expires_at), 'MMM d, yyyy')}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BillingPage;
