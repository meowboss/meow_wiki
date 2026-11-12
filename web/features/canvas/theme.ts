import type { CSSProperties } from 'react';
import type { CanvasTheme } from '../../../packages/canvas-contract/index';

/** UI/render fallbacks only; never inserted into a stored composition implicitly. */
export const DEFAULT_CANVAS_THEME = {
  foreground: '#334155',
  accent: '#2563eb',
  font: 'sans',
  fontSize: 16,
  lineHeight: 1.7,
} as const satisfies Required<CanvasTheme>;

export const CANVAS_THEME_PRESETS = {
  light: { background: '#ffffff', theme: { ...DEFAULT_CANVAS_THEME } },
  dark: {
    background: '#172033',
    theme: { ...DEFAULT_CANVAS_THEME, foreground: '#e2e8f0', accent: '#93c5fd' },
  },
} satisfies Record<string, { background: string; theme: Required<CanvasTheme> }>;

const FONT_FAMILIES = {
  sans: 'system-ui, sans-serif',
  serif: 'Georgia, "Noto Serif SC", serif',
  mono: 'ui-monospace, monospace',
} as const;

export function canvasThemeStyle(theme: CanvasTheme | undefined): CSSProperties {
  if (theme === undefined) return {};
  const resolved = { ...DEFAULT_CANVAS_THEME, ...theme };
  return {
    '--canvas-foreground': resolved.foreground,
    '--canvas-accent': resolved.accent,
    '--canvas-font-family': FONT_FAMILIES[resolved.font],
    '--canvas-font-size': `${resolved.fontSize}px`,
    '--canvas-line-height': resolved.lineHeight,
  } as CSSProperties;
}

/** Legacy backgrounds accept short/alpha hex. Ignore alpha, never parse arbitrary CSS. */
function luminance(hex: string): number | undefined {
  if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return undefined;
  const raw = hex.slice(1);
  const rgb =
    raw.length <= 4
      ? raw
          .slice(0, 3)
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : raw.slice(0, 6);
  const channels = [0, 2, 4].map((offset) => {
    const value = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

export function canvasContrastRatio(foreground: string, background: string): number | undefined {
  const a = luminance(foreground);
  const b = luminance(background);
  if (a === undefined || b === undefined) return undefined;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
