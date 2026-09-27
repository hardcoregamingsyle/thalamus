"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type Step = "email" | "code";
const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
    body: JSON.stringify(body),
  });
}

/** The /api/* routes send either `{error: string}` (apiError(), used here for
 * both otp endpoints) or `{error: {message, code}}` — handle both rather
 * than assuming the object shape. */
async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const err = body?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const { message } = err as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return fallback;
}

export function AuthFlow() {
  const router = useRouter();
  const still = useReducedMotion();
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/otp/send", { email });
      if (!res.ok) {
        setError(await errorMessage(res, "Couldn't send a code. Try again."));
        return;
      }
      setDigits(Array(CODE_LENGTH).fill(""));
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setStep("code");
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(code: string) {
    if (code.length !== CODE_LENGTH) return;
    setPending(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/otp/verify", { email, code });
      if (!res.ok) {
        setError(await errorMessage(res, "That code didn't work. Try again."));
        setDigits(Array(CODE_LENGTH).fill(""));
        inputsRef.current[0]?.focus();
        return;
      }
      router.push("/console");
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function resend() {
    setResending(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/otp/send", { email });
      if (!res.ok) {
        setError(await errorMessage(res, "Couldn't resend a code. Try again."));
        return;
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setResending(false);
    }
  }

  function backToEmail() {
    setStep("email");
    setDigits(Array(CODE_LENGTH).fill(""));
    setError(null);
    setCooldown(0);
  }

  function handleDigitChange(index: number, event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value.replace(/\D/g, "").slice(-1);
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    if (value && index < CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
    if (next.every((d) => d.length === 1)) void verify(next.join(""));
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!text) return;
    event.preventDefault();
    const next = Array.from({ length: CODE_LENGTH }, (_, i) => text[i] ?? "");
    setDigits(next);
    const focusIndex = Math.min(text.length, CODE_LENGTH) - 1;
    inputsRef.current[Math.max(focusIndex, 0)]?.focus();
    if (text.length === CODE_LENGTH) void verify(text);
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={still ? false : { opacity: 0, x: step === "code" ? 16 : -16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={still ? { opacity: 0 } : { opacity: 0, x: step === "code" ? 16 : -16 }}
        transition={{ duration: still ? 0.12 : 0.25, ease: [0.22, 1, 0.36, 1] }}
      >
        {step === "email" ? (
          <form onSubmit={(event) => void sendCode(event)} className="flex flex-col gap-4">
            <Input
              label="Email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={error ?? undefined}
            />
            <Button type="submit" size="lg" disabled={pending || !email} className="w-full">
              {pending ? "Sending…" : "Continue"}
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verify(digits.join(""));
            }}
            className="flex flex-col gap-5"
          >
            <p className="text-sm text-fg-muted">
              We sent a code to <span className="font-medium text-fg">{email}</span>.
            </p>
            <div className="grid grid-cols-6 gap-2">
              {digits.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    inputsRef.current[index] = el;
                  }}
                  value={digit}
                  onChange={(event) => handleDigitChange(index, event)}
                  onKeyDown={(event) => handleKeyDown(index, event)}
                  onPaste={handlePaste}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete={index === 0 ? "one-time-code" : "off"}
                  maxLength={1}
                  aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
                  className="h-12 w-full min-w-0 rounded-xl border border-border-strong bg-surface text-center text-lg font-mono text-fg outline-none transition-colors focus:border-fg/30"
                />
              ))}
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              size="lg"
              disabled={pending || digits.some((d) => !d)}
              className="w-full"
            >
              {pending ? "Verifying…" : "Verify"}
            </Button>
            <div className="flex items-center justify-between text-[13px]">
              <button
                type="button"
                onClick={backToEmail}
                className="text-fg-muted transition-colors hover:text-fg"
              >
                Use a different email
              </button>
              <button
                type="button"
                onClick={() => void resend()}
                disabled={cooldown > 0 || resending}
                className="text-fg-muted transition-colors hover:text-fg disabled:opacity-50"
              >
                {resending
                  ? "Sending…"
                  : cooldown > 0
                    ? `Resend code (${cooldown}s)`
                    : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
