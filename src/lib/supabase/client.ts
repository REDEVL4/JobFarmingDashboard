import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "";

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: (process.env.NEXT_PUBLIC_SUPABASE_SCHEMA as any) || "public",
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}
