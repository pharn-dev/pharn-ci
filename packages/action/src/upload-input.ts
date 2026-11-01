/** What the `upload` input chose: `auto` (upload when the job can and the org installed the app) or `never`. */
export type UploadChoice = "auto" | "never";

const UPLOAD_INPUT_ERROR = "the upload input must be auto or never";

/**
 * Reads the `upload` input: empty or `auto`, or `never`. The names are case-sensitive. Anything else throws one fixed
 * Error that never repeats the value.
 */
export function parseUploadInput(value: string): UploadChoice {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "auto") return "auto";
  if (trimmed === "never") return "never";
  throw new Error(UPLOAD_INPUT_ERROR);
}
