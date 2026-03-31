/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{html,js,svelte,ts}',
    './src/routes/**/*.{svelte,ts}'
  ],
  theme: {
    extend: {}
  },
  plugins: [],
  darkMode: 'class'  // Enables Flood-like dark mode toggle later
};
