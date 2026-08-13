import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
export const configured = Boolean(url && key);
export const supabase = createClient(
  url || "https://unconfigured.supabase.co",
  key || "unconfigured-public-key",
);
