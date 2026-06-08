import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Get user from JWT
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { license_key, workspace_id } = await req.json();
    if (!license_key || !workspace_id) {
      return new Response(JSON.stringify({ error: "license_key and workspace_id are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Find the license key
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from("license_keys")
      .select("*")
      .eq("key", license_key)
      .single();

    if (keyError || !keyData) {
      return new Response(JSON.stringify({ error: "Invalid license key" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (keyData.status !== "active") {
      return new Response(JSON.stringify({ error: `License key is ${keyData.status}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + (keyData.duration_days || 365) * 86400000).toISOString();

    // Update license key
    await supabaseAdmin.from("license_keys").update({
      status: "redeemed",
      redeemed_by: user.id,
      redeemed_at: now,
      assigned_workspace: workspace_id,
      expires_at: expiresAt,
    }).eq("id", keyData.id);

    // Activate workspace
    await supabaseAdmin.from("workspaces").update({
      is_active: true,
      access_source: "license",
    }).eq("id", workspace_id);

    // Upsert subscription
    const { data: existingSub } = await supabaseAdmin
      .from("subscriptions")
      .select("id")
      .eq("workspace_id", workspace_id)
      .single();

    if (existingSub) {
      await supabaseAdmin.from("subscriptions").update({
        plan: keyData.plan || "pro",
        status: "active",
        current_period_start: now,
        current_period_end: expiresAt,
      }).eq("id", existingSub.id);
    } else {
      await supabaseAdmin.from("subscriptions").insert({
        workspace_id,
        plan: keyData.plan || "pro",
        status: "active",
        current_period_start: now,
        current_period_end: expiresAt,
      });
    }

    // Log activity
    await supabaseAdmin.from("activity_log").insert({
      user_id: user.id,
      workspace_id,
      action: "license_redeemed",
      details: { license_key: license_key.slice(0, 8) + "...", plan: keyData.plan },
    });

    return new Response(JSON.stringify({ 
      success: true, 
      plan: keyData.plan, 
      expires_at: expiresAt,
      max_schools: keyData.max_schools 
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
