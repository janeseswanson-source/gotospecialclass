import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

const AdminProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!session) { setIsAdmin(false); return; }
    supabase.rpc('has_role', { _user_id: session.user.id, _role: 'admin' })
      .then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  if (isAdmin === null) return <div className="flex h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!isAdmin) return <Navigate to="/app/dashboard" replace />;
  return <>{children}</>;
};

export default AdminProtectedRoute;
