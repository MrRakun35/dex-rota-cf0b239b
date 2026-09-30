import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/{**,.client,.server}/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dex: {
          canvas: "rgb(var(--oui-color-base-10) / <alpha-value>)",
          surface: "rgb(var(--oui-color-base-9) / <alpha-value>)",
          elevated: "rgb(var(--oui-color-base-7) / <alpha-value>)",
          accent: "rgb(var(--oui-color-primary) / <alpha-value>)",
          text: "rgb(var(--oui-color-base-foreground) / <alpha-value>)",
          muted: "rgb(var(--oui-color-quaternary) / <alpha-value>)",
          line: "rgb(var(--oui-color-line) / <alpha-value>)",
          positive: "rgb(var(--oui-color-success) / <alpha-value>)",
          negative: "rgb(var(--oui-color-danger) / <alpha-value>)",
        },
      },
      borderRadius: {
        sm: "var(--oui-rounded-sm)",
        DEFAULT: "var(--oui-rounded)",
        md: "var(--oui-rounded-md)",
        lg: "var(--oui-rounded-lg)",
        xl: "var(--oui-rounded-xl)",
        "2xl": "var(--oui-rounded-2xl)",
      },
      fontFamily: {
        sans: ["var(--oui-font-family)"],
      },
    },
  },
  plugins: [],
} satisfies Config;
