"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  animationConfig: () => animationConfig,
  animationKeyframes: () => animationKeyframes,
  paletteDarkNavy: () => paletteDarkNavy,
  paletteLawFirm: () => paletteLawFirm,
  paletteNavy: () => paletteNavy,
  paletteToCSS: () => paletteToCSS,
  paletteToTailwindColors: () => paletteToTailwindColors
});
module.exports = __toCommonJS(index_exports);

// src/animations.ts
var animationKeyframes = {
  shimmer: {
    "0%": { transform: "translateX(-100%)" },
    "100%": { transform: "translateX(100%)" }
  },
  "fade-in": {
    "0%": { opacity: "0" },
    "100%": { opacity: "1" }
  },
  "fade-up": {
    "0%": { opacity: "0", transform: "translateY(30px)" },
    "100%": { opacity: "1", transform: "translateY(0)" }
  },
  "slide-up": {
    "0%": { opacity: "0", transform: "translateY(20px)" },
    "100%": { opacity: "1", transform: "translateY(0)" }
  },
  "scale-in": {
    "0%": { opacity: "0", transform: "scale(0.9)" },
    "100%": { opacity: "1", transform: "scale(1)" }
  },
  "bounce-in": {
    "0%": { transform: "scale(0.3)", opacity: "0" },
    "50%": { transform: "scale(1.05)" },
    "70%": { transform: "scale(0.9)" },
    "100%": { transform: "scale(1)", opacity: "1" }
  }
};
var animationConfig = {
  shimmer: "shimmer 2s infinite",
  "fade-in": "fade-in 0.5s ease-out",
  "fade-up": "fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards",
  "slide-up": "slide-up 0.6s ease-out",
  "scale-in": "scale-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
  "bounce-in": "bounce-in 0.6s ease-out"
};

// src/colors.ts
var paletteNavy = {
  primary: "#1e3a5f",
  "primary-foreground": "#ffffff",
  "primary-light": "#2d5a8e",
  secondary: "#475569",
  "secondary-foreground": "#ffffff",
  accent: "#c9753e",
  "accent-foreground": "#ffffff",
  "accent-light": "#e8996a",
  background: "#fafafa",
  foreground: "#1a1a2e",
  surface: "#ffffff",
  muted: "#f1f5f9",
  "muted-foreground": "#64748b",
  card: "#ffffff",
  "card-foreground": "#1a1a2e",
  border: "#e2e8f0",
  ring: "#1e3a5f",
  destructive: "#ef4444",
  success: "#4a7c59",
  warning: "#d97706"
};
var paletteDarkNavy = {
  primary: "#94abd6",
  "primary-foreground": "#0a0a14",
  "primary-light": "#b0c4e8",
  secondary: "#64748b",
  "secondary-foreground": "#ffffff",
  accent: "#d43d5e",
  "accent-foreground": "#ffffff",
  "accent-light": "#e86a84",
  background: "#0a0a14",
  foreground: "#e8e3da",
  surface: "#12121e",
  muted: "#1a1a2e",
  "muted-foreground": "#94a3b8",
  card: "#12121e",
  "card-foreground": "#e8e3da",
  border: "#1e293b",
  ring: "#94abd6",
  destructive: "#ef4444",
  success: "#4a7c59",
  warning: "#d97706"
};
var paletteLawFirm = {
  primary: "#1B2A4A",
  "primary-foreground": "#ffffff",
  "primary-light": "#2d4070",
  secondary: "#4B5563",
  "secondary-foreground": "#ffffff",
  accent: "#C9A96E",
  "accent-foreground": "#1B2A4A",
  "accent-light": "#d4b888",
  background: "#faf8f5",
  foreground: "#1a1a2e",
  surface: "#ffffff",
  muted: "#f0ede6",
  "muted-foreground": "#6B7280",
  card: "#ffffff",
  "card-foreground": "#1a1a2e",
  border: "#E8E3DA",
  ring: "#1B2A4A",
  destructive: "#ef4444",
  success: "#4a7c59",
  warning: "#d97706"
};
function paletteToCSS(palette, prefix = "") {
  return Object.entries(palette).map(([key, value]) => `  --${prefix}${key.replace(/_/g, "-")}: ${value};`).join("\n");
}
function paletteToTailwindColors(palette) {
  return {
    primary: {
      DEFAULT: palette.primary,
      foreground: palette["primary-foreground"],
      light: palette["primary-light"]
    },
    secondary: {
      DEFAULT: palette.secondary,
      foreground: palette["secondary-foreground"]
    },
    accent: {
      DEFAULT: palette.accent,
      foreground: palette["accent-foreground"],
      light: palette["accent-light"]
    },
    background: palette.background,
    foreground: palette.foreground,
    surface: palette.surface,
    muted: {
      DEFAULT: palette.muted,
      foreground: palette["muted-foreground"]
    },
    card: {
      DEFAULT: palette.card,
      foreground: palette["card-foreground"]
    },
    border: palette.border,
    ring: palette.ring,
    destructive: {
      DEFAULT: palette.destructive,
      foreground: "#ffffff"
    },
    success: palette.success,
    warning: palette.warning
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  animationConfig,
  animationKeyframes,
  paletteDarkNavy,
  paletteLawFirm,
  paletteNavy,
  paletteToCSS,
  paletteToTailwindColors
});
