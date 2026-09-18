import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#121212", onSurface: "#F8FAFC", surfaceSecondary: "#1E1E1E", onSurfaceSecondary: "#FFFFFF",
  surfaceTertiary: "#2A2A2A", onSurfaceTertiary: "#E2E8F0", surfaceInverse: "#FFFFFF", onSurfaceInverse: "#121212",
  muted: "#94A3B8", brand: "#B91C1C", onBrand: "#FFFFFF", brandPrimary: "#DC2626", onBrandPrimary: "#FFFFFF",
  brandSecondary: "#991B1B", onBrandSecondary: "#FFFFFF", brandTertiary: "#7F1D1D", onBrandTertiary: "#FFFFFF",
  success: "#16A34A", onSuccess: "#FFFFFF", warning: "#CA8A04", onWarning: "#FFFFFF", error: "#DC2626", onError: "#FFFFFF",
  info: "#2563EB", onInfo: "#FFFFFF", border: "#27272A", borderStrong: "#3F3F46", divider: "#1E1E1E",
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