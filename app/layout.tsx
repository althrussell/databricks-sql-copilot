import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DBSQL Co-Pilot",
  description: "Databricks SQL performance advisor",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen bg-background`}
      >
        {/* ── Header — L1 surface on L0 canvas ── */}
        <header className="sticky top-0 z-40 bg-card border-b border-border shadow-sm">
          <div className="container mx-auto flex h-14 items-center px-6">
            <Link
              href="/"
              className="text-lg font-bold tracking-tight text-foreground hover:text-primary transition-colors"
            >
              DBSQL Co-Pilot
            </Link>
            <span className="ml-3 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              Performance Advisor
            </span>
          </div>
        </header>

        {/* ── Main content — L0 canvas ── */}
        <main className="container mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
