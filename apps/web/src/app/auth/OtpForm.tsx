"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ApiErrorBody } from "@/lib/types";

type Step = "email" | "code";

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "thalamus" },
    body: JSON.stringify(body),
  });
}

export function OtpForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/otp/send", { email });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setError(body?.error.message ?? "Couldn't send a code. Try again.");
        return;
      }
      setStep("code");
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await postJson("/api/auth/otp/verify", { email, code });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        setError(body?.error.message ?? "That code didn't work. Try again.");
        return;
      }
      router.push("/console");
    } catch {
      setError("Couldn't reach Thalamus. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (step === "email") {
    return (
      <form onSubmit={(event) => void sendCode(event)} className="flex flex-col gap-3">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send a code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={(event) => void verifyCode(event)} className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        We sent a code to <strong className="text-foreground">{email}</strong>.
      </p>
      <label htmlFor="code" className="text-sm font-medium">
        Code
      </label>
      <input
        id="code"
        type="text"
        inputMode="numeric"
        required
        autoComplete="one-time-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="rounded-md border border-border bg-background px-3 py-2 text-sm"
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-60"
      >
        {pending ? "Verifying…" : "Verify"}
      </button>
      <button
        type="button"
        onClick={() => setStep("email")}
        className="text-left text-sm text-muted-foreground hover:underline"
      >
        Use a different email
      </button>
    </form>
  );
}
