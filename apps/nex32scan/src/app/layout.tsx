import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nex32scan.vercel.app';
const DESCRIPTION =
  'Explorer for the Nexus Architect knowledge chain on Polygon Amoy testnet: sealed blocks, answers, tamper-proof commitments and the Genesis tokenomics schedule.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'NEX32SCAN — Nexus Architect explorer', template: '%s · NEX32SCAN' },
  description: DESCRIPTION,
  applicationName: 'NEX32SCAN',
  alternates: {
    canonical: '/',
    languages: { en: '/en', th: '/th' },
  },
  openGraph: {
    type: 'website',
    siteName: 'NEX32SCAN',
    title: 'NEX32SCAN — Nexus Architect explorer',
    description: DESCRIPTION,
    url: SITE_URL,
  },
  icons: { icon: '/logo.png' },
  twitter: {
    card: 'summary',
    title: 'NEX32SCAN — Nexus Architect explorer',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAF6EC',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
