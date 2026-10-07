# Test font: Open Plan Test TC

`OpenPlanTestTC.ttf` is a small subset of **Noto Sans TC**, used only by `../render.test.ts` to check that CJK room labels render the same on every computer. Production rendering uses the system fonts.

- **Licence:** SIL Open Font License 1.1, in `OFL.txt` (from the same source commit). The subset has a new family name, "Open Plan Test TC", because the OFL asks modified fonts not to use the reserved font name. A distinct name also shows that the test uses this file and not an installed font.
- **Content:** the regular weight (400) of the variable font, and only the characters in `characters.txt`: every character in the text of the sample plan's SVG (room names, areas and dimension numbers).

## Source

| | |
| --- | --- |
| Repository | `https://github.com/google/fonts`, commit `3be1884c48c3e45b52ecc725676a08f87776373e` |
| File | `ofl/notosanstc/NotoSansTC[wght].ttf` (11 941 968 bytes) |
| SHA-256 | `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f` |
| `OFL.txt` SHA-256 | `1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9` |

## Generation

Download the source to a folder outside the repository, then run the script in an isolated environment (fonttools is not a repository dependency):

```sh
curl -fLo 'NotoSansTC[wght].ttf' 'https://raw.githubusercontent.com/google/fonts/3be1884c48c3e45b52ecc725676a08f87776373e/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf'
uv run --no-project --isolated --with fonttools==4.66.1 python make-test-font.py 'NotoSansTC[wght].ttf'
```

The script refuses a source with another SHA-256. The result is the same bytes each time: 13 284 bytes, SHA-256 `9d9fea8d29436113f0b460dead725fdd4ace6c3016764500300dede5ca02cc31`.

If the sample text gets new characters, the CJK test lists them. Add them to `characters.txt`, run the script again, and update the reference with `UPDATE_REFERENCES=1 pnpm vitest run packages/cli/test/render.test.ts`; look at the new reference image before you commit it.
