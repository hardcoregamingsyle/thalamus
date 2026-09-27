"use client";

import { useEffect, useState } from "react";
import { OtpForm } from "./OtpForm";

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

export default function AuthPage() {
  // Both need the browser: the OAuth `redirect` must round-trip to whichever
  // origin actually served the request (localhost in dev, the production
  // domain once cut over), and `oauth_error` only exists on the client's URL.
  // This is a static export with no server render, so there's nothing to
  // read before mount — the buttons are inert for one frame instead.
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setRedirectUrl(`${window.location.origin}/auth/callback`);
    setErrorMessage(
      oauthErrorMessage(new URLSearchParams(window.location.search).get("oauth_error")),
    );
  }, []);

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Thalamus uses the same account as AgentOverflow.
      </p>

      {errorMessage ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-danger px-3 py-2 text-sm text-danger"
        >
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-6 flex flex-col gap-2">
        <a
          href={
            redirectUrl
              ? `${CONVEX_SITE}/auth/google?redirect=${encodeURIComponent(redirectUrl)}`
              : undefined
          }
          aria-disabled={!redirectUrl}
          className="rounded-md border border-border px-4 py-2 text-center no-underline hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-60"
        >
          Continue with Google
        </a>
        <a
          href={
            redirectUrl
              ? `${CONVEX_SITE}/auth/github?redirect=${encodeURIComponent(redirectUrl)}`
              : undefined
          }
          aria-disabled={!redirectUrl}
          className="rounded-md border border-border px-4 py-2 text-center no-underline hover:bg-surface aria-disabled:pointer-events-none aria-disabled:opacity-60"
        >
          Continue with GitHub
        </a>
      </div>

      <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-6">
        <OtpForm />
      </div>
    </div>
  );
}
