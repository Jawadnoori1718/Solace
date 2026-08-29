import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

/**
 * Two typefaces, each doing one job.
 *
 * Source Serif carries the figures and headings, because a serif reads as a
 * public document rather than a dashboard. Inter carries everything else, where
 * clarity at small sizes matters more than character.
 *
 * Both are downloaded at build time and self-hosted, so the running application
 * never reaches out to a font service — which matters for a demonstration that
 * has to work without the internet.
 */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Solace — fuel poverty accountability",
  description:
    "Surplus rooftop solar routed to households in need, settled on a public ledger, and reported back to councillors in plain English.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-GB"
      className={`${sourceSerif.variable} ${inter.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-paper text-ink">
        {children}
      </body>
    </html>
  );
}
