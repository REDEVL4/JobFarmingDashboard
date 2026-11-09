import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

export const OWNER_USER_ID = "f2729195-5445-4272-ab85-cac5b03b0967";

export async function createClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://mldtysploensrrulchdl.supabase.co";
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseAnonKey || supabaseAnonKey === "placeholder_anon_key") {
    throw new Error("Missing Supabase publishable credentials. Server access rejected.");
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    db: {
      schema: process.env.NEXT_PUBLIC_SUPABASE_SCHEMA || "jobbot",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: any }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Ignored when called from Server Component
        }
      },
    },
  });
}

/**
 * Server-side authorization barrier.
 * Verifies that an active Supabase user session exists AND that the user ID
 * matches the designated owner. Throws or returns null if unauthorized.
 */
export async function getAuthenticatedOwner(): Promise<{ user: User; client: Awaited<ReturnType<typeof createClient>> } | null> {
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();

    if (error || !user) {
      return null;
    }

    const expectedOwner = process.env.OWNER_USER_ID || OWNER_USER_ID;
    if (user.id !== expectedOwner) {
      return null;
    }

    return { user, client };
  } catch {
    return null;
  }
}
