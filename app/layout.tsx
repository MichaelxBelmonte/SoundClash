import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Hanken_Grotesk, JetBrains_Mono, Anton, Permanent_Marker } from "next/font/google";
import AudioDirector from "@/components/audio/AudioDirector";

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Monospace for numbers, timers, scores and code-like labels — the "tech" register.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

// Condensed poster face for mixtape-style headlines.
const condensed = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-condensed",
  display: "swap",
});

// Handwritten marker for J-card scribbles + tape-label notes.
const marker = Permanent_Marker({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-marker",
  display: "swap",
});

const description =
  "The music party game where friends clash on the same track. Powered by live Musixmatch lyrics.";

export const metadata: Metadata = {
  metadataBase: new URL("https://soundclash-production-9c06.up.railway.app"),
  title: "Soundclash",
  description,
  applicationName: "Soundclash",
  appleWebApp: {
    capable: true,
    title: "Soundclash",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Soundclash",
    description,
    siteName: "Soundclash",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Soundclash" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Soundclash",
    description,
    images: ["/og.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#F4ECD8",
  width: "device-width",
  initialScale: 1,
  // Draw under the notch/home-indicator so env(safe-area-inset-*) becomes active.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${condensed.variable} ${marker.variable}`}
    >
      <body className="min-h-[100dvh] bg-paper font-sans text-ink antialiased">
        {children}
        <AudioDirector />
      </body>
    </html>
  );
}
