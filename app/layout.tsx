import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ForgeSight CAD Intelligence",
  description: "Upload CAD files and preview supported geometry in 3D."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
