import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";
import { updateOutreachProposalText } from "@/lib/data-service";

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
    const { proposal_id, instruction } = body;

    // Strict rule: Do not call regenerate without a real, existing proposal id
    if (!proposal_id || typeof proposal_id !== "string" || !proposal_id.trim()) {
      return NextResponse.json(
        { error: "Bad Request: proposal_id is required." },
        { status: 400 }
      );
    }

    // 3. Call bot regenerate endpoint with real proposal_id
    const supabaseToken =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "";
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
        proposal_id: proposal_id.trim(),
        instruction: (instruction || "regenerate, more natural, show curiosity").slice(0, 500),
      }),
    });

    // If the call returns 400, 404, or 409, pass through the error status
    if (!botRes.ok) {
      const botErr = await botRes.json().catch(() => ({}));
      const statusCode = [400, 404, 409].includes(botRes.status) ? botRes.status : 502;
      return NextResponse.json(
        {
          error: botErr.error || `Bot regenerate call failed with status ${botRes.status}`,
          detail: botErr.detail || null,
        },
        { status: statusCode }
      );
    }

    const botJson = await botRes.json().catch(() => null);
    let draftText: string | null = null;

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
        } catch {
          // If bot_body is raw text
          if (typeof botJson.bot_body === "string" && botJson.bot_body.trim()) {
            draftText = botJson.bot_body.trim();
          }
        }
      }
    }

    // If bot webhook updated the proposal directly in the database, fetch it
    if (!draftText) {
      const fetchRes = await auth.client
        .from("jf_outreach_proposals")
        .select("*")
        .eq("id", proposal_id)
        .maybeSingle();

      if (fetchRes.data && fetchRes.data.proposed_text && fetchRes.data.proposed_text.trim()) {
        return NextResponse.json({
          success: true,
          data: fetchRes.data,
        });
      }
    }

    // Do not generate draft text on the website. All draft text must come from the bot.
    if (!draftText || !draftText.trim()) {
      return NextResponse.json(
        { error: "Bot did not return draft text. Please retry." },
        { status: 502 }
      );
    }

    // Update proposal with generated proposed_text from bot
    const updateRes = await updateOutreachProposalText(proposal_id, draftText.trim());

    if (!updateRes.success || !updateRes.data) {
      return NextResponse.json(
        { error: updateRes.error || "Failed to update draft proposal with bot response." },
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
