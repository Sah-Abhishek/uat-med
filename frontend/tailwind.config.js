/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Surfaces
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--surface-sunken) / <alpha-value>)',

        // Text
        ink: 'rgb(var(--ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--ink-muted) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--ink-subtle) / <alpha-value>)',

        // Borders
        line: 'rgb(var(--line) / <alpha-value>)',
        'line-strong': 'rgb(var(--line-strong) / <alpha-value>)',

        // Brand
        primary: {
          DEFAULT: '#FFC72C',
          hover: '#F2B91C',
          soft: 'rgb(var(--primary-soft) / <alpha-value>)',
          ink: '#1E1A06',
        },
        danger: {
          DEFAULT: '#E8436E',
          hover: '#D8365F',
          soft: 'rgb(var(--danger-soft) / <alpha-value>)',
        },
        success: {
          DEFAULT: '#22C55E',
          soft: 'rgb(var(--success-soft) / <alpha-value>)',
        },
        warn: {
          DEFAULT: '#F59E0B',
          soft: 'rgb(var(--warn-soft) / <alpha-value>)',
        },
        info: {
          DEFAULT: '#3BA4E0',
          soft: 'rgb(var(--info-soft) / <alpha-value>)',
        },

        // Milestone tile tints (variants in CSS)
        tile: {
          taupe: 'rgb(var(--tile-taupe) / <alpha-value>)',
          indigo: 'rgb(var(--tile-indigo) / <alpha-value>)',
          teal: 'rgb(var(--tile-teal) / <alpha-value>)',
          mint: 'rgb(var(--tile-mint) / <alpha-value>)',
          sky: 'rgb(var(--tile-sky) / <alpha-value>)',
          butter: 'rgb(var(--tile-butter) / <alpha-value>)',
          coral: 'rgb(var(--tile-coral) / <alpha-value>)',
        },
      },
      borderRadius: {
        pill: '9999px',
        card: '14px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20, 25, 30, 0.04), 0 0 0 1px rgba(20, 25, 30, 0.04)',
        pop: '0 10px 30px rgba(20, 25, 30, 0.12), 0 0 0 1px rgba(20, 25, 30, 0.06)',
        'card-dark': '0 1px 2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.04)',
        'pop-dark': '0 18px 48px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05)',
      },
      letterSpacing: {
        tightish: '-0.01em',
      },
    },
  },
  plugins: [],
};
