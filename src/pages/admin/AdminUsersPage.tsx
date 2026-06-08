import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { MoreHorizontal, Trash2, Eye } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const AdminUsersPage = () => {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['admin-all-profiles'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ['admin-all-user-roles'],
    queryFn: async () => {
      const { data } = await supabase.from('user_roles').select('*');
      return data || [];
    },
  });

  const { data: workspaceMembers } = useQuery({
    queryKey: ['admin-all-workspace-members'],
    queryFn: async () => {
      const { data } = await supabase.from('workspace_members').select('user_id, workspace_id');
      return data || [];
    },
  });

  const getRoles = (userId: string) => {
    return (userRoles || []).filter(r => r.user_id === userId).map(r => r.role);
  };

  const getWorkspaceCount = (userId: string) => {
    return (workspaceMembers || []).filter(m => m.user_id === userId).length;
  };

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { user_id: deleteTarget.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'User deleted', description: `${deleteTarget.name} has been removed.` });
      queryClient.invalidateQueries({ queryKey: ['admin-all-profiles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-user-roles'] });
      queryClient.invalidateQueries({ queryKey: ['admin-all-workspace-members'] });
    } catch (err: any) {
      toast({ title: 'Delete failed', description: err.message, variant: 'destructive' });
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  const columns = [
    { key: 'display_name', header: 'Name', render: (r: any) => r.display_name || '—' },
    { key: 'user_id', header: 'User ID', render: (r: any) => <span className="font-mono text-xs">{r.user_id.slice(0, 8)}…</span> },
    {
      key: 'roles', header: 'Roles', render: (r: any) => {
        const roles = getRoles(r.user_id);
        return roles.length > 0
          ? <div className="flex gap-1 flex-wrap">{roles.map(role => <Badge key={role} variant="secondary" className="text-xs">{role}</Badge>)}</div>
          : <span className="text-xs text-muted-foreground">—</span>;
      }
    },
    {
      key: 'workspaces', header: 'Workspaces', render: (r: any) => {
        const count = getWorkspaceCount(r.user_id);
        return <span className="text-sm">{count}</span>;
      }
    },
    { key: 'created_at', header: 'Joined', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
    {
      key: 'actions', header: '', render: (r: any) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="gap-2">
              <Eye className="h-3.5 w-3.5" /> View Details
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              onClick={() => setDeleteTarget({ id: r.user_id, name: r.display_name || 'this user' })}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete User
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">User Management</h1>
        <p className="text-sm text-muted-foreground">Search, inspect, and manage users.</p>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={profiles || []} columns={columns} searchKey="display_name" searchPlaceholder="Search by name..." />}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all their associated data (workspaces, profiles). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminUsersPage;
