"use client";

import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/Logo";
import { AuthFlow } from "./AuthFlow";

const CONVEX_SITE = "https://befitting-wildebeest-866.convex.site";

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  missing_token: "Sign-in didn't complete. Try again.",
  session_failed: "We couldn't start a session. Try again in a moment.",
  access_denied: "Sign-in was cancelled.",
};

function oauthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code] ?? "Sign-in failed. Try again.";
}

function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.17-1.81-.17-1.81Z"
      />
    </svg>
  );
}

function GithubIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 .5C5.73.5.5 5.73.5 12c0 5.09 3.29 9.4 7.86 10.93.57.1.78-.25.78-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.78 2.72 1.27 3.38.97.1-.75.4-1.27.73-1.56-2.55-.29-5.23-1.28-5.23-5.68 0-1.25.44-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.8 1.18 1.83 1.18 3.08 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.2.66.79.55A10.99 10.99 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"
      />
    </svg>
  );
}

export default function AuthPage() {
  // Both need the browser: the OAuth `redirect` must round-trip to whichever
  // origin actually served the request, and `oauth_error` only exists on the
  // client's URL. This is a static export with no server render, so nothing
  // reads these before mount — the buttons are inert for one frame instead.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  useEffect(() => {
    setRedirectUrl(`${window.location.origin}/auth/callback`);
    setOauthError(
      oauthErrorMessage(new URLSearchParams(window.location.search).get("oauth_error")),
    );
  }, []);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-bg">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px] opacity-70 [background:radial-gradient(55%_50%_at_50%_0%,color-mix(in_srgb,var(--raw-grad-2)_16%,transparent),transparent_70%)]"
      />
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-50" />

      <div className="relative mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-16">
        <div className="flex flex-col items-center text-center">
          <LogoMark className="h-9 w-9" />
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-fg">
            Welcome to Thalamus
          </h1>
          <p className="mt-1.5 text-[15px] text-fg-muted">Sign in or create an account.</p>
        </div>

        {oauthError ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
          >
            {oauthError}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-2.5">
          <a
            href={
              redirectUrl
                ? `${CONVEX_SITE}/auth/google?redirect=${encodeURIComponent(redirectUrl)}`
                : undefined
            }
            aria-disabled={!redirectUrl}
            className={buttonClass({
              variant: "secondary",
              size: "lg",
              className: "w-full aria-disabled:pointer-events-none aria-disabled:opacity-50",
            })}
          >
            <GoogleIcon className="h-[18px] w-[18px]" />
            Continue with Google
          </a>
          <a
            href={
              redirectUrl
                ? `${CONVEX_SITE}/auth/github?redirect=${encodeURIComponent(redirectUrl)}`
                : undefined
            }
            aria-disabled={!redirectUrl}
            className={buttonClass({
              variant: "secondary",
              size: "lg",
              className: "w-full aria-disabled:pointer-events-none aria-disabled:opacity-50",
            })}
          >
            <GithubIcon className="h-[18px] w-[18px]" />
            Continue with GitHub
          </a>
        </div>

        <div className="my-7 flex items-center gap-3 text-xs text-fg-subtle">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <AuthFlow />
      </div>
    </div>
  );
}
