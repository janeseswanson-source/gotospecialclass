import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { Save, LogOut, User, Building2, Lock, Users, Mail, Loader2, Trash2, Plus } from 'lucide-react';

interface WorkspaceMember {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
  email?: string;
}

interface WorkspaceInvite {
  id: string;
  email: string;
  role: string;
  created_at: string;
  accepted_at: string | null;
  expires_at: string;
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'specialist_teacher', label: 'Specialist Teacher' },
  { value: 'classroom_teacher', label: 'Classroom Teacher' },
  { value: 'office_staff', label: 'Office Staff' },
  { value: 'viewer', label: 'Viewer' },
];

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const { workspaceId } = useSchool();
  const { toast } = useToast();
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Team state
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [loadingTeam, setLoadingTeam] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<string>('viewer');

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('user_id', user.id)
        .single();
      if (profile) {
        setDisplayName(profile.display_name || '');
        setAvatarUrl(profile.avatar_url || '');
      }

      if (workspaceId) {
        const { data: ws } = await supabase
          .from('workspaces')
          .select('name')
          .eq('id', workspaceId)
          .single();
        if (ws) setWorkspaceName(ws.name);
        loadTeam();
      }
    };
    load();
  }, [user, workspaceId]);

  async function loadTeam() {
    if (!workspaceId || !user) return;
    setLoadingTeam(true);
    
    const { data: membersData } = await supabase
      .from('workspace_members')
      .select('id, user_id, role, created_at')
      .eq('workspace_id', workspaceId);

    if (membersData) {
      const enriched: WorkspaceMember[] = [];
      for (const m of membersData) {
        const { data: prof } = await supabase
          .from('profiles')
          .select('display_name, avatar_url')
          .eq('user_id', m.user_id)
          .single();
        enriched.push({ ...m, profile: prof || undefined });
        if (m.user_id === user.id) setCurrentUserRole(m.role);
      }
      setMembers(enriched);
    }

    const { data: invitesData } = await supabase
      .from('workspace_invites')
      .select('id, email, role, created_at, accepted_at, expires_at')
      .eq('workspace_id', workspaceId)
      .is('accepted_at', null)
      .order('created_at', { ascending: false });
    if (invitesData) setInvites(invitesData);
    
    setLoadingTeam(false);
  }

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName, avatar_url: avatarUrl || null })
      .eq('user_id', user.id);
    setSaving(false);
    toast(error
      ? { title: 'Error', description: error.message, variant: 'destructive' }
      : { title: 'Saved', description: 'Profile updated.' });
  };

  const saveWorkspace = async () => {
    if (!workspaceId) return;
    setSaving(true);
    const { error } = await supabase
      .from('workspaces')
      .update({ name: workspaceName })
      .eq('id', workspaceId);
    setSaving(false);
    toast(error
      ? { title: 'Error', description: error.message, variant: 'destructive' }
      : { title: 'Saved', description: 'Workspace updated.' });
  };

  const changePassword = async () => {
    const pwErrors: string[] = [];
    if (newPassword.length < 8) pwErrors.push('at least 8 characters');
    if (!/[A-Z]/.test(newPassword)) pwErrors.push('one uppercase letter');
    if (!/[a-z]/.test(newPassword)) pwErrors.push('one lowercase letter');
    if (!/[0-9]/.test(newPassword)) pwErrors.push('one number');
    if (pwErrors.length > 0) {
      toast({ title: 'Error', description: `Password must have: ${pwErrors.join(', ')}.`, variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Error', description: 'Passwords do not match.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Saved', description: 'Password updated.' });
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim() || !workspaceId) return;
    setSendingInvite(true);
    try {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: { workspace_id: workspaceId, email: inviteEmail.trim(), role: inviteRole },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Invite sent', description: `Invitation sent to ${inviteEmail}` });
      setInviteEmail('');
      loadTeam();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
    setSendingInvite(false);
  };

  const removeMember = async (userId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: { action: 'remove_member', workspace_id: workspaceId, user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Member removed' });
      loadTeam();
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const cancelInvite = async (inviteId: string) => {
    const { error } = await supabase.from('workspace_invites').delete().eq('id', inviteId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Invite cancelled' });
      loadTeam();
    }
  };

  const canManageTeam = ['owner', 'admin'].includes(currentUserRole);
  const inviteUrl = (token: string) => `${window.location.origin}/accept-invite?token=${token}`;

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your profile, workspace, and account.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><User className="h-4 w-4" /> Profile</CardTitle>
          <CardDescription>Your personal information.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input value={user?.email || ''} disabled className="mt-1" />
          </div>
          <div>
            <Label>Display Name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Avatar URL</Label>
            <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." className="mt-1" />
          </div>
          <Button onClick={saveProfile} disabled={saving} size="sm" className="gap-2">
            <Save className="h-3.5 w-3.5" /> Save Profile
          </Button>
        </CardContent>
      </Card>

      {workspaceId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" /> Workspace</CardTitle>
            <CardDescription>Your workspace settings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Workspace Name</Label>
              <Input value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} className="mt-1" />
            </div>
            <Button onClick={saveWorkspace} disabled={saving} size="sm" className="gap-2">
              <Save className="h-3.5 w-3.5" /> Save Workspace
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Team Management */}
      {workspaceId && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Team Members</CardTitle>
            <CardDescription>Manage who has access to this workspace.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingTeam ? (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : (
              <>
                {/* Current members */}
                <div className="space-y-2">
                  {members.map(m => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground shrink-0">
                        {(m.profile?.display_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{m.profile?.display_name || 'Unknown'}</p>
                        {m.user_id === user?.id && <span className="text-[10px] text-muted-foreground">(you)</span>}
                      </div>
                      <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                      {canManageTeam && m.user_id !== user?.id && m.role !== 'owner' && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove member?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will remove {m.profile?.display_name || 'this user'} from the workspace.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => removeMember(m.user_id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  ))}
                </div>

                {/* Pending invites */}
                {invites.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pending Invites</p>
                    {invites.map(inv => (
                      <div key={inv.id} className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2">
                        <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{inv.email}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">{inv.role}</Badge>
                        {canManageTeam && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => cancelInvite(inv.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Invite form */}
                {canManageTeam && (
                  <div className="space-y-3 pt-2 border-t border-border">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Invite New Member</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Email address"
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        className="flex-1"
                      />
                      <Select value={inviteRole} onValueChange={setInviteRole}>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLE_OPTIONS.map(r => (
                            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button onClick={sendInvite} disabled={sendingInvite || !inviteEmail.trim()} size="sm" className="gap-2">
                      {sendingInvite ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      Send Invite
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4" /> Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>New Password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label>Confirm Password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="mt-1" />
          </div>
          <Button onClick={changePassword} disabled={saving} size="sm" variant="secondary">Change Password</Button>
        </CardContent>
      </Card>

      <Separator />

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">⚠️ Danger Zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Export My Data</p>
              <p className="text-xs text-muted-foreground">Download all your data as JSON.</p>
            </div>
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const { data, error } = await supabase.functions.invoke('manage-account', { body: { action: 'export' } });
                if (error) throw error;
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `my-data-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast({ title: 'Data exported' });
              } catch (err: any) {
                toast({ title: 'Error', description: err.message, variant: 'destructive' });
              }
            }}>
              Export Data
            </Button>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-destructive">Delete My Account</p>
              <p className="text-xs text-muted-foreground">Permanently delete your account and all data.</p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm">Delete Account</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete your account and remove all associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => {
                    try {
                      const { error } = await supabase.functions.invoke('manage-account', { body: { action: 'delete' } });
                      if (error) throw error;
                      await signOut();
                      toast({ title: 'Account deleted' });
                    } catch (err: any) {
                      toast({ title: 'Error', description: err.message, variant: 'destructive' });
                    }
                  }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete My Account
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      <Button variant="destructive" className="gap-2" onClick={signOut}>
        <LogOut className="h-4 w-4" /> Sign Out
      </Button>
    </div>
  );
};

export default SettingsPage;
