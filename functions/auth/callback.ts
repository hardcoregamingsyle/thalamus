// OAuth landing spot: Convex redirects here with ?token=. Exchanged for our
// own session cookie server-side (through the GATEWAY binding) and redirected
// on to /console — the token never reaches client-side JS or stays in the
// browser's URL or history.
interface Env {
  GATEWAY: Fetcher;
}

function redirectTo(requestUrl: string, path: string): Response {
  const location = new URL(path, requestUrl).toString();
  return new Response(null, { status: 302, headers: { location } });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return redirectTo(context.request.url, "/auth?oauth_error=missing_token");
  }

  let upstream: Response;
  try {
    upstream = await context.env.GATEWAY.fetch("https://gateway.internal/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-requested-with": "thalamus" },
      body: JSON.stringify({ token }),
    });
  } catch {
    return redirectTo(context.request.url, "/auth?oauth_error=session_failed");
  }

  if (!upstream.ok) {
    return redirectTo(context.request.url, "/auth?oauth_error=session_failed");
  }

  const headers = new Headers({ location: new URL("/console", context.request.url).toString() });
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
};
