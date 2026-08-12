import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useRouter, useSegments } from "expo-router";
import { api, setAuthToken, User } from "./api";
import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "auth_token";

interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<{ message: string }>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    (async () => {
      const token = (await storage.secureGet(TOKEN_KEY, null)) as string | null;
      if (token) {
        setAuthToken(token);
        try {
          setUser(await api<User>("/auth/me"));
        } catch {
          setAuthToken(null);
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading) return;
    const inLogin = segments[0] === "login";
    if (!user && !inLogin) {
      router.replace("/login");
    } else if (user && inLogin) {
      router.replace("/(tabs)/home");
    }
  }, [user, loading, segments, router]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.access_token);
    await storage.secureSet(TOKEN_KEY, res.access_token);
    setUser(res.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    return api<{ message: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
  }, []);

  const logout = useCallback(async () => {
    setAuthToken(null);
    await storage.secureRemove(TOKEN_KEY);
    setUser(null);
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#121212", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#D4AF37" size="large" />
      </View>
    );
  }

  return <Ctx.Provider value={{ user, login, register, logout }}>{children}</Ctx.Provider>;
}
