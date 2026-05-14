"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { verifySession, logout, FmgInstance } from "@/lib/api";

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [username, setUsername] = useState<string>("");
  const [activeInstance, setActiveInstance] = useState<FmgInstance | null>(null);
  const [instances, setInstances] = useState<FmgInstance[]>([]);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    const redirectToLogin = () => {
      window.location.replace("/login");
    };

    // Skip auth check on login page
    if (pathname === "/login") {
      setChecked(true);
      return;
    }

    setChecked(false);
    let cancelled = false;
    const token = localStorage.getItem("fmg_token");
    if (!token) {
      redirectToLogin();
      return;
    }

    verifySession()
      .then((result) => {
        if (cancelled) return;
        if (!result.valid) {
          localStorage.removeItem("fmg_token");
          localStorage.removeItem("fmg_user");
          redirectToLogin();
        } else {
          setUsername(result.username || localStorage.getItem("fmg_user") || "");
          setActiveInstance(result.activeInstance || null);
          setInstances(result.instances || []);
          setNeedsSetup(result.needsSetup || false);
          setChecked(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem("fmg_token");
        localStorage.removeItem("fmg_user");
        redirectToLogin();
      });

    return () => {
      cancelled = true;
    };
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
    <AuthContext.Provider
      value={{
        username,
        activeInstance,
        instances,
        needsSetup,
        setActiveInstance,
        setInstances,
        setNeedsSetup,
        logout: handleLogout,
      }}
    >
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
  activeInstance: FmgInstance | null;
  instances: FmgInstance[];
  needsSetup: boolean;
  setActiveInstance: (inst: FmgInstance | null) => void;
  setInstances: (insts: FmgInstance[]) => void;
  setNeedsSetup: (v: boolean) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  username: "",
  activeInstance: null,
  instances: [],
  needsSetup: false,
  setActiveInstance: () => {},
  setInstances: () => {},
  setNeedsSetup: () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}
