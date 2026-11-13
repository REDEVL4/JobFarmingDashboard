import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        // Orbital Mission Control & Telemetry Palette
        orbital: {
          obsidian: "#050811",
          slate: "#0f172a",
          surface: "rgba(15, 23, 42, 0.75)",
          hover: "rgba(30, 41, 59, 0.85)",
          cyan: "#38bdf8",
          cyanGlow: "#06b6d4",
          cobalt: "#3b82f6",
          emerald: "#10b981",
          amber: "#f59e0b",
          rose: "#f43f5e",
          dim: "#64748b",
        },
        status: {
          applied: {
            bg: "rgba(99, 102, 241, 0.12)",
            text: "#6366f1",
            border: "rgba(99, 102, 241, 0.25)",
          },
          pending: {
            bg: "rgba(245, 158, 11, 0.12)",
            text: "#f59e0b",
            border: "rgba(245, 158, 11, 0.25)",
          },
          review: {
            bg: "rgba(14, 165, 233, 0.12)",
            text: "#0ea5e9",
            border: "rgba(14, 165, 233, 0.25)",
          },
          interview: {
            bg: "rgba(168, 85, 247, 0.12)",
            text: "#a855f7",
            border: "rgba(168, 85, 247, 0.25)",
          },
          offer: {
            bg: "rgba(16, 185, 129, 0.12)",
            text: "#10b981",
            border: "rgba(16, 185, 129, 0.25)",
          },
          rejected: {
            bg: "rgba(244, 63, 94, 0.12)",
            text: "#f43f5e",
            border: "rgba(244, 63, 94, 0.25)",
          },
          withdrawn: {
            bg: "rgba(100, 116, 139, 0.12)",
            text: "#64748b",
            border: "rgba(100, 116, 139, 0.25)",
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        subtle: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.03)",
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        telemetry: "0 0 15px -3px rgba(56, 189, 248, 0.25)",
        specular: "inset 0 1px 0 0 rgba(255, 255, 255, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
