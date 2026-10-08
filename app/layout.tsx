import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mail.7mit",
  description: "A private mail workspace for your custom IMAP and SMTP accounts.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
