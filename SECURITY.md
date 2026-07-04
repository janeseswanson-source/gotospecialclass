# Security & Tenant Isolation

The product is multi-tenant: every customer is a **workspace**, a workspace has
**schools**, and all scheduling data hangs off a school. Isolation is enforced in
the database with **Row-Level Security (RLS)** — the client only ever talks to
Postgres through PostgREST with the caller's JWT, so a policy gap is the only way
one tenant could read another's data.

## Isolation model

Two membership predicates gate everything (both `SECURITY DEFINER`, so they can
read the membership tables without recursing into RLS):

- `public.is_workspace_member(workspace_id uuid) → bool` — is the caller a member
  of that workspace?
- School-scoped tables don't store `workspace_id`; they resolve it through the
  school:
  ```sql
  EXISTS (SELECT 1 FROM public.schools s
          WHERE s.id = <table>.school_id
            AND public.is_workspace_member(s.workspace_id))
  ```

Workspace joins never happen via a client INSERT — only through the
`handle_new_user()` signup trigger and the `invite-member` edge function (both
service-role / SECURITY DEFINER, bypassing RLS). See
`20260610090000_fix_tenant_isolation_rls.sql`, which closed two escalation holes:

- **J-1** — any authenticated user could insert themselves into *any* workspace
  (`user_id = auth.uid()` was the only check). Now a client self-join requires a
  valid, unexpired, unaccepted invite for the caller's own email in that exact
  workspace.
- **J-2** — any authenticated user could read *every* invite row (emails + tokens)
  via `USING (true)`. Removed; the accept flow resolves tokens server-side with the
  service role.

## Table → policy map

| Table | Isolation guard | Policies |
|---|---|---|
| `workspaces` | `is_workspace_member(id)` | view/update (members); insert via trigger |
| `workspace_members` | `is_workspace_member(workspace_id)` | view (members); **insert only via valid invite** (J-1) |
| `workspace_invites` | members of the workspace | view own workspace's invites; **no public token SELECT** (J-2); accept via service role |
| `schools` | `is_workspace_member(workspace_id)` | select/insert/update/delete (members) |
| `specialists` | school → `is_workspace_member` | manage (ALL) |
| `classroom_teachers` | school → `is_workspace_member` | manage (ALL) |
| `recess_lunch_config` | school → `is_workspace_member` | manage (ALL) |
| `class_rotations` | school → `is_workspace_member` | manage (ALL) |
| `clubs` / `special_events` | school → `is_workspace_member` | manage (ALL) |
| `parsed_calendar_events` / `calendar_uploads` | school → `is_workspace_member` | manage (ALL) |
| `coordinator_prep` | `is_workspace_member(workspace_id)` | manage (ALL) |
| `schedule_generations` | school → `is_workspace_member` | manage (ALL) |
| `schedule_blocks` | school → `is_workspace_member` | manage (ALL) |
| `generation_jobs` | school → `is_workspace_member` | read / enqueue / cancel (members); step worker uses service role |
| `quotes` | school → `is_workspace_member` | read / insert (members) |
| `scoring_weight_profiles` | school → `is_workspace_member` | read / write (members) |
| `lesson_plans` / `lesson_plan_templates` | school → `is_workspace_member` | manage (ALL) |
| `export_records` | school → `is_workspace_member` | manage (ALL) |
| `ai_usage_log` | workspace-scoped read; **service-role writes** | admins read; rate-limit writes bypass RLS |
| `activity_log` | `is_workspace_member(workspace_id)` | insert own; members read |
| `notifications` / `notification_preferences` | `user_id = auth.uid()` | own rows only |
| `profiles` | `id = auth.uid()` | own row |
| `user_roles` | `has_role()` / self | role checks (app-admin gating) |
| `license_keys` / `subscriptions` | workspace-scoped + admin | members read own; admin manage |
| `crm_entries` / `support_tickets` / `admin_templates` | app-admin (`has_role`) | admin-only surfaces |

> App-**admin** surfaces (the `/admin` area) are gated by `has_role(auth.uid(),
> 'admin')` in addition to RLS; they are staff-only and not tenant-scoped.

## Edge function auth patterns

- **User-authenticated** (parsers, `generate-quote`, `schedule-chat`,
  `generate-lesson-starter`): create a client with the caller's `Authorization`
  header and `auth.getUser()`; RLS applies to any user-scoped reads. A separate
  **service-role** client is used only for cross-cutting writes (rate-limit log).
- **Internal-only** (`run-generation-job`): requires the service-role key in the
  request; never callable from a browser.
- **Service-role / SECURITY DEFINER** (signup trigger, `invite-member`): perform
  the privileged joins that RLS intentionally forbids from clients.

## Cross-tenant test coverage

`supabase/functions/_tests/rls_isolation_test.ts` seeds two users in two
workspaces/schools and asserts that user B **cannot read or write** user A's rows
for: `schedule_generations`, `schedule_blocks`, `generation_jobs`, `quotes`,
`scoring_weight_profiles`, and the setup tables (`specialists`,
`classroom_teachers`, `recess_lunch_config`). The test **skips** when the
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` env vars are absent (CI without a DB),
so it never blocks a keyless build.

## Reporting

Found a hole? Email **security@GoToSpecialClass.com** — do not open a public issue.
