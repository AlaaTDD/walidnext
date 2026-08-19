import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Web port of frontend/lib/main.dart's MaterialApp configuration:
 * title: 'Sheet Nesting', RTL Directionality wrapping the whole app,
 * Arabic UI throughout every screen.
 */
export const metadata: Metadata = {
  title: "وليد لترتيب الشيتات",
  description: "تطبيق وليد لترتيب وتجهيز صور الطباعة على الشيت بدقة هندسية كاملة.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
