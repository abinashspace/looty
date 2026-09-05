/**
 * The app's colours, in light and dark. Everything reads these through
 * `useTheme()`, which follows the device's system setting — there is no in-app
 * switcher, so both tables have to stand on their own.
 *
 * The violet palette was set by the owner on 2026-09-05. Light is the palette as
 * given; dark is derived from the same hues, because leaving it on the old blue
 * would have shipped two different products to two users of the same phone.
 *
 * Note on `accent`: it is the one interactive colour — buttons, links, the active
 * tab, unread dots, and your own chat bubbles. Light uses Primary (#7C3AED);
 * dark uses Bright Purple (#A855F7), which is legible on a dark ground where the
 * deeper violet is not. `accentText` is what sits *on* accent, so it flips: white
 * on light, near-black on dark.
 *
 * Keep this away from pink and red. Looty is a friends app and the palette is
 * part of carrying that — see CONTEXT.md §1. Violet is fine; rose is not.
 *
 * Two colours from the owner's palette are not tokens here:
 *
 * - **Primary Dark #5B21B6** is a pressed/active state, and no button in the app
 *   implements one. Adding the token without the states would be dead weight; it
 *   is recorded here so the value is not lost.
 * - **Online #22C55E** is below, but nothing reads it yet — Looty has no presence
 *   feature and CONTEXT.md §7 settles "no last-seen". It is reserved, not
 *   forgotten. If it ever lands on the light background it needs darkening to
 *   about #1CA44E; as given it measures 2.16:1 there.
 *
 * `backgroundSelected` was removed on 2026-09-05: a starter-template leftover with
 * zero uses and no design intent behind it.
 */

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1E1B2E',
    background: '#FAF8FF',
    backgroundElement: '#FFFFFF',
    bubble: '#EDE9FE',
    // Muted Purple as given (#7C748F) measures 4.20:1 on this background — under
    // the 4.5 body-text bar, and this is the most-used token in the app.
    // Darkened just enough to pass; visually the same colour.
    textSecondary: '#776F8A',
    border: '#E9E3F5',
    accent: '#7C3AED',
    accentText: '#FFFFFF',
    danger: '#C4342B',
    online: '#22C55E',
  },
  dark: {
    text: '#F5F3FF',
    background: '#100D18',
    backgroundElement: '#1B1726',
    bubble: '#2A2140',
    textSecondary: '#A79FBC',
    border: '#2E2842',
    accent: '#A855F7',
    accentText: '#1E1B2E',
    danger: '#F0776C',
    online: '#22C55E',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
