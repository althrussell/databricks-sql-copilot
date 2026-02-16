import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { LayoutDashboard, HeartPulse, Monitor } from "lucide-react";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
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
  icons: {
    icon: "/databricks-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased min-h-screen bg-background`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          {/* ── Header — L1 surface on L0 canvas ── */}
          <header className="sticky top-0 z-40 bg-card border-b border-border shadow-sm">
            <div className="flex h-14 items-center px-6">
              <Link
                href="/"
                className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
              >
                <Image
                  src="/databricks-icon.svg"
                  alt="Databricks"
                  width={26}
                  height={26}
                  className="shrink-0"
                  priority
                />
                <span className="text-lg font-bold tracking-tight text-foreground">
                  DBSQL Co-Pilot
                </span>
              </Link>
              <span className="ml-3 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Performance Advisor
              </span>

              {/* Nav links */}
              <nav className="ml-auto flex items-center gap-1">
                <Link
                  href="/"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </Link>
                <Link
                  href="/warehouse-health"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <HeartPulse className="h-3.5 w-3.5" />
                  Warehouse Health
                </Link>
                <Link
                  href="/warehouse-monitor"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <Monitor className="h-3.5 w-3.5" />
                  Warehouse Monitor
                </Link>
                <div className="h-5 w-px bg-border mx-1" />
                <ThemeToggle />
              </nav>
            </div>
          </header>

          {/* ── Main content — L0 canvas ── */}
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
