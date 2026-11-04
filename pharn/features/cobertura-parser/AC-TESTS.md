---
spec_id: cobertura-parser
spec_content_hash: a0f430ad49367ef04424d15f71b4cb1700f45f85d4d0c7ad684ded2f4c449f3c
---

## Files

- `packages/core/test/cobertura.test.ts` — the tests for AC-1 to AC-13 and AC-15
- `packages/core/test/cobertura-check.test.ts` — the test for AC-14
- `packages/core/test/cobertura-hostile.test.ts` — the test for AC-16

## Mapping

- AC-1 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-2 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-3 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-4 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-5 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-6 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-7 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-8 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-9 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-10 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-11 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-12 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-13 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
- AC-14 | integration | `packages/core/test/cobertura-check.test.ts` | packages/core/src/check.ts#check(input: CheckInput): Report — with coverage { text, format: "cobertura", file } and a threshold
- AC-15 | unit | `packages/core/test/cobertura.test.ts` | packages/core/src/coverage/index.ts#parseCoverage(text: string, format: CoverageFormat, options?: ParseCoverageOptions): CoverageMap, compared with parseCobertura
- AC-16 | unit | `packages/core/test/cobertura-hostile.test.ts` | packages/core/src/coverage/cobertura.ts#parseCobertura(text: string, options?: ParseCoverageOptions): CoverageMap
