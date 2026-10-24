export interface ConvexEnv {
  CONVEX_SITE_URL?: string;
}

/** The Pages origin owns the cookie; Convex owns accounts and waitlist data. */
export async function forwardToConvex(request: Request, env: ConvexEnv): Promise<Response> {
  const origin = env.CONVEX_SITE_URL ?? "https://befitting-wildebeest-866.convex.site";
  const incoming = new URL(request.url);
  const target = new URL(`/nameless${incoming.pathname}${incoming.search}`, origin);
  const headers = new Headers();
  for (const name of ["content-type", "cookie", "x-requested-with"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      redirect: "manual",
    });
  } catch {
    return Response.json(
      { error: "Account service unavailable. Please try again." },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
