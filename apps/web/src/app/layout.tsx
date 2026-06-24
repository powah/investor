import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Small-Cap Catalyst Dashboard",
  description: "Local decision-support dashboard for small-cap catalyst momentum trading.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
