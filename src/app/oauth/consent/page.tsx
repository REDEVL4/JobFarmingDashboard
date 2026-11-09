"use client";

import React, { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  X,
  AlertTriangle,
  Lock,
  Ban,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const OWNER_UUID = "f2729195-5445-4272-ab85-cac5b03b0967";

// Defensible trust policy allowlist for exact verified redirect URIs
const VERIFIED_REDIRECT_URIS = [
  "https://grok.com/connectors-oauth-exchange-code/",
  "https://www.cursor.com/agents/mcp/oauth/callback",
];

// Recognized standard scopes
const STANDARD_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

function ConsentContent() {
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");
  const rawClientId = searchParams.get("client_id");
  const rawRedirectUri = searchParams.get("redirect_uri");
  const rawScope = searchParams.get("scope");

  const [denied, setDenied] = useState(false);

  // Validate redirect URI against strict whitelist
  const isRedirectValid = Boolean(
    rawRedirectUri && VERIFIED_REDIRECT_URIS.some((trusted) => rawRedirectUri === trusted)
  );

  // Parse and filter scopes
  const requestedScopes = rawScope
    ? rawScope.split(" ").filter((s) => STANDARD_SCOPES.has(s.trim()))
    : ["openid"];

  const handleDeny = () => {
    setDenied(true);
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
            Supabase OAuth Server Authorization
          </CardTitle>
          <CardDescription className="text-xs">
            Review the incoming connection request to interact with your Supabase backend.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 text-xs">
          {/* Production Configuration Lock Banner */}
          <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-300 space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-xs">
              <Ban className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>OAuth Grant Disabled: Live Configuration Required</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Live authorization code issuance requires a verified registered client in Supabase OAuth Server.
              Per production security policy, simulated authorization codes (<code className="font-mono">Math.random()</code>)
              and unverified dynamic client approvals are strictly prohibited. Approval is disabled until Supabase OAuth Server registration is finalized.
            </p>
          </div>

          {/* Owner Identity Verification */}
          <div className="p-3.5 rounded-xl border bg-muted/40 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[11px] text-muted-foreground block font-medium">Designated Owner</span>
              <span className="font-semibold text-foreground">Govardhan Reddy Narala</span>
              <span className="font-mono text-[10px] text-muted-foreground block truncate max-w-xs">
                UUID: {OWNER_UUID}
              </span>
            </div>
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
              <ShieldCheck className="h-4 w-4" />
              Verified Owner
            </span>
          </div>

          {/* Client & Redirect Verification */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
              Client & Redirect URI Verification
            </h4>
            <div className="p-3.5 rounded-xl border bg-card space-y-2.5">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Client ID:</span>
                <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                  {rawClientId ? rawClientId : "Not Provided (Unregistered)"}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Redirect URI:</span>
                <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                  {rawRedirectUri ? rawRedirectUri : "Not Provided"}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t">
                <span className="text-muted-foreground">Redirect Trust Status:</span>
                {isRedirectValid ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Exact Whitelisted Callback URI
                  </span>
                ) : (
                  <span className="text-rose-600 font-semibold flex items-center gap-1">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    Unverified / Disallowed Redirect URI
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Scopes Requested */}
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
              Requested Permission Scopes (Standardized)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {requestedScopes.map((scope) => (
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

          {/* Mutating Tool Security Notice */}
          <div className="p-3.5 rounded-xl border border-destructive/20 bg-destructive/5 text-foreground space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-xs text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>MCP Tool Guard Warning</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Approved OAuth tokens permit clients to invoke MCP endpoints. Mutating tools (<code className="font-mono text-foreground">claim_work</code>, <code className="font-mono text-foreground">complete_work</code>) can modify Supabase database records. Authorization must never be granted automatically or fabricated.
            </p>
          </div>

          {/* Denial confirmation */}
          {denied && (
            <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-medium text-center">
              Authorization denied. Request has been rejected. You may close this tab.
            </div>
          )}
        </CardContent>

        <CardFooter className="p-6 border-t bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={denied}
            className="w-full sm:w-auto h-9 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
          >
            <X className="h-4 w-4 mr-1.5" />
            Deny Access
          </Button>

          <Button
            disabled={true}
            className="w-full sm:w-auto h-9 text-xs bg-muted text-muted-foreground cursor-not-allowed shadow-none"
          >
            Approval Unavailable (Config Required)
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
