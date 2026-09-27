import Link from "next/link";

const surfaces = [
  {
    title: "OpenAI-compatible API",
    body: "Point an existing OpenAI SDK at Thalamus and call chat completions, streamed or not, against Thalamus Sophon.",
  },
  {
    title: "Developer console",
    body: "Create and revoke API keys, and see usage by day and model.",
  },
  {
    title: "Web chat",
    body: "A conversational app for trying the model directly, with no API integration required.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:py-24">
      <section className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          An AI provider built on its own model
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Thalamus serves Thalamus Sophon — an in-house model built on a non-transformer
          architecture — through an OpenAI-compatible API, a developer console, and a web chat app.
        </p>
        <p className="mt-4 text-muted-foreground">
          Thalamus is currently in private beta. New accounts join a waitlist and are invited in
          order.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/auth"
            className="rounded-md bg-accent px-5 py-2.5 font-medium text-accent-foreground no-underline hover:opacity-90"
          >
            Join the waitlist
          </Link>
          <Link
            href="/docs"
            className="rounded-md border border-border px-5 py-2.5 font-medium no-underline hover:bg-surface"
          >
            Read the docs
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-8 sm:grid-cols-3">
        {surfaces.map((surface) => (
          <div key={surface.title}>
            <h2 className="font-medium">{surface.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{surface.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
