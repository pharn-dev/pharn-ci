/**
 * The one place the markdown header's logo markup comes from.
 *
 * It renders nothing until the user supplies the pharn logo. `docs/assets/pharn-ci-logo.svg` is not
 * that logo and is never linked or embedded here. Fixed markup only: nothing input-derived may enter.
 */
export function logoMarkup(): string {
  return "";
}
