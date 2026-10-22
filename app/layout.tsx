import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CIVITAS Marketplace",
  description:
    "Installierbare Use-Case-Pakete und Datenstrukturen für diese CIVITAS/CORE-Instanz.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Server default; the inline script below overwrites both before paint.
      data-theme="system"
      // Required: the theme script mutates class and data-theme on this element
      // before React hydrates. Without it React treats the difference as a
      // hydration error and client-renders the subtree, which loses the
      // correction and flashes.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
