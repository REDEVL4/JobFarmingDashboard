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
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "./ui/button";

interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  badge?: string | number;
}

const NAVIGATION: NavItem[] = [
  { name: "Executive Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Applications Tracker", href: "/applications", icon: Briefcase },
  { name: "Gmail Monitoring", href: "/monitoring", icon: MailCheck },
  { name: "LinkedIn CRM", href: "/outreach", icon: Users },
  { name: "MCP & Diagnostics", href: "/diagnostics", icon: Cpu },
  { name: "OAuth Consent", href: "/oauth/consent", icon: KeyRound },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Auth pages (login, oauth consent) do not render the dashboard navigation shell
  const isAuthPage = pathname === "/login" || pathname?.startsWith("/oauth");
  if (isAuthPage) {
    return <main className="min-h-screen bg-background">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <span className="font-bold tracking-tight text-foreground flex items-center gap-1.5 text-base">
            <span className="w-2.5 h-2.5 rounded-full bg-brand-500 animate-pulse" />
            Job Farming OS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="w-8 h-8 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 font-semibold text-xs flex items-center justify-center border border-brand-500/20">
            GN
          </div>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
          <div className="fixed inset-y-0 left-0 w-3/4 max-w-xs bg-card border-r p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b mb-4">
                <span className="font-bold text-lg text-foreground">Navigation</span>
                <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
              <nav className="space-y-1">
                {NAVIGATION.map((item) => {
                  const isActive = pathname === item.href;
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-4 w-4" />
                        <span>{item.name}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={cn(
                            "px-2 py-0.5 text-xs rounded-full font-semibold",
                            isActive
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 border-t text-xs text-muted-foreground space-y-2">
              <div className="flex items-center justify-between">
                <span>Theme</span>
                <ThemeToggle />
              </div>
              <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Owner Authenticated</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Collapsible Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r bg-card/60 backdrop-blur-xl transition-all duration-300 ease-in-out sticky top-0 h-screen z-30",
          collapsed ? "w-18" : "w-64"
        )}
      >
        {/* Brand / Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white shadow-sm font-bold text-sm">
                JF
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight text-foreground leading-tight">
                  Job Farming
                </span>
                <span className="text-[11px] text-muted-foreground font-medium">Command Center</span>
              </div>
            </Link>
          )}

          {collapsed && (
            <div className="mx-auto w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center text-white shadow-sm font-bold text-sm">
              JF
            </div>
          )}

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden md:flex h-7 w-7 text-muted-foreground hover:text-foreground"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAVIGATION.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-subtle font-semibold"
                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
                )}
                title={collapsed ? item.name : undefined}
              >
                <div className="flex items-center gap-3">
                  <Icon className={cn("h-4 w-4 shrink-0 transition-transform group-hover:scale-105", isActive && "text-primary-foreground")} />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </div>
                {!collapsed && item.badge && (
                  <span
                    className={cn(
                      "px-2 py-0.5 text-[11px] rounded-full font-semibold",
                      isActive
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:bg-muted-foreground/20"
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
        <div className="p-3 border-t bg-card/40 space-y-2">
          {!collapsed ? (
            <div className="flex items-center justify-between px-2 py-1">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-foreground truncate max-w-[130px]">
                  Govardhan Reddy
                </span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
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
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header Bar */}
        <header className="hidden md:flex h-16 items-center justify-between px-8 border-b bg-card/50 backdrop-blur-md sticky top-0 z-20">
          {/* Search Bar */}
          <div className="relative w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search companies, positions, contacts..."
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring transition-all placeholder:text-muted-foreground"
            />
          </div>

          {/* Quick Header Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span>Supabase jobbot: Read-Only Preview</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
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

            <Button variant="ghost" size="icon" className="h-8 w-8 relative text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-brand-500" />
            </Button>

            <div className="flex items-center gap-2 pl-2 border-l">
              <div className="w-8 h-8 rounded-full bg-brand-600 text-white font-semibold text-xs flex items-center justify-center shadow-subtle">
                GN
              </div>
            </div>
          </div>
        </header>

        {/* Page Content Viewport */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}

