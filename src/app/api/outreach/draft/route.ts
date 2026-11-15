import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import { updateOutreachProposalText } from "@/lib/data-service";
import { generateContextualDraft } from "@/lib/outreach-helpers";

const OUTREACH_REGENERATE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL
    ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/outreach-regenerate`
    : "https://mldtysploensrrulchdl.supabase.co/functions/v1/outreach-regenerate";

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

    const body = await req.json().catch(() => ({}));
    const { proposal_id, contact_id, contact, thread = [], instruction } = body;

    // Strict rule: Do not call regenerate without a proposal id
    if (!proposal_id) {
      return NextResponse.json(
        { error: "Bad Request: proposal_id is required." },
        { status: 400 }
      );
    }

    let draftText: string | null = null;

    // 3. Call bot regenerate endpoint with proposal_id and the full prior thread
    try {
      const supabaseToken = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (supabaseToken) {
        headers["Authorization"] = `Bearer ${supabaseToken}`;
      }

      const botRes = await fetch(OUTREACH_REGENERATE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "regenerate",
          proposal_id,
          contact_id,
          contact,
          thread,
          instruction: instruction || "draft fresh message based on conversation history and current rules",
        }),
      });

      if (botRes.ok) {
        const botJson = await botRes.json().catch(() => null);
        if (botJson) {
          if (botJson.proposed_text) {
            draftText = botJson.proposed_text;
          } else if (botJson.text) {
            draftText = botJson.text;
          } else if (botJson.message) {
            draftText = botJson.message;
          } else if (botJson.draft) {
            draftText = botJson.draft;
          } else if (botJson.bot_body) {
            try {
              const parsed = JSON.parse(botJson.bot_body);
              draftText = parsed.proposed_text || parsed.text || parsed.message || parsed.draft;
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.warn("[api/outreach/draft] Bot webhook exception, falling back to contextual generator:", err?.message || err);
    }

    // 4. Fallback to contextual rule-based draft generator if bot webhook is unreachable
    if (!draftText || !draftText.trim()) {
      draftText = generateContextualDraft({
        contactName: contact?.full_name || contact?.name,
        company: contact?.company,
        role: contact?.professional_title || contact?.role,
        thread,
        instruction,
      });
    }

    if (!draftText || !draftText.trim()) {
      return NextResponse.json(
        { error: "Failed to generate proposed text with bot." },
        { status: 502 }
      );
    }

    // 5. Update proposal with generated proposed_text
    const updateRes = await updateOutreachProposalText(proposal_id, draftText.trim());

    if (!updateRes.success || !updateRes.data) {
      return NextResponse.json(
        { error: updateRes.error || "Failed to update draft proposal." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updateRes.data,
    });
  } catch (err: any) {
    console.error("[api/outreach/draft] Exception:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error drafting message." },
      { status: 500 }
    );
  }
}
