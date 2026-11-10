import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  try {
    // 1. Strict Same-Origin & CSRF Protection
    // Block all cross-site requests fail-closed
    const secFetchSite = req.headers.get("sec-fetch-site");
    if (secFetchSite && secFetchSite !== "same-origin") {
      return NextResponse.json(
        { error: "Forbidden: Cross-site request rejected (CSRF protection)." },
        { status: 403 }
      );
    }

    // Require strict same-origin: incoming origin must exactly match this deployment's origin
    const origin = req.headers.get("origin");
    if (origin) {
      const requestUrl = new URL(req.url);
      if (origin !== requestUrl.origin) {
        return NextResponse.json(
          { error: "Forbidden: Cross-origin request rejected. Strict same-origin required." },
          { status: 403 }
        );
      }
    }

    // 2. Owner-only authentication barrier
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      if (auth.reason === "unauthenticated") {
        return NextResponse.json(
          { error: "Authentication required: Sign in as the designated owner to resolve reviews." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: "Forbidden: Only the verified owner UUID can resolve recruitment reviews." },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { reviewItemId, action, notes, targetApplicationId } = body;

    if (!reviewItemId || !action) {
      return NextResponse.json(
        { error: "Bad Request: reviewItemId and action are required." },
        { status: 400 }
      );
    }

    if (!["approve", "reject", "ignore", "needs_review"].includes(action)) {
      return NextResponse.json(
        { error: `Invalid action: ${action}. Must be one of approve, reject, ignore, needs_review.` },
        { status: 400 }
      );
    }

    const { data, error } = await auth.client.rpc("jf_owner_resolve_recruitment_review", {
      p_review_item_id: reviewItemId,
      p_action: action,
      p_notes: notes ?? null,
      p_target_application_id: targetApplicationId ?? null,
    });

    if (error) {
      console.error("[recruitment/resolve-review] RPC error:", error);
      // Map user-actionable business rule rejections safely
      const safeMessage = error.message.includes("Ambiguous candidate match")
        ? error.message
        : error.message.includes("does not belong to the candidate list")
        ? error.message
        : error.message.includes("no candidate application match")
        ? error.message
        : error.message.includes("Terminal review state") || error.message.includes("already resolved") || error.message.includes("already ignored")
        ? error.message
        : "Failed to resolve review. Please try again or check audit logs.";

      return NextResponse.json(
        { error: safeMessage },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error("[recruitment/resolve-review] Unexpected error:", err);
    return NextResponse.json(
      { error: "An unexpected error occurred while processing the review." },
      { status: 500 }
    );
  }
}
