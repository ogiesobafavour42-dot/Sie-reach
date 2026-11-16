import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import SwRegister from "@/components/SwRegister";

export const metadata: Metadata = {
  title: "SiteReach",
  description: "Automated website sales for local businesses",
  applicationName: "SiteReach",
  appleWebApp: { capable: true, title: "SiteReach", statusBarStyle: "black-translucent" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#14213d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-ivory text-navy antialiased">
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
