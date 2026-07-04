-- Fix: 20260705020000_health_rpc.sql revoked EXECUTE on pg_realtime_has_table
-- from PUBLIC (correct for anon/authenticated), but service_role only had EXECUTE
-- via PUBLIC's default grant — so the health function's realtime check silently
-- fell back to "unavailable". Grant it explicitly to service_role.
GRANT EXECUTE ON FUNCTION public.pg_realtime_has_table(text) TO service_role;
