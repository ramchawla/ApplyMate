// Single source of design tokens for the side panel and dashboard
// (values mirror docs/superpowers/mockups/review-chat/tokens.css).
//
// The plugin below defines the CSS custom properties (light default, dark via
// prefers-color-scheme unless data-theme="light", or forced by data-theme="dark").
// theme.extend maps names to var(--x), so no `dark:` variants are needed.
//
// Tailwind mapping (flat keys, e.g. `bg-surface-2`, `text-text-2`, `border-border-strong`):
//   colors       bg surface surface-2 border border-strong text text-2 text-3
//                accent accent-hover accent-fg accent-soft accent-text
//                add-bg add-text del-bg del-text ok ok-bg warn warn-bg err err-bg
//                kw-present kw-injected kw-skipped
//   fontSize     text-meta(12) text-small(12.75) text-body(13.5) text-title(15) text-h2(18) text-h1(22), line-height 1.5
//   borderRadius rounded-chip(4) rounded-ctl(6) rounded-card(10)
//   fontFamily   font-sans = system stack
//   boxShadow    shadow-1, shadow-2
// Note: var() colors do not support opacity modifiers (e.g. `bg-accent/50`).
// Base styles are custom properties only: no body background/font is set here.

const light = {
  "--font": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
  "--t-meta": "12px",
  "--t-small": "12.75px",
  "--t-body": "13.5px",
  "--t-title": "15px",
  "--t-h2": "18px",
  "--t-h1": "22px",
  "--lh": "1.5",
  "--s1": "4px",
  "--s2": "8px",
  "--s3": "12px",
  "--s4": "16px",
  "--s5": "24px",
  "--s6": "32px",
  "--r-chip": "4px",
  "--r-ctl": "6px",
  "--r-card": "10px",
  "--bg": "#f7f8fa",
  "--surface": "#ffffff",
  "--surface-2": "#f1f2f5",
  "--border": "#e3e5ea",
  "--border-strong": "#cfd3da",
  "--text": "#16181d",
  "--text-2": "#4c515b",
  "--text-3": "#686e7b",
  "--accent": "#3657d6",
  "--accent-hover": "#2b49bf",
  "--accent-fg": "#ffffff",
  "--accent-soft": "#eaeefc",
  "--accent-text": "#2a47b5",
  "--add-bg": "#ddf3e4",
  "--add-text": "#135c36",
  "--del-bg": "#fbe4e4",
  "--del-text": "#9e2328",
  "--ok": "#1d8348",
  "--ok-bg": "#e4f5ea",
  "--warn": "#9a5b00",
  "--warn-bg": "#fff2d6",
  "--err": "#b8282d",
  "--err-bg": "#fdeaea",
  "--kw-present": "#8a94b8",
  "--kw-injected": "var(--accent)",
  "--kw-skipped": "var(--border-strong)",
  "--focus": "0 0 0 2px var(--surface), 0 0 0 4px color-mix(in srgb, var(--accent) 55%, transparent)",
  "--shadow-1": "0 1px 2px rgb(16 18 24 / 0.06), 0 1px 1px rgb(16 18 24 / 0.04)",
  "--shadow-2": "0 6px 20px -6px rgb(16 18 24 / 0.18), 0 2px 6px -2px rgb(16 18 24 / 0.08)",
};

const darkVars = {
  "--bg": "#131418",
  "--surface": "#1a1c21",
  "--surface-2": "#202228",
  "--border": "#2b2e35",
  "--border-strong": "#3a3e47",
  "--text": "#eceef1",
  "--text-2": "#aeb2bb",
  "--text-3": "#8d929c",
  "--accent": "#7089ff",
  "--accent-hover": "#8a9eff",
  "--accent-fg": "#0d1233",
  "--accent-soft": "#222a4a",
  "--accent-text": "#a3b3ff",
  "--add-bg": "#15362a",
  "--add-text": "#86dba8",
  "--del-bg": "#3d1d20",
  "--del-text": "#ff9e9e",
  "--ok": "#52c784",
  "--ok-bg": "#16301f",
  "--warn": "#f0b443",
  "--warn-bg": "#362a12",
  "--err": "#ff6f6f",
  "--err-bg": "#3a1c1e",
  "--kw-present": "#6b7499",
  "--kw-skipped": "#3a3e47",
  "--shadow-1": "0 1px 2px rgb(0 0 0 / 0.4)",
  "--shadow-2": "0 8px 24px -8px rgb(0 0 0 / 0.6), 0 2px 6px -2px rgb(0 0 0 / 0.4)",
};

const colorNames = [
  "bg", "surface", "surface-2", "border", "border-strong", "text", "text-2", "text-3",
  "accent", "accent-hover", "accent-fg", "accent-soft", "accent-text",
  "add-bg", "add-text", "del-bg", "del-text",
  "ok", "ok-bg", "warn", "warn-bg", "err", "err-bg",
  "kw-present", "kw-injected", "kw-skipped",
];

const lh = { lineHeight: "1.5" };

module.exports = {
  plugins: [
    ({ addBase }) =>
      addBase({
        ":root": light,
        "@media (prefers-color-scheme: dark)": { ':root:not([data-theme="light"])': darkVars },
        ':root[data-theme="dark"]': darkVars,
      }),
  ],
  theme: {
    extend: {
      colors: Object.fromEntries(colorNames.map((n) => [n, `var(--${n})`])),
      fontSize: {
        meta: ["12px", lh],
        small: ["12.75px", lh],
        body: ["13.5px", lh],
        title: ["15px", lh],
        h2: ["18px", lh],
        h1: ["22px", lh],
      },
      borderRadius: { chip: "4px", ctl: "6px", card: "10px" },
      fontFamily: { sans: ["var(--font)", "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"] },
      boxShadow: { 1: "var(--shadow-1)", 2: "var(--shadow-2)" },
    },
  },
};
