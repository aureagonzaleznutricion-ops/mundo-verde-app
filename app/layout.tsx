import type { Metadata } from "next";
import { Lora, Raleway } from "next/font/google";
import "./globals.css";

const lora = Lora({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-lora" });
const raleway = Raleway({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-raleway" });

export const metadata: Metadata = {
  title: "Mundo Verde · Reserva de fruta y verdura ecológica",
  description: "Reserva tu fruta y verdura ecológica y recógela en Mundo Verde, Rúa Peregrina 54, Pontevedra.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${lora.variable} ${raleway.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
