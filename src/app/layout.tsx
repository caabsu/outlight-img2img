import "./globals.css";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { ThemeProvider } from "@/components/theme-provider";

export const metadata: Metadata = {
  title: "Outlight Studio",
  description: "Scalable image + video generation workspace for creative teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-50">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <main className="min-h-[calc(100vh-4rem)]">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
