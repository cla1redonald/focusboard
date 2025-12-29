import React from "react";
import type { ThemeMode } from "./types";

/**
 * Hook that applies the theme class to the document root element.
 * Handles light, dark, and system preference modes.
 */
export function useTheme(themeMode: ThemeMode): void {
  React.useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    };

    if (themeMode === "system") {
      // Use system preference
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      // Listen for system preference changes
      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches);
      };
      mediaQuery.addEventListener("change", handler);

      return () => {
        mediaQuery.removeEventListener("change", handler);
      };
    } else {
      // Use explicit theme setting
      applyTheme(themeMode === "dark");
    }
  }, [themeMode]);
}

/**
 * Get the resolved theme (light or dark) based on the theme mode.
 * Useful for components that need to know the actual applied theme.
 */
export function getResolvedTheme(themeMode: ThemeMode): "light" | "dark" {
  if (themeMode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return themeMode;
}
