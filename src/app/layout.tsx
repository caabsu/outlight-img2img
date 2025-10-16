import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Outlight — Image Generator (MVP)",
  description: "Internal image-to-image MVP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
