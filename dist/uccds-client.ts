// UCCDS v1.0.0 client: use the UCCDS dependency script from your own script
// Paste everything below into your script, after its /*--- ... ---*/ header and before your own code.
// Needs the "UCCDS: Universal Customizable Chapter Detection System" script installed and enabled.
// Main calls: uccdsIsAvailable(), uccdsGetChapters(), uccdsGetChaptersIfChanged(prev), uccdsOnChaptersChanged(fn).
// Do not paste this AND uccds-core.ts into the same script: they share type and helper names.
// Want both (built in, and the UCCDS script when it is installed)? Use uccds-dual.ts instead.
// Free to use, share and change (MIT). By MidMeantime: https://storyscriptvault.com/users/MidMeantime

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

// --- UCCDS result helpers (pure; shared by the embedded core and the dependency client) ---

/** Divider check for helpers: *** / --- / ___ (spaced or not), – – –, — — —, or the given token */
function uccdsLooksLikeDivider(text: string, breakToken?: string, onlyBreakToken: boolean = false): boolean {
    const t = (text || "").trim();
    if (!t) return false;
    if (breakToken && breakToken.trim() && t === breakToken.trim()) return true;
    if (onlyBreakToken && breakToken && breakToken.trim()) return false;
    if (t === "– – –" || t === "— — —") return true;
    return /^(?:\*\s*){3,}$/.test(t) || /^(?:-\s*){3,}$/.test(t) || /^(?:_\s*){3,}$/.test(t);
}

/**
 * A chapter's text. By default the body only, paragraphs joined with "\n" (NovelAI's own line breaks).
 * dropDividers removes scene-break lines (pass the result's settings.breakToken for custom tokens).
 */
function uccdsChapterText(chapter: UccdsChapter, options?: { includeHeader?: boolean; separator?: string; dropDividers?: boolean; breakToken?: string; dropBlank?: boolean }): string {
    const o = options || {};
    const sep = typeof o.separator === 'string' ? o.separator : "\n";
    let paras = chapter.paragraphs;
    if (o.dropDividers) paras = paras.filter((p: string) => !uccdsLooksLikeDivider(p, o.breakToken));
    if (o.dropBlank) paras = paras.filter((p: string) => p.trim().length > 0);
    const body = paras.join(sep);
    if (o.includeHeader && chapter.rawHeader) return body ? `${chapter.rawHeader}${sep}${body}` : chapter.rawHeader;
    return body;
}

/** The chapter that holds a section id, or null */
function uccdsChapterAt(result: UccdsResult, sectionId: number): UccdsChapter | null {
    for (const ch of result.chapters) {
        if (ch.sectionIds.indexOf(sectionId) !== -1) return ch;
    }
    return null;
}

/** Chapters of the given kinds, e.g. uccdsChaptersOfKind(result, ['chapter', 'title', 'untitled']) */
function uccdsChaptersOfKind(result: UccdsResult, kinds: UccdsChapterKind[]): UccdsChapter[] {
    return result.chapters.filter((ch: UccdsChapter) => kinds.indexOf(ch.kind) !== -1);
}

/** The chapter with this key (header section id), or null. Keys survive edits elsewhere in the story */
function uccdsChapterByKey(result: UccdsResult, key: number): UccdsChapter | null {
    for (const ch of result.chapters) {
        if (ch.key === key) return ch;
    }
    return null;
}

/**
 * The word to keep when a script rewrites or reformats this chapter's header: "Section" for
 * "[ Section 3: ]", "Intro" for "[ Intro: ]", "Prologue" for a prologue, and `fallback`
 * ("Chapter") when the header said Chapter / Ch. or had no keyword. Use it instead of hard-coding
 * "Chapter", so users' own header words survive linting and exporting.
 */
function uccdsHeaderWord(chapter: UccdsChapter, fallback: string = "Chapter"): string {
    const h = chapter.header;
    const kw = h && h.keyword ? h.keyword.trim() : "";
    const key = kw.replace(/\.$/, "").toLowerCase();
    if (!kw || key === "chapter" || key === "ch") return fallback;
    return kw;
}

// --- UCCDS client: ask the UCCDS dependency script for chapters ---
// Paste this file (dist/uccds-client.ts, which already includes the types and helpers) into your
// script. Needs the "UCCDS: Universal Customizable Chapter Detection System" script installed and
// enabled in the same story. No permissions are needed for messaging.
//
//   const result = await uccdsGetChapters();            // UccdsResult, the user's own chapter rules
//   for (const ch of result.chapters) api.v1.log(ch.label, ch.title, ch.wordCount);
//   await uccdsOnChaptersChanged(async () => { ... });  // re-fetch when the story's chapters change
//
// Every call rejects with an Error when UCCDS isn't installed or doesn't answer in time, so wrap
// calls in try/catch and tell the user to install UCCDS (uccdsIsAvailable() checks first).

/** How long a request waits for the dependency before failing (ms) */
const UCCDS_REQUEST_TIMEOUT = 5000;
/** How long uccdsConnect() keeps looking for the dependency (ms) */
const UCCDS_CONNECT_TIMEOUT = 4000;
const UCCDS_MISSING_MESSAGE = "UCCDS didn't answer. Is the \"UCCDS: Universal Customizable Chapter Detection System\" script installed and enabled?";

interface UccdsPendingRequest {
    resolve: (data: any) => void;
    reject: (err: Error) => void;
    timer: number;
}

const uccdsClient: {
    started: boolean;
    starting: Promise<void> | null;
    service: UccdsServiceInfo | null;
    pending: Record<string, UccdsPendingRequest>;
    counter: number;
    changeListeners: ((event: UccdsEventMessage) => void | Promise<void>)[];
    subscribed: boolean;
} = {
    started: false,
    starting: null,
    service: null,
    pending: {},
    counter: 0,
    changeListeners: [],
    subscribed: false
};

function uccdsClientHandle(message: ScriptMessage): void {
    const msg: any = message.data;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;

    if (msg.type === 'uccds:reply') {
        const pending = uccdsClient.pending[msg.requestId];
        if (!pending) return; // someone else's, or already timed out
        delete uccdsClient.pending[msg.requestId];
        api.v1.timers.clearTimeout(pending.timer).catch(() => { /* already fired */ });
        if (!uccdsClient.service || uccdsClient.service.scriptId !== message.fromScriptId) {
            const info: any = msg.data && msg.data.scriptId ? msg.data : null;
            uccdsClient.service = { scriptId: message.fromScriptId, version: info ? info.version : "", protocol: msg.protocol };
        }
        if (msg.ok) pending.resolve(msg.data);
        else pending.reject(new Error(msg.error || "UCCDS request failed."));
        return;
    }

    if (msg.type === 'uccds:ready') {
        uccdsClient.service = { scriptId: message.fromScriptId, version: msg.version || "", protocol: msg.protocol };
        // The dependency (re)loaded or turned up late: sign up again, and tell listeners, since
        // the chapters may now come from a different source or different settings
        if (uccdsClient.changeListeners.length > 0) {
            uccdsClient.subscribed = false;
            uccdsSubscribe()
                .then(() => uccdsNotifyListeners({ type: 'uccds:changed', protocol: msg.protocol, version: msg.version || "" }))
                .catch((err: any) => api.v1.log("UCCDS client: re-subscribe failed:", err));
        }
        return;
    }

    if (msg.type === 'uccds:changed') {
        uccdsNotifyListeners(msg as UccdsEventMessage);
    }
}

function uccdsNotifyListeners(event: UccdsEventMessage): void {
    for (const listener of uccdsClient.changeListeners.slice()) {
        try {
            const r = listener(event);
            if (r && typeof (r as any).catch === 'function') (r as Promise<void>).catch((err: any) => api.v1.log("UCCDS client: change listener failed:", err));
        } catch (err: any) {
            api.v1.log("UCCDS client: change listener failed:", err);
        }
    }
}

/** Starts listening on the UCCDS channel. Safe to call any number of times */
async function uccdsClientStart(): Promise<void> {
    if (uccdsClient.started) return;
    if (!uccdsClient.starting) {
        uccdsClient.starting = (async () => {
            await api.v1.messaging.onMessage((message: ScriptMessage) => uccdsClientHandle(message), { channel: UCCDS_CHANNEL });
            uccdsClient.started = true;
        })();
    }
    await uccdsClient.starting;
}

function uccdsNewRequestId(): string {
    uccdsClient.counter++;
    return `${api.v1.script.id}:${Date.now().toString(36)}:${uccdsClient.counter}`;
}

/**
 * Low-level request. Sent straight to the dependency once it's known, broadcast before that.
 * Resolves with the reply's data; rejects on an error reply or after `timeoutMs`.
 */
async function uccdsRequest(type: UccdsRequestType, payload?: any, timeoutMs: number = UCCDS_REQUEST_TIMEOUT): Promise<any> {
    await uccdsClientStart();
    const requestId = uccdsNewRequestId();
    const message: UccdsRequestMessage = { type, requestId, protocol: UCCDS_PROTOCOL, payload: payload || {} };
    return new Promise<any>((resolve: (data: any) => void, reject: (err: Error) => void) => {
        (async () => {
            const timer = await api.v1.timers.setTimeout(() => {
                if (!uccdsClient.pending[requestId]) return;
                delete uccdsClient.pending[requestId];
                uccdsClient.service = null; // look for it again next time (it may have been disabled or reloaded)
                reject(new Error(UCCDS_MISSING_MESSAGE));
            }, timeoutMs);
            uccdsClient.pending[requestId] = { resolve, reject, timer };
            if (uccdsClient.service) {
                await api.v1.messaging.send(uccdsClient.service.scriptId, message, UCCDS_CHANNEL);
            } else {
                await api.v1.messaging.broadcast(message, UCCDS_CHANNEL);
            }
        })().catch((err: any) => {
            delete uccdsClient.pending[requestId];
            reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
}

/**
 * Finds the dependency, retrying for `timeoutMs` (it may load after your script).
 * Resolves with its info, or null when it isn't there.
 */
async function uccdsConnect(timeoutMs: number = UCCDS_CONNECT_TIMEOUT): Promise<UccdsServiceInfo | null> {
    await uccdsClientStart();
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const left = deadline - Date.now();
        if (left <= 0) return null;
        try {
            const info: UccdsServiceInfo = await uccdsRequest('uccds:ping', {}, Math.min(800, left));
            uccdsClient.service = info;
            return info;
        } catch {
            // not up yet: try again until the deadline
        }
    }
}

/** True when the dependency answers within `timeoutMs` */
async function uccdsIsAvailable(timeoutMs: number = UCCDS_CONNECT_TIMEOUT): Promise<boolean> {
    if (uccdsClient.service) return true;
    return (await uccdsConnect(timeoutMs)) !== null;
}

/** Connects when needed; throws the install hint when the dependency isn't there */
async function uccdsRequireService(): Promise<void> {
    if (uccdsClient.service) return;
    if ((await uccdsConnect()) === null) throw new Error(UCCDS_MISSING_MESSAGE);
}

/** The dependency's version info, or null when unknown */
function uccdsDependencyInfo(): UccdsServiceInfo | null {
    return uccdsClient.service;
}

/**
 * The story's chapters under the user's UCCDS settings, plus your overrides.
 * Example: await uccdsGetChapters({ includeText: false })      // ids, titles and counts only
 *          await uccdsGetChapters({ settings: { openingText: 'ignore' } })
 */
async function uccdsGetChapters(request?: UccdsDetectRequest, timeoutMs: number = UCCDS_REQUEST_TIMEOUT): Promise<UccdsResult> {
    await uccdsRequireService();
    const r = request || {};
    const data = await uccdsRequest('uccds:detect', { ...r, sinceSignature: undefined }, timeoutMs);
    return data.result as UccdsResult;
}

/**
 * Like uccdsGetChapters, but resolves null when nothing changed since `previous`
 * (cheap: the dependency skips building chapters and sends no text).
 */
async function uccdsGetChaptersIfChanged(previous: UccdsResult | null, request?: UccdsDetectRequest, timeoutMs: number = UCCDS_REQUEST_TIMEOUT): Promise<UccdsResult | null> {
    await uccdsRequireService();
    const r = request || {};
    const data = await uccdsRequest('uccds:detect', { ...r, sinceSignature: previous ? previous.signature : undefined }, timeoutMs);
    return data.unchanged ? null : (data.result as UccdsResult);
}

/** Parses one line (or several) as a chapter header with the user's UCCDS settings */
async function uccdsParseHeaderRemote(text: string, settings?: Partial<UccdsSettings>): Promise<UccdsHeader> {
    await uccdsRequireService();
    return (await uccdsRequest('uccds:parseHeader', { text, settings })) as UccdsHeader;
}

async function uccdsParseHeadersRemote(texts: string[], settings?: Partial<UccdsSettings>): Promise<UccdsHeader[]> {
    await uccdsRequireService();
    return (await uccdsRequest('uccds:parseHeader', { texts, settings })) as UccdsHeader[];
}

/** The chapter rules the user picked in the UCCDS config */
async function uccdsGetUserSettings(): Promise<UccdsSettings> {
    await uccdsRequireService();
    return (await uccdsRequest('uccds:getSettings', {})) as UccdsSettings;
}

async function uccdsSubscribe(): Promise<void> {
    if (uccdsClient.subscribed) return;
    await uccdsRequireService();
    await uccdsRequest('uccds:subscribe', {});
    uccdsClient.subscribed = true;
}

/**
 * Calls `listener` whenever the story's chapters change (checked by the dependency every few
 * seconds, and after each generation / undo). Re-fetch with uccdsGetChapters inside the listener.
 * Also called when UCCDS loads or reloads while you're listening.
 * With { waitForService: true } it doesn't throw when UCCDS isn't there yet: the listener is kept
 * and starts working as soon as UCCDS loads (useful when your script falls back to its own detection).
 */
async function uccdsOnChaptersChanged(listener: (event: UccdsEventMessage) => void | Promise<void>, options?: { waitForService?: boolean }): Promise<void> {
    uccdsClient.changeListeners.push(listener);
    try {
        await uccdsSubscribe();
    } catch (err: any) {
        if (!(options && options.waitForService)) throw err;
    }
}

/** Stops all change listeners */
async function uccdsStopListening(): Promise<void> {
    uccdsClient.changeListeners = [];
    if (!uccdsClient.subscribed) return;
    uccdsClient.subscribed = false;
    try {
        await uccdsRequest('uccds:unsubscribe', {});
    } catch {
        // dependency already gone
    }
}
