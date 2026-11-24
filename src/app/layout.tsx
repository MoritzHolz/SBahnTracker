import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { LoginGate } from "@/components/LoginGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "S-Bahn Stuttgart Live",
  description:
    "Geschätzte Live-Positionen der S-Bahn Stuttgart auf Basis von Echtzeit- und Fahrplandaten (NVBW EFA / MobiData BW).",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Android: Tastatur verkleinert die Seite, statt Eingabefelder zu verdecken
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
        <LoginGate>{children}</LoginGate>
      </body>
    </html>
  );
}
