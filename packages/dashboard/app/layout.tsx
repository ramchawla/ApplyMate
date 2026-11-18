import "./globals.css";
import { Nav } from "../components/Nav";

export const metadata = { title: "ApplyMate Dashboard" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="max-w-[1240px] mx-auto px-6 pt-6 pb-16">{children}</main>
      </body>
    </html>
  );
}
