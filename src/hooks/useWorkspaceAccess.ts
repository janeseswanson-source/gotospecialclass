import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface WorkspaceAccess {
  isActive: boolean;
  plan: string | null;
  loading: boolean;
  workspaceId: string | null;
}

export function useWorkspaceAccess(): WorkspaceAccess {
  const { user } = useAuth();
  const [state, setState] = useState<WorkspaceAccess>({
    isActive: false,
    plan: null,
    loading: true,
    workspaceId: null,
  });

  useEffect(() => {
    if (!user) {
      setState({ isActive: false, plan: null, loading: false, workspaceId: null });
      return;
    }

    async function check() {
      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", user!.id)
        .limit(1)
        .maybeSingle();

      if (!membership) {
        setState({ isActive: false, plan: null, loading: false, workspaceId: null });
        return;
      }

      const { data: workspace } = await supabase
        .from("workspaces")
        .select("is_active")
        .eq("id", membership.workspace_id)
        .single();

      const { data: sub } = await supabase
        .from("subscriptions")
        .select("plan, status")
        .eq("workspace_id", membership.workspace_id)
        .limit(1)
        .maybeSingle();

      const hasActiveSub = sub?.status === "active";
      const isActive = workspace?.is_active || hasActiveSub;

      setState({
        isActive: !!isActive,
        plan: sub?.plan ?? "free",
        loading: false,
        workspaceId: membership.workspace_id,
      });
    }

    check();
  }, [user]);

  return state;
}
