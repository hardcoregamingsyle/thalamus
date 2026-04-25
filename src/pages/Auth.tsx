import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { ArrowRight, Loader2, Terminal, Mail } from "lucide-react";
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
      const redirect = redirectAfterAuth || "/portal";
      navigate(redirect);
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
      setError(
        error instanceof Error ? error.message : "Failed to send verification code.",
      );
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
      const redirect = redirectAfterAuth || "/portal";
      navigate(redirect);
    } catch {
      setError("Invalid verification code.");
      setIsLoading(false);
      setOtp("");
    }
  };

  return (
    <div className="min-h-screen bg-background font-mono flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-6 h-12 flex items-center">
        <button onClick={() => navigate("/")} className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-primary terminal-glow" />
          <span className="text-primary font-bold text-sm tracking-widest terminal-glow">AGENT_AI</span>
        </button>
      </nav>

      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <div className="border border-border bg-card">
            {/* Terminal title bar */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-2.5 h-2.5 rounded-full bg-destructive" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground ml-2">
                {step === "signIn" ? "auth — login" : "auth — verify_otp"}
              </span>
            </div>

            <div className="p-6">
              {step === "signIn" ? (
                <>
                  <div className="mb-6">
                    <p className="text-xs text-muted-foreground mb-1">// AUTHENTICATION_REQUIRED</p>
                    <h1 className="text-lg font-bold text-primary terminal-glow">ACCESS_PORTAL</h1>
                    <p className="text-xs text-muted-foreground mt-1">Enter your email to receive a verification code</p>
                  </div>

                  <form onSubmit={handleEmailSubmit} className="space-y-4">
                    <div>
                      <label className="text-xs text-muted-foreground block mb-1">$ email_address</label>
                      <div className="flex items-center border border-border bg-background focus-within:border-primary transition-colors">
                        <span className="text-primary text-xs px-2 terminal-glow">@</span>
                        <Input
                          name="email"
                          placeholder="user@domain.com"
                          type="email"
                          className="border-0 bg-transparent text-xs font-mono focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder:text-muted-foreground"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs text-destructive font-mono">! ERROR: {error}</p>
                    )}

                    <Button
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none"
                    >
                      {isLoading ? (
                        <><Loader2 className="h-3 w-3 animate-spin mr-2" />SENDING_OTP...</>
                      ) : (
                        <><Mail className="h-3 w-3 mr-2" />SEND_VERIFICATION_CODE<ArrowRight className="h-3 w-3 ml-2" /></>
                      )}
                    </Button>
                  </form>

                  <p className="text-xs text-muted-foreground mt-4 text-center">
                    // New users will be registered automatically
                  </p>
                </>
              ) : (
                <>
                  <div className="mb-6">
                    <p className="text-xs text-muted-foreground mb-1">// OTP_VERIFICATION</p>
                    <h1 className="text-lg font-bold text-primary terminal-glow">VERIFY_CODE</h1>
                    <p className="text-xs text-muted-foreground mt-1">
                      Code sent to: <span className="text-primary">{step.email}</span>
                    </p>
                  </div>

                  <form onSubmit={handleOtpSubmit} className="space-y-4">
                    <input type="hidden" name="email" value={step.email} />
                    <input type="hidden" name="code" value={otp} />

                    <div>
                      <label className="text-xs text-muted-foreground block mb-3">$ enter_6_digit_code</label>
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
                                className="border-border bg-background text-primary font-mono text-sm rounded-none"
                              />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                    </div>

                    {error && (
                      <p className="text-xs text-destructive font-mono text-center">! ERROR: {error}</p>
                    )}

                    <Button
                      type="submit"
                      disabled={isLoading || otp.length !== 6}
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-mono font-bold rounded-none"
                    >
                      {isLoading ? (
                        <><Loader2 className="h-3 w-3 animate-spin mr-2" />VERIFYING...</>
                      ) : (
                        <>AUTHENTICATE<ArrowRight className="h-3 w-3 ml-2" /></>
                      )}
                    </Button>

                    <button
                      type="button"
                      onClick={() => setStep("signIn")}
                      disabled={isLoading}
                      className="w-full text-xs text-muted-foreground hover:text-primary transition-colors py-1"
                    >
                      $ use_different_email
                    </button>
                  </form>
                </>
              )}
            </div>

            <div className="px-4 py-3 border-t border-border text-xs text-center text-muted-foreground">
              Secured by{" "}
              <a href="https://vly.ai" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                vly.ai
              </a>
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