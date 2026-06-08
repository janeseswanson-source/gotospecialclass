import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { event_type, workspace_id, details } = await req.json();
    if (!event_type || !workspace_id) {
      return new Response(JSON.stringify({ error: "event_type and workspace_id required" }), { status: 400, headers: corsHeaders });
    }

    // Get all workspace members with notification preferences
    const { data: members } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspace_id);

    if (!members?.length) {
      return new Response(JSON.stringify({ notified: 0 }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userIds = members.map(m => m.user_id);

    // Check notification preferences
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*")
      .eq("workspace_id", workspace_id)
      .in("user_id", userIds);

    const prefsMap = new Map((prefs ?? []).map(p => [p.user_id, p]));

    let notifiedCount = 0;

    for (const uid of userIds) {
      const pref = prefsMap.get(uid);
      // Default: notifications enabled if no preferences set
      const emailEnabled = pref?.email_enabled ?? true;

      if (!emailEnabled) continue;

      if (event_type === "schedule_generated" && pref && !pref.notify_schedule_generated) continue;
      if (event_type === "export_complete" && pref && !pref.notify_export_complete) continue;

      // Log the notification (actual email sending would require email infrastructure)
      await supabase.from("activity_log").insert({
        user_id: uid,
        workspace_id,
        action: `notification_${event_type}`,
        details: { ...details, notification_type: event_type },
      });

      notifiedCount++;
    }

    return new Response(
      JSON.stringify({ notified: notifiedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Notification error:", err);
    return new Response(
      JSON.stringify({ error: err.message ?? "Internal error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
