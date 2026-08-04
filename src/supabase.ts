
import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL || "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const configured = Boolean(url && key);
export const supabase = createClient(url || "https://example.supabase.co", key || "demo-key");
