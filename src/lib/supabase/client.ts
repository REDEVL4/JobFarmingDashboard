import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder_anon_key";

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "jobbot",
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

