import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  // E1: the create-next-app default survived to C8's fresh-clone pass, which is
  // the first thing a reviewer reads — in the tab, before the page renders.
  title: {
    default: "Feature Intelligence — Ledgerline",
    template: "%s · Feature Intelligence",
  },
  description:
    "Groups feature requests by the problem underneath them, not by their wording, and ranks the problems with a decomposition a PM can argue with.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
