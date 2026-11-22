/**
 * The one place the markdown header's logo markup comes from.
 *
 * It renders the pharn mark from `docs/assets/pharn-logo.svg` through its raw URL at a fixed commit, never `main`:
 * a change to the file on `main` must not change the image in comments already posted (CORE-124). When the logo
 * changes, a later PR sets `LOGO_COMMIT` to the commit that changed it (docs/RELEASING.md).
 * `docs/assets/pharn-ci-logo.svg` is still never linked or embedded here. Fixed markup only:
 * nothing input-derived may enter.
 */
const LOGO_COMMIT = "515998146a22a1886341d94236e4138e1777c13a";

const LOGO_MARKUP = `<img src="https://raw.githubusercontent.com/pharn-dev/pharn-ci/${LOGO_COMMIT}/docs/assets/pharn-logo.svg" alt="pharn" width="48" height="48">`;

export function logoMarkup(): string {
  return LOGO_MARKUP;
}
