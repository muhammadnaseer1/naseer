import type { Metadata } from "next";
import "./globals.css";
const url = process.env.APP_URL || "http://localhost:3000";
export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: "FlashMail — A little privacy. A fresh inbox.",
  description:
    "Your free temporary inbox. Generate a disposable email address in seconds, keep your personal inbox private, and receive email without signing up.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "FlashMail — Your inbox, on your terms.",
    description: "Private, disposable email. No account required.",
    type: "website",
  },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
