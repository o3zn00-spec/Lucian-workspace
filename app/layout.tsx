import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { Toaster as ShadcnToaster } from "@/components/ui-devspace/toaster";
import { Toaster as SonnerToaster } from "sonner";
import {
  ACCENT_IDS,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  LEGACY_ACCENT_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_IDS,
  THEME_STORAGE_KEY,
} from "@/lib/themes";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lucian — Workspace",
  description:
    "Lucian Workspace — a clean, themeable workspace foundation with markets, vault, development tools, and more.",
  applicationName: "Lucian Workspace",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
      { url: "/branding/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon.png", sizes: "192x192", type: "image/png" },
      { url: "/icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lucian",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1013" },
    { media: "(prefers-color-scheme: light)", color: "#f6f8fa" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Inline bootstrap script — runs synchronously before paint so the user's
 * persisted theme/accent is applied to <html> without a flash of the default.
 *
 * It also transparently migrates the legacy `lucid-*` localStorage keys
 * (from the previous build) to the new `lucian-*` keys.
 */
const bootstrapScript = `
(function () {
  try {
    var themes = ${JSON.stringify(THEME_IDS)};
    var accents = ${JSON.stringify(ACCENT_IDS)};
    var themeKey = ${JSON.stringify(THEME_STORAGE_KEY)};
    var accentKey = ${JSON.stringify(ACCENT_STORAGE_KEY)};
    var legacyThemeKey = ${JSON.stringify(LEGACY_THEME_STORAGE_KEY)};
    var legacyAccentKey = ${JSON.stringify(LEGACY_ACCENT_STORAGE_KEY)};

    var t = localStorage.getItem(themeKey);
    if (!t && localStorage.getItem(legacyThemeKey)) {
      t = localStorage.getItem(legacyThemeKey);
      if (t) {
        localStorage.setItem(themeKey, t);
        localStorage.removeItem(legacyThemeKey);
      }
    }
    var a = localStorage.getItem(accentKey);
    if (!a && localStorage.getItem(legacyAccentKey)) {
      a = localStorage.getItem(legacyAccentKey);
      if (a) {
        localStorage.setItem(accentKey, a);
        localStorage.removeItem(legacyAccentKey);
      }
    }

    document.documentElement.dataset.theme =
      themes.indexOf(t) >= 0 ? t : ${JSON.stringify(DEFAULT_THEME)};
    document.documentElement.dataset.accent =
      accents.indexOf(a) >= 0 ? a : ${JSON.stringify(DEFAULT_ACCENT)};
  } catch (e) {
    document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
    document.documentElement.dataset.accent = ${JSON.stringify(DEFAULT_ACCENT)};
  }
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      data-accent={DEFAULT_ACCENT}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Lucian" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          {children}
          {/* Toast providers — DevSpace components use both shadcn's useToast
              hook and the sonner library directly, so both toasters must be
              mounted at the root. They don't conflict — each renders its own
              viewport. */}
          <ShadcnToaster />
          <SonnerToaster
            position="bottom-right"
            toastOptions={{
              // Use LUCIAN CSS variables for theming — sonner respects
              // these via inline styles.
              style: {
                background: "var(--surface)",
                color: "var(--fg)",
                border: "1px solid var(--line)",
              },
            }}
          />
        </ThemeProvider>
        {/* Service worker registration — only in production to avoid
            caching issues during development. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator && '${process.env.NODE_ENV}' === 'production') {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
