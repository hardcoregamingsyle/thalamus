import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { useState, useEffect } from "react";

const SESSION_KEY = "agentai_session_token";

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(SESSION_KEY);
    }
    return null;
  });

  const user = useQuery(
    api.customAuthHelpers.getUserByToken,
    token ? { token } : "skip"
  );

  const signOutMutation = useMutation(api.customAuthHelpers.signOut);
  const sendOtpAction = useAction(api.customAuth.sendOtp);
  const verifyOtpAction = useAction(api.customAuth.verifyOtp);

  const isLoading = token !== null && user === undefined;
  const isAuthenticated = !!user;

  const signIn = async (provider: string, formData: FormData) => {
    if (provider === "email-otp") {
      const email = formData.get("email") as string;
      const code = formData.get("code") as string | null;

      if (!code) {
        // Step 1: Send OTP
        await sendOtpAction({ email });
        return { started: true };
      } else {
        // Step 2: Verify OTP
        const result = await verifyOtpAction({ email, code });
        localStorage.setItem(SESSION_KEY, result.token);
        setToken(result.token);
        return result;
      }
    }
    throw new Error("Unknown provider");
  };

  const signOut = async () => {
    if (token) {
      try {
        await signOutMutation({ token });
      } catch {
        // ignore
      }
    }
    localStorage.removeItem(SESSION_KEY);
    setToken(null);
  };

  // Listen for storage changes (multi-tab support)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === SESSION_KEY) {
        setToken(e.newValue);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
    token,
  };
}