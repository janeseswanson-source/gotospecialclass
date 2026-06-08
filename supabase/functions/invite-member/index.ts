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

    const { action, workspace_id, email, role, token, user_id } = await req.json();

    // Accept invite action
    if (action === "accept") {
      if (!token) {
        return new Response(JSON.stringify({ error: "Token is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);

      // Look up invite by token
      const { data: invite, error: inviteErr } = await adminClient
        .from("workspace_invites")
        .select("*")
        .eq("token", token)
        .is("accepted_at", null)
        .single();

      if (inviteErr || !invite) {
        return new Response(JSON.stringify({ error: "Invalid or expired invite" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (new Date(invite.expires_at) < new Date()) {
        return new Response(JSON.stringify({ error: "Invite has expired" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Add user to workspace
      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .upsert({
          user_id: caller.id,
          workspace_id: invite.workspace_id,
          role: invite.role,
        }, { onConflict: "user_id,workspace_id" });

      if (memberErr) {
        return new Response(JSON.stringify({ error: memberErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Mark invite as accepted
      await adminClient
        .from("workspace_invites")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      return new Response(JSON.stringify({ success: true, workspace_id: invite.workspace_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Remove member action
    if (action === "remove_member") {
      if (!workspace_id || !user_id) {
        return new Response(JSON.stringify({ error: "workspace_id and user_id required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check caller is owner/admin
      const { data: callerMember } = await callerClient
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", caller.id)
        .single();

      if (!callerMember || !["owner", "admin"].includes(callerMember.role)) {
        return new Response(JSON.stringify({ error: "Only owners/admins can remove members" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (user_id === caller.id) {
        return new Response(JSON.stringify({ error: "Cannot remove yourself" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const adminClient = createClient(supabaseUrl, serviceRoleKey);
      const { error: delErr } = await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id);

      if (delErr) {
        return new Response(JSON.stringify({ error: delErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Default: create invite
    if (!workspace_id || !email) {
      return new Response(JSON.stringify({ error: "workspace_id and email are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is workspace member
    const { data: isMember } = await callerClient.rpc("is_workspace_member", {
      _workspace_id: workspace_id,
    });
    if (!isMember) {
      return new Response(JSON.stringify({ error: "Not a workspace member" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for existing pending invite
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: existing } = await adminClient
      .from("workspace_invites")
      .select("id")
      .eq("workspace_id", workspace_id)
      .eq("email", email.toLowerCase())
      .is("accepted_at", null)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ error: "An invite for this email already exists" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create invite
    const { data: invite, error: createErr } = await adminClient
      .from("workspace_invites")
      .insert({
        workspace_id,
        email: email.toLowerCase(),
        role: role || "viewer",
        invited_by: caller.id,
      })
      .select()
      .single();

    if (createErr) {
      return new Response(JSON.stringify({ error: createErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, invite }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
