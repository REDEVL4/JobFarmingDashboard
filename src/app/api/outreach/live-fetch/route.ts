import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error || "Authentication required." },
        { status: auth.reason === "unauthenticated" ? 401 : 403 }
      );
    }

    const { data, error } = await auth.client.rpc("jf_request_linkedin_live_fetch");
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("[api/outreach/live-fetch POST] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to trigger live fetch." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error || "Authentication required." },
        { status: auth.reason === "unauthenticated" ? 401 : 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const fetchId = searchParams.get("fetch_id");
    if (!fetchId) {
      return NextResponse.json(
        { error: "Missing required query parameter: fetch_id" },
        { status: 400 }
      );
    }

    const { data, error } = await auth.client.rpc("jf_linkedin_live_fetch_status", {
      p_fetch_id: fetchId,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    console.error("[api/outreach/live-fetch GET] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to query live fetch status." },
      { status: 500 }
    );
  }
}

