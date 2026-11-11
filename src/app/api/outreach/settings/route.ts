import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import {
  fetchOutreachSettings,
  setOutreachMode,
  setAutoConnectionRequests,
  setAutoAcceptConnections,
} from "@/lib/data-service";

export async function GET() {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: auth.error || "Authentication required." },
        { status: auth.reason === "unauthenticated" ? 401 : 403 }
      );
    }

    const result = await fetchOutreachSettings();
    if (result.status === "permission_denied" || result.status === "unauthenticated") {
      return NextResponse.json({ error: result.error }, { status: 403 });
    }

    return NextResponse.json({ success: true, settings: result.data });
  } catch (err: any) {
    console.error("[api/outreach/settings GET] Error:", err);
    return NextResponse.json(
      { error: "Failed to fetch outreach settings." },
      { status: 500 }
    );
  }
}

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
    const { mode, auto_connection_requests, auto_accept_connections } = body;

    if (mode !== undefined) {
      if (!["review", "auto"].includes(mode)) {
        return NextResponse.json(
          { error: "Invalid mode. Must be 'review' or 'auto'." },
          { status: 400 }
        );
      }
      const res = await setOutreachMode(mode);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
    }

    if (auto_connection_requests !== undefined) {
      if (typeof auto_connection_requests !== "boolean") {
        return NextResponse.json(
          { error: "auto_connection_requests must be a boolean." },
          { status: 400 }
        );
      }
      const res = await setAutoConnectionRequests(auto_connection_requests);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
    }

    if (auto_accept_connections !== undefined) {
      if (typeof auto_accept_connections !== "boolean") {
        return NextResponse.json(
          { error: "auto_accept_connections must be a boolean." },
          { status: 400 }
        );
      }
      const res = await setAutoAcceptConnections(auto_accept_connections);
      if (!res.success) {
        return NextResponse.json({ error: res.error }, { status: 400 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[api/outreach/settings POST] Error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while updating settings." },
      { status: 500 }
    );
  }
}
