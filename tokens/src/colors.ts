/**
 * Default color palettes for AI Whisperers projects.
 * Each palette provides CSS custom properties and a Tailwind-compatible color map.
 *
 * Usage:
 *   :root { @include palette-navy(); }
 *   or pick individual colors for custom branding.
 */

export interface ColorPalette {
  primary: string;
  "primary-foreground": string;
  "primary-light": string;
  secondary: string;
  "secondary-foreground": string;
  accent: string;
  "accent-foreground": string;
  "accent-light": string;
  background: string;
  foreground: string;
  surface: string;
  muted: string;
  "muted-foreground": string;
  card: string;
  "card-foreground": string;
  border: string;
  ring: string;
  destructive: string;
  success: string;
  warning: string;
}

export const paletteNavy: ColorPalette = {
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
  warning: "#d97706",
};

export const paletteDarkNavy: ColorPalette = {
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
  warning: "#d97706",
};

export const paletteLawFirm: ColorPalette = {
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
  warning: "#d97706",
};

/**
 * Convert a ColorPalette to CSS custom properties string.
 */
export function paletteToCSS(palette: ColorPalette, prefix = ""): string {
  return Object.entries(palette)
    .map(([key, value]) => `  --${prefix}${key.replace(/_/g, "-")}: ${value};`)
    .join("\n");
}

/**
 * Convert a ColorPalette to a Tailwind v3 config colors object.
 */
export function paletteToTailwindColors(palette: ColorPalette): Record<string, string | Record<string, string>> {
  return {
    primary: {
      DEFAULT: palette.primary,
      foreground: palette["primary-foreground"],
      light: palette["primary-light"],
    },
    secondary: {
      DEFAULT: palette.secondary,
      foreground: palette["secondary-foreground"],
    },
    accent: {
      DEFAULT: palette.accent,
      foreground: palette["accent-foreground"],
      light: palette["accent-light"],
    },
    background: palette.background,
    foreground: palette.foreground,
    surface: palette.surface,
    muted: {
      DEFAULT: palette.muted,
      foreground: palette["muted-foreground"],
    },
    card: {
      DEFAULT: palette.card,
      foreground: palette["card-foreground"],
    },
    border: palette.border,
    ring: palette.ring,
    destructive: {
      DEFAULT: palette.destructive,
      foreground: "#ffffff",
    },
    success: palette.success,
    warning: palette.warning,
  };
}
