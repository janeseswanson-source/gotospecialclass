import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'login_required'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setStatus('error');
      setErrorMsg('No invite token provided.');
      return;
    }
    if (!user) {
      // Store token and redirect to login
      localStorage.setItem('pending_invite_token', token);
      setStatus('login_required');
      return;
    }
    acceptInvite();
  }, [user, authLoading, token]);

  async function acceptInvite() {
    try {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: { action: 'accept', token },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setStatus('success');
      localStorage.removeItem('pending_invite_token');
      setTimeout(() => navigate('/app/dashboard'), 2000);
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Failed to accept invite');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center">Team Invite</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          {status === 'loading' && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Accepting invite…</p>
            </>
          )}
          {status === 'success' && (
            <>
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-sm font-medium">You've been added to the workspace!</p>
              <p className="text-xs text-muted-foreground">Redirecting to dashboard…</p>
            </>
          )}
          {status === 'login_required' && (
            <>
              <p className="text-sm text-center">You need to sign in or create an account to accept this invite.</p>
              <div className="flex gap-3">
                <Button asChild><Link to={`/login?redirect=/accept-invite?token=${token}`}>Sign In</Link></Button>
                <Button variant="outline" asChild><Link to={`/signup?redirect=/accept-invite?token=${token}`}>Sign Up</Link></Button>
              </div>
            </>
          )}
          {status === 'error' && (
            <>
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="text-sm text-destructive">{errorMsg}</p>
              <Button variant="outline" asChild><Link to="/app/dashboard">Go to Dashboard</Link></Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
