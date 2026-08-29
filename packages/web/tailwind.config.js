/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // The neon arc in the logo. Every accent in the app derives from here,
      // so retuning the brand is a one-line change.
      colors: {
        // Three grounds, not one: the page sits behind the panel, which sits
        // behind the cards. Same greys as the mockups, biased blue like the logo.
        // Exactly the mockup's grounds: page behind panel behind card.
        // Edges are white-alpha hairlines, not these — see border-white/[0.07].
        ink: {
          950: "#0b0e15", // page
          900: "#0f131c", // panel
          800: "#171b26", // card, tile
          700: "#1f2431", // icon tile inside a card
        },
        brand: {
          200: "#fecdd3",
          300: "#fda4af",
          400: "#fb7185",
          500: "#f43f5e",
          600: "#e11d48",
          700: "#be123c",
          800: "#9f1239",
          900: "#881337",
        },
      },
    },
  },
  plugins: [],
};
