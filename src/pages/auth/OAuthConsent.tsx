// OAuth 2.1 consent page for MCP clients (ChatGPT, Claude, Cursor, etc.).
// Mounted at /.lovable/oauth/consent — Supabase redirects users here to
// approve or deny an authorization request from a registered OAuth client.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/brand/brand";
import logo from "@/assets/nsc-wordmark.png";

// Local typed wrapper — the `supabase.auth.oauth` namespace is currently beta
// and missing from generated types.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: { message: string } | null }>;
};

const oauthApi = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        // Preserve the FULL consent URL so auth returns the user here.
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      try {
        const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load authorization request");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const api = oauthApi();
      const { data, error } = approve
        ? await api.approveAuthorization(authorizationId)
        : await api.denyAuthorization(authorizationId);
      if (error) {
        setBusy(false);
        setError(error.message);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setBusy(false);
        setError("No redirect returned by the authorization server.");
        return;
      }
      window.location.href = target;
    } catch (e: any) {
      setBusy(false);
      setError(e?.message ?? "Approval failed");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <img src={logo} alt={BRAND.name} className="mx-auto mb-4 h-12 w-auto" />
          <h1 className="text-2xl font-bold text-foreground">Connect an app</h1>
        </div>
        <div className="rounded-xl border border-border bg-card p-8 shadow-sm">
          {error ? (
            <>
              <p className="text-sm text-destructive">Could not load this authorization request:</p>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            </>
          ) : !details ? (
            <p className="text-sm text-muted-foreground">Loading authorization request…</p>
          ) : (
            <>
              <p className="text-base text-foreground">
                <span className="font-semibold">{details.client?.name ?? "An app"}</span> wants to
                connect to your {BRAND.name} account.
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                It will be able to read your schools, teachers, specialists, and generated schedules on
                your behalf. You can revoke access any time from your account settings.
              </p>
              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => decide(false)}
                >
                  Deny
                </Button>
                <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                  {busy ? "Working…" : "Approve"}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
