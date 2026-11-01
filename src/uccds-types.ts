// --- UCCDS shared types (used by both the embedded core and the dependency client) ---
// Everything here is a plain, serializable shape so chapter results can travel between scripts
// through api.v1.messaging. Names are prefixed `Uccds` / `UCCDS_` to stay clear of script-level names.

/** Version of the message protocol between the UCCDS dependency script and its clients */
const UCCDS_PROTOCOL = 1;
/** Messaging channel every UCCDS message uses */
const UCCDS_CHANNEL = "uccds";

/**
 * What a chapter is.
 * - chapter / title / prologue / epilogue / interlude / division: from a detected header
 *   ('title' = a header with no keyword, like "# The Gathering")
 * - opening: text before the first header
 * - untitled: a chapter with no header (split on dividers, or the whole story when it has no headers)
 */
type UccdsChapterKind = 'chapter' | 'title' | 'prologue' | 'epilogue' | 'interlude' | 'division' | 'opening' | 'untitled';

/** A parsed header line. Same shape as the parser's ParsedHeader, written out so the client needs no parser. */
interface UccdsHeader {
    isHeader: boolean;
    syntax: 'markdown' | 'bracket' | 'keyword' | null;
    /** Markdown heading level (1-6); 0 for bracket/keyword headers */
    level: number;
    kind: 'chapter' | 'title' | 'prologue' | 'epilogue' | 'interlude' | 'division';
    /** Label exactly as written, minus trailing separator: "Chapter 3", "Part 1: Chapter 3", "IV", "" */
    labelText: string;
    /** Innermost keyword ("Chapter", "Part", "Prologue"); "" for bare numbers and titles */
    keyword: string;
    /** Innermost number as written ("IV", "8", "Twenty-One"); "" when there is none */
    numberText: string;
    /** Innermost number as a value, or null */
    number: number | null;
    /** Title text after the label: "The Dark Forest"; "" when the header is only a label */
    cleanName: string;
    /** The paragraph started with its own divider line ("***\n# Chapter 1") */
    hasEmbeddedDivider: boolean;
    /** Division written before the chapter on the same line: "Book 2" in "Book 2: Chapter 3" */
    divisionLabel: string;
    divisionNumber: number | null;
}

/**
 * Everything that decides what counts as a chapter. All fields have defaults (UCCDS_DEFAULT_SETTINGS);
 * scripts usually expose them as config options (see config-snippet.yaml).
 */
interface UccdsSettings {
    /** 'auto' = markdown headings, [bracketed] titles and standalone "Chapter X" lines; 'markdown_headings' = # lines only */
    headerSyntax: 'auto' | 'markdown_headings';
    /** Detect [Chapter 1: Title] / [Title] headers. NovelAI metadata like [ Author: X; Tags: Y ] is always ignored */
    detectBracketedTitles: boolean;
    /** Scene/chapter divider recognised besides *** / --- / ___ */
    breakToken: string;
    /** Only breakToken counts as a divider (a lone --- stays normal text) */
    onlyBreakToken: boolean;
    /**
     * Where chapters start:
     * - 'headers': at chapter headers; dividers inside a chapter are scene breaks (default)
     * - 'headers_and_dividers': at headers, and at any divider that isn't directly above a header
     * - 'dividers': only at dividers; a header right under a divider names that chapter
     */
    boundaryMode: 'headers' | 'headers_and_dividers' | 'dividers';
    /** When the story has no headers at all: one 'untitled' chapter, or split it on dividers */
    noHeaderFallback: 'single' | 'dividers';
    /** Text before the first header: its own 'opening' chapter, or left out of the chapter list */
    openingText: 'chapter' | 'ignore';
    /** Part / Book / Act headers: their own unnumbered 'division' entries that group the chapters under them, or plain numbered chapters */
    divisionHeaders: 'separate' | 'chapter';
    /** `sequence` numbering across Books/Parts: restart at 1 in each, continuous, or 'auto' (restart only if the story already does) */
    numbering: 'auto' | 'restart' | 'continuous';
    // The user's own header words, added to the built-in ones. Case-insensitive, multi-word allowed.
    // A word moves out of the built-in list it was in: ['Section'] makes "Section 3" a chapter
    // instead of a Part. In request overrides, a list replaces the user's list (it doesn't add to it).
    /** Start a numbered chapter, like "Chapter" (e.g. Section, Episode, Scene) */
    chapterKeywords: string[];
    /** Group chapters, like "Part" / "Book" (e.g. Saga, Season) */
    divisionKeywords: string[];
    /**
     * Unnumbered sections, like "Prologue" (e.g. Intro, Foreword, Afterword). Their kind follows
     * their place: before the first numbered chapter 'prologue', after the last 'epilogue', else 'interlude'
     */
    specialKeywords: string[];
}

/** One chapter (or division / opening text) of the story */
interface UccdsChapter {
    /** Position in the returned list (0-based) */
    index: number;
    /** Stable key: the header's section id, or the first section id when there is no header */
    key: number;
    kind: UccdsChapterKind;
    /** Full display title: "Chapter 3: The Fall", "Prologue", "Book 2: Return", "The Gathering" */
    title: string;
    /** Title text without the label ("The Fall"); "" when untitled */
    name: string;
    /** Short label: "Ch. 3", "Prologue", "Book 2", "Opening" */
    label: string;
    /** Chapter number as written; unnumbered chapters get previous + 1. Null for specials, divisions and opening text */
    number: number | null;
    /** Running chapter count (1, 2, 3...), restarting per Book/Part when `numbering` says so. Null where `number` is null */
    sequence: number | null;
    /** The Book/Part/Act this chapter sits in ("Book 2"), or "" */
    division: string;
    /** The parsed header, or null for opening/untitled chapters */
    header: UccdsHeader | null;
    /** Header paragraph as written (embedded divider line removed); "" when there is none */
    rawHeader: string;
    /** Section id of the header paragraph, or null */
    headerSectionId: number | null;
    /** First section of the chapter (the divider above the header, when there is one) */
    startSectionId: number;
    /** Last section of the chapter */
    endSectionId: number;
    /** Every section id in the chapter, in order: boundary divider, header, body */
    sectionIds: number[];
    /** Body section ids (no boundary divider, no header). Inner scene-break dividers stay */
    bodySectionIds: number[];
    /** Body paragraphs, in order. Empty when the request asked for no text */
    paragraphs: string[];
    wordCount: number;
    charCount: number;
}

interface UccdsResult {
    chapters: UccdsChapter[];
    /** The settings the result was made with (defaults filled in) */
    settings: UccdsSettings;
    /** At least one header was found */
    hasHeaders: boolean;
    /** `sequence` restarts in each Book/Part */
    restartsPerDivision: boolean;
    /** Fingerprint of the document + settings; equal signatures mean an identical result */
    signature: string;
    sectionCount: number;
    totalWords: number;
    /** False when the request asked for no text (paragraphs are empty) */
    includesText: boolean;
}

/** Plain section shape the core works on. Build it from api.v1.document.scan() */
interface UccdsSection {
    sectionId: number;
    text: string;
}

// --- Dependency protocol (client <-> UCCDS dependency script, channel "uccds") ---

interface UccdsDetectRequest {
    /** Overrides applied on top of the settings the user chose in the UCCDS dependency's config */
    settings?: Partial<UccdsSettings>;
    /** Ignore the dependency's config and use defaults + `settings` only. Default false */
    ignoreUserConfig?: boolean;
    /** Include chapter paragraphs. Default true; false returns ids, titles and counts only */
    includeText?: boolean;
    /** Signature from an earlier result: when nothing changed the reply is { unchanged: true } and no chapters */
    sinceSignature?: string;
}

type UccdsRequestType = 'uccds:ping' | 'uccds:detect' | 'uccds:parseHeader' | 'uccds:getSettings' | 'uccds:subscribe' | 'uccds:unsubscribe';

interface UccdsRequestMessage {
    type: UccdsRequestType;
    requestId: string;
    protocol: number;
    payload?: any;
}

interface UccdsReplyMessage {
    type: 'uccds:reply';
    requestId: string;
    protocol: number;
    ok: boolean;
    error?: string;
    data?: any;
}

/** Sent by the dependency: 'uccds:ready' when it loads, 'uccds:changed' to subscribers when the chapters change */
interface UccdsEventMessage {
    type: 'uccds:ready' | 'uccds:changed';
    protocol: number;
    version: string;
    signature?: string;
    chapterCount?: number;
}

interface UccdsServiceInfo {
    /** The dependency's script id (for targeted messages) */
    scriptId: string;
    version: string;
    protocol: number;
}
