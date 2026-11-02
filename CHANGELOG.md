# Changelog

## 1.0.0 (2026-10-29)

First public release.

- Header parser shared with Chapter Linter, Markdown Manager and ChatGLM v2 (markdown / bracket / keyword headers, Prologue / Prelude / Interlude / Epilogue, Part / Book / Act / Volume / Section / Arc, stacked labels like `Book 2: Chapter 3`, strict Roman numerals, number words, NovelAI metadata brackets ignored).
- Chapter segmentation with user options: where chapters start (headers / headers and bare dividers / dividers only), stories without headers, opening text, Part/Book headers, numbering across books.
- Embedded version (`dist/uccds-core.ts`) and dependency version (`dist/UCCDS_v1.0.0.naiscript` + `dist/uccds-client.ts`, messaging protocol 1) with change notifications.
- **Dual version** (`dist/uccds-dual.ts`): the built-in detector, plus the UCCDS script whenever it's installed and enabled. Start-up never waits for UCCDS; the source switches when UCCDS turns up (`onChange('source')`), falls back to built-in in the same call if UCCDS stops answering, and switches back when it reloads. Calls: `uccdsDualStart`, `uccdsDualGetChapters`, `uccdsDualGetChaptersIfChanged`, `uccdsDualSource`, `uccdsDualSettings`, `uccdsDualDependencyInfo`, `uccdsDualOnChange`, `uccdsDualReloadSettings`.
- Example scripts for all three versions, and AGENTS.md for AI-assisted script writing.
- User-defined header words: `chapter_custom_chapter_words`, `chapter_custom_part_words`, `chapter_custom_unnumbered_words` (e.g. `Section`, `Season`, `Intro`). They work in every header style, override the built-in group a word was in, and unnumbered words take their kind from their position. Labels use the user's word (`Section 3`), and `uccdsHeaderWord()` gives scripts the word to keep when rewriting headers.
- Client: `uccdsOnChaptersChanged(fn, { waitForService: true })` keeps the listener when UCCDS isn't loaded yet; listeners are told when UCCDS loads or reloads.
- UCCDS's `src/chapter-headers.ts` is now the source of truth for the parser; `npm run sync` pushes it to `Editorial/shared`.
