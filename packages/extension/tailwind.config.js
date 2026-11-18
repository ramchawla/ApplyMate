import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** @type {import('tailwindcss').Config} */
export default {
  presets: [require("../../lib/ui/tailwind-preset.cjs")],
  content: ["./side-panel.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};
