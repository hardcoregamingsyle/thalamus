import { api } from "@/convex/_generated/api";
import { useQuery, useMutation, useAction } from "convex/react";
import { useState, useEffect } from "react";
import { SESSION_KEY, getSessionToken, setSessionToken, clearSessionToken } from "@/lib/session";

export function useAuth() {
  const [token, setToken] = useState<string | null>(getSessionToken);

  // A token too short to be a session (64 hex) is junk — a truncated paste, a
  // stale format. The query has to skip it, which means `user` stays undefined
  // forever, so it must not count as "still loading" or the app spins for good.
  const hasUsableToken = !!token && token.length >= 32;
  const user = useQuery(
    api.customAuthHelpers.getUserByToken,
    hasUsableToken ? { token } : "skip"
  );

  const signOutMutation = useMutation(api.customAuthHelpers.signOut);
  const sendOtpAction = useAction(api.customAuth.sendOtp);
  const verifyOtpAction = useAction(api.customAuth.verifyOtp);

  const isLoading = hasUsableToken && user === undefined;
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
        // Step 2: Verify OTP — pass referralCode if present in formData
        const referralCode = formData.get("referralCode") as string | null;
        const result = await verifyOtpAction({ email, code, ...(referralCode ? { referralCode } : {}) });
        setSessionToken(result.token);
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
    clearSessionToken();
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