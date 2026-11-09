"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  X,
  AlertTriangle,
  Lock,
  Check,
  Loader2,
  ExternalLink,
  Ban,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import {
  DESIGNATED_OWNER_UUID,
  DESIGNATED_OWNER_EMAIL,
  STANDARD_SCOPES,
  validateAuthorizationId,
  validateOwnerAccess,
  validateOAuthClient,
  type ClientTrustResult,
} from "@/lib/oauth-validation";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";

function ConsentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authorizationId = searchParams.get("authorization_id");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [authDetails, setAuthDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [clientTrust, setClientTrust] = useState<ClientTrustResult | null>(null);
  const [decisionCompleted, setDecisionCompleted] = useState<"approved" | "denied" | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadAuthorization() {
      setLoading(true);
      setErrorMessage(null);

      // Step 1: Validate authorization_id presence & format
      const idValidation = validateAuthorizationId(authorizationId);
      if (!idValidation.valid) {
        if (isMounted) {
          setErrorMessage(idValidation.error || "Invalid authorization request.");
          setLoading(false);
        }
        return;
      }

      try {
        const supabase = createClient();

        // Step 2: Verify active user session
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          // Preserve authorization request and redirect to login
          const targetUrl = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId!)}`;
          router.push(`/login?redirect=${encodeURIComponent(targetUrl)}`);
          return;
        }

        // Step 3: Verify authenticated identity matches designated owner
        const ownerValidation = validateOwnerAccess(user.id);
        if (!ownerValidation.isOwner) {
          if (isMounted) {
            setErrorMessage(ownerValidation.error || "Access denied: Unauthorized principal.");
            setLoading(false);
          }
          return;
        }

        // Step 4: Retrieve verified authorization details from Supabase Auth OAuth Server
        const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId!);

        if (error || !data) {
          if (isMounted) {
            setErrorMessage(
              error?.message ||
                "Failed to retrieve authorization details. The authorization request may have expired or is invalid."
            );
            setLoading(false);
          }
          return;
        }

        // Step 4.1: Require explicit verified authorization details linking this request to the client
        // In Supabase OAuth 2.1, when a user previously consented, getAuthorizationDetails returns
        // only { redirect_url: string } without client identity or authorization_id.
        // That does NOT establish that THIS request belongs to the approved client ID (16bdb57f-c2cd-40d8-b6e1-c1a1b17e3f32).
        // Therefore, automatic approval without explicit client details is strictly blocked.
        if (!("authorization_id" in data) || !("client" in data) || !data.client || !data.client.id) {
          if (isMounted) {
            setErrorMessage(
              "Automatic approval blocked: The authorization request cannot be verified against the approved client ID because explicit client details were omitted by the server. A fresh verified authorization flow with explicit owner consent is required."
            );
            setLoading(false);
          }
          return;
        }

        // Step 4.2: Validate client trust, callback URI, and exact client ID linkage
        const trustResult = validateOAuthClient(data.client, data.redirect_uri);
        if (!trustResult.trusted) {
          if (isMounted) {
            setErrorMessage(trustResult.reason || "Unauthorized OAuth client or callback URI.");
            setAuthDetails(data as OAuthAuthorizationDetails);
            setClientTrust(trustResult);
            setLoading(false);
          }
          return;
        }

        if (isMounted) {
          setAuthDetails(data as OAuthAuthorizationDetails);
          setClientTrust(trustResult);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setErrorMessage(err?.message || "An unexpected error occurred while loading authorization details.");
          setLoading(false);
        }
      }
    }

    loadAuthorization();

    return () => {
      isMounted = false;
    };
  }, [authorizationId, router]);

  // Step 5 & 6: Explicit owner approval via Supabase Auth
  const handleApprove = async () => {
    if (!authorizationId || submitting || !clientTrust || !clientTrust.trusted) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.oauth.approveAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });

      if (error || !data?.redirect_url) {
        setErrorMessage(error?.message || "Failed to approve authorization request.");
        setSubmitting(false);
        return;
      }

      setDecisionCompleted("approved");
      setRedirectUrl(data.redirect_url);
      // Step 7: Redirect only to the URL returned by Supabase Auth
      window.location.assign(data.redirect_url);
    } catch (err: any) {
      setErrorMessage(err?.message || "An unexpected error occurred during approval.");
      setSubmitting(false);
    }
  };

  // Step 5 & 6: Explicit owner denial via Supabase Auth
  const handleDeny = async () => {
    if (!authorizationId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.oauth.denyAuthorization(authorizationId, {
        skipBrowserRedirect: true,
      });

      if (error || !data?.redirect_url) {
        setErrorMessage(error?.message || "Failed to record authorization denial.");
        setSubmitting(false);
        return;
      }

      setDecisionCompleted("denied");
      setRedirectUrl(data.redirect_url);
      // Step 7: Redirect only to the URL returned by Supabase Auth
      window.location.assign(data.redirect_url);
    } catch (err: any) {
      setErrorMessage(err?.message || "An unexpected error occurred during denial.");
      setSubmitting(false);
    }
  };

  // Scopes array from verified server authorization details
  const verifiedScopes = authDetails?.scope
    ? authDetails.scope.split(/\s+/).filter(Boolean)
    : [];

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
            Review and authorize third-party client access to your Job Farming Command Center and MCP endpoints.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 text-xs">
          {/* Loading state */}
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
              <p className="text-xs font-medium">Verifying authorization parameters with Supabase OAuth Server...</p>
            </div>
          )}

          {/* Error display */}
          {errorMessage && !loading && (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300 space-y-1.5">
              <div className="flex items-center gap-2 font-bold text-xs">
                <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0" />
                <span>Authorization Error</span>
              </div>
              <p className="text-[11px] leading-relaxed">{errorMessage}</p>
            </div>
          )}

          {/* Decision completed redirecting banner */}
          {decisionCompleted && redirectUrl && (
            <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-bold text-xs">
                {decisionCompleted === "approved" ? (
                  <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                ) : (
                  <Ban className="h-4 w-4 text-amber-600 shrink-0" />
                )}
                <span>
                  {decisionCompleted === "approved"
                    ? "Authorization Approved: Redirecting to client..."
                    : "Authorization Denied: Redirecting to client..."}
                </span>
              </div>
              <p className="text-[11px] truncate">
                Target: <code className="font-mono text-[10px]">{redirectUrl}</code>
              </p>
              <div className="pt-1">
                <a
                  href={redirectUrl}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-600 underline"
                >
                  Click here if you are not automatically redirected
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}

          {/* Main Consent Form when auth details are loaded */}
          {!loading && authDetails && !decisionCompleted && (
            <>
              {/* Owner Identity Verification */}
              <div className="p-3.5 rounded-xl border bg-muted/40 flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-[11px] text-muted-foreground block font-medium">Authenticated Owner</span>
                  <span className="font-semibold text-foreground">Govardhan Reddy Narala</span>
                  <span className="font-mono text-[10px] text-muted-foreground block truncate max-w-xs">
                    UUID: {DESIGNATED_OWNER_UUID} ({DESIGNATED_OWNER_EMAIL})
                  </span>
                </div>
                <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10 gap-1 text-[11px]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verified Principal
                </Badge>
              </div>

              {/* Verified Client Application Details */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
                  Requesting Application Details (Verified via Server)
                </h4>
                <div className="p-3.5 rounded-xl border bg-card space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Client Name:</span>
                    <span className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                      {authDetails.client?.name || "Unknown Application"}
                      {clientTrust?.trusted && (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 bg-emerald-500/10 text-[10px] py-0 px-1.5">
                          {clientTrust.connector === "grok" ? "Verified Grok" : "Verified Cursor"}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Client ID:</span>
                    <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                      {authDetails.client?.id || "N/A"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Registration Status:</span>
                    <span className="text-[11px] font-medium text-foreground">
                      {clientTrust?.trusted ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Authorized Grok Connector</span>
                      ) : clientTrust?.isPendingApproval ? (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold">Dynamic Registration (Owner Allowlist Required)</span>
                      ) : (
                        <span className="text-rose-600 font-semibold">Untrusted / Disallowed Client</span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t">
                    <span className="text-muted-foreground">Registered Redirect URI:</span>
                    <span className="font-mono text-[11px] text-foreground truncate max-w-xs">
                      {authDetails.redirect_uri}
                    </span>
                  </div>
                </div>
              </div>

              {/* Scopes Requested */}
              <div className="space-y-2">
                <h4 className="font-semibold text-foreground uppercase tracking-wider text-[11px]">
                  Requested Permission Scopes
                </h4>
                <div className="space-y-2">
                  {verifiedScopes.map((scope) => (
                    <div
                      key={scope}
                      className="p-3 rounded-lg border bg-muted/30 flex items-start gap-2.5"
                    >
                      <Lock className="h-4 w-4 text-brand-600 mt-0.5 shrink-0" />
                      <div className="space-y-0.5">
                        <span className="font-mono font-bold text-foreground text-xs block">{scope}</span>
                        <span className="text-[11px] text-muted-foreground block">
                          {STANDARD_SCOPES[scope] || "Standard Supabase OAuth 2.1 claim scope"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mutating Tool Security Notice */}
              <div className="p-3.5 rounded-xl border border-destructive/20 bg-destructive/5 text-foreground space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-xs text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Security & Access Scope</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Approving grants this client short-lived access tokens to interact with your Supabase backend and MCP services.
                  You can revoke access at any time from your Supabase Auth administration portal.
                </p>
              </div>
            </>
          )}
        </CardContent>

        <CardFooter className="p-6 border-t bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={loading || submitting || Boolean(decisionCompleted) || !authDetails}
            className="w-full sm:w-auto h-9 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/20"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <X className="h-4 w-4 mr-1.5" />
            )}
            Deny Access
          </Button>

          <Button
            onClick={handleApprove}
            disabled={loading || submitting || Boolean(decisionCompleted) || !authDetails || !clientTrust?.trusted}
            className="w-full sm:w-auto h-9 text-xs bg-brand-600 hover:bg-brand-700 text-white font-medium"
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : !clientTrust?.trusted ? (
              <Lock className="h-4 w-4 mr-1.5" />
            ) : (
              <Check className="h-4 w-4 mr-1.5" />
            )}
            {!clientTrust?.trusted ? "Approval Unavailable" : "Authorize Application"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function ConsentPage() {
  return (
    <Suspense
      fallback={
        <div className="h-96 flex items-center justify-center text-xs text-muted-foreground">
          Loading authorization parameters...
        </div>
      }
    >
      <ConsentContent />
    </Suspense>
  );
}
