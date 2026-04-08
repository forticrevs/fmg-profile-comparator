"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { verifySession, logout } from "@/lib/api";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState<string>("");

  useEffect(() => {
    // Skip auth check on login page
    if (pathname === "/login") {
      setChecked(true);
      return;
    }

    const token = localStorage.getItem("fmg_token");
    if (!token) {
      router.replace("/login");
      return;
    }

    verifySession().then(({ valid, username: user }) => {
      if (!valid) {
        localStorage.removeItem("fmg_token");
        localStorage.removeItem("fmg_user");
        localStorage.removeItem("fmg_host");
        router.replace("/login");
      } else {
        setUsername(user || localStorage.getItem("fmg_user") || "");
        setChecked(true);
      }
    });
  }, [pathname, router]);

  if (!checked && pathname !== "/login") {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-cyan-500 border-t-transparent" />
      </div>
    );
  }

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <AuthContext.Provider value={{ username, logout: handleLogout }}>
      {children}
    </AuthContext.Provider>
  );

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }
}

// Minimal context for child components to access user info
import { createContext, useContext } from "react";

interface AuthContextType {
  username: string;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  username: "",
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
