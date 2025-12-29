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
      // Always explicitly add or remove the dark class
      if (isDark) {
        root.classList.remove("light");
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
        root.classList.add("light");
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
