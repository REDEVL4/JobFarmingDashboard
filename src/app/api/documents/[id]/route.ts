import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedOwner } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthenticatedOwner();

    if (!auth.success) {
      return NextResponse.json(
        { error: "Unauthorized: Active owner session required to view application documents." },
        { status: 401 }
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Missing document ID" }, { status: 400 });
    }

    // Query document metadata from public.jf_documents
    const { data: doc, error: docError } = await auth.client
      .from("jf_documents")
      .select("*")
      .eq("id", id)
      .single();

    if (docError || !doc) {
      return NextResponse.json(
        { error: `Document not found: ${docError?.message || "Record does not exist"}` },
        { status: 404 }
      );
    }

    if (!doc.storage_path) {
      return NextResponse.json(
        { error: "Document has no associated storage path in Supabase Storage." },
        { status: 404 }
      );
    }

    const bucketName = "jobbot-application-docs";

    // 1. Try to generate a secure 1-hour signed URL
    const { data: signedData, error: signError } = await auth.client.storage
      .from(bucketName)
      .createSignedUrl(doc.storage_path, 3600);

    if (signedData?.signedUrl) {
      return NextResponse.redirect(signedData.signedUrl);
    }

    // 2. Fallback to direct streaming from storage if signed URL generation is restricted
    console.warn("createSignedUrl failed, falling back to direct download:", signError?.message);
    const { data: fileData, error: dlError } = await auth.client.storage
      .from(bucketName)
      .download(doc.storage_path);

    if (dlError || !fileData) {
      return NextResponse.json(
        { error: `Failed to retrieve document from storage: ${dlError?.message || "File unavailable"}` },
        { status: 500 }
      );
    }

    return new Response(fileData, {
      headers: {
        "Content-Type": doc.mime_type || "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.original_filename || "document.pdf")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("Document download exception:", err);
    return NextResponse.json(
      { error: `Internal document retrieval error: ${err?.message || "Unknown error"}` },
      { status: 500 }
    );
  }
}

