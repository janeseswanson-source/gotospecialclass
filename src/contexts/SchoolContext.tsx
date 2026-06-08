import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface School {
  id: string;
  name: string;
  setup_complete: boolean | null;
  setup_step: number | null;
  school_year: string | null;
  is_demo: boolean | null;
}

interface SchoolContextType {
  schools: School[];
  selectedSchool: School | null;
  selectedSchoolId: string | null;
  setSelectedSchoolId: (id: string) => void;
  loading: boolean;
  workspaceId: string | null;
  refresh: () => Promise<void>;
}

const SchoolContext = createContext<SchoolContextType | undefined>(undefined);

const STORAGE_KEY = 'selected_school_id';

export const SchoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY)
  );
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const setSelectedSchoolId = useCallback((id: string) => {
    setSelectedSchoolIdState(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const loadSchools = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!membership) { setLoading(false); return; }
    setWorkspaceId(membership.workspace_id);

    const { data: schoolRows } = await supabase
      .from('schools')
      .select('id, name, setup_complete, setup_step, school_year, is_demo')
      .eq('workspace_id', membership.workspace_id)
      .order('created_at', { ascending: false });

    const list = schoolRows ?? [];
    setSchools(list);

    // Auto-select: use stored id if still valid, else pick first
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (list.length > 0) {
      const valid = list.find(s => s.id === storedId);
      if (valid) {
        setSelectedSchoolIdState(valid.id);
      } else {
        setSelectedSchoolId(list[0].id);
      }
    } else {
      setSelectedSchoolIdState(null);
    }

    setLoading(false);
  }, [user, setSelectedSchoolId]);

  useEffect(() => { loadSchools(); }, [loadSchools]);

  const selectedSchool = schools.find(s => s.id === selectedSchoolId) ?? null;

  return (
    <SchoolContext.Provider value={{
      schools,
      selectedSchool,
      selectedSchoolId,
      setSelectedSchoolId,
      loading,
      workspaceId,
      refresh: loadSchools,
    }}>
      {children}
    </SchoolContext.Provider>
  );
};

export const useSchool = () => {
  const context = useContext(SchoolContext);
  if (!context) throw new Error('useSchool must be used within SchoolProvider');
  return context;
};
