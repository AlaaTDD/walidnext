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
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: {
          DEFAULT: "var(--primary)",
          dark: "var(--primary-dark)",
          light: "var(--primary-light)",
        },
        success: "var(--success)",
        warning: "var(--warning)",
        danger: "var(--danger)",
        info: "var(--info)",
        slate: {
          50: "var(--slate-50)",
          100: "var(--slate-100)",
          200: "var(--slate-200)",
          300: "var(--slate-300)",
          400: "var(--slate-400)",
          500: "var(--slate-500)",
          600: "var(--slate-600)",
          700: "var(--slate-700)",
          800: "var(--slate-800)",
          900: "var(--slate-900)",
          950: "var(--slate-950)",
        },
        "sheet-canvas": "var(--sheet-canvas)",
        "sheet-border": "var(--sheet-border)",
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
