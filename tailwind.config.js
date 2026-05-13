/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        burst: {
          bg: '#0a0a0a',
          panel: '#111111',
          card: '#161616',
          border: '#1f1f1f',
          orange: '#FF6B00',
          'orange-bright': '#FF8C00',
          'orange-glow': '#FFA033',
          text: '#ffffff',
          muted: '#9CA3AF',
          danger: '#EF4444',
          warning: '#F59E0B',
          success: '#22C55E',
        },
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'orange-glow': '0 0 24px rgba(255, 107, 0, 0.35)',
        'orange-glow-sm': '0 0 12px rgba(255, 107, 0, 0.25)',
        card: '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      animation: {
        'pulse-orange': 'pulse-orange 1.6s ease-in-out infinite',
        'pulse-danger': 'pulse-danger 1.6s ease-in-out infinite',
        'pulse-flame': 'pulse-flame 2.4s ease-in-out infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'slide-up': 'slide-up 0.4s ease-out',
      },
      keyframes: {
        'pulse-orange': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(255, 107, 0, 0.6)' },
          '50%': { boxShadow: '0 0 0 12px rgba(255, 107, 0, 0)' },
        },
        'pulse-danger': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239, 68, 68, 0.6)' },
          '50%': { boxShadow: '0 0 0 12px rgba(239, 68, 68, 0)' },
        },
        'pulse-flame': {
          '0%, 100%': {
            filter:
              'drop-shadow(0 0 8px rgba(255, 107, 0, 0.5)) brightness(1)',
          },
          '50%': {
            filter:
              'drop-shadow(0 0 14px rgba(255, 140, 0, 0.85)) brightness(1.08)',
          },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
