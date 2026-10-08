import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

/*
 * Three families, three jobs — see docs/DESIGN.md. All three are variable
 * fonts, so no weight list is needed; next/font self-hosts them, which is why
 * the mockups' Google CDN <link> has no equivalent here.
 *
 * The variable names below are the ones globals.css points `--font-sans`,
 * `--font-display` and `--font-mono` at. They must never point at themselves:
 * `--font-sans: var(--font-sans)` is what shipped the whole app in Times at E1,
 * and an invalid declaration fails silently.
 */
const display = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
});

const sans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
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
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
