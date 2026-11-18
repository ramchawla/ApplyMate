"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

// ponytail: no "Resumes" item until a /resumes index page exists (only /resumes/[id] does).
const links = [
  ["/applications", "Applications"],
  ["/jd-archive", "JD archive"],
  ["/analytics", "Analytics"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="sticky top-0 z-10 flex items-center gap-1 h-12 px-6 border-b border-border bg-surface">
      <Link href="/applications" className="inline-flex items-center gap-2 mr-5 font-semibold tracking-[-0.01em]">
        <span className="w-[22px] h-[22px] rounded-ctl grid place-items-center bg-accent text-accent-fg">
          <Icon name="zap" className="w-3 h-3" />
        </span>
        ApplyMate
      </Link>
      {links.map(([href, name]) => (
        <Link
          key={href}
          href={href}
          aria-current={path?.startsWith(href) ? "page" : undefined}
          className="px-2.5 py-1.5 rounded-ctl text-small font-medium text-text-2 hover:bg-surface-2 hover:text-text aria-[current=page]:bg-surface-2 aria-[current=page]:text-text"
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}
