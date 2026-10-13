import type { Metadata, Viewport } from "next"
import { JetBrains_Mono, Vazirmatn } from "next/font/google"
import "./globals.css"

const vazir = Vazirmatn({ subsets: ["arabic", "latin"], variable: "--font-vazir" })
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" })

export const metadata: Metadata = {
  title: "ASiRi panel — پنل کنترل",
  description: "رابط وب برای اجرا و مدیریت تونل aether روی سرور (غیر رسمی)",
  manifest: "/manifest.json",
  icons: { icon: "/icon.png", apple: "/icon.png" },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#090b0e",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={`${vazir.variable} ${jetbrains.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
