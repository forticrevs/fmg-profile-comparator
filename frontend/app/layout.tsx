import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthGuard from "@/components/AuthGuard";
import ChatWidget from "@/components/ChatWidget";
import { ChatContextProvider } from "@/components/ChatContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FortiManager Profile Comparator",
  description: "Compare FortiManager security profiles and SD-WAN templates side-by-side",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-slate-950 antialiased`}>
        <AuthGuard>
          <ChatContextProvider>
            {children}
            <ChatWidget />
          </ChatContextProvider>
        </AuthGuard>
      </body>
    </html>
  );
}
