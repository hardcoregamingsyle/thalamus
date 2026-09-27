const SNIPPET = `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.THALAMUS_API_KEY,
  baseURL: "https://thalamus.aphantic.skinticals.com/v1",
});

const completion = await client.chat.completions.create({
  model: "thalamus-sophon-1.0",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(completion.choices[0].message.content);`;

export function Quickstart() {
  return (
    <div className="mt-4">
      <p className="text-sm text-muted-foreground">
        Thalamus speaks the OpenAI chat-completions API. Point any OpenAI SDK at the base URL below
        with an API key from above.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md border border-border bg-surface p-4 text-sm">
        <code>{SNIPPET}</code>
      </pre>
    </div>
  );
}
