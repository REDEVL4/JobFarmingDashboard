"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Lock, Mail, ArrowRight, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { DESIGNATED_OWNER_UUID, validateSafeRedirect } from "@/lib/oauth-validation";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const redirectParam = searchParams.get("redirect") || searchParams.get("returnTo");
  const isOAuthRedirect = Boolean(redirectParam && redirectParam.includes("/oauth/consent"));

  const [email, setEmail] = useState("govardhanreddy.vys7@gmail.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // Fail-closed: Never allow bypass on error
        setErrorMessage(`Authentication failed: ${error.message}`);
        return;
      }

      if (!data?.user) {
        setErrorMessage("Authentication failed: No user session returned.");
        return;
      }

      // Verify that the authenticated user is the designated owner
      if (data.user.id !== DESIGNATED_OWNER_UUID) {
        await supabase.auth.signOut();
        setErrorMessage("Access denied: You are not the authorized owner of this command center.");
        return;
      }

      // Authenticated owner confirmed - preserve destination (e.g. OAuth consent)
      const redirectParam = searchParams.get("redirect") || searchParams.get("returnTo");
      const destination = validateSafeRedirect(redirectParam, "/");
      router.push(destination);
      router.refresh();
    } catch (err: any) {
      // Fail-closed: Always stay on login page on any exception
      setErrorMessage(`Authentication error: ${err?.message || "An unexpected error occurred."}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <Card className="w-full max-w-md border shadow-elevation">
        <div className="bg-brand-600 px-6 py-4 text-white rounded-t-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <span className="font-bold text-sm">Owner Access Verification</span>
          </div>
          <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded font-mono font-semibold">
            f2729195
          </span>
        </div>

        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl font-bold text-foreground">Sign In</CardTitle>
          <CardDescription className="text-xs">
            Authenticate to access your private Job Farming Command Center
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSignIn}>
          <CardContent className="space-y-4 text-xs">
            {isOAuthRedirect && (
              <div className="p-3 rounded-lg border border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300 flex items-start gap-2">
                <Lock className="h-4 w-4 shrink-0 mt-0.5 text-brand-600 dark:text-brand-400" />
                <span>
                  <strong>OAuth 2.1 Consent:</strong> Authenticate as the designated owner to review and authorize the requesting application.
                </span>
              </div>
            )}

            {errorCode === "unauthorized_owner" && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Access denied: The authenticated user is not the designated owner.</span>
              </div>
            )}

            {errorCode === "missing_credentials" && (
              <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Configuration notice: Supabase credentials are missing or unconfigured. Access is locked.</span>
              </div>
            )}

            {errorMessage && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Owner Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 text-xs h-9"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Password / Master Token</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 text-xs h-9"
                  required
                />
              </div>
            </div>
          </CardContent>

          <CardFooter className="pt-2">
            <Button
              type="submit"
              className="w-full text-xs h-9 bg-brand-600 hover:bg-brand-700 text-white font-medium"
              disabled={loading}
            >
              {loading ? "Verifying Credentials..." : "Authenticate as Owner"}
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-muted-foreground">Loading login...</div>}>
      <LoginContent />
    </Suspense>
  );
}
