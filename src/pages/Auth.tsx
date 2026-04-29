import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Cpu, Mail } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";

interface AuthProps {
  redirectAfterAuth?: string;
}

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<"signIn" | { email: string }>("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      {/* Background grid */}
      <div className="fixed inset-0 opacity-[0.03] pointer-events-none" style={{
        backgroundImage: "linear-gradient(oklch(0.60 0.22 25) 1px, transparent 1px), linear-gradient(90deg, oklch(0.60 0.22 25) 1px, transparent 1px)",
        backgroundSize: "60px 60px",
      }} />

      {/* Nav */}
      <nav className="relative z-10 border-b border-border px-6 h-14 flex items-center">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center">
            <Cpu className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-primary font-bold text-sm tracking-widest amd-glow">AGENT_AI</span>
          <span className="text-[10px] text-muted-foreground">× AMD Hackathon</span>
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
                  {step === "signIn" ? "AUTHENTICATION REQUIRED" : "OTP VERIFICATION"}
                </span>
              </div>
              <h1 className="text-xl font-bold text-primary amd-glow">
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
                      ⚠ {error}
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
                      ⚠ {error}
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

            <div className="px-6 py-3 border-t border-border text-xs text-center text-muted-foreground">
              Secured by{" "}
              <a href="https://vly.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                vly.ai
              </a>
              {" "}• AMD Developer Hackathon 2025
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