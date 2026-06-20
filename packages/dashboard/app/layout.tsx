import "./globals.css";
import Link from "next/link";

export const metadata = { title: "ApplyMate Dashboard" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <nav className="bg-white border-b px-4 py-3 flex gap-4 text-sm font-medium">
          <Link href="/applications">Applications</Link>
          <Link href="/jd-archive">JD Archive</Link>
          <Link href="/analytics">Analytics</Link>
        </nav>
        <main className="max-w-4xl mx-auto p-4">{children}</main>
      </body>
    </html>
  );
}
