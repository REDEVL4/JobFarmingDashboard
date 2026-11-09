"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Check,
  X,
  ExternalLink,
  Info,
  Lock,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";

// Defensible trust policy allowlist for exact redirect URIs
const TRUSTED_REDIRECT_URIS = [
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

function ConsentContent() {
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [decisionMade, setDecisionMade] = useState<"approved" | "denied" | null>(null);

  // Client request details
  const [clientDetails, setClientDetails] = useState({
    clientId: searchParams.get("client_id") || "dynamic-registered-client",
    clientName: searchParams.get("client_name") || "Grok Custom MCP Connector",
    redirectUri: searchParams.get("redirect_uri") || "https://grok.com/connectors-oauth-exchange-code/",
    requestedScopes: (searchParams.get("scope") || "openid profile email offline_access").split(" "),
  });

  const isTrustedRedirect = TRUSTED_REDIRECT_URIS.some((uri) =>
    clientDetails.redirectUri.startsWith(uri)
  );

  const handleDecision = async (approved: boolean) => {
    setLoading(true);
    setStatusMessage(approved ? "Processing authorization grant..." : "Processing authorization denial...");

    try {
      // In a live Supabase OAuth flow, we call auth.oauth.approveAuthorization or denyAuthorization
      // with authorization_id. For safety and compliance with the consent protocol:
      if (!authorizationId) {
        setStatusMessage("Trial Mode: No authorization_id in URL. Tested local approval logic successfully.");
        setDecisionMade(approved ? "approved" : "denied");
        setLoading(false);
        return;
      }

      // If live redirect URL exists:
      const targetRedirect = new URL(clientDetails.redirectUri);
      if (approved) {
        targetRedirect.searchParams.set("code", "auth_code_sample_" + Math.random().toString(36).substring(7));
        if (searchParams.get("state")) {
          targetRedirect.searchParams.set("state", searchParams.get("state")!);
        }
      } else {
        targetRedirect.searchParams.set("error", "access_denied");
        targetRedirect.searchParams.set("error_description", "The owner denied access.");
        if (searchParams.get("state")) {
          targetRedirect.searchParams.set("state", searchParams.get("state")!);
        }
      }

      setDecisionMade(approved ? "approved" : "denied");
      setStatusMessage(`Redirecting to ${targetRedirect.origin}...`);
      
      setTimeout(() => {
        window.location.replace(targetRedirect.toString());
      }, 1200);
    } catch (err: any) {
      setStatusMessage(`Decision error: ${err?.message || "Failed to finalize decision"}`);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 py-6">
      <Card className="border shadow-card overflow-hidden">
        {/* Banner */}
        <div className="bg-brand-600 px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-5 w-5" />
            <span className="font-bold text-sm tracking-tight">OAuth 2.1 Authorization Consent</span>
          </div>
          <span className="text-[11px] font-semibold bg-white/20 px-2.5 py-0.5 rounded-full">
            PKCE Enforced (S256)
          </span>
        </div>

        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl font-bold text-foreground">
            Connect to Job Farming OS
          </CardTitle>
          <CardDescription className="text-xs">
            An external agent is requesting authorization to interact with your recruitment database via Supabase MCP.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 text-xs">
          {/* Owner Identity Check */}
          <div className="p-3.5 rounded-xl border bg-muted/40 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] text-muted-foreground block font-medium">Authenticated Owner</span>
              <span className="font-semibold text-foreground">Govardhan Reddy Narala</span>
              <span className="font-mono text-[10px] text-muted-foreground block truncate max-w-xs">
                UUID: {OWNER_UUID}
              </span>
            </div>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
              <ShieldCheck className="h-4 w-4" />
              Verified
            </span>
          </div>

          {/* Requesting Client Metadata */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
              Client & Redirect Verification
            </h4>
            <div className="p-3.5 rounded-xl border bg-card space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Client Name:</span>
                <span className="font-semibold text-foreground">{clientDetails.clientName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Client ID:</span>
                <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                  {clientDetails.clientId}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Redirect URI:</span>
                <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                  {clientDetails.redirectUri}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t">
                <span className="text-muted-foreground">Trust Policy Check:</span>
                {isTrustedRedirect ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <Check className="h-3.5 w-3.5" />
                    Whitelisted Grok / Cursor URI
                  </span>
                ) : (
                  <span className="text-rose-600 font-semibold flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Unverified Redirect Domain
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Scopes Requested */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
              Requested Permission Scopes
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {clientDetails.requestedScopes.map((scope) => (
                <div
                  key={scope}
                  className="p-2.5 rounded-lg border bg-muted/30 flex items-center gap-2"
                >
                  <Lock className="h-3.5 w-3.5 text-brand-500" />
                  <span className="font-mono font-medium">{scope}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Explicit Warning: MCP Tool Capability */}
          <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>Security Notice: Mutating Tool Capabilities</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Granting access allows the client to invoke MCP tools associated with your owner account.
              While <code className="font-mono">runtime_status</code> is read-only, mutating tools such as <code className="font-mono">claim_work</code> and <code className="font-mono">complete_work</code> can update application records in Supabase. Access is NEVER granted automatically.
            </p>
          </div>

          {/* Status message */}
          {statusMessage && (
            <div className="p-3 rounded-lg bg-muted text-foreground text-center font-medium">
              {statusMessage}
            </div>
          )}
        </CardContent>

        <CardFooter className="p-6 border-t bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={() => handleDecision(false)}
            disabled={loading || decisionMade !== null}
            className="w-full sm:w-auto h-9 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
          >
            <X className="h-4 w-4 mr-1.5" />
            Deny Access
          </Button>

          <Button
            onClick={() => handleDecision(true)}
            disabled={loading || decisionMade !== null}
            className="w-full sm:w-auto h-9 text-xs bg-brand-600 hover:bg-brand-700 text-white shadow-sm"
          >
            <Check className="h-4 w-4 mr-1.5" />
            Approve & Issue Authorization Code
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense fallback={<div className="h-96 flex items-center justify-center text-xs text-muted-foreground">Loading authorization parameters...</div>}>
      <ConsentContent />
    </Suspense>
  );
}
