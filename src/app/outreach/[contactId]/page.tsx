import React from "react";
import Link from "next/link";
import { ArrowLeft, UserX } from "lucide-react";
import { fetchContactOutreachThread } from "@/lib/data-service";
import { ContactThreadView } from "@/components/outreach/contact-thread-view";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface ContactThreadPageProps {
  params: Promise<{ contactId: string }>;
}

export default async function ContactThreadPage({ params }: ContactThreadPageProps) {
  const { contactId } = await params;
  const result = await fetchContactOutreachThread(contactId);

  if (!result.data.contact) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-4 space-y-4">
        <div>
          <Link
            href="/outreach"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to LinkedIn CRM</span>
          </Link>
        </div>
        <Card className="border border-border">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center space-y-3">
            <UserX className="h-10 w-10 text-muted-foreground opacity-40" />
            <h2 className="text-base font-semibold text-foreground">Contact Not Found</h2>
            <p className="text-xs text-muted-foreground max-w-sm">
              The outreach contact with ID{" "}
              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">{contactId}</code>{" "}
              was not found or could not be loaded.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ContactThreadView
      contact={result.data.contact}
      initialInteractions={result.data.interactions}
      initialProposals={result.data.proposals}
    />
  );
}
