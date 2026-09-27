// @ts-check
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      ".agentoverflow/**",
      "**/dist/**",
      "**/.next/**",
      "**/out/**",
      "**/.wrangler/**",
      "packages/db/migrations/**",
      "apps/convex/convex/_generated/**",
      "docs/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
