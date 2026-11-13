"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Briefcase,
  MailCheck,
  Users,
  Cpu,
  KeyRound,
  Search,
  Bell,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Radio,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

interface NavItem {
  name: string;
  shortName: string;
  href: string;
  icon: React.ElementType;
  badge?: string | number;
}

const NAVIGATION: NavItem[] = [
  { name: "Executive Dashboard", shortName: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Applications Tracker", shortName: "Applications", href: "/applications", icon: Briefcase },
  { name: "Gmail Monitoring", shortName: "Gmail", href: "/monitoring", icon: MailCheck },
  { name: "LinkedIn CRM", shortName: "LinkedIn", href: "/outreach", icon: Users },
  { name: "MCP & Diagnostics", shortName: "Diagnostics", href: "/diagnostics", icon: Cpu },
  { name: "OAuth Consent", shortName: "OAuth", href: "/oauth/consent", icon: KeyRound },
];

// Top 5 routes for mobile bottom dock
const MOBILE_DOCK_NAV = NAVIGATION.slice(0, 5);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [bannerCollapsed, setBannerCollapsed] = useState(false);

  // Login page does not render the dashboard navigation shell
  const isAuthPage = pathname === "/login";
  if (isAuthPage) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row overflow-x-hidden selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Mobile Sticky Compact Top Bar (<768px) */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-3.5 py-2.5 border-b border-border/80 bg-slate-950/85 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-sm font-bold text-xs">
            JF
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-foreground flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#38bdf8]" />
              Orbital Mission Control
            </span>
            <span className="text-[10px] text-muted-foreground font-mono">jobbot: read-only</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="w-7 h-7 rounded-full bg-cyan-500/10 text-cyan-400 font-semibold text-[11px] flex items-center justify-center border border-cyan-500/30 font-mono shadow-[0_0_10px_rgba(6,182,212,0.2)]">
            GN
          </div>
        </div>
      </header>

      {/* Desktop / Tablet Collapsible Command Rail (>=768px) */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border/80 bg-slate-950/80 backdrop-blur-2xl transition-all duration-300 ease-in-out sticky top-0 h-screen z-30 shrink-0",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Brand / Logo Header */}
        <div className="h-16 flex items-center justify-between px-3.5 border-b border-border/60">
          {!collapsed ? (
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 via-cobalt-500 to-cyan-400 flex items-center justify-center text-white shadow-[0_0_15px_rgba(59,130,246,0.35)] font-bold text-sm tracking-wider">
                JF
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-xs tracking-tight text-foreground group-hover:text-cyan-400 transition-colors uppercase">
                  Job Farming OS
                </span>
                <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Telemetry v2.0
                </span>
              </div>
            </Link>
          ) : (
            <div className="mx-auto w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center text-white shadow-sm font-bold text-sm">
              JF
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex h-7 w-7 text-muted-foreground hover:text-cyan-400 hover:bg-slate-800/60"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation Items (6 routes) */}
        <div className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
          {NAVIGATION.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-all group",
                  isActive
                    ? "bg-slate-900/90 text-cyan-300 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] border border-cyan-500/30"
                    : "text-muted-foreground hover:bg-slate-900/40 hover:text-foreground"
                )}
                title={collapsed ? item.name : undefined}
              >
                {/* Laser active indicator */}
                {isActive && <div className="laser-indicator" />}

                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-all duration-200",
                      isActive
                        ? "text-cyan-400 filter drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]"
                        : "group-hover:text-cyan-300"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </div>
                {!collapsed && item.badge && (
                  <span
                    className={cn(
                      "px-1.5 py-0.5 text-[10px] rounded font-mono font-semibold",
                      isActive
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-border/60 bg-slate-950/60 space-y-2">
          {!collapsed ? (
            <div className="flex items-center justify-between px-1">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground truncate max-w-[125px]">
                  Govardhan Reddy
                </span>
                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                  <ShieldCheck className="w-3 h-3 text-emerald-400" />
                  Owner Guard Active
                </span>
              </div>
              <ThemeToggle />
            </div>
          ) : (
            <div className="flex justify-center py-1">
              <ThemeToggle />
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-20 md:pb-8">
        {/* Top Telemetry Header (>=768px) */}
        <header className="hidden md:flex h-14 items-center justify-between px-6 border-b border-border/70 bg-slate-950/70 backdrop-blur-xl sticky top-0 z-20">
          {/* Global Search Input */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search companies, positions, contacts... [⌘K]"
              className="w-full pl-9 pr-12 py-1.5 text-xs rounded-lg border border-border/80 bg-slate-900/60 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/40 transition-all font-mono"
            />
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[10px] font-mono text-muted-foreground bg-muted/50 px-1 py-0.5 rounded border border-border">
              ⌘K
            </kbd>
          </div>

          {/* Quick Header Telemetry Badges & Controls */}
          <div className="flex items-center gap-3">
            {/* Live Status Pill */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-medium shadow-[0_0_12px_rgba(16,185,129,0.15)]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>● Supabase jobbot: Read-Only Preview</span>
            </div>

            {/* Security Badge */}
            <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-700/80 text-muted-foreground text-[11px] font-mono">
              <ShieldCheck className="h-3.5 w-3.5 text-cyan-400" />
              <span>Owner Guard Active</span>
            </div>

            {/* Original Site Link */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-[11px] font-mono border-border/80 bg-slate-900/40 text-muted-foreground hover:text-cyan-400 hover:border-cyan-500/40"
              asChild
            >
              <a
                href="https://job-farming-command-center.redevil.chatgpt.site"
                target="_blank"
                rel="noreferrer"
              >
                <span>Original Site</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>

            {/* Notification Bell */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 relative text-muted-foreground hover:text-foreground"
              aria-label="System notifications"
            >
              <Bell className="h-3.5 w-3.5" />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_#38bdf8]" />
            </Button>

            {/* User Avatar */}
            <div className="flex items-center gap-2 pl-2 border-l border-border/60">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 text-white font-mono font-semibold text-[11px] flex items-center justify-center shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                  GN
                </div>
                <span className="hidden xl:inline text-xs font-mono font-medium text-muted-foreground">
                  Govardhan Reddy
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Collapsible Sleek Safety Policy Top Banner */}
        <div className="px-4 md:px-8 pt-3">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 sm:px-4 text-xs text-muted-foreground transition-all">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px] text-amber-300">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="font-semibold text-foreground">Production Safety Policy Active</span>
                <span className="hidden sm:inline text-muted-foreground">— Connected to Supabase project</span>
                <code className="hidden sm:inline bg-slate-900/80 px-1.5 py-0.2 rounded border border-border text-cyan-300 font-mono text-[10px]">
                  mldtysploensrrulchdl
                </code>
                <span className="hidden sm:inline text-muted-foreground">(schema: jobbot). All dashboard operations are strictly read-only.</span>
              </div>
              <button
                onClick={() => setBannerCollapsed(!bannerCollapsed)}
                className="text-muted-foreground hover:text-foreground text-[10px] font-mono px-1.5 py-0.5 rounded hover:bg-slate-800/60 flex items-center gap-1"
                aria-label="Toggle banner details"
              >
                <span>{bannerCollapsed ? "Expand" : "Collapse"}</span>
                {bannerCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              </button>
            </div>
            {!bannerCollapsed && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                Connected to Supabase project <code className="bg-slate-900/80 px-1 py-0.5 rounded font-mono text-cyan-300">mldtysploensrrulchdl</code> (schema: <code className="bg-slate-900/80 px-1 py-0.5 rounded font-mono text-cyan-300">jobbot</code>). All dashboard operations are strictly read-only. External LinkedIn invitation dispatch and destructive modifications remain disabled.
              </p>
            )}
          </div>
        </div>

        {/* Page Content Viewport */}
        <main className="flex-1 p-3.5 sm:p-6 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Frosted Glass Dock (<768px, 5 icons) */}
      <nav
        aria-label="Mobile navigation dock"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 backdrop-blur-xl bg-slate-950/85 border-t border-slate-800/80 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)]"
      >
        {MOBILE_DOCK_NAV.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-medium transition-colors relative",
                isActive ? "text-cyan-400 font-bold" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isActive && (
                <div className="absolute top-0 w-8 h-0.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#38bdf8]" />
              )}
              <Icon
                className={cn(
                  "h-5 w-5 mb-0.5 transition-transform",
                  isActive && "scale-110 drop-shadow-[0_0_6px_rgba(56,189,248,0.7)]"
                )}
              />
              <span className="truncate max-w-[64px] text-center">{item.shortName}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
