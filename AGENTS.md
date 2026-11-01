# UCCDS: instructions for AI agents

You are adding chapter detection to a NovelAI user script with the **Universal Customizable Chapter Detection System (UCCDS)**. This file tells you which version to use, how to wire it in, and what you get back. Read it fully before writing code. Humans: README.md is the friendlier version of this.

Everything you paste comes from `dist/`. Never edit the pasted UCCDS code itself: updates are done by pasting the new `dist/` file over the old one, so local edits get lost.

---

## 1. Pick a version

| | **Embedded** (`dist/uccds-core.ts`) | **Dependency** (`dist/uccds-client.ts` + the UCCDS script) |
| :--- | :--- | :--- |
| How it works | The detector is pasted into the script | The script asks the separately installed `UCCDS: Universal Customizable Chapter Detection System` script over `api.v1.messaging` |
| User installs | Just this script | This script **and** UCCDS (from ScriptVault / Discord / GitHub) |
| Chapter rules set | In each script's own Config tab | Once, in UCCDS's Config tab, shared by every script that uses it |
| Calls | Synchronous on a section list, or one `await` for the live document | Every call is an async request that can fail if UCCDS is missing |
| Size added | ~48 KB | ~20 KB |
| Updates to detection | Re-paste the new core and re-release | User updates UCCDS; the script needn't change |

Choose:
- The user said which: do that.
- The script must work on its own, or is going on ScriptVault for people who won't install extras: **embedded**.
- The user has (or plans) several scripts that should agree on chapters, or wants detection updates without re-releasing: **dependency**.
- Not stated and you can ask: ask, in one question, with the two-line trade-off above. Not stated and you can't ask: **embedded**, and say so.

Never paste both files into one script: they share type and helper names and the script won't compile.

## 2. Config options: on by default

By default, let the script's users define what a chapter is. **Add the options from `dist/uccds-config-snippet.yaml` to the script header** unless the user asked you not to.

- **Embedded:** paste the options under `config:` in the `/*--- ... ---*/` header (2-space indent, keep the `- name:` lines aligned with any existing options). The `#` comment lines at the top of the snippet are optional; drop them if the header has no other comments. Then read them with `uccdsLoadSettings()`.
  - Trim options the script has no use for (e.g. drop `chapter_numbering` if the script never shows numbers). A missing option just uses its default.
  - Option names collide with the user's other config? Rename the `name:` and pass the new name: `uccdsLoadSettings(null, { breakToken: 'my_break_token' })`.
  - Option names `chapter_detection_mode`, `detect_bracketed_titles`, `chapter_break_token`, `chapter_numbering` deliberately match Chapter Linter / Markdown Manager / Manuscript Menagerie, so users who know those scripts see familiar options. Menagerie's `chapter_detection_mode: break_token` value is understood too.
- **Dependency:** do **not** add the snippet. The rules live in UCCDS's config and apply to every script. Only add a script option when this script genuinely needs a different rule than the user's global one, and pass it as an override (`settings: {...}`, see §4).
- **User opted out of config options:** skip the snippet and pass fixed settings in code: `uccdsDetectDocument({ boundaryMode: 'dividers' })` (embedded) or `uccdsGetChapters({ settings: {...} })` (dependency). Anything you don't pass uses the defaults below.

### Settings (`UccdsSettings`) and their config option names

| Field | Config option | Values (default first) | Meaning |
| :--- | :--- | :--- | :--- |
| `headerSyntax` | `chapter_detection_mode` | `auto`, `markdown_headings` | `auto` = `#` headings, `[bracketed]` titles and standalone `Chapter X` / `Prologue` / `Part Two` lines |
| `detectBracketedTitles` | `detect_bracketed_titles` | `true`, `false` | `[Chapter 1: Title]`, `[Title]`. NovelAI metadata like `[ Author: X; Tags: Y ]` is never a header |
| `breakToken` | `chapter_break_token` | `"***"` | Extra divider besides `***` / `---` / `___` |
| `onlyBreakToken` | `chapter_only_break_token` | `false`, `true` | Only `breakToken` counts as a divider |
| `boundaryMode` | `chapter_boundary_mode` | `headers`, `headers_and_dividers`, `dividers` | Where chapters start (dividers inside chapters are scene breaks in `headers` mode) |
| `noHeaderFallback` | `chapter_no_header_fallback` | `single`, `dividers` | Story with no headers at all: one chapter, or split on dividers |
| `openingText` | `chapter_opening_text` | `chapter`, `ignore` | Text before the first header: an `opening` entry, or left out |
| `divisionHeaders` | `chapter_division_headers` | `separate`, `chapter` | Part/Book/Act headers: unnumbered `division` entries that group chapters, or numbered chapters |
| `numbering` | `chapter_numbering` | `auto`, `restart`, `continuous` | Whether `sequence` restarts per Book/Part (`auto` = only if the story already does) |
| `chapterKeywords` | `chapter_custom_chapter_words` | `[]` (config: comma list) | The user's own words that start a numbered chapter, e.g. `Section, Episode` |
| `divisionKeywords` | `chapter_custom_part_words` | `[]` | The user's own Part/Book-style words, e.g. `Season, Saga` |
| `specialKeywords` | `chapter_custom_unnumbered_words` | `[]` | The user's own unnumbered words, e.g. `Intro, Afterword` |

### The user's own header words

The built-in words are `Chapter`, `Ch.` (numbered chapters), `Act`, `Book`, `Part`, `Volume`, `Section`, `Arc` (groupings) and `Prologue`, `Prelude`, `Epilogue`, `Interlude` (unnumbered). Anything else, like `[ Intro: ]` or `Episode 4`, needs the three word-list settings above. They're what makes UCCDS work for stories with their own conventions, so **keep these three options in the snippet** even when trimming others.

- Words are case-insensitive, may be multi-word (`Side Story`), and a trailing `.` is optional (`Ep.` matches `Ep 4` and `Ep. 4`). Words with digits, brackets, `:`, `;`, `|` or `,` in them are ignored.
- A user word moves out of the built-in list it was in: `chapterKeywords: ['Section']` makes `[ Section 3: ]` a numbered chapter instead of a Part. Between the user's own lists, chapter beats part beats unnumbered.
- An unnumbered user word gets its kind from where it sits: before the first numbered chapter it's a `prologue`, after the last an `epilogue`, in between an `interlude`. Built-in `Prologue`/`Epilogue`/etc. keep their own kind.
- In config the lists are comma-separated text; in code pass an array or the same text. In a dependency request override, a list **replaces** the user's list.
- Labels follow the word: `Section 3`, `Intro`. The title is the header as written (`Section 2: The Pass`).

**When a script rewrites or exports headers, never hard-code "Chapter".** Use `uccdsHeaderWord(ch)` (returns `"Section"` for `[ Section 3: ]`, `"Intro"` for `[ Intro: ]`, and `"Chapter"` for Chapter / Ch. / keyword-less headers), or `ch.header.keyword` directly, so the user's own words survive linting and reformatting.

---

## 3. Embedded: wiring it in

1. Paste all of `dist/uccds-core.ts` **after the header comment and before the script's own code**. Order inside the file matters; paste it whole.
2. Add the config options (§2).
3. Use it:

```typescript
// Live document, user's config:
const settings = await uccdsLoadSettings();                 // reads the config options
const result = await uccdsDetectDocument(settings);         // scan + detect
for (const ch of result.chapters) {
    api.v1.log(`${ch.label}: ${ch.title} (${ch.wordCount} words)`);
}

// Any section list (pure, synchronous): an imported file, test data, a filtered document
const lines = fileText.split('\n').map((text: string, i: number) => ({ sectionId: i, text }));
const fromFile = uccdsDetectChapters(lines, settings);

// One line as a header
const h = uccdsParseHeader("Book 2: Chapter IV - Rain", settings); // h.kind 'chapter', h.number 4, h.cleanName 'Rain'
```

Also available: `uccdsHeaderWord(ch)`, `uccdsScanSections()`, `uccdsNormalizeSettings(partial)`, `uccdsIsDivider(text, settings)`, `uccdsSignature(sections, settings, includeText)`, and the parser's own `chParseHeader`, `chIsDivider`, `chParseNumber`, `chToRoman`, `chDisplayTitle`, `chNormalizeTitle`, `chStripEmphasis`, `chCountWords`.

Name rules for the script's own code: don't declare anything starting with `uccds`, `Uccds`, `UCCDS_`, `ch` + capital letter, or `CH_`, and don't declare `HeaderDetectionOptions`, `ParsedHeader`, `ChapterKind` or `HeaderSyntax`.

## 4. Dependency: wiring it in

1. Paste all of `dist/uccds-client.ts` after the header comment and before the script's own code.
2. Say in the script's `description:` that it needs **UCCDS: Universal Customizable Chapter Detection System** installed and enabled. No permissions are needed for messaging.
3. Handle UCCDS being missing: check once at start-up and show a short install hint instead of failing silently. Every client call throws an `Error` with an install hint when UCCDS doesn't answer.
4. Use it:

```typescript
async function init(): Promise<void> {
    if (!(await uccdsIsAvailable())) {          // waits up to 4 s: UCCDS may load after this script
        await showInstallHint();                // your own UI
        return;
    }
    let chapters = await uccdsGetChapters({ includeText: false });   // titles, ids, counts only
    await uccdsOnChaptersChanged(async () => {                      // after edits, generations, undo
        const next = await uccdsGetChaptersIfChanged(chapters, { includeText: false });
        if (next) { chapters = next; await redraw(); }
    });
}
init().catch((err: any) => api.v1.error("init failed:", err));
```

Calls (all async; all except the first two throw when UCCDS is missing):
- `uccdsIsAvailable(timeoutMs?)` → `boolean`; `uccdsConnect(timeoutMs?)` → `UccdsServiceInfo | null`; `uccdsDependencyInfo()` (sync) → `{ scriptId, version, protocol } | null`
- `uccdsGetChapters(request?)` → `UccdsResult`
- `uccdsGetChaptersIfChanged(previous, request?)` → `UccdsResult | null` (null = unchanged; cheap)
- `uccdsParseHeaderRemote(text, settings?)` → `UccdsHeader`; `uccdsParseHeadersRemote(texts, settings?)` → `UccdsHeader[]`
- `uccdsGetUserSettings()` → `UccdsSettings` (what the user picked in UCCDS)
- `uccdsOnChaptersChanged(listener, { waitForService? })`, `uccdsStopListening()`. Listeners are also called when UCCDS loads or reloads. With `waitForService: true` the call doesn't throw when UCCDS is missing; the listener starts working once UCCDS loads (use this when the script falls back to its own detection)

`request` (`UccdsDetectRequest`): `settings` = overrides on top of the user's UCCDS config; `ignoreUserConfig: true` = defaults + overrides only (use only when the script must not follow the user's rules, and say so in its description); `includeText: false` = no paragraphs (keep messages small; fetch text only for the chapters you actually need).

The pure helpers are in the client too: `uccdsChapterText`, `uccdsChapterAt`, `uccdsChapterByKey`, `uccdsChaptersOfKind`, `uccdsHeaderWord`, `uccdsLooksLikeDivider`. The parser is **not**: use `uccdsParseHeaderRemote` instead of `chParseHeader`.

Name rules: as for embedded, minus the `ch`/`CH_` parser names.

---

## 5. What you get back

`UccdsResult`: `chapters`, `settings` (defaults filled in), `hasHeaders`, `restartsPerDivision`, `signature` (equal = identical result), `sectionCount`, `totalWords`, `includesText`.

`UccdsChapter` (all plain, serializable values):

| Field | Notes |
| :--- | :--- |
| `kind` | `chapter`, `title` (header without a keyword, e.g. `# The Gathering`), `prologue`, `epilogue`, `interlude`, `division` (Part/Book/Act), `opening` (text before the first header), `untitled` (no header: split on dividers, or the whole story) |
| `title` | As written, cleaned: `Chapter IV: Echoes`, `Prologue: The Fall`, `The Gathering`, `Opening text`, `Chapter 3` (untitled), `Full story` |
| `name` | Title text only (`Echoes`), `""` when untitled |
| `label` | Short, for lists: `Ch. 4`, `Section 3` (user word), `Prologue`, `Intro`, `Book 2 Ch. 1`, `Opening` |
| `number` | Number as written; an unnumbered chapter gets previous + 1. `null` for prologue/epilogue/interlude/division/opening. Can repeat across Books, or when a divider split sits between written numbers |
| `sequence` | Running count 1, 2, 3 over numbered chapters, restarting per Book/Part when `restartsPerDivision`. Use this for "the Nth chapter" |
| `division` | Book/Part the chapter sits in (`Book 2`) or `""` |
| `header` | Parsed header (`UccdsHeader`) or `null` |
| `rawHeader` | Header paragraph as written |
| `key` | Header section id (or first section id). Stable while the header paragraph exists: use it to remember a chapter between calls and in storage |
| `headerSectionId`, `startSectionId`, `endSectionId` | Section ids; `start` is the divider above the header when there is one |
| `sectionIds` | Every section in the chapter (divider, header, body) |
| `bodySectionIds` / `paragraphs` | Body only, aligned 1:1 (`paragraphs[i]` is the text of `bodySectionIds[i]`). Inner `***` scene breaks stay; blank paragraphs at either end are trimmed. `paragraphs` is `[]` when text wasn't requested |
| `wordCount`, `charCount` | Body only, dividers not counted |

Text for a prompt: `uccdsChapterText(ch, { includeHeader: true, separator: "\n\n", dropDividers: true, breakToken: result.settings.breakToken })`.

Editing the document: section ids go straight into `api.v1.document.updateParagraph(s)` / `insertParagraphAfter` / `removeParagraphs` (needs the `documentEdit` permission). Results go stale as soon as the document changes, so re-detect right before writing, and edit bottom-to-top when inserting.

Chapter under the cursor: `const sel = await api.v1.editor.selection.get(); const ch = uccdsChapterAt(result, sel.from.sectionId);`

---

## 6. Protocol (only if you can't use the client)

Channel `"uccds"`, protocol `1`. Requests are `{ type, requestId, protocol: 1, payload }`; broadcast them until you know the dependency's script id (from any reply's `fromScriptId` or a `uccds:ready` broadcast), then `send` to it. Don't hard-code its id.

| `type` | `payload` | reply `data` |
| :--- | :--- | :--- |
| `uccds:ping` | — | `{ scriptId, version, protocol }` (answers on any protocol) |
| `uccds:detect` | `UccdsDetectRequest` | `{ unchanged: true, signature }` or `{ unchanged: false, signature, result }` |
| `uccds:parseHeader` | `{ text }` or `{ texts }`, optional `settings`, `ignoreUserConfig` | `UccdsHeader` or `UccdsHeader[]` |
| `uccds:getSettings` | optional `settings`, `ignoreUserConfig` | `UccdsSettings` |
| `uccds:subscribe` / `uccds:unsubscribe` | — | `{ signature, chapterCount }` / `{ subscribed: false }` |

Replies: `{ type: 'uccds:reply', requestId, protocol, ok, data, error? }`, sent only to the requester. Events from the dependency: `uccds:ready` (broadcast when it loads; subscribers must subscribe again) and `uccds:changed` (`{ signature, chapterCount }`, to subscribers when the chapters under the user's settings change).

---

## 7. NovelAI reminders that matter here

- Wrap every `await` chain in `try/catch` or `.catch(...)`: rejected promises in the worker are silent.
- No global `setTimeout`: the client already uses `api.v1.timers`. Use `api.v1.timers.sleep` for your own polling.
- Annotate every parameter type (`(ch: UccdsChapter) => ...`), cast `Object.entries` results, and type-check the final bundle against the official `script-types.d.ts` before handing it over (`tools/typecheck.js` in this repo does that).
- Don't keep results in globals across reloads; re-detect on load. Store `key`s, not indexes, if you persist a chapter choice.
- Typing in the editor has no hook. Embedded scripts that need live updates poll (`await api.v1.timers.sleep(10000)` in a loop, compare `result.signature`); dependency scripts use `uccdsOnChaptersChanged`.
- When building GLM-4.6 prompts from chapters, label each chapter clearly (`--- [Chapter 3: The Fall] ---`) and keep scene breaks out unless they matter (`dropDividers: true`).

## 8. Credit

MIT licensed: use, change and redistribute freely. A credit line is appreciated, never required, e.g. in the script description: `Chapter detection: UCCDS by MidMeantime`.
