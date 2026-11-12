
import { Suspense } from "react";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Navbar, NavbarFallback } from "@/components/shared/Navbar";
import { DemoBanner } from "@/components/shared/DemoBanner";
import { Footer } from "@/components/shared/Footer";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: {
    default: "Brokerage AI — AI-assisted peer-to-peer deals (demo)",
    template: "%s · Brokerage AI",
  },
  description:
    "A frontend demo of Brokerage AI: AI agents help buyers and sellers negotiate structured deals. Sample data only; no real payments are processed.",
  verification: {
    google: "mioFZQSqhQik8ZlBaCq4Xb8d0X0CUMb4jrJBDYyOxac",
  },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        <Suspense fallback={<NavbarFallback />}>
          <Navbar />
        </Suspense>

        <DemoBanner />

        <main id="main" className="flex-1">
          {children}
        </main>

        <Footer />
      </body>
    </html>
  );
}
