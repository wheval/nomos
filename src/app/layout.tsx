import type { Metadata } from 'next'
import { Funnel_Display, Funnel_Sans, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

// Ferro-derived type system: Funnel Display for headings, Funnel Sans for
// everything else, IBM Plex Mono for hex addresses / hashes / code.
const funnelSans = Funnel_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})
const funnelDisplay = Funnel_Display({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-display',
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
      className={`${funnelSans.variable} ${funnelDisplay.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  )
}
