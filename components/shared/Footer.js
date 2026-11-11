import Link from "next/link";
import { APP_NAME, NAV_LINKS } from "@/lib/config";

export function Footer() {
  return (
    <footer className="border-t border-border py-10 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 md:flex-row">
        <p>
          {APP_NAME} — built for the PayPal AI Hackathon. Frontend demo with
          sample data.
        </p>
        <nav
          aria-label="Footer"
          className="flex flex-wrap justify-center gap-5"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link href="/terms-and-conditions" className="hover:text-foreground">
            Terms &amp; Conditions
          </Link>
          <Link href="/privacy-policy" className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Log in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
