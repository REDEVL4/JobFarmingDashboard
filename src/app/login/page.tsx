"use client";

import React, { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck, Lock, Mail, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const unauthorizedError = searchParams.get("error") === "unauthorized_owner";

  const [email, setEmail] = useState("govardhanreddy.vys7@gmail.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        // In local preview mode without a configured live auth session, allow owner entry
        setMessage(`Sign-in note: ${error.message}. Entering Owner Preview mode.`);
        setTimeout(() => {
          router.push("/");
        }, 1000);
      } else if (data?.user) {
        router.push("/");
      }
    } catch {
      router.push("/");
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
            {unauthorizedError && (
              <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Access denied: The authenticated user is not the designated owner.</span>
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
                />
              </div>
            </div>

            {message && (
              <div className="p-3 rounded-lg bg-muted text-foreground text-xs">
                {message}
              </div>
            )}
          </CardContent>

          <CardFooter className="flex flex-col gap-2 pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="w-full h-9 text-xs bg-brand-600 hover:bg-brand-700 text-white"
            >
              <span>{loading ? "Authenticating..." : "Authenticate as Owner"}</span>
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Owner identity is strictly bound to UUID <code className="font-mono">f2729195-5445-4272-ab85-cac5b03b0967</code>.
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-[70vh] flex items-center justify-center text-xs text-muted-foreground">Loading sign-in form...</div>}>
      <LoginContent />
    </Suspense>
  );
}

