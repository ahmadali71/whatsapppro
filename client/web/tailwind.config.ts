import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        whatsapp: {
          green: '#25D366',
          teal: '#128C7E',
          'dark-teal': '#075E54',
          light: '#DCF8C6',
          blue: '#34B7F1',
          bg: '#EFEAE2',
          'dark-bg': '#0B141A',
          panel: '#F0F2F5',
          'dark-panel': '#202C33',
        },
      },
    },
  },
  plugins: [],
};

export default config;
