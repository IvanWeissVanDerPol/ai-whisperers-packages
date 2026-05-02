/**
 * Shared CSS animation keyframes and Tailwind-compatible animation config.
 * Drop these into your tailwind.config theme.extend or @theme block.
 */
export const animationKeyframes = {
  shimmer: {
    "0%": { transform: "translateX(-100%)" },
    "100%": { transform: "translateX(100%)" },
  },
  "fade-in": {
    "0%": { opacity: "0" },
    "100%": { opacity: "1" },
  },
  "fade-up": {
    "0%": { opacity: "0", transform: "translateY(30px)" },
    "100%": { opacity: "1", transform: "translateY(0)" },
  },
  "slide-up": {
    "0%": { opacity: "0", transform: "translateY(20px)" },
    "100%": { opacity: "1", transform: "translateY(0)" },
  },
  "scale-in": {
    "0%": { opacity: "0", transform: "scale(0.9)" },
    "100%": { opacity: "1", transform: "scale(1)" },
  },
  "bounce-in": {
    "0%": { transform: "scale(0.3)", opacity: "0" },
    "50%": { transform: "scale(1.05)" },
    "70%": { transform: "scale(0.9)" },
    "100%": { transform: "scale(1)", opacity: "1" },
  },
};

export const animationConfig = {
  shimmer: "shimmer 2s infinite",
  "fade-in": "fade-in 0.5s ease-out",
  "fade-up": "fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
  "slide-up": "slide-up 0.6s ease-out",
  "scale-in": "scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
  "bounce-in": "bounce-in 0.6s ease-out",
};
