/** File classification helpers shared by chat and study-mode uploaders. */

/** Hard cap for original PDF/image uploads. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MiB

// Extensions we treat as text when the browser doesn't supply a MIME type
// (common for code files dragged from disk).
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|json|jsonc|yaml|yml|xml|html|htm|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|ps1|bat|sql|toml|ini|cfg|conf|env|csv|tsv|log|svg)$/i;

/**
 * True when a file can be meaningfully attached as plain text. Binary files
 * (images, PDFs, archives) must NOT go through `file.text()` because that
 * decodes arbitrary bytes as UTF-8 replacement-character garbage.
 */
export function isProbablyTextFile(file: File): boolean {
  if (file.type.startsWith("text/")) return true;
  if (
    file.type === "application/json" ||
    file.type === "application/xml" ||
    file.type === "application/javascript" ||
    file.type === "application/x-sh"
  ) {
    return true;
  }
  if (!file.type && TEXT_EXTENSIONS.test(file.name)) return true;
  return TEXT_EXTENSIONS.test(file.name);
}

const NATIVE_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** MIME type to use when uploading the original file for a multimodal model. */
export function nativeAiFileMimeType(file: File): string | null {
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    return "application/pdf";
  }
  return NATIVE_IMAGE_TYPES.has(file.type) ? file.type : null;
}
