import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://nameless.is"),
  title: { default: "NAMELESS", template: "%s — NAMELESS" },
  description:
    "NAMELESS is an AI model training on our own architecture. Create an account to join the waitlist for early access.",
  openGraph: { title: "NAMELESS", type: "website", url: "/" },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark light",
};

// Applies the saved theme before first paint so there is no flash of the wrong one.
const themeScript = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
