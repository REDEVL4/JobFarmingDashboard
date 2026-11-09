import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { User, SupabaseClient } from "@supabase/supabase-js";

export const OWNER_USER_ID = "f2729195-5445-4272-ab85-cac5b03b0967";

export async function createClient(): Promise<SupabaseClient> {
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

export type OwnerAuthResult =
  | { success: true; user: User; client: SupabaseClient }
  | {
      success: false;
      reason: "missing_credentials" | "unauthenticated" | "unauthorized_owner" | "error";
      error: string;
    };

/**
 * Server-side authorization barrier.
 * Verifies that an active Supabase user session exists AND that the user ID
 * matches the designated owner. Returns structured failure reason when unauthorized.
 */
export async function getAuthenticatedOwner(): Promise<OwnerAuthResult> {
  try {
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseAnonKey || supabaseAnonKey === "placeholder_anon_key") {
      return {
        success: false,
        reason: "missing_credentials",
        error: "Supabase publishable credentials are not configured.",
      };
    }

    const client = await createClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();

    if (error || !user) {
      return {
        success: false,
        reason: "unauthenticated",
        error: "Authentication required: No active owner session found. Please sign in.",
      };
    }

    const expectedOwner = process.env.OWNER_USER_ID || OWNER_USER_ID;
    if (user.id !== expectedOwner) {
      return {
        success: false,
        reason: "unauthorized_owner",
        error: `Access denied: User ${user.id} is not the designated owner (${expectedOwner}).`,
      };
    }

    return { success: true, user, client };
  } catch (err: any) {
    return {
      success: false,
      reason: "error",
      error: err?.message || "An unexpected error occurred during owner authorization.",
    };
  }
}
