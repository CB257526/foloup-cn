"use client";

import Navbar from "@/components/navbar";
import Providers from "@/components/providers";
import SideMenu from "@/components/sideMenu";
import { cn } from "@/lib/utils";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return (
    <body className={cn(inter.className, "antialiased overflow-x-hidden min-h-screen")}>
      <Providers>
        <Navbar />
        <div className="flex flex-row h-screen">
          <SideMenu />
          <div className="ml-[72px] md:ml-[200px] pt-[64px] h-[calc(100vh-64px)] min-w-0 w-[calc(100%-72px)] md:w-[calc(100%-200px)] overflow-y-auto flex-grow">
            {children}
          </div>
        </div>
        <Toaster
          toastOptions={{
            classNames: {
              toast: "bg-white",
              title: "text-black",
              description: "text-red-400",
              actionButton: "bg-indigo-400",
              cancelButton: "bg-orange-400",
              closeButton: "bg-white-400",
            },
          }}
        />
      </Providers>
    </body>
  );
}
