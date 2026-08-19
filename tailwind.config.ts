import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // background/foreground are never used with an opacity modifier
        // (bg-background/50 etc. don't appear anywhere in this codebase),
        // so they're left as plain var() -- no -rgb sibling needed.
        background: "var(--background)",
        foreground: "var(--foreground)",
        // Every other color below IS used with opacity modifiers
        // (bg-primary/[0.07], border-success/25, bg-slate-700/[0.16], ...)
        // somewhere in src/components/*. Tailwind can only apply an alpha
        // channel to a color it can decompose into R/G/B, so each of these
        // resolves through the bare-channel `--x-rgb` variable defined in
        // globals.css, wrapped in the documented `rgb(var(...) / <alpha-value>)`
        // format. `<alpha-value>` is replaced by Tailwind at build time with
        // either 1 (no modifier) or the requested opacity (e.g. bg-primary/50
        // -> 0.5, bg-success/[0.1] -> 0.1). Without this exact wrapper format,
        // every class using `/opacity` on these colors silently compiles to
        // 100% opaque with no build warning -- see the 33dd971ab2a7 UI-overhaul
        // task handoff for how this was diagnosed against real compiled CSS.
        primary: {
          DEFAULT: "rgb(var(--primary-rgb) / <alpha-value>)",
          dark: "rgb(var(--primary-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--primary-light-rgb) / <alpha-value>)",
        },
        success: "rgb(var(--success-rgb) / <alpha-value>)",
        warning: "rgb(var(--warning-rgb) / <alpha-value>)",
        danger: "rgb(var(--danger-rgb) / <alpha-value>)",
        info: "rgb(var(--info-rgb) / <alpha-value>)",
        slate: {
          50: "rgb(var(--slate-50-rgb) / <alpha-value>)",
          100: "rgb(var(--slate-100-rgb) / <alpha-value>)",
          200: "rgb(var(--slate-200-rgb) / <alpha-value>)",
          300: "rgb(var(--slate-300-rgb) / <alpha-value>)",
          400: "rgb(var(--slate-400-rgb) / <alpha-value>)",
          500: "rgb(var(--slate-500-rgb) / <alpha-value>)",
          600: "rgb(var(--slate-600-rgb) / <alpha-value>)",
          700: "rgb(var(--slate-700-rgb) / <alpha-value>)",
          800: "rgb(var(--slate-800-rgb) / <alpha-value>)",
          900: "rgb(var(--slate-900-rgb) / <alpha-value>)",
          950: "rgb(var(--slate-950-rgb) / <alpha-value>)",
        },
        "sheet-canvas": "rgb(var(--sheet-canvas-rgb) / <alpha-value>)",
        "sheet-border": "rgb(var(--sheet-border-rgb) / <alpha-value>)",
      },
      transitionDuration: {
        fast: "160ms",
        base: "240ms",
        slow: "380ms",
      },
      transitionTimingFunction: {
        standard: "var(--motion-standard)",
        enter: "var(--motion-enter)",
        exit: "var(--motion-exit)",
        emphasized: "var(--motion-emphasized)",
      },
    },
  },
  plugins: [],
} satisfies Config;
