import type { Config } from "tailwindcss";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const preset = require("../../lib/ui/tailwind-preset.cjs");

export default {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  // Bare `border` / `divide-y` (unrestyled pages) use the token instead of gray-200.
  theme: { extend: { borderColor: { DEFAULT: "var(--border)" } } },
  plugins: [],
} satisfies Config;
