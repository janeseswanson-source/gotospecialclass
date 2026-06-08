import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useSchool } from '@/contexts/SchoolContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Plus, School, Loader2, Trash2, Settings, Users, BookOpen } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface SchoolData {
  id: string;
  name: string;
  school_year: string | null;
  setup_complete: boolean;
  setup_step: number;
  grades_served: string[] | null;
  specialistCount: number;
  teacherCount: number;
  generationCount: number;
}

export default function SchoolsPage() {
  const { schools, selectedSchoolId, setSelectedSchoolId, workspaceId } = useSchool();
  const navigate = useNavigate();
  const [schoolsData, setSchoolsData] = useState<SchoolData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadSchools(); }, [schools]);

  async function loadSchools() {
    setLoading(true);
    const enriched: SchoolData[] = [];
    for (const s of schools) {
      const [specRes, teachRes, genRes, schoolRes] = await Promise.all([
        supabase.from('specialists').select('id', { count: 'exact', head: true }).eq('school_id', s.id),
        supabase.from('classroom_teachers').select('id', { count: 'exact', head: true }).eq('school_id', s.id),
        supabase.from('schedule_generations').select('id', { count: 'exact', head: true }).eq('school_id', s.id),
        supabase.from('schools').select('grades_served').eq('id', s.id).single(),
      ]);
      enriched.push({
        id: s.id,
        name: s.name,
        school_year: s.school_year,
        setup_complete: s.setup_complete ?? false,
        setup_step: s.setup_step ?? 0,
        grades_served: schoolRes.data?.grades_served as string[] | null,
        specialistCount: specRes.count || 0,
        teacherCount: teachRes.count || 0,
        generationCount: genRes.count || 0,
      });
    }
    setSchoolsData(enriched);
    setLoading(false);
  }

  async function createSchool() {
    if (!newName.trim() || !workspaceId) return;
    setCreating(true);
    const { data, error } = await supabase
      .from('schools')
      .insert({ name: newName.trim(), workspace_id: workspaceId })
      .select()
      .single();
    setCreating(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'School created' });
      setShowAdd(false);
      setNewName('');
      if (data) setSelectedSchoolId(data.id);
      navigate('/app/setup');
    }
  }

  async function deleteSchool(id: string) {
    const { error } = await supabase.from('schools').delete().eq('id', id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'School deleted' });
      if (selectedSchoolId === id && schools.length > 1) {
        const other = schools.find(s => s.id !== id);
        if (other) setSelectedSchoolId(other.id);
      }
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Schools</h1>
          <p className="text-sm text-muted-foreground">Manage your schools.</p>
        </div>
        <Button onClick={() => setShowAdd(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add School
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : schoolsData.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-10 text-center">
          <School className="h-10 w-10 mx-auto text-primary/50 mb-3" />
          <p className="text-sm text-muted-foreground">No schools yet. Add your first school to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schoolsData.map(school => (
            <Card key={school.id} className={`transition-all hover:shadow-md ${selectedSchoolId === school.id ? 'border-primary ring-1 ring-primary/20' : ''}`}>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-sm">{school.name}</h3>
                    <p className="text-xs text-muted-foreground">{school.school_year || '2025-2026'}</p>
                  </div>
                  <Badge variant={school.setup_complete ? 'default' : 'secondary'} className="text-[10px]">
                    {school.setup_complete ? 'Complete' : `Step ${school.setup_step}/10`}
                  </Badge>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {school.specialistCount} spec</span>
                  <span className="flex items-center gap-1"><BookOpen className="h-3 w-3" /> {school.teacherCount} teach</span>
                  <span>{school.generationCount} gen</span>
                </div>
                {school.grades_served && school.grades_served.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {school.grades_served.map(g => (
                      <span key={g} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{g}</span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1 text-xs"
                    onClick={() => { setSelectedSchoolId(school.id); navigate('/app/setup'); }}
                  >
                    <Settings className="h-3 w-3" /> Configure
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {school.name}?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete this school and all its data.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => deleteSchool(school.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add New School</DialogTitle></DialogHeader>
          <div>
            <Label>School Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Lincoln Elementary" className="mt-1" />
          </div>
          <DialogFooter>
            <Button onClick={createSchool} disabled={creating || !newName.trim()} className="gap-2">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create School
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
