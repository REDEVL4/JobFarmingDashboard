import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BUCKET_NAME = "jobbot-application-docs";

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: "Unauthorized: Active owner session required." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const storagePath = searchParams.get("path");
    const format = searchParams.get("format");
    const wantsJson = format === "json" || request.headers.get("accept")?.includes("application/json");

    if (!storagePath) {
      return NextResponse.json(
        { error: "Missing required query parameter: path" },
        { status: 400 }
      );
    }

    // Clean and validate storage path
    const cleanPath = storagePath.trim();
    if (cleanPath.includes("..")) {
      return NextResponse.json(
        { error: "Invalid storage path traversal." },
        { status: 400 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const { data: signedData, error: signError } = await auth.client.storage
      .from(BUCKET_NAME)
      .createSignedUrl(cleanPath, 3600);

    if (signError || !signedData?.signedUrl) {
      console.warn("[attachment-url] createSignedUrl failed:", signError?.message);

      // Attempt fallback download if signed URL fails
      const { data: fileData, error: dlError } = await auth.client.storage
        .from(BUCKET_NAME)
        .download(cleanPath);

      if (dlError || !fileData) {
        return NextResponse.json(
          { error: `Failed to retrieve attachment: ${signError?.message || dlError?.message || "File unavailable"}` },
          { status: 404 }
        );
      }

      const fileName = cleanPath.split("/").pop() || "document.pdf";
      return new Response(fileData, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }

    if (wantsJson) {
      return NextResponse.json({
        success: true,
        signedUrl: signedData.signedUrl,
      });
    }

    return NextResponse.redirect(signedData.signedUrl);
  } catch (err: any) {
    console.error("[attachment-url] Exception:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedOwner();
    if (!auth.success) {
      return NextResponse.json(
        { error: "Unauthorized: Active owner session required." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const storagePath = body.path;

    if (!storagePath || typeof storagePath !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid 'path' in request body." },
        { status: 400 }
      );
    }

    const cleanPath = storagePath.trim();
    if (cleanPath.includes("..")) {
      return NextResponse.json(
        { error: "Invalid storage path traversal." },
        { status: 400 }
      );
    }

    const { data: signedData, error: signError } = await auth.client.storage
      .from(BUCKET_NAME)
      .createSignedUrl(cleanPath, 3600);

    if (signError || !signedData?.signedUrl) {
      return NextResponse.json(
        { error: `Failed to create signed URL: ${signError?.message || "File not found"}` },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      signedUrl: signedData.signedUrl,
    });
  } catch (err: any) {
    console.error("[attachment-url POST] Exception:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
