import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Mail, Lock } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "framer-motion";

interface AuthProps {
  redirectAfterAuth?: string;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const refCode = searchParams.get("ref") ?? undefined;

  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth (Google/GitHub) lands back here with ?token= — adopt it as the
  // session and hard-reload so every localStorage reader picks it up.
  useEffect(() => {
    const oauthToken = searchParams.get("token");
    const oauthError = searchParams.get("oauth_error");
    if (oauthToken) {
      localStorage.setItem("agentai_session_token", oauthToken);
      window.location.replace(redirectAfterAuth || "/portal");
      return;
    }
    if (oauthError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot adoption of an error passed via redirect URL
      setError(oauthError);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount for URL params
  }, []);

  const startOAuth = (provider: "google" | "github") => {
    const site = (import.meta.env.VITE_CONVEX_URL as string).replace(".convex.cloud", ".convex.site");
    const back = `${window.location.origin}/auth`;
    window.location.href = `${site}/auth/${provider}?redirect=${encodeURIComponent(back)}`;
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(redirectAfterAuth || "/portal");
    }
  }, [authLoading, isAuthenticated, navigate, redirectAfterAuth]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
      setIsLoading(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to send verification code.");
      setIsLoading(false);
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const email = typeof step === "object" ? step.email : "";
      const formData = new FormData();
      formData.set("email", email);
      formData.set("code", otp);
      // Pass referral code if present in URL
      if (refCode) formData.set("referralCode", refCode.toUpperCase());
      await signIn("email-otp", formData);
      navigate(redirectAfterAuth || "/portal");
    } catch {
      setError("Invalid verification code.");
      setIsLoading(false);
      setOtp("");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      <meta name="robots" content="noindex" />
      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none" style={{
        backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Nav */}
      <nav className="relative z-10 border-b border-border px-6 h-14 flex items-center">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg border border-primary/40 overflow-hidden bg-card">
            <img src="/thalamus-logo.png" alt="Thalamus AI" className="h-full w-full object-cover" />
          </div>
          <span className="text-primary font-bold text-sm tracking-widest">THALAMUS_AI</span>
          <span className="text-[10px] text-muted-foreground">by Aphantic Corporations</span>
        </button>
      </nav>

      <div className="relative z-10 flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          {/* Glow orb */}
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

          <div className="relative border border-border bg-card rounded-2xl overflow-hidden shadow-2xl">
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />

            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="text-[10px] text-muted-foreground font-bold tracking-widest">
                  {step === "signIn" ? "Sign in" : "Verify your email"}
                </span>
              </div>
              <h1 className="text-xl font-bold text-primary">
                {step === "signIn" ? "Access Portal" : "Verify Code"}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                {step === "signIn"
                  ? "Enter your email to receive a verification code"
                  : `Code sent to: ${typeof step === "object" ? step.email : ""}`}
              </p>
            </div>

            <div className="p-6">
              {step === "signIn" ? (
                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1.5 font-bold">EMAIL ADDRESS</label>
                    <div className="flex items-center border border-border bg-background rounded-lg focus-within:border-primary transition-colors overflow-hidden">
                      <span className="text-primary text-xs px-3 border-r border-border py-2.5">
                        <Mail className="h-3.5 w-3.5" />
                      </span>
                      <Input
                        name="email"
                        placeholder="user@domain.com"
                        type="email"
                        className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground rounded-none"
                        disabled={isLoading}
                        required
                      />
                    </div>
                  </div>

                  {error && (
                    <p className="text-xs text-destructive font-mono bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-lg h-10"
                  >
                    {isLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />SENDING CODE...</>
                    ) : (
                      <>SEND VERIFICATION CODE<ArrowRight className="h-3.5 w-3.5 ml-2" /></>
                    )}
                  </Button>

                  <p className="text-[11px] text-muted-foreground text-center">
                    New users are registered automatically
                  </p>

                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[10px] text-muted-foreground font-bold">OR</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => startOAuth("google")}
                      disabled={isLoading}
                      className="text-xs font-mono font-bold rounded-lg h-10"
                    >
                      <svg className="h-3.5 w-3.5 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a5.8 5.8 0 1 1 0-11.6c1.5 0 2.8.55 3.85 1.45l2.15-2.15A8.65 8.65 0 1 0 12 20.65c5 0 8.65-3.5 8.65-8.65 0-.3-.1-.6-.3-.9Z" />
                      </svg>
                      GOOGLE
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => startOAuth("github")}
                      disabled={isLoading}
                      className="text-xs font-mono font-bold rounded-lg h-10"
                    >
                      <svg className="h-3.5 w-3.5 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
                      </svg>
                      GITHUB
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleOtpSubmit} className="space-y-4">
                  <input type="hidden" name="email" value={typeof step === "object" ? step.email : ""} />
                  <input type="hidden" name="code" value={otp} />

                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-3 font-bold">ENTER 6-DIGIT CODE</label>
                    <div className="flex justify-center">
                      <InputOTP
                        value={otp}
                        onChange={setOtp}
                        maxLength={6}
                        disabled={isLoading}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                            const form = (e.target as HTMLElement).closest("form");
                            if (form) form.requestSubmit();
                          }
                        }}
                      >
                        <InputOTPGroup>
                          {Array.from({ length: 6 }).map((_, index) => (
                            <InputOTPSlot
                              key={index}
                              index={index}
                              className="border-border bg-background text-primary font-mono text-sm rounded-lg"
                            />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                  </div>

                  {error && (
                    <p className="text-xs text-destructive font-mono text-center bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {error}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={isLoading || otp.length !== 6}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-lg h-10"
                  >
                    {isLoading ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />VERIFYING...</>
                    ) : (
                      <>AUTHENTICATE<ArrowRight className="h-3.5 w-3.5 ml-2" /></>
                    )}
                  </Button>

                  <button
                    type="button"
                    onClick={() => setStep("signIn")}
                    disabled={isLoading}
                    className="w-full text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                  >
                    ← Use different email
                  </button>
                </form>
              )}
            </div>

            <div className="px-6 py-3 border-t border-border text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
              <Lock className="h-3 w-3 text-primary/60" />
              Secured by{" "}
              <span className="text-primary">Thalamus AI</span>
              {" "}• by Aphantic Corporations
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
