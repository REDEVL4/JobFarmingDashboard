import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import { setOutreachMode } from "@/lib/data-service";

export async function POST(req: NextRequest) {
  try {
    // 1. Strict Same-Origin & CSRF Protection
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin") {
      return NextResponse.json(
        { error: "Forbidden: Cross-site request rejected (CSRF protection)." },
        { status: 403 }
      );
    }

    const origin = req.headers.get("origin");
    if (origin) {
      const requestUrl = new URL(req.url);
      if (origin !== requestUrl.origin) {
        return NextResponse.json(
          { error: "Forbidden: Cross-origin request rejected." },
          { status: 403 }
        );
      }
    }

    // 2. Owner-only authentication barrier
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error || "Authentication required." },
        { status: auth.reason === "unauthenticated" ? 401 : 403 }
      );
    }

    const body = await req.json();
    const { mode } = body;

    if (!mode || !["review", "auto"].includes(mode)) {
      return NextResponse.json(
        { error: "Invalid mode. Must be 'review' or 'auto'." },
        { status: 400 }
      );
    }

    const result = await setOutreachMode(mode);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, mode });
  } catch (err: any) {
    console.error("[api/outreach/mode] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while updating outreach mode." },
      { status: 500 }
    );
  }
}

