import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#FFFFFF", onSurface: "#0F172A", surfaceSecondary: "#F8FAFC", onSurfaceSecondary: "#0F172A",
  surfaceTertiary: "#EEF2F6", onSurfaceTertiary: "#334155", surfaceInverse: "#0F2D4A", onSurfaceInverse: "#FFFFFF",
  muted: "#64748B", brand: "#FFFFFF", onBrand: "#0F172A", brandPrimary: "#123B63", onBrandPrimary: "#FFFFFF",
  brandSecondary: "#0F2D4A", onBrandSecondary: "#FFFFFF", brandTertiary: "#E7EEF5", onBrandTertiary: "#0F2D4A",
  success: "#16A34A", onSuccess: "#FFFFFF", warning: "#CA8A04", onWarning: "#FFFFFF", error: "#DC2626", onError: "#FFFFFF",
  info: "#2563EB", onInfo: "#FFFFFF", border: "#CBD5E1", borderStrong: "#94A3B8", divider: "#E2E8F0",
} as const;

export type ThemeColors = typeof light;
export const defaultScheme = "light" satisfies ColorScheme;
export const themes: { light: ThemeColors; dark?: ThemeColors } = { light, dark: light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme() as ColorScheme | null;
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}