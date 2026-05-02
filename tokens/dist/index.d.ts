/**
 * Shared CSS animation keyframes and Tailwind-compatible animation config.
 * Drop these into your tailwind.config theme.extend or @theme block.
 */
declare const animationKeyframes: {
    shimmer: {
        "0%": {
            transform: string;
        };
        "100%": {
            transform: string;
        };
    };
    "fade-in": {
        "0%": {
            opacity: string;
        };
        "100%": {
            opacity: string;
        };
    };
    "fade-up": {
        "0%": {
            opacity: string;
            transform: string;
        };
        "100%": {
            opacity: string;
            transform: string;
        };
    };
    "slide-up": {
        "0%": {
            opacity: string;
            transform: string;
        };
        "100%": {
            opacity: string;
            transform: string;
        };
    };
    "scale-in": {
        "0%": {
            opacity: string;
            transform: string;
        };
        "100%": {
            opacity: string;
            transform: string;
        };
    };
    "bounce-in": {
        "0%": {
            transform: string;
            opacity: string;
        };
        "50%": {
            transform: string;
        };
        "70%": {
            transform: string;
        };
        "100%": {
            transform: string;
            opacity: string;
        };
    };
};
declare const animationConfig: {
    shimmer: string;
    "fade-in": string;
    "fade-up": string;
    "slide-up": string;
    "scale-in": string;
    "bounce-in": string;
};

/**
 * Default color palettes for AI Whisperers projects.
 * Each palette provides CSS custom properties and a Tailwind-compatible color map.
 *
 * Usage:
 *   :root { @include palette-navy(); }
 *   or pick individual colors for custom branding.
 */
interface ColorPalette {
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
declare const paletteNavy: ColorPalette;
declare const paletteDarkNavy: ColorPalette;
declare const paletteLawFirm: ColorPalette;
/**
 * Convert a ColorPalette to CSS custom properties string.
 */
declare function paletteToCSS(palette: ColorPalette, prefix?: string): string;
/**
 * Convert a ColorPalette to a Tailwind v3 config colors object.
 */
declare function paletteToTailwindColors(palette: ColorPalette): Record<string, string | Record<string, string>>;

export { type ColorPalette, animationConfig, animationKeyframes, paletteDarkNavy, paletteLawFirm, paletteNavy, paletteToCSS, paletteToTailwindColors };
