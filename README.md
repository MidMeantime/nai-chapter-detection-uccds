# UCCDS: Universal Customizable Chapter Detection System

*A scripter's resource for NovelAI.*

UCCDS finds the chapters in a NovelAI story: `# Markdown` headings, `[Chapter 3: Bracketed]` titles, plain `Chapter IV: Echoes` lines, Prologue / Prelude / Interlude / Epilogue, Part / Book / Act / Volume groupings, Roman numerals and spelled-out numbers, scene breaks, while excluding NovelAI metadata brackets (`[ Author: X; Tags: Y ]`) and much more.

It comes three ways:

| | **Embedded** | **Dependency** | **Dual** |
| :--- | :--- | :--- | :--- |
| What you add to your script | `dist/uccds-core.ts` (~58 KB) | `dist/uccds-client.ts` (~23 KB) | `dist/uccds-dual.ts` (~77 KB) |
| What your users install | Just your script | Your script **and** the UCCDS script | Just your script (UCCDS optional) |
| Where users set chapter rules | Your script's Config tab | Once, in UCCDS. Every UCCDS script follows it | Your Config tab, or UCCDS's if it's installed |
| Detection updates | You re-paste and re-release | Users update UCCDS; your script stays the same | From UCCDS for users who have it |

**Dual** is "works on its own, plays nice with UCCDS": the detector is built in, and if the user also has the UCCDS script enabled, your script quietly switches to it (and back, if they turn it off).

All pieces of this system are free to use, change and redistribute any way. I'd obviously love a credit if you do, but it's far from required :]

> **Using an AI agent to write your script?** Point it at [`AGENTS.md`](AGENTS.md). It covers all three versions, when to pick which, and wires in the user-facing config options by default (tell it if you'd rather skip them).

---

## What counts as a chapter (the options)

By default, scripts expose these options so users can decide what a "chapter" means for their story. They're in `dist/uccds-config-snippet.yaml`; the embedded version reads them from your script's config, the dependency reads them from UCCDS's own config.

| Option | Choices (default first) | What it does |
| :--- | :--- | :--- |
| Header Style (`chapter_detection_mode`) | Auto · Markdown headings only | Auto = `#` headings, `[bracketed]` titles and standalone `Chapter X` / `Prologue` / `Part Two` lines |
| Detect Bracketed Titles (`detect_bracketed_titles`) | On · Off | `[Chapter 1: Title]` and `[Title]` headers |
| Break Token (`chapter_break_token`) | `***` | An extra divider besides `***` / `---` / `___` |
| Only Use My Break Token (`chapter_only_break_token`) | Off · On | A lone `---` stays plain text |
| Where Chapters Start (`chapter_boundary_mode`) | At headers · At headers and bare dividers · Only at dividers | In the default, `***` inside a chapter is a scene break, not a new chapter |
| Story Without Headers (`chapter_no_header_fallback`) | One chapter · Split on dividers | For stories with no headers at all |
| Text Before the First Header (`chapter_opening_text`) | Keep as "Opening" · Leave out | Prefaces, notes, unlabelled prologues |
| Part / Book / Act Headers (`chapter_division_headers`) | Group chapters (unnumbered) · Count as chapters | |
| Numbering Across Books / Parts (`chapter_numbering`) | Auto · Restart per book · Continuous | Auto restarts only when the story already does |
| My Chapter Words (`chapter_custom_chapter_words`) | e.g. `Section, Episode` | Your own words that start a numbered chapter |
| My Part / Book Words (`chapter_custom_part_words`) | e.g. `Season, Saga` | Your own words that group chapters |
| My Unnumbered Section Words (`chapter_custom_unnumbered_words`) | e.g. `Intro, Afterword` | Before the first chapter they're a prologue, after the last an epilogue, in between an interlude |

The option names match Chapter Linter, Markdown Manager and Manuscript Menagerie where they overlap.

**Your own header words.** Out of the box UCCDS knows Chapter / Ch., Part / Book / Act / Volume / Section / Arc, and Prologue / Prelude / Epilogue / Interlude. If your story uses something else, list it in the "My ... Words" options. For a story whose headers are `[ Intro: ]` and `[ Section 1: ]`, `[ Section 2: ]`..., set **My Chapter Words** to `Section` and **My Unnumbered Section Words** to `Intro`. Your words work in every header style (`[ Section 3: ]`, `# Section 3`, `Section 3: Title`), and a word you list moves out of its built-in group (Section stops being a Part word).

---

## Quick Start

### Embedded

1. Paste all of [`dist/uccds-core.ts`](dist/uccds-core.ts) into your script, right after the `/*--- ... ---*/` header.
2. Paste the options from [`dist/uccds-config-snippet.yaml`](dist/uccds-config-snippet.yaml) under `config:` in your header (keep only the ones you want).
3. Detect:

```typescript
const settings = await uccdsLoadSettings();          // the user's choices from your Config tab
const result = await uccdsDetectDocument(settings);  // scan the story and split it into chapters
for (const ch of result.chapters) {
    api.v1.log(`${ch.label}: ${ch.title}, ${ch.wordCount} words`);
}
```

`uccdsDetectChapters(sections, settings)` does the same on any list of `{ sectionId, text }` (an imported file, say) without touching the document, and `uccdsParseHeader(line, settings)` parses a single line. See [`examples/embedded/main.ts`](examples/embedded/main.ts) for a complete little script.

### Dependency

1. Install **UCCDS** ([`dist/UCCDS_v1.0.0.naiscript`](dist/UCCDS_v1.0.0.naiscript), or from ScriptVault) and enable it in your story.
2. Paste all of [`dist/uccds-client.ts`](dist/uccds-client.ts) into your script after its header. Mention in your description that it needs UCCDS.
3. Ask for chapters:

```typescript
if (!(await uccdsIsAvailable())) {
    // tell the user to install/enable UCCDS
} else {
    let result = await uccdsGetChapters({ includeText: false });
    await uccdsOnChaptersChanged(async () => {
        const next = await uccdsGetChaptersIfChanged(result, { includeText: false });
        if (next) result = next; // ...and redraw
    });
}
```

Requests use the rules the user set in UCCDS. Pass `settings: { ... }` to override a rule for your script only. See [`examples/dependency/main.ts`](examples/dependency/main.ts).

### Dual

1. Paste all of [`dist/uccds-dual.ts`](dist/uccds-dual.ts) into your script after its header (instead of the other two files, never alongside them).
2. Paste the options from [`dist/uccds-config-snippet.yaml`](dist/uccds-config-snippet.yaml) under `config:`. They apply while UCCDS isn't installed; mention in your description that UCCDS's rules win when it is.
3. Ask for chapters:

```typescript
let result: UccdsResult | null = null;
await uccdsDualStart({                       // reads your options, looks for UCCDS in the background
    onChange: async (reason: UccdsDualChangeReason) => {   // 'source' (UCCDS appeared / went away) or 'chapters'
        const next = reason === 'source' ? await uccdsDualGetChapters() : await uccdsDualGetChaptersIfChanged(result);
        if (next) result = next; // ...and redraw
    }
});
result = await uccdsDualGetChapters();
uccdsDualSource();                           // 'embedded' or 'dependency', if you want to show it
```

See [`examples/dual/main.ts`](examples/dual/main.ts). **Manuscript Menagerie** uses this version.

The UCCDS script also has a small **UCCDS Chapters** script panel that shows exactly what it detects, which is handy while tuning the options.

---

## What a chapter looks like

Each entry in `result.chapters`:

| Field | Example | Notes |
| :--- | :--- | :--- |
| `kind` | `chapter` | also `title`, `prologue`, `epilogue`, `interlude`, `division`, `opening`, `untitled` |
| `title` / `name` / `label` | `Chapter IV: Echoes` / `Echoes` / `Ch. 4` | |
| `number` / `sequence` | `4` / `4` | `number` follows the headers as written; `sequence` is the running count (restarting per book when it should) |
| `division` | `Book 2` | the Part/Book it sits in |
| `key` | `1234` | the header's section id: stable, good for remembering a chapter |
| `sectionIds`, `bodySectionIds`, `headerSectionId`, `startSectionId`, `endSectionId` | | for reading or editing the document |
| `paragraphs` | `["It rained.", "***", "..."]` | body text, lined up with `bodySectionIds` |
| `wordCount`, `charCount` | | body only |

`uccdsChapterText(ch, { includeHeader: true, separator: "\n\n" })` joins a chapter back into text; `uccdsChapterAt(result, sectionId)` finds the chapter around a paragraph. The full reference is in [`AGENTS.md`](AGENTS.md).

---

## Project Structure

```
src/chapter-headers.ts     # the header parser (shared with the Editorial scripts)
src/uccds-types.ts         # result / settings / protocol types
src/uccds-helpers.ts       # pure helpers on results (in both the core and the client)
src/uccds-core.ts          # sections -> chapters, settings, config loading
src/client/                # the dependency client
src/dual/                  # the dual layer (built-in detector + the dependency when it's installed)
src/service/               # the UCCDS dependency script (messaging, change watch, preview panel)
src/config-snippet.yaml    # the user-facing options, injected into headers at build time
examples/                  # one small script per version
tests/                     # parser, segmenter, dependency+client and dual end-to-end over a mock message bus
tools/                     # bundler, strict type check against the official NovelAI types, test harness
```

## Contributing

Contributions are more than welcome! A full contribution guide with development setup, code style guidelines, and PR process will be released soon.

Feature requests and bug reports are encouraged — please open a [GitHub Issue](https://github.com/MidMeantime/nai-chapter-detection-uccds/issues) or throw me a message in the Discord thread.

```
npm install
npm run check    # build everything into dist/, type-check each file, run all tests
```
## Related Projects
#### Scripts that use UCCDS
*( feel free to ask to be added to this list! the more the merrier :] )*
- Chapter Linter — a simple ui for keeping your in-editor chapters neat and tidy
- Markdown Manager — qol script for painless importing/exporting of your story
- Manuscript Menagerie — all-in-one workspace for chapter analysis and summaries
- [ChatGLM v2](https://storyscriptvault.com/scripts/chatglm-v2-NjB10u) (v1 by piersf) — turns GLM into a chatbot to discuss your current story

## Links

- My other scripts: https://storyscriptvault.com/users/MidMeantime
- Like my work? https://buymeacoffee.com/midmeantime

MIT License, see [LICENSE](LICENSE).
