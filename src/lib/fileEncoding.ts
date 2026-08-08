/**
 * File-reading helpers shared by the chat composer (text attachments) and the
 * study-mode uploader (base64 for PDFs/images).
 */

/** Hard cap for study-mode uploads (PDF/image extraction upstream). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

// Extensions we treat as text when the browser doesn't supply a MIME type
// (common for code files dragged from disk).
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|jsonc|yaml|yml|xml|html|htm|css|scss|less|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bash|ps1|bat|sql|toml|ini|cfg|conf|env|csv|tsv|log|svg)$/i;

/**
 * True when a file can be meaningfully attached as plain text. Binary files
 * (images, PDFs, archives) must NOT go through `file.text()` — it decodes the
 * bytes as UTF-8 and produces replacement-character garbage that used to be
 * silently sent to the model as an "attachment".
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

/**
 * Base64-encode a file without building the string one byte at a time.
 * The old inline loop (`binary += String.fromCharCode(bytes[i])` per byte)
 * performed millions of string appends for a single PDF and stalled the main
 * thread for seconds on mobile. FileReader does the conversion in native code.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — callers want the raw payload.
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
