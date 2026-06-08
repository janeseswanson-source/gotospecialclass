import { useWorkspaceAccess } from '@/hooks/useWorkspaceAccess';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldAlert, Key } from 'lucide-react';

const GatedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isActive, loading } = useWorkspaceAccess();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center animate-fade-in">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10">
          <ShieldAlert className="h-8 w-8 text-accent" />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="text-xl font-bold text-foreground">Activate Your Workspace</h2>
          <p className="text-sm text-muted-foreground">
            You need an active subscription or license key to access scheduling features.
            Head to Billing to redeem a license key or start a plan.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link to="/app/billing">
              <Key className="mr-2 h-4 w-4" />
              Go to Billing
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/app/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default GatedRoute;
