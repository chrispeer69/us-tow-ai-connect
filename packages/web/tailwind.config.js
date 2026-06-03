/** @type {import('tailwindcss').Config} */
module.exports = {
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
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        "popover-foreground": "var(--popover-foreground)",
        primary: "var(--primary)",
        "primary-foreground": "var(--primary-foreground)",
        secondary: "var(--secondary)",
        "secondary-foreground": "var(--secondary-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
        destructive: "var(--destructive)",
        "destructive-foreground": "var(--destructive-foreground)",
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        brand: {
          // alliance palette — consumed by new components
          navy: "#05162b",
          "navy-2": "#00174b",
          primary: "#2563eb",
          "primary-dark": "#003ea8",
          accent: "#f59e0b",
          "accent-light": "#fbbf24",
          green: "#4ade80",
          purple: "#7c3aed",
        },
        surface: {
          DEFAULT: "var(--surface)",
          bg: "var(--surface-bg)",
          card: "var(--surface-card)",
          low: "var(--surface-low)",
          high: "var(--surface-high)",
        },
        ink: {
          DEFAULT: "var(--text-main)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        line: {
          DEFAULT: "var(--border-color)",
          strong: "var(--border-strong)",
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Manrope", "Inter", "system-ui", "sans-serif"],
        label: ["var(--font-label)", "Work Sans", "system-ui", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "12px",
        sm: "8px",
        lg: "16px",
        xl: "20px",
      },
      boxShadow: {
        ambient: "0 4px 40px rgba(21, 27, 45, 0.08)",
        card: "0 4px 16px rgba(21, 27, 45, 0.08)",
        lift: "0 18px 40px rgba(21, 27, 45, 0.12)",
      },
      maxWidth: {
        container: "1400px",
      },
    },
  },
  plugins: [],
}
