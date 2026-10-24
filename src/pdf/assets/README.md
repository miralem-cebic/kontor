# Files embedded in the PDFs

| File | Source | Licence |
| --- | --- | --- |
| `sRGB-v2-magic.icc` | [Compact ICC Profiles](https://github.com/saucecontrol/Compact-ICC-Profiles), `profiles/sRGB-v2-magic.icc` (736 bytes, SHA-256 `af4efe28f6d311799865f325ba39184a2e978b113ca74124d60af7de22b105f4`) | CC0 1.0 (public domain) |

The fonts are not copied here: `src/pdf/assets.ts` imports the static TTF files of Inter (Regular and SemiBold) from the npm package `@expo-google-fonts/inter`, which takes them from Google Fonts. Inter is licensed under the SIL Open Font License 1.1; its copyright and licence are part of the font files and of the package (`LICENSE_FONT`).

The ICC profile is the output intent of every PDF (sRGB), which PDF/A requires; see `src/pdf/render.ts` and ADR 0005.
