import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings, Upload, Trash2, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import SystemStatusCard from '@/components/admin/SystemStatusCard';

const FLAGS = [
  { key: 'ff_ai_calendar', label: 'AI Calendar Parsing', description: 'Enable AI-powered calendar PDF parsing' },
  { key: 'ff_schedule_gen', label: 'Schedule Generation', description: 'Enable AI schedule generation' },
  { key: 'ff_exports', label: 'Export to PDF/CSV', description: 'Allow users to export schedules' },
  { key: 'ff_specialist_planner', label: 'Specialist Planner', description: 'Enable specialist planner view' },
  { key: 'ff_billing', label: 'Billing & Licenses', description: 'Show billing page to users' },
];

const TEMPLATE_SLOTS = [
  { key: 'prep_guide', label: 'Prep Guide Template', description: 'Multi-tab import template for the Setup Wizard' },
  { key: 'teachers', label: 'Teachers Template', description: 'CSV template for importing classroom teachers' },
  { key: 'specialists', label: 'Specialists Template', description: 'CSV template for importing specialists' },
];

interface AdminTemplate {
  id: string;
  template_key: string;
  file_name: string;
  file_path: string;
  updated_at: string;
}

const AdminSettingsPage = () => {
  const [flags, setFlags] = useState<Record<string, boolean>>(() => {
    const stored = localStorage.getItem('admin_feature_flags');
    return stored ? JSON.parse(stored) : FLAGS.reduce((acc, f) => ({ ...acc, [f.key]: true }), {});
  });

  const [templates, setTemplates] = useState<AdminTemplate[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const toggle = (key: string) => {
    const updated = { ...flags, [key]: !flags[key] };
    setFlags(updated);
    localStorage.setItem('admin_feature_flags', JSON.stringify(updated));
  };

  const loadTemplates = async () => {
    const { data } = await supabase.from('admin_templates').select('*');
    if (data) setTemplates(data as AdminTemplate[]);
  };

  useEffect(() => { loadTemplates(); }, []);

  const handleUpload = async (templateKey: string, file: File) => {
    setUploading(templateKey);
    try {
      const ext = file.name.split('.').pop() || 'csv';
      const storagePath = `${templateKey}/template.${ext}`;

      // Upload to storage (overwrite)
      const { error: uploadError } = await supabase.storage
        .from('templates')
        .upload(storagePath, file, { upsert: true });
      if (uploadError) throw uploadError;

      // Upsert metadata
      const { data: { user } } = await supabase.auth.getUser();
      const { error: dbError } = await supabase.from('admin_templates').upsert({
        template_key: templateKey,
        file_name: file.name,
        file_path: storagePath,
        uploaded_by: user?.id || null,
        updated_at: new Date().toISOString(),
      } as any, { onConflict: 'template_key' });
      if (dbError) throw dbError;

      toast.success(`Template "${templateKey}" updated`);
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const handleDelete = async (templateKey: string) => {
    const tpl = templates.find(t => t.template_key === templateKey);
    if (!tpl) return;
    try {
      await supabase.storage.from('templates').remove([tpl.file_path]);
      await supabase.from('admin_templates').delete().eq('template_key', templateKey);
      toast.success('Reverted to default template');
      loadTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Delete failed');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Settings</h1>
        <p className="text-sm text-muted-foreground">Plans, feature flags, templates, and system configuration.</p>
      </div>

      {/* System / dependency status */}
      <SystemStatusCard />

      {/* Feature Flags */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5" /> Feature Flags</CardTitle><CardDescription>Toggle features on/off across the platform.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {FLAGS.map(flag => (
            <div key={flag.key} className="flex items-center justify-between rounded-lg border border-border p-4">
              <div>
                <p className="text-sm font-medium">{flag.label}</p>
                <p className="text-xs text-muted-foreground">{flag.description}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={flags[flag.key] ? 'default' : 'outline'}>{flags[flag.key] ? 'On' : 'Off'}</Badge>
                <Switch checked={flags[flag.key]} onCheckedChange={() => toggle(flag.key)} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Template Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> Template Management</CardTitle>
          <CardDescription>Upload custom templates that all users will download. Revert to defaults by deleting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {TEMPLATE_SLOTS.map(slot => {
            const tpl = templates.find(t => t.template_key === slot.key);
            const isUploading = uploading === slot.key;
            return (
              <div key={slot.key} className="flex items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{slot.label}</p>
                  <p className="text-xs text-muted-foreground">{slot.description}</p>
                  {tpl ? (
                    <p className="text-xs text-primary">
                      Custom: {tpl.file_name} · Updated {new Date(tpl.updated_at).toLocaleDateString()}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Using built-in default</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={el => { fileRefs.current[slot.key] = el; }}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleUpload(slot.key, f);
                      e.target.value = '';
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={isUploading}
                    onClick={() => fileRefs.current[slot.key]?.click()}
                  >
                    {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {tpl ? 'Replace' : 'Upload'}
                  </Button>
                  {tpl && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(slot.key)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Plan Config */}
      <Card>
        <CardHeader><CardTitle>Plan Configuration</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border p-4">
              <h4 className="font-semibold">Pro Plan</h4>
              <p className="text-sm text-muted-foreground">Up to 5 schools, AI features, exports</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <h4 className="font-semibold">Enterprise Plan</h4>
              <p className="text-sm text-muted-foreground">Unlimited schools, priority support, custom branding</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminSettingsPage;
