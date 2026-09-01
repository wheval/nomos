import type { Metadata } from 'next'
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { cn } from "@/lib/utils";
import WalletSession from "./components/WalletSession";

// DM Sans throughout, at both body and display sizes — one typeface rather
// than a display/text pair, so headings and copy read as the same voice. It is
// a variable font, so the weight range costs nothing extra to load. IBM Plex
// Mono stays for hex addresses, hashes and code, where the distinction between
// 0/O and 1/l/I is functional rather than decorative.
//
// Tailwind's font-sans utility (used by shadcn/Aceternity components) is wired
// to DM Sans too - see globals.css's --font-sans mapping - so nothing
// introduces a second, competing typeface (shadcn init defaults to Geist).
// One instance, not two: --font-display is aliased to it in globals.css.
// Calling DM_Sans twice registers the family twice and puts it in the computed
// stack twice for no benefit.
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono-ui',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Nomos · Private payment gateway for Starknet',
  description: 'Accept payment via Payment Link, invoice, or embedded widget — shielded and settled through the STRK20 pool.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={cn(dmSans.variable, plexMono.variable, "font-sans")}
      suppressHydrationWarning
    >
      <body>
        <WalletSession />
        {children}
      </body>
    </html>
  )
}
