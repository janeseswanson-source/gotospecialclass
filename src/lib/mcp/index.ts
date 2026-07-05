// MCP server entry — exposes read-only tools over Next Specials Class data.
// Import-safe: no top-level env reads, no I/O. Secrets are read inside handlers.
import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSchoolsTool from "./tools/list-schools";
import listTeachersTool from "./tools/list-teachers";
import listSpecialistsTool from "./tools/list-specialists";
import getScheduleTool from "./tools/get-schedule";

// The OAuth issuer MUST be the direct Supabase host, built from the project ref
// (see app-mcp-server-authoring knowledge). VITE_SUPABASE_PROJECT_ID is inlined
// as a literal by Vite at build time, so this stays import-safe.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "next-specials-class-mcp",
  title: "Next Specials Class",
  version: "0.1.0",
  instructions:
    "Read-only access to a school's Next Specials Class data: schools, classroom teachers, specialists, and the current generated schedule. Start with list_schools to discover the school_id, then pass it to list_teachers, list_specialists, or get_schedule.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listSchoolsTool, listTeachersTool, listSpecialistsTool, getScheduleTool],
});
