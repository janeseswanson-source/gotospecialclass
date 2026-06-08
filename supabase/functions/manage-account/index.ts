import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action } = await req.json();

    if (action === "export") {
      // Export all user data
      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      const [profileRes, membershipsRes] = await Promise.all([
        adminClient.from("profiles").select("*").eq("user_id", caller.id),
        adminClient.from("workspace_members").select("*, workspaces(*)").eq("user_id", caller.id),
      ]);

      const workspaceIds = (membershipsRes.data || []).map((m: any) => m.workspace_id);
      let schools: any[] = [];
      let schedules: any[] = [];
      let exports: any[] = [];

      if (workspaceIds.length > 0) {
        const [schoolsRes, gensRes, exportsRes] = await Promise.all([
          adminClient.from("schools").select("*").in("workspace_id", workspaceIds),
          adminClient.from("schedule_generations").select("*").in("school_id",
            (await adminClient.from("schools").select("id").in("workspace_id", workspaceIds)).data?.map((s: any) => s.id) || []
          ),
          adminClient.from("export_records").select("*").in("school_id",
            (await adminClient.from("schools").select("id").in("workspace_id", workspaceIds)).data?.map((s: any) => s.id) || []
          ),
        ]);
        schools = schoolsRes.data || [];
        schedules = gensRes.data || [];
        exports = exportsRes.data || [];
      }

      const exportData = {
        exported_at: new Date().toISOString(),
        profile: profileRes.data?.[0] || null,
        workspaces: membershipsRes.data || [],
        schools,
        schedule_generations: schedules,
        export_records: exports,
      };

      return new Response(JSON.stringify(exportData), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Delete user via admin API (cascades handle related data)
      const { error } = await adminClient.auth.admin.deleteUser(caller.id);
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
