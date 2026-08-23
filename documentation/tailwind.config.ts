import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './content/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#030303',
        violet: {
          glow: '#8B5CF6',
        },
        cyan: {
          glow: '#06B6D4',
        },
        emerald: {
          glow: '#10B981',
        },
      },
      fontFamily: {
        serif: ['var(--font-instrument-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        tightest: '-0.05em',
        tighter2: '-0.02em',
        widest2: '0.2em',
      },
      lineHeight: {
        '0.9': '0.9',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0) scale(1)' },
          '50%': { transform: 'translateY(-20px) scale(1.05)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '0% center' },
        },
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        spinSlow: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        float: 'float 12s ease-in-out infinite',
        'float-slow': 'float 18s ease-in-out infinite',
        'float-fast': 'float 7s ease-in-out infinite',
        shimmer: 'shimmer 6s linear infinite',
        ticker: 'ticker 40s linear infinite',
        rise: 'rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'spin-slow': 'spinSlow 8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
