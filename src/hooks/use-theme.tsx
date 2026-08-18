import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * App-wide light/dark theme state.
 *
 * This used to be a plain hook with per-component useState, which meant every
 * caller owned its own copy of the theme: two mounted components could
 * disagree, fight over the <html> class list during transitions, and a toggle
 * from one place could be silently undone by another. It is now a single
 * context mounted once in main.tsx; `useTheme()` keeps the same return shape
 * ({ theme, toggleTheme }) so call sites did not change.
 *
 * The theme is persisted to localStorage and synced across tabs via the
 * `storage` event. Dark is the default.
 */

type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "thalamus_theme";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
});

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in private-browsing modes; fall through to default.
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // Reflect the theme onto <html> so Tailwind's `.light` overrides apply.
  // During a toggle we briefly add `theme-transition` so the CSS cross-fade in
  // index.css plays, then remove it so normal interactions aren't slowed by a
  // blanket transition.
  useEffect(() => {
    const root = document.documentElement;
    const isToggling = root.classList.contains("theme-transition");
    root.classList.toggle("light", theme === "light");
    root.classList.toggle("dark", theme === "dark");
    if (!isToggling) root.classList.add("theme-transition");
    const t = setTimeout(() => root.classList.remove("theme-transition"), 400);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Non-fatal: the theme just won't persist.
    }
    return () => clearTimeout(t);
  }, [theme]);

  // Keep multiple tabs in agreement: a toggle in one tab updates the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY && (e.newValue === "light" || e.newValue === "dark")) {
        setTheme(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider and hook belong together; HMR is disabled repo-wide (vite server.hmr: false)
export function useTheme() {
  return useContext(ThemeContext);
}
