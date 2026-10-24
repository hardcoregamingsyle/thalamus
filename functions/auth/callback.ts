// OAuth landing spot: Convex redirects here with ?token=. Exchanged for our
// own session cookie server-side (through Convex) and redirected
// on to /console — the token never reaches client-side JS or stays in the
// browser's URL or history.
import { forwardToConvex, type ConvexEnv } from "../_lib/convex";

function redirectTo(requestUrl: string, path: string): Response {
  const location = new URL(path, requestUrl).toString();
  return new Response(null, {
    status: 302,
    headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

export const onRequestGet: PagesFunction<ConvexEnv> = async (context) => {
  const url = new URL(context.request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return redirectTo(context.request.url, "/auth?oauth_error=missing_token");
  }

  let upstream: Response;
  try {
    upstream = await forwardToConvex(
      new Request(new URL("/api/session", context.request.url), {
        method: "POST",
        headers: { "content-type": "application/json", "x-requested-with": "thalamus" },
        body: JSON.stringify({ token }),
      }),
      context.env,
    );
  } catch {
    return redirectTo(context.request.url, "/auth?oauth_error=session_failed");
  }

  if (!upstream.ok) {
    return redirectTo(context.request.url, "/auth?oauth_error=session_failed");
  }

  const headers = new Headers({
    location: new URL("/console", context.request.url).toString(),
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 302, headers });
};
