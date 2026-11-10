import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import { resolveOutreachProposal } from "@/lib/data-service";

const OUTREACH_TRIGGER_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/outreach-send-trigger`
    : "https://mldtysploensrrulchdl.supabase.co/functions/v1/outreach-send-trigger";

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
    const { id, action, approved_text } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: "Bad Request: id and action are required." },
        { status: 400 }
      );
    }

    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: `Invalid action: ${action}. Must be one of 'approve', 'reject'.` },
        { status: 400 }
      );
    }

    const result = await resolveOutreachProposal(id, action, approved_text);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const proposal = result.data;

    // Trigger outreach-send-trigger edge function if channel is linkedin and new state is approved_for_send
    if (
      action === "approve" &&
      proposal &&
      (proposal.channel || "").toLowerCase() === "linkedin" &&
      proposal.state === "approved_for_send"
    ) {
      try {
        const { data: sessionData } = await auth.client.auth.getSession();
        const token =
          sessionData.session?.access_token ||
          process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        const triggerRes = await fetch(OUTREACH_TRIGGER_URL, {
          method: "POST",
          headers,
          body: JSON.stringify({ proposal_id: proposal.id }),
        });

        if (!triggerRes.ok) {
          const errBody = await triggerRes.text();
          console.error(
            `[api/outreach/proposals] outreach-send-trigger returned error status ${triggerRes.status}:`,
            errBody
          );
        } else {
          const triggerData = await triggerRes.json().catch(() => null);
          console.log("[api/outreach/proposals] outreach-send-trigger response:", triggerData);
        }
      } catch (triggerErr: any) {
        console.error("[api/outreach/proposals] Error invoking outreach-send-trigger:", triggerErr);
      }
    }

    return NextResponse.json({ success: true, data: result.data });
  } catch (err: any) {
    console.error("[api/outreach/proposals] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while processing the outreach proposal." },
      { status: 500 }
    );
  }
}
