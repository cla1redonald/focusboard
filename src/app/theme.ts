import React from "react";
import type { ThemeMode } from "./types";

/**
 * Applies the theme class to the document based on the theme mode.
 * - "light": removes .dark class, adds .light class
 * - "dark": adds .dark class, removes .light class
 * - "system": follows the system preference
 */
export function useTheme(theme: ThemeMode) {
  React.useEffect(() => {
    const root = document.documentElement;

    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        root.classList.remove("light");
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
        root.classList.add("light");
      }
    };

    if (theme === "dark") {
      applyTheme(true);
    } else if (theme === "light") {
      applyTheme(false);
    } else {
      // System preference
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyTheme(mediaQuery.matches);

      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener("change", handler);
      return () => mediaQuery.removeEventListener("change", handler);
    }
  }, [theme]);
}
