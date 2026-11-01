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
