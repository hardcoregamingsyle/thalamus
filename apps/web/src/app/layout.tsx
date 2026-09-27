import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://thalamus.aphantic.skinticals.com"),
  title: { default: "Thalamus", template: "%s — Thalamus" },
  description:
    "Thalamus Sophon is a model built on a non-transformer architecture, served through an OpenAI-compatible API, a developer console and a chat app.",
  openGraph: { title: "Thalamus", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark light",
};

// Applies the saved theme before first paint so there is no flash of the wrong one.
const themeScript = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <Script id="theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        {children}
      </body>
    </html>
  );
}
