import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Groundtruth — agent-assisted rapid damage assessment",
  description:
    "You read the imagery. Your agent reads everything else. A WebMCP post-disaster damage assessment console over real NOAA storm-day imagery of Fort Myers Beach after Hurricane Ian.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
