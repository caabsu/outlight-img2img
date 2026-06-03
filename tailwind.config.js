/** @type {import('tailwindcss').Config} */
//
// OUTLIGHT DESIGN SYSTEM — "Atelier" (refined)
// ------------------------------------------------------------------
// The whole OS was previously built on Tailwind's stock `slate` (neutral)
// and `indigo` (accent) scales, used inline across ~22k lines. Rather than
// hand-edit every file, we REDEFINE those two scales here so the entire app
// adopts the new identity at once — warm stone neutrals + an evergreen brand —
// in both light and dark mode. New work should prefer the semantic aliases
// (`bg-surface`, `text-ink`, `border-line`, `text-brand`, …) defined below.
//
// Cool graphite neutral scale — replaces stock `slate` everywhere.
const neutral = {
  50:  '#fbfbfd',
  100: '#f2f3f6',
  200: '#e6e7ec',
  300: '#d3d5dc',
  400: '#9ca0ac',
  500: '#71757f',
  600: '#52555e',
  700: '#3a3c44',
  800: '#26262e',
  900: '#17171c',
  950: '#0e0e12',
};

// Indigo→violet brand/accent scale — replaces every cool/purple accent family
// (indigo, violet, sky, blue, purple, fuchsia, cyan) so the OS has ONE accent.
const brand = {
  50:  '#eef0fe',
  100: '#e0e3fd',
  200: '#c4c8fb',
  300: '#a5abf8',
  400: '#818cf8',
  500: '#6366f1',
  600: '#4f46e5',
  700: '#4338ca',
  800: '#372fa8',
  900: '#2e2a83',
  950: '#1e1b4b',
};

module.exports = {
  darkMode: 'class',
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: neutral,
        gray: neutral,
        zinc: neutral,
        neutral: neutral,
        stone: neutral,
        indigo: brand,
        violet: brand,
        purple: brand,
        fuchsia: brand,
        sky: brand,
        blue: brand,
        cyan: brand,
        // ---- Semantic aliases (preferred for new code) ----
        canvas:      'rgb(var(--c-canvas) / <alpha-value>)',
        'canvas-2':  'rgb(var(--c-canvas-2) / <alpha-value>)',
        surface:     'rgb(var(--c-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--c-surface-2) / <alpha-value>)',
        line:        'rgb(var(--c-line) / <alpha-value>)',
        'line-strong':'rgb(var(--c-line-strong) / <alpha-value>)',
        ink:         'rgb(var(--c-ink) / <alpha-value>)',
        'ink-2':     'rgb(var(--c-ink-2) / <alpha-value>)',
        'ink-3':     'rgb(var(--c-ink-3) / <alpha-value>)',
        brand:       'rgb(var(--c-brand) / <alpha-value>)',
        'brand-hover':'rgb(var(--c-brand-hover) / <alpha-value>)',
        'brand-soft':'rgb(var(--c-brand-soft) / <alpha-value>)',
        'on-brand':  'rgb(var(--c-on-brand) / <alpha-value>)',
        accent:      'rgb(var(--c-accent) / <alpha-value>)',
        'accent-soft':'rgb(var(--c-accent-soft) / <alpha-value>)',
        danger:      'rgb(var(--c-danger) / <alpha-value>)',
        'danger-soft':'rgb(var(--c-danger-soft) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        lg: '0.625rem',   // 10px — controls
        xl: '0.875rem',   // 14px — cards
        '2xl': '1.125rem',// 18px — large panels / modals
      },
      boxShadow: {
        sm: '0 1px 2px rgba(45,35,15,.05)',
        DEFAULT: '0 1px 2px rgba(45,35,15,.05), 0 4px 14px -8px rgba(45,35,15,.14)',
        md: '0 1px 2px rgba(45,35,15,.05), 0 4px 14px -8px rgba(45,35,15,.14)',
        lg: '0 2px 6px rgba(45,35,15,.06), 0 18px 40px -20px rgba(45,35,15,.26)',
        xl: '0 2px 6px rgba(45,35,15,.06), 0 28px 56px -24px rgba(45,35,15,.30)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in .3s ease both',
        'fade-up': 'fade-up .35s cubic-bezier(.2,.7,.3,1) both',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
