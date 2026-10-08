import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chainmail",
  description: "Messages people write inside Ethereum transactions, as they land onchain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <div className="page">
          <header className="masthead">
            <Link href="/" className="wordmark">
              Chainmail
            </Link>
            <p className="tagline">Messages people write inside Ethereum transactions, as they land.</p>
            <form action="/search" method="get" className="search" role="search">
              <label htmlFor="q" className="visually-hidden">
                Search messages, names or addresses
              </label>
              <input id="q" name="q" type="search" placeholder="Search messages, names or addresses" autoComplete="off" />
            </form>
          </header>
          {children}
          <footer className="colophon">
            <p>
              Every message here was written into the input data of a public Ethereum transaction. Spam and
              inscriptions are filtered out automatically, and some messages are hidden by hand.
            </p>
          </footer>
        </div>
      </body>
    </html>
  );
}
