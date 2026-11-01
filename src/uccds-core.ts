// --- UCCDS core: story sections -> chapters ---
// Builds on the header parser (chParseHeader & co.) above it in the bundle. Pure functions first,
// then three small api helpers at the bottom (scan, config, detect-the-document).

const UCCDS_VERSION = "1.0.0";

const UCCDS_DEFAULT_SETTINGS: UccdsSettings = {
    headerSyntax: 'auto',
    detectBracketedTitles: true,
    breakToken: "***",
    onlyBreakToken: false,
    boundaryMode: 'headers',
    noHeaderFallback: 'single',
    openingText: 'chapter',
    divisionHeaders: 'separate',
    numbering: 'auto',
    chapterKeywords: [],
    divisionKeywords: [],
    specialKeywords: []
};

/** Config option names read by uccdsLoadSettings(). Same names as Chapter Linter / Markdown Manager where they overlap. */
const UCCDS_CONFIG_KEYS: Record<keyof UccdsSettings, string> = {
    headerSyntax: 'chapter_detection_mode',
    detectBracketedTitles: 'detect_bracketed_titles',
    breakToken: 'chapter_break_token',
    onlyBreakToken: 'chapter_only_break_token',
    boundaryMode: 'chapter_boundary_mode',
    noHeaderFallback: 'chapter_no_header_fallback',
    openingText: 'chapter_opening_text',
    divisionHeaders: 'chapter_division_headers',
    numbering: 'chapter_numbering',
    chapterKeywords: 'chapter_custom_chapter_words',
    divisionKeywords: 'chapter_custom_part_words',
    specialKeywords: 'chapter_custom_unnumbered_words'
};

function uccdsPick<T extends string>(value: any, allowed: T[], fallback: T): T {
    if (typeof value !== 'string') return fallback;
    const v = value.trim().toLowerCase();
    for (const a of allowed) {
        if (a === v) return a;
    }
    return fallback;
}

/**
 * A header word list from user input: "Section, Episode" (commas, semicolons or new lines) or an
 * array. Invalid words (digits, brackets, separators) and duplicates are dropped.
 */
function uccdsWordList(value: any, fallback: string[]): string[] {
    let words: string[];
    if (typeof value === 'string') words = value.split(/[,;\n]/);
    else if (Array.isArray(value)) words = value.filter((w: any) => typeof w === 'string');
    else return fallback.slice();
    return chCleanWords(words);
}

/** Fills in defaults and drops invalid values, so any partial / user-typed settings object is safe to use */
function uccdsNormalizeSettings(partial?: Partial<UccdsSettings> | null): UccdsSettings {
    const p: any = partial || {};
    const d = UCCDS_DEFAULT_SETTINGS;
    return {
        headerSyntax: uccdsPick(p.headerSyntax, ['auto', 'markdown_headings'], d.headerSyntax),
        detectBracketedTitles: typeof p.detectBracketedTitles === 'boolean' ? p.detectBracketedTitles : d.detectBracketedTitles,
        breakToken: typeof p.breakToken === 'string' && p.breakToken.trim() ? p.breakToken.trim() : d.breakToken,
        onlyBreakToken: typeof p.onlyBreakToken === 'boolean' ? p.onlyBreakToken : d.onlyBreakToken,
        boundaryMode: uccdsPick(p.boundaryMode, ['headers', 'headers_and_dividers', 'dividers'], d.boundaryMode),
        noHeaderFallback: uccdsPick(p.noHeaderFallback, ['single', 'dividers'], d.noHeaderFallback),
        openingText: uccdsPick(p.openingText, ['chapter', 'ignore'], d.openingText),
        divisionHeaders: uccdsPick(p.divisionHeaders, ['separate', 'chapter'], d.divisionHeaders),
        numbering: uccdsPick(p.numbering, ['auto', 'restart', 'continuous'], d.numbering),
        chapterKeywords: uccdsWordList(p.chapterKeywords, d.chapterKeywords),
        divisionKeywords: uccdsWordList(p.divisionKeywords, d.divisionKeywords),
        specialKeywords: uccdsWordList(p.specialKeywords, d.specialKeywords)
    };
}

/** The parser options that match a settings object */
function uccdsHeaderOptions(settings: UccdsSettings): HeaderDetectionOptions {
    return {
        detectionMode: settings.headerSyntax,
        detectBracketedTitles: settings.detectBracketedTitles,
        breakToken: settings.breakToken,
        onlyBreakToken: settings.onlyBreakToken,
        chapterKeywords: settings.chapterKeywords,
        divisionKeywords: settings.divisionKeywords,
        specialKeywords: settings.specialKeywords
    };
}

/** Is this paragraph a scene/chapter divider under these settings? */
function uccdsIsDivider(text: string, settings: UccdsSettings): boolean {
    return chIsDivider(text, settings.breakToken, settings.onlyBreakToken);
}

/** Parses one paragraph with these settings (isHeader=false for prose) */
function uccdsParseHeader(text: string, settings?: Partial<UccdsSettings> | null): UccdsHeader {
    return chParseHeader(text || "", uccdsHeaderOptions(uccdsNormalizeSettings(settings)));
}

/** FNV-1a over section ids + text + settings: equal signatures mean an identical result */
function uccdsSignature(sections: UccdsSection[], settings: UccdsSettings, includeText: boolean): string {
    let hash = 0x811c9dc5;
    const mix = (str: string): void => {
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        hash ^= 0x1f;
        hash = Math.imul(hash, 0x01000193);
    };
    mix(JSON.stringify(settings));
    mix(includeText ? "t" : "n");
    for (const s of sections) {
        mix(String(s.sectionId));
        mix(s.text || "");
    }
    return `${sections.length}:${(hash >>> 0).toString(16)}`;
}

function uccdsCapitalize(word: string): string {
    return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word;
}

function uccdsTrimLabel(label: string): string {
    return (label || "").replace(new RegExp(`\\s*(?:${CH_SEP}|,)\\s*$`), '').trim();
}

/** Short label word for a chapter keyword: "Ch." for Chapter / Ch / none, the word as written otherwise ("Section") */
function uccdsShortWord(keyword: string): string {
    const key = chWordKey(keyword);
    return !key || key === 'chapter' || key === 'ch' ? "Ch." : keyword.trim();
}

/** A run of sections that will become one chapter */
interface UccdsSegment {
    start: number;
    end: number; // exclusive
    headerAt: number; // -1 when there is no header
    header: ParsedHeader | null;
    dividerAt: number; // boundary divider above the header (or opening the segment), -1 when none
}

/**
 * Should `sequence` restart at each Book/Part? 'auto' says yes when the story already restarts:
 * the first numbered chapter after a Book/Part change has a number no higher than the one before.
 */
function uccdsShouldRestart(entries: { number: number | null; explicit: boolean; boundary: boolean }[], numbering: UccdsSettings['numbering']): boolean {
    if (numbering !== 'auto') return numbering === 'restart';
    let lastNumber: number | null = null;
    let afterBoundary = false;
    for (const e of entries) {
        if (e.boundary) afterBoundary = lastNumber !== null;
        if (!e.explicit || e.number === null) continue;
        if (afterBoundary && lastNumber !== null && e.number <= lastNumber) return true;
        afterBoundary = false;
        lastNumber = e.number;
    }
    return false;
}

/**
 * Splits story sections into chapters. Pure: no api calls, so it can run on any section list
 * (the live document, an imported file split into lines, test data).
 */
function uccdsDetectChapters(
    sections: UccdsSection[],
    settingsInput?: Partial<UccdsSettings> | null,
    options?: { includeText?: boolean }
): UccdsResult {
    const settings = uccdsNormalizeSettings(settingsInput);
    const includeText = !options || options.includeText !== false;
    const detection = uccdsHeaderOptions(settings);
    const list: UccdsSection[] = (sections || []).map((s: UccdsSection) => ({ sectionId: s.sectionId, text: s.text || "" }));
    const n = list.length;

    const isBlank: boolean[] = list.map((s: UccdsSection) => s.text.trim().length === 0);
    const isDivider: boolean[] = list.map((s: UccdsSection) => uccdsIsDivider(s.text, settings));
    const headers: (ParsedHeader | null)[] = list.map((s: UccdsSection, i: number) => {
        if (isBlank[i] || isDivider[i]) return null;
        const h = chParseHeader(s.text, detection);
        return h.isHeader ? h : null;
    });
    const hasHeaders = headers.some((h: ParsedHeader | null) => h !== null);

    const nextContent = (from: number): number => {
        for (let j = from; j < n; j++) if (!isBlank[j]) return j;
        return -1;
    };
    const prevContent = (from: number): number => {
        for (let j = from; j >= 0; j--) if (!isBlank[j]) return j;
        return -1;
    };

    // 1. Where chapters start: { start, headerAt, dividerAt }
    const starts: { start: number; headerAt: number; dividerAt: number }[] = [];
    const mode = settings.boundaryMode;
    const splitOnDividers = mode === 'dividers' || mode === 'headers_and_dividers' || (!hasHeaders && settings.noHeaderFallback === 'dividers');

    if (mode === 'dividers') {
        // The document start acts as a divider, so a header on the first line names chapter 1
        const first = nextContent(0);
        if (first !== -1 && headers[first]) starts.push({ start: 0, headerAt: first, dividerAt: -1 });
        for (let i = 0; i < n; i++) {
            const h = headers[i];
            if (h && h.hasEmbeddedDivider) {
                if (!(starts.length > 0 && starts[starts.length - 1].headerAt === i)) starts.push({ start: i, headerAt: i, dividerAt: -1 });
                continue;
            }
            if (!isDivider[i]) continue;
            const next = nextContent(i + 1);
            if (next === -1) continue; // a trailing divider stays with the last chapter
            if (isDivider[next]) continue; // the last of several stacked dividers opens the chapter
            const named = headers[next] !== null;
            starts.push({ start: i, headerAt: named ? next : -1, dividerAt: i });
        }
    } else {
        let lastStart = -1;
        for (let i = 0; i < n; i++) {
            if (headers[i]) {
                // A divider right above the header (blank lines between allowed) belongs to the new chapter
                const prev = prevContent(i - 1);
                const takeDivider = prev !== -1 && isDivider[prev] && prev > lastStart;
                const start = takeDivider ? prev : i;
                starts.push({ start, headerAt: i, dividerAt: takeDivider ? prev : -1 });
                lastStart = i;
            } else if (isDivider[i] && splitOnDividers) {
                const next = nextContent(i + 1);
                if (next === -1 || isDivider[next] || headers[next]) continue; // the header claims it
                starts.push({ start: i, headerAt: -1, dividerAt: i });
                lastStart = i;
            }
        }
    }

    // 2. Segments: [start of this, start of next)
    const segments: UccdsSegment[] = [];
    if (starts.length === 0 || starts[0].start > 0) {
        segments.push({ start: 0, end: starts.length > 0 ? starts[0].start : n, headerAt: -1, header: null, dividerAt: -1 });
    }
    starts.forEach((s: { start: number; headerAt: number; dividerAt: number }, k: number) => {
        segments.push({
            start: s.start,
            end: k + 1 < starts.length ? starts[k + 1].start : n,
            headerAt: s.headerAt,
            header: s.headerAt >= 0 ? headers[s.headerAt] : null,
            dividerAt: s.dividerAt
        });
    });

    // 3. Kinds; drop segments that hold nothing but blank lines / dividers (unless they have a header)
    interface Draft { seg: UccdsSegment; kind: UccdsChapterKind; bodyIdx: number[] }
    const drafts: Draft[] = [];
    let seenHeader = false;
    // "Has headers" for naming purposes: some chapter is actually named by one
    const anyNamed = segments.some((seg: UccdsSegment) => seg.header !== null);
    for (const seg of segments) {
        const bodyIdx: number[] = [];
        for (let i = seg.start; i < seg.end; i++) {
            if (i === seg.headerAt || i === seg.dividerAt) continue;
            // Blank lines between the boundary divider and the header are spacing, not body
            if (seg.dividerAt >= 0 && seg.headerAt > seg.dividerAt && i > seg.dividerAt && i < seg.headerAt) continue;
            bodyIdx.push(i);
        }
        // Trim blank paragraphs at both ends
        while (bodyIdx.length > 0 && isBlank[bodyIdx[0]]) bodyIdx.shift();
        while (bodyIdx.length > 0 && isBlank[bodyIdx[bodyIdx.length - 1]]) bodyIdx.pop();
        const hasContent = bodyIdx.some((i: number) => !isDivider[i]);

        let kind: UccdsChapterKind;
        if (seg.header) {
            kind = seg.header.kind;
            if (kind === 'division' && settings.divisionHeaders === 'chapter') kind = 'chapter';
            seenHeader = true;
        } else {
            if (!hasContent) continue;
            if (anyNamed && !seenHeader) {
                if (settings.openingText === 'ignore') continue;
                kind = 'opening';
            } else {
                kind = 'untitled';
            }
        }
        drafts.push({ seg, kind, bodyIdx });
    }

    // 3b. The user's own unnumbered words get their kind from their place in the story
    const numberedKind = (k: UccdsChapterKind): boolean => k === 'chapter' || k === 'title' || k === 'untitled';
    let firstNumbered = -1;
    let lastNumbered = -1;
    drafts.forEach((d: Draft, i: number) => {
        if (!numberedKind(d.kind)) return;
        if (firstNumbered === -1) firstNumbered = i;
        lastNumbered = i;
    });
    drafts.forEach((d: Draft, i: number) => {
        const h = d.seg.header;
        if (!h || (d.kind !== 'prologue' && d.kind !== 'epilogue' && d.kind !== 'interlude') || chIsBuiltinSpecial(h.keyword)) return;
        if (firstNumbered === -1 || i < firstNumbered) d.kind = 'prologue';
        else if (i > lastNumbered) d.kind = 'epilogue';
        else d.kind = 'interlude';
    });

    // 4. Numbers, divisions, sequence
    const numbered = (k: UccdsChapterKind): boolean => k === 'chapter' || k === 'title' || k === 'untitled';
    const numbers: (number | null)[] = [];
    let last = 0;
    for (const d of drafts) {
        if (!numbered(d.kind)) {
            numbers.push(null);
            continue;
        }
        const explicit = d.seg.header && d.seg.header.number !== null ? d.seg.header.number : null;
        const num = explicit !== null ? explicit : last + 1;
        last = num;
        numbers.push(num);
    }

    const divisions: string[] = [];
    const boundaries: boolean[] = [];
    let current = "";
    for (const d of drafts) {
        const h = d.seg.header;
        let boundary = false;
        if (h && d.kind === 'division') {
            current = uccdsTrimLabel(h.labelText) || uccdsTrimLabel(chDisplayTitle(h));
            boundary = true;
        } else if (h && h.divisionLabel) {
            const inline = uccdsTrimLabel(h.divisionLabel);
            if (chNormalizeTitle(inline) !== chNormalizeTitle(current)) boundary = true;
            current = inline;
        }
        divisions.push(current);
        boundaries.push(boundary);
    }

    const restart = uccdsShouldRestart(drafts.map((d: Draft, i: number) => ({
        number: numbers[i],
        explicit: !!(d.seg.header && d.seg.header.number !== null && d.kind === 'chapter'),
        boundary: boundaries[i]
    })), settings.numbering);

    const chapters: UccdsChapter[] = [];
    let seq = 0;
    let totalWords = 0;
    drafts.forEach((d: Draft, i: number) => {
        if (boundaries[i] && restart) seq = 0;
        const num = numbers[i];
        const sequence = num !== null ? ++seq : null;
        const h = d.seg.header;
        const division = d.kind === 'division' ? "" : divisions[i];

        let title: string;
        let label: string;
        if (h) {
            title = chDisplayTitle(h) || uccdsCapitalize(h.keyword) || `Chapter ${num}`;
            if (d.kind === 'division') {
                label = uccdsTrimLabel(h.labelText) || "Part";
            } else if (d.kind === 'prologue' || d.kind === 'epilogue' || d.kind === 'interlude') {
                label = uccdsCapitalize(h.keyword) || uccdsCapitalize(d.kind);
            } else {
                label = `${uccdsShortWord(h.keyword)} ${num}`;
            }
        } else if (d.kind === 'opening') {
            title = "Opening text";
            label = "Opening";
        } else if (!anyNamed && !splitOnDividers) {
            title = "Full story";
            label = "Story";
        } else {
            title = `Chapter ${num}`;
            label = `Ch. ${num}`;
        }
        if (division && d.kind !== 'division') label = `${division} ${label}`;

        const bodyTexts = d.bodyIdx.map((idx: number) => list[idx].text);
        const counted = d.bodyIdx.filter((idx: number) => !isDivider[idx]).map((idx: number) => list[idx].text);
        const wordCount = counted.reduce((sum: number, t: string) => sum + chCountWords(t), 0);
        const charCount = counted.reduce((sum: number, t: string) => sum + t.length, 0);
        totalWords += wordCount;

        const sectionIds: number[] = [];
        for (let s = d.seg.start; s < d.seg.end; s++) sectionIds.push(list[s].sectionId);
        let rawHeader = "";
        if (h && d.seg.headerAt >= 0) {
            const t = list[d.seg.headerAt].text.trim();
            rawHeader = h.hasEmbeddedDivider ? t.slice(t.indexOf("\n") + 1).trim() : t;
        }

        chapters.push({
            index: chapters.length,
            key: d.seg.headerAt >= 0 ? list[d.seg.headerAt].sectionId : sectionIds[0],
            kind: d.kind,
            title,
            name: h ? h.cleanName : "",
            label,
            number: num,
            sequence,
            division,
            header: h,
            rawHeader,
            headerSectionId: d.seg.headerAt >= 0 ? list[d.seg.headerAt].sectionId : null,
            startSectionId: sectionIds[0],
            endSectionId: sectionIds[sectionIds.length - 1],
            sectionIds,
            bodySectionIds: d.bodyIdx.map((idx: number) => list[idx].sectionId),
            paragraphs: includeText ? bodyTexts : [],
            wordCount,
            charCount
        });
    });

    return {
        chapters,
        settings,
        hasHeaders,
        restartsPerDivision: restart,
        signature: uccdsSignature(list, settings, includeText),
        sectionCount: n,
        totalWords,
        includesText: includeText
    };
}

// --- api helpers ---

/** The live document as plain sections */
async function uccdsScanSections(): Promise<UccdsSection[]> {
    const scanned = await api.v1.document.scan();
    return (scanned || []).map((s: { sectionId: number; section: Section }) => ({
        sectionId: s.sectionId,
        text: (s.section && s.section.text) || ""
    }));
}

/**
 * Reads the chapter settings from this script's config options (see config-snippet.yaml).
 * `keys` renames options, e.g. { breakToken: 'my_break_token' }. Missing or invalid values fall
 * back to `overrides`, then to the defaults.
 */
async function uccdsLoadSettings(overrides?: Partial<UccdsSettings> | null, keys?: Partial<Record<keyof UccdsSettings, string>>): Promise<UccdsSettings> {
    const base = uccdsNormalizeSettings(overrides);
    const names: Record<keyof UccdsSettings, string> = { ...UCCDS_CONFIG_KEYS, ...(keys || {}) };
    const read: any = {};
    for (const field of Object.keys(names) as (keyof UccdsSettings)[]) {
        try {
            const value = await api.v1.config.get(names[field]);
            if (value !== undefined && value !== null && value !== "") read[field] = value;
        } catch {
            // keep the base value
        }
    }
    // Manuscript Menagerie's "Break Token Only" detection mode is the 'dividers' boundary mode
    if (read.headerSyntax === 'break_token') {
        delete read.headerSyntax;
        if (read.boundaryMode === undefined) read.boundaryMode = 'dividers';
    }
    const merged: any = { ...base };
    for (const field of Object.keys(read)) {
        const candidate = uccdsNormalizeSettings({ ...base, [field]: read[field] } as Partial<UccdsSettings>);
        merged[field] = (candidate as any)[field];
    }
    return merged as UccdsSettings;
}

/** Scans the document and detects chapters in one call */
async function uccdsDetectDocument(settings?: Partial<UccdsSettings> | null, options?: { includeText?: boolean }): Promise<UccdsResult> {
    return uccdsDetectChapters(await uccdsScanSections(), settings, options);
}
