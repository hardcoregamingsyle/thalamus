import { useState, useCallback } from "react";
import { useSearchParams } from "react-router";
import { useAction, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, Loader2, Monitor, Shield, Clock, Terminal, Mail, Key } from "lucide-react";

type Step = "signin" | "otp" | "authorize" | "success" | "error";

export default function AuthDesktop() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get("code") ?? "";

  // Use the custom auth flow (same as Auth.tsx) instead of @convex-dev/auth
  const sendOtp = useAction(api.customAuth.sendOtp);
  const verifyOtp = useAction(api.customAuth.verifyOtp);
  const doAuthorize = useMutation(api.desktopAuth.authorizeCode);

  const [step, setStep] = useState<Step>("signin");
  const [email, setEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  const handleSendOtp = useCallback(async () => {
    if (!email || !email.includes("@")) {
      setErrorMsg("Enter a valid email address.");
      return;
    }
    setSendingOtp(true);
    setErrorMsg("");
    try {
      await sendOtp({ email });
      setStep("otp");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to send code. Try again.");
    } finally {
      setSendingOtp(false);
    }
  }, [email, sendOtp]);

  const handleVerifyOtp = useCallback(async () => {
    if (otpCode.length < 6) {
      setErrorMsg("Enter the 6-digit code from your email.");
      return;
    }
    setErrorMsg("");
    try {
      await verifyOtp({ email, code: otpCode });
      // OTP verified — move straight to authorize step
      setStep("authorize");
      setErrorMsg("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Invalid code. Try again.");
    }
  }, [email, otpCode, verifyOtp]);

  const handleAuthorize = useCallback(async () => {
    if (!code) {
      setErrorMsg("No authentication code provided. Go back to the desktop app.");
      setStep("error");
      return;
    }
    setAuthorizing(true);
    setErrorMsg("");
    try {
      await doAuthorize({ code: code.toUpperCase() });
      setStep("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Authorization failed. Try again.");
      setStep("error");
    } finally {
      setAuthorizing(false);
    }
  }, [code, doAuthorize]);

  return (
    <div className="min-h-screen bg-[#050a14] flex items-center justify-center p-4 relative overflow-hidden">
      <meta name="robots" content="noindex" />
      {/* Ambient glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-indigo-500/5 rounded-full blur-[100px]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,255,65,0.1) 1px, rgba(0,255,65,0.1) 2px)" }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.3 }}
          className="relative w-full max-w-md"
        >
          <div className="border border-[#1e3a5f] rounded-xl bg-[#0a1628]/95 backdrop-blur overflow-hidden">
            {/* Terminal header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1e3a5f] bg-[#020b1d]">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
              <span className="text-[#64748b] text-xs ml-2 font-mono">Thalamus Desktop</span>
            </div>

            <div className="p-6 sm:p-8">
              {/* Logo */}
              <div className="flex items-center justify-center mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                  <Terminal className="w-6 h-6 text-white" />
                </div>
              </div>

              {/* Code badge */}
              {code && step !== "success" && (
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0d1f3c] border border-[#1e3a5f]">
                    <Monitor className="w-4 h-4 text-blue-400" />
                    <span className="text-[#64748b] text-sm">Desktop Auth:</span>
                    <span className="text-blue-400 font-mono font-bold text-lg tracking-widest">{code.toUpperCase()}</span>
                  </div>
                </div>
              )}

              {/* Step: Sign in → email entry */}
              {step === "signin" && (
                <div className="space-y-5">
                  <div className="text-center">
                    <h1 className="text-xl font-bold text-[#e2e8f0] mb-2">Sign in to your account</h1>
                    <p className="text-sm text-[#64748b]">
                      Sign in to authorize the Thalamus desktop app.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-[#64748b] mb-1.5 block">Email address</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full bg-[#0d1f3c] border border-[#1e3a5f] rounded-lg px-4 py-3 text-[#e2e8f0] text-sm placeholder-[#334155] outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-colors"
                        placeholder="you@example.com"
                        onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                      />
                    </div>
                    {errorMsg && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs">{errorMsg}</motion.p>
                    )}
                    <button
                      onClick={handleSendOtp}
                      disabled={sendingOtp}
                      className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-sm transition-all duration-200 flex items-center justify-center gap-2"
                    >
                      {sendingOtp ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Sending Code...</>
                      ) : (
                        <><Mail className="w-4 h-4" /> Send Login Code</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Step: OTP entry */}
              {step === "otp" && (
                <div className="space-y-5">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                      <Key className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-xl font-bold text-[#e2e8f0] mb-2">Check your email</h1>
                    <p className="text-sm text-[#64748b]">
                      We sent a 6-digit code to <span className="text-[#e2e8f0]">{email}</span>
                    </p>
                  </div>

                  <div>
                    <label className="text-xs text-[#64748b] mb-1.5 block">Verification code</label>
                    <input
                      type="text"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      maxLength={6}
                      className="w-full bg-[#0d1f3c] border border-[#1e3a5f] rounded-lg px-4 py-3 text-[#e2e8f0] text-lg font-mono text-center tracking-[8px] placeholder-[#334155] outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-colors"
                      placeholder="000000"
                      onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                      autoFocus
                    />
                    {errorMsg && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs mt-2">{errorMsg}</motion.p>
                    )}
                  </div>

                  <button
                    onClick={handleVerifyOtp}
                    disabled={otpCode.length !== 6}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-sm transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" /> Verify & Sign In
                  </button>

                  <button
                    onClick={() => { setStep("signin"); setErrorMsg(""); }}
                    className="w-full text-[#64748b] hover:text-[#e2e8f0] text-sm transition-colors"
                  >
                    Use a different email
                  </button>
                </div>
              )}

              {/* Step: Authorize desktop app */}
              {step === "authorize" && (
                <div className="space-y-5">
                  <div className="text-center">
                    <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                      <Shield className="w-8 h-8 text-blue-400" />
                    </div>
                    <h1 className="text-xl font-bold text-[#e2e8f0] mb-2">Authorize Desktop App?</h1>
                    <p className="text-sm text-[#64748b]">
                      A desktop app is requesting access to your Thalamus account.
                    </p>
                  </div>

                  <div className="bg-[#0d1f3c] border border-[#1e3a5f] rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-3 text-sm text-[#e2e8f0]">
                      <Monitor className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <span>Thalamus Desktop App</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-[#64748b]">
                      <Clock className="w-4 h-4 flex-shrink-0" />
                      <span>Session expires in 30 days</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-[#64748b]">
                      <Terminal className="w-4 h-4 flex-shrink-0" />
                      <span>Full access to your account</span>
                    </div>
                  </div>

                  {errorMsg && (
                    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-xs">{errorMsg}</motion.p>
                  )}

                  <button
                    onClick={handleAuthorize}
                    disabled={authorizing}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold py-3 rounded-lg text-sm transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {authorizing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Authorizing...</>
                    ) : (
                      <><Shield className="w-4 h-4" /> Authorize Desktop App</>
                    )}
                  </button>
                </div>
              )}

              {/* Step: Success */}
              {step === "success" && (
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto">
                    <CheckCircle className="w-8 h-8 text-green-400" />
                  </div>
                  <h1 className="text-xl font-bold text-[#e2e8f0]">Authorized!</h1>
                  <p className="text-sm text-[#64748b]">
                    The desktop app is now signed in. You can close this window and return to the app.
                  </p>
                  <div className="inline-flex items-center gap-2 px-4 py-3 rounded-lg bg-[#0d1f3c] border border-green-500/20 mt-2">
                    <Loader2 className="w-4 h-4 text-green-400 animate-spin" />
                    <span className="text-sm text-green-400">Desktop app connecting...</span>
                  </div>
                </div>
              )}

              {/* Step: Error */}
              {step === "error" && (
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
                    <XCircle className="w-8 h-8 text-red-400" />
                  </div>
                  <h1 className="text-xl font-bold text-[#e2e8f0]">Authorization Failed</h1>
                  <p className="text-sm text-[#64748b]">{errorMsg || "Something went wrong. Try again from the desktop app."}</p>
                  <button
                    onClick={() => { setStep("authorize"); setErrorMsg(""); }}
                    className="text-blue-400 hover:text-blue-300 text-sm underline underline-offset-2"
                  >
                    Try again
                  </button>
                </div>
              )}

              {/* Footer */}
              <div className="mt-6 pt-4 border-t border-[#1e3a5f] text-center">
                <p className="text-xs text-[#334155] font-mono">
                  Secured by Thalamus AI
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
