/**
 * The one place the markdown header's logo markup comes from.
 *
 * It renders the pharn mark from `docs/assets/pharn-logo.svg` through its raw `main` URL.
 * `docs/assets/pharn-ci-logo.svg` is still never linked or embedded here. Fixed markup only:
 * nothing input-derived may enter.
 */
const LOGO_MARKUP =
  '<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/main/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">';

export function logoMarkup(): string {
  return LOGO_MARKUP;
}
