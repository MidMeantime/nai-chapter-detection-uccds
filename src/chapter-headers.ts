// --- UCCDS header parser ---
// Parses one paragraph into a chapter header (markdown / [bracket] / "Chapter X" keyword lines,
// prologue / epilogue / interlude / Part-Book-Act kinds, strict Roman numerals, number words, dividers).
// Same parser as Chapter Linter, Markdown Manager and ChatGLM (this file is the source; `npm run sync`
// pushes it to Editorial/shared). Header words are configurable (see chGrammar). Names are prefixed `ch` / `CH_`.

/** What a header introduces. 'title' = a header with no keyword ("# The Gathering", "[The Long Night]") */
type ChapterKind = 'chapter' | 'title' | 'prologue' | 'epilogue' | 'interlude' | 'division';

/** How the header was written in the source text */
type HeaderSyntax = 'markdown' | 'bracket' | 'keyword';

interface HeaderDetectionOptions {
    /** 'auto' = markdown headings, [bracketed] titles and standalone "Chapter X" lines */
    detectionMode: 'auto' | 'markdown_headings';
    detectBracketedTitles: boolean;
    /** Extra divider token recognised besides *** / --- / ___ */
    breakToken?: string;
    /** Only the breakToken counts as a divider (a lone --- stays text) */
    onlyBreakToken?: boolean;
    /**
     * Extra words that start a numbered chapter, like "Chapter" (e.g. "Section", "Episode").
     * Case-insensitive; multi-word is fine ("Side Story"). A word listed here stops being a
     * Part/Book word or an unnumbered word, so ["Section"] turns "Section 3" into a chapter.
     */
    chapterKeywords?: string[];
    /** Extra words that group chapters, like "Part" / "Book" (e.g. "Saga", "Season") */
    divisionKeywords?: string[];
    /** Extra words for unnumbered sections, like "Prologue" / "Epilogue" (e.g. "Intro", "Afterword") */
    specialKeywords?: string[];
}

interface ParsedHeader {
    isHeader: boolean;
    syntax: HeaderSyntax | null;
    /** Markdown heading level (1-6); 0 for bracket/keyword headers */
    level: number;
    kind: ChapterKind;
    /** Label prefix exactly as written, minus trailing separator: "Chapter 3", "Part 1: Chapter 3", "IV", "" */
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
    /** Division written before the chapter on the same line: "Book 2" in "Book 2: Chapter 3"; "" otherwise */
    divisionLabel: string;
    /** That division's number (2 above), or null */
    divisionNumber: number | null;
}

const CH_DEFAULT_DETECTION: HeaderDetectionOptions = { detectionMode: 'auto', detectBracketedTitles: true };

// Separators allowed between a label and its title: ":", "-", en/em dash, ".", "|"
const CH_SEP = "[:\\-\\u2013\\u2014.|]";
// Spelled-out numbers, including hyphenated/spaced compounds ("Twenty-One", "Thirty Two")
const CH_NUMBER_WORD = "(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?"
    + "|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen"
    + "|ten|one|two|three|four|five|six|seven|eight|nine|zero|hundred)";
// Only well-formed numerals, so words like "Mill" or "Mild" are never read as numbers
const CH_ROMAN = "(?=[MDCLXVI])M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})";
const CH_NUMBER = `(?:\\d+|${CH_ROMAN}|${CH_NUMBER_WORD})`;
const CH_LABEL_END = `(?=\\s|${CH_SEP}|,|$)`;

// Built-in header words. Users add their own through HeaderDetectionOptions (see chGrammar).
// A trailing "." is optional ("Ch." also matches "Ch").
const CH_BUILTIN_CHAPTER_WORDS: string[] = ["Chapter", "Ch."];
const CH_BUILTIN_DIVISION_WORDS: string[] = ["Act", "Book", "Part", "Volume", "Section", "Arc"];
// Unnumbered special sections. Prelude counts as a prologue, Interlude sits between chapters.
const CH_BUILTIN_SPECIAL_WORDS: string[] = ["Prologue", "Prelude", "Epilogue", "Interlude"];
const CH_MAX_CUSTOM_WORDS = 40;
const CH_MAX_WORD_LENGTH = 40;

/** The regexes for one set of header words */
interface ChGrammar {
    /** A plain line that is ONLY a label (optionally + separator + title) */
    keywordLine: RegExp;
    /** Leading "Chapter 4", "Part II", "Ch. Twenty-One" (number optional). Groups: 1 keyword, 2 number */
    labelPrefix: RegExp;
    /** Is this keyword a Part/Book-style word? */
    divisionTest: RegExp;
    /** Keys that may label a bracketed header: [Chapter 3: ...], [Title: ...], [Book II - Chapter IV: Rain] */
    bracketKey: RegExp;
    /** "Prologue: The Fall". Groups: 1 keyword, 2 rest */
    special: RegExp;
}

/** Comparison key for a header word: lowercase, single spaces, no trailing "." */
function chWordKey(word: string): string {
    return (word || "").trim().replace(/\s+/g, " ").replace(/\.$/, "").toLowerCase();
}

/**
 * Regex source for one header word, or null when it can't be one: empty, too long, or containing
 * digits / brackets / separators that would clash with numbers and titles.
 */
function chWordPattern(word: string): string | null {
    const w = (word || "").trim().replace(/\s+/g, " ");
    if (!w || w.length > CH_MAX_WORD_LENGTH) return null;
    if (/[\d\[\]:;|,\\(){}*+?^$#\u2013\u2014]/.test(w)) return null;
    if (/^[-.'\s]+$/.test(w)) return null;
    const dotted = w.endsWith(".");
    const core = dotted ? w.slice(0, -1) : w;
    const escaped = core.replace(/[.\-'"]/g, (c: string) => `\\${c}`).replace(/ /g, "\\s+");
    return dotted ? `${escaped}\\.?` : escaped;
}

/** Turns a list of words into one alternation (longest first); never matches when the list is empty */
function chAlternation(words: string[]): string {
    const patterns: string[] = [];
    for (const w of words) {
        const p = chWordPattern(w);
        if (p && patterns.indexOf(p) === -1) patterns.push(p);
    }
    if (patterns.length === 0) return "(?!)";
    patterns.sort((a: string, b: string) => b.length - a.length);
    return `(?:${patterns.join("|")})`;
}

/** Cleans a user word list: trims, drops invalid words and duplicates, caps its size */
function chCleanWords(words: string[] | undefined): string[] {
    const out: string[] = [];
    const seen: Record<string, boolean> = {};
    for (const w of Array.isArray(words) ? words : []) {
        if (typeof w !== 'string' || chWordPattern(w) === null) continue;
        const key = chWordKey(w);
        if (!key || seen[key]) continue;
        seen[key] = true;
        out.push(w.trim().replace(/\s+/g, " "));
        if (out.length >= CH_MAX_CUSTOM_WORDS) break;
    }
    return out;
}

/**
 * Merges the user's words into the built-in lists. A user word moves out of any other list,
 * and between the user's own lists chapter beats division beats special.
 */
function chResolveWords(options?: HeaderDetectionOptions): { chapter: string[]; division: string[]; special: string[] } {
    const o: HeaderDetectionOptions = options || CH_DEFAULT_DETECTION;
    const userChapter = chCleanWords(o.chapterKeywords);
    const userDivision = chCleanWords(o.divisionKeywords);
    const userSpecial = chCleanWords(o.specialKeywords);
    const keys = (list: string[]): string[] => list.map((w: string) => chWordKey(w));
    const chapterKeys = keys(userChapter);
    const divisionKeys = keys(userDivision).filter((k: string) => chapterKeys.indexOf(k) === -1);
    const specialKeys = keys(userSpecial).filter((k: string) => chapterKeys.indexOf(k) === -1 && divisionKeys.indexOf(k) === -1);
    const without = (list: string[], ...remove: string[][]): string[] =>
        list.filter((w: string) => !remove.some((r: string[]) => r.indexOf(chWordKey(w)) !== -1));
    return {
        chapter: [...without(CH_BUILTIN_CHAPTER_WORDS, divisionKeys, specialKeys), ...userChapter],
        division: [...without(CH_BUILTIN_DIVISION_WORDS, chapterKeys, specialKeys), ...userDivision.filter((w: string) => divisionKeys.indexOf(chWordKey(w)) !== -1)],
        special: [...without(CH_BUILTIN_SPECIAL_WORDS, chapterKeys, divisionKeys), ...userSpecial.filter((w: string) => specialKeys.indexOf(chWordKey(w)) !== -1)]
    };
}

function chBuildGrammar(chapterWords: string[], divisionWords: string[], specialWords: string[]): ChGrammar {
    const chapter = chAlternation(chapterWords);
    const division = chAlternation(divisionWords);
    const special = chAlternation(specialWords);
    const keyword = `(?:${chapter}|${division})`;
    // Anchored to the whole line so prose like "Part of me wanted..." is never mistaken for a header.
    // A comma only counts when another label follows it ("Part 1, Chapter 3"), never before prose.
    const keywordLine = new RegExp(
        `^(?:${keyword}(?:\\s+${CH_NUMBER})?|${special})(?:\\s*${CH_SEP}.*|\\s*,\\s*(?:${keyword}|${special})${CH_LABEL_END}.*)?$`, 'i'
    );
    const bracketLabel = `(?:${keyword}(?:\\s+${CH_NUMBER})?|Title|${special})`;
    return {
        keywordLine,
        labelPrefix: new RegExp(`^(${keyword})(?:\\s+(${CH_NUMBER}))?${CH_LABEL_END}`, 'i'),
        divisionTest: new RegExp(`^${division}$`, 'i'),
        bracketKey: new RegExp(`^${bracketLabel}(?:\\s*(?:${CH_SEP}|,)\\s*${bracketLabel})*$`, 'i'),
        special: new RegExp(`^(${special})${CH_LABEL_END}\\s*${CH_SEP}?\\s*(.*)$`, 'i')
    };
}

const CH_GRAMMAR_CACHE: Record<string, ChGrammar> = {};

/** The grammar for a set of options, built once per distinct word set */
function chGrammar(options?: HeaderDetectionOptions): ChGrammar {
    const words = chResolveWords(options);
    const cacheKey = JSON.stringify(words);
    let g = CH_GRAMMAR_CACHE[cacheKey];
    if (!g) {
        g = chBuildGrammar(words.chapter, words.division, words.special);
        CH_GRAMMAR_CACHE[cacheKey] = g;
    }
    return g;
}

/** True when `keyword` is one of the four built-in special words (Prologue, Prelude, Epilogue, Interlude) */
function chIsBuiltinSpecial(keyword: string): boolean {
    const key = chWordKey(keyword);
    return CH_BUILTIN_SPECIAL_WORDS.some((w: string) => chWordKey(w) === key);
}

// A bare number with no keyword, e.g. the "1" in "[ 1: Sandor ]". Roman numerals must be
// uppercase here so short words like "Mid" or "Ivy" aren't read as numbers.
const CH_BARE_NUMBER_PATTERNS: RegExp[] = [
    new RegExp(`^(\\d+|${CH_ROMAN})`),
    new RegExp(`^(${CH_NUMBER_WORD})`, 'i')
];
const CH_MAX_BRACKET_LENGTH = 100;

const CH_WORD_VALUES: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90, hundred: 100
};
const CH_ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const CH_ROMAN_TABLE: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
];

function chToRoman(num: number): string {
    if (num <= 0 || num > 3999) return String(num);
    let result = "";
    let rem = num;
    for (const [val, roman] of CH_ROMAN_TABLE) {
        while (rem >= val) {
            result += roman;
            rem -= val;
        }
    }
    return result;
}

/** "12" -> 12, "IV"/"iv" -> 4, "Twenty-One" -> 21. Returns null for anything else. */
function chParseNumber(token: string): number | null {
    const t = (token || "").trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (new RegExp(`^${CH_ROMAN}$`, 'i').test(t)) {
        const upper = t.toUpperCase();
        let total = 0;
        let prev = 0;
        for (let i = upper.length - 1; i >= 0; i--) {
            const val = CH_ROMAN_VALUES[upper[i]] || 0;
            if (val < prev) {
                total -= val;
            } else {
                total += val;
                prev = val;
            }
        }
        return total > 0 ? total : null;
    }
    const words = t.toLowerCase().split(/[-\s]+/).filter((w: string) => w.length > 0);
    if (words.length === 0 || words.length > 2) return null;
    let sum = 0;
    for (const w of words) {
        const v = CH_WORD_VALUES[w];
        if (v === undefined) return null;
        sum += v;
    }
    return sum;
}

function chIsDivider(text: string, customToken?: string, onlyCustom: boolean = false): boolean {
    if (!text) return false;
    const t = text.trim();
    if (!t) return false;
    if (customToken && customToken.trim() && t === customToken.trim()) return true;
    if (onlyCustom && customToken && customToken.trim()) return false;
    if (t === "– – –" || t === "— — —") return true;
    return /^(?:\*\s*){3,}$/.test(t) || /^(?:-\s*){3,}$/.test(t) || /^(?:_\s*){3,}$/.test(t);
}

// Length of a leading bare number (plus separator) when it ends the text or is followed by a
// separator; 0 otherwise, so a title like "1984" or "Ivy" is left alone.
function chMatchBareNumberPrefix(text: string, requireWhole: boolean = false): number {
    for (const pattern of CH_BARE_NUMBER_PATTERNS) {
        const m = text.match(pattern);
        if (!m || !m[0]) continue;
        const after = text.slice(m[0].length);
        if (requireWhole) {
            if (after.trim() === "") return text.length;
            continue;
        }
        const sep = after.match(new RegExp(`^\\s*(?:${CH_SEP}\\s*|$)`));
        if (sep) return m[0].length + sep[0].length;
    }
    return 0;
}

/**
 * Inner text of a bracketed header, or null when the brackets hold something else
 * (NovelAI author's notes / ATTG metadata such as "[ Author: X; Tags: Y ]").
 */
function chExtractBracketBody(text: string, grammar: ChGrammar = chGrammar()): string | null {
    const m = text.match(/^\[\s*([^\[\]\n]+?)\s*\]$/);
    if (!m) return null;
    const inner = m[1];
    if (inner.length > CH_MAX_BRACKET_LENGTH || inner.includes(";")) return null;
    const keyMatch = inner.match(/^([^:]+?)\s*:/);
    if (keyMatch) {
        const key = keyMatch[1].trim();
        if (!grammar.bracketKey.test(key) && !chMatchBareNumberPrefix(key, true)) return null;
    } else if (/[.!?\u2026]["'\u201D\u2019]?$/.test(inner) && !grammar.keywordLine.test(inner)) {
        // "[He looked away.]" is an aside, not a title. "[Chapter 7.]" still counts.
        return null;
    }
    return inner;
}

/** "Prologue: The Fall" -> { kind: 'prologue', keyword: 'Prologue', rest: 'The Fall' } */
function chMatchSpecial(text: string, grammar: ChGrammar = chGrammar()): { kind: ChapterKind; keyword: string; rest: string } | null {
    const m = text.match(grammar.special);
    if (!m) return null;
    const lower = chWordKey(m[1]);
    const kind: ChapterKind = lower === 'epilogue' ? 'epilogue' : lower === 'interlude' ? 'interlude' : 'prologue';
    return { kind, keyword: m[1], rest: m[2] };
}

/**
 * Fills in chapter numbers the way readers expect: explicit numbers are kept, an unnumbered
 * chapter gets the previous number + 1 (so an untitled chapter after "Chapter 5" is 6), and
 * the first unnumbered chapter is 1. Prologue / epilogue / interlude / division get null.
 */
function chFillNumbers(headers: (ParsedHeader | null)[]): (number | null)[] {
    let last = 0;
    return headers.map((h: ParsedHeader | null) => {
        if (!h || !h.isHeader) return null;
        if (h.kind !== 'chapter' && h.kind !== 'title') return null;
        const n = h.number !== null ? h.number : last + 1;
        last = n;
        return n;
    });
}

/**
 * Which Book/Part each header sits in: its own inline prefix ("Book 2: Chapter 1"), else the
 * last standalone division header above it ("Book 2:" on its own line). "" outside any division.
 * Division headers themselves get their own label.
 */
function chDivisionContext(headers: (ParsedHeader | null)[]): string[] {
    let current = "";
    return headers.map((h: ParsedHeader | null) => {
        if (!h || !h.isHeader) return current;
        if (h.kind === 'division') {
            current = h.labelText.replace(new RegExp(`\\s*(?:${CH_SEP}|,)\\s*$`), '').trim();
            return current;
        }
        if (h.divisionLabel) {
            current = h.divisionLabel.replace(new RegExp(`\\s*(?:${CH_SEP}|,)\\s*$`), '').trim();
        }
        return current;
    });
}

function chNotHeader(): ParsedHeader {
    return {
        isHeader: false, syntax: null, level: 0, kind: 'title', labelText: "", keyword: "",
        numberText: "", number: null, cleanName: "", hasEmbeddedDivider: false,
        divisionLabel: "", divisionNumber: null
    };
}

/**
 * Parses one paragraph/line. Returns isHeader=false for prose, dividers, metadata brackets
 * and anything spanning several lines.
 */
function chParseHeader(raw: string, options: HeaderDetectionOptions = CH_DEFAULT_DETECTION): ParsedHeader {
    const result = chNotHeader();
    if (!raw) return result;
    const grammar = chGrammar(options);
    let working = raw.trim();
    if (!working || chIsDivider(working, options.breakToken, options.onlyBreakToken)) return result;

    // Allow a divider sharing the paragraph on its own first line, e.g. "***\n# Chapter 1"
    const newlineIdx = working.indexOf("\n");
    if (newlineIdx !== -1 && chIsDivider(working.slice(0, newlineIdx), options.breakToken, options.onlyBreakToken)) {
        working = working.slice(newlineIdx + 1).trim();
        result.hasEmbeddedDivider = true;
    }
    if (!working || working.includes("\n")) return chNotHeader();

    let body: string | null = null;
    const mdMatch = working.match(/^(#{1,6})\s+(.+)$/);
    if (mdMatch) {
        body = mdMatch[2];
        result.syntax = 'markdown';
        result.level = mdMatch[1].length;
    } else if (options.detectionMode === 'auto') {
        if (working.startsWith("[")) {
            if (options.detectBracketedTitles) {
                body = chExtractBracketBody(working, grammar);
                result.syntax = 'bracket';
            }
        } else {
            // Keyword lines, optionally wrapped in emphasis: "Chapter IV: Echoes", "**Part Two**"
            const emphasis = working.match(/^(\*\*|__|\*|_)(.+)\1$/);
            const candidate = (emphasis ? emphasis[2] : working).trim();
            if (grammar.keywordLine.test(candidate)) {
                body = candidate;
                result.syntax = 'keyword';
            }
        }
    }
    if (body === null) return chNotHeader();
    result.isHeader = true;

    const full = body.trim();
    let rest = full.replace(/^Title\s*:\s*/i, '');
    let labelEnd = 0; // characters of `rest` (pre-strip) that belong to the label

    const special = chMatchSpecial(rest, grammar);
    if (special) {
        result.kind = special.kind;
        result.keyword = special.keyword;
        result.labelText = special.keyword;
        rest = special.rest;
    } else {
        // Strip stacked labels ("Part 1: Chapter 3: Title" -> "Title"). A bare keyword is only
        // stripped when followed by a separator or nothing, so "# Part of the Plan" keeps its words.
        const original = rest;
        let consumed = 0;
        let strippedLabel = false;
        let label = rest.match(grammar.labelPrefix);
        while (label) {
            let after = rest.slice(label[0].length);
            let numberText = label[2] || "";
            let labelLength = label[0].length;
            if (!numberText) {
                const sep = after.match(new RegExp(`^\\s*${CH_SEP}\\s*`));
                if (!sep && after.trim() !== "") break;
                // "Chapter: 3" / "Book - II": the number comes after the separator
                if (sep) {
                    const tail = after.slice(sep[0].length);
                    const bareLen = chMatchBareNumberPrefix(tail);
                    if (bareLen > 0) {
                        numberText = tail.slice(0, bareLen).replace(new RegExp(`\\s*(?:${CH_SEP}|,)?\\s*$`), '');
                        labelLength += sep[0].length + numberText.length;
                        after = rest.slice(labelLength);
                    }
                }
            }
            const isDivision = grammar.divisionTest.test(label[1]);
            // Remember a division written before the chapter on the same line ("Book 2: Chapter 3")
            if (!isDivision && result.kind === 'division' && strippedLabel) {
                result.divisionLabel = original.slice(0, labelEnd).trim();
                result.divisionNumber = result.numberText ? chParseNumber(result.numberText) : null;
            }
            result.keyword = label[1];
            result.numberText = numberText;
            result.kind = isDivision ? 'division' : 'chapter';
            consumed += labelLength;
            labelEnd = consumed;
            // A comma also separates stacked labels: "Part 1, Chapter 3"
            const sepMatch = after.match(new RegExp(`^\\s*(?:${CH_SEP}|,)?\\s*`));
            const sepLen = sepMatch ? sepMatch[0].length : 0;
            consumed += sepLen;
            rest = after.slice(sepLen);
            strippedLabel = true;
            label = rest.match(grammar.labelPrefix);
        }
        // "Act II: Prologue" / "Part 1, Interlude": a special section inside a division
        const innerSpecial = strippedLabel && result.kind === 'division' ? chMatchSpecial(rest, grammar) : null;
        if (innerSpecial) {
            result.kind = innerSpecial.kind;
            result.keyword = innerSpecial.keyword;
            result.numberText = "";
            labelEnd = consumed + (rest.length - innerSpecial.rest.length);
            result.labelText = original.slice(0, labelEnd).replace(new RegExp(`\\s*${CH_SEP}?\\s*$`), '').trim();
            rest = innerSpecial.rest;
        } else if (strippedLabel) {
            result.labelText = original.slice(0, labelEnd).trim();
        } else {
            // Keyword-less number left by imports: "1: Sandor" -> "Sandor", "12" -> "".
            // Skipped after a real label so a numeric title ("Chapter 3: 1984") survives.
            const bareLen = chMatchBareNumberPrefix(rest);
            if (bareLen > 0) {
                const token = rest.slice(0, bareLen).replace(new RegExp(`\\s*${CH_SEP}?\\s*$`), '');
                result.kind = 'chapter';
                result.numberText = token;
                result.labelText = token;
                rest = rest.slice(bareLen);
            } else {
                result.kind = 'title';
            }
        }
    }

    result.number = result.numberText ? chParseNumber(result.numberText) : null;
    result.cleanName = rest
        .replace(new RegExp(`^${CH_SEP}\\s*`), '')
        .replace(new RegExp(`\\s*${CH_SEP}$`), '')
        .replace(/^["'\[\]]+|["'\[\]]+$/g, '')
        .trim();
    // "[Title: X]" or "# X" with nothing left: keep the header, it is just untitled
    return result;
}

/**
 * Human-readable title for a parsed header: "Chapter 3: The Fall", "Prologue", "Part 2: Return",
 * "The Gathering". Bare numbers ("[ 1: Sandor ]") are shown as "Chapter 1: Sandor".
 */
function chDisplayTitle(h: ParsedHeader): string {
    if (!h.isHeader) return "";
    let label = h.labelText;
    if (h.kind === 'chapter' && !h.keyword && h.numberText) {
        label = `Chapter ${h.numberText}`;
    }
    if (label && h.cleanName) return `${label}: ${h.cleanName}`;
    return label || h.cleanName;
}

/** Normalised text for comparing titles: lowercase, punctuation and extra spaces removed */
function chNormalizeTitle(text: string): string {
    // Only ASCII punctuation is dropped, so accented and non-Latin titles still compare
    return (text || "").toLowerCase().replace(/[!-\/:-@\[-`{-~–—‘’“”]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Removes markdown emphasis (*x*, **x**, ***x***, _x_, __x__) without touching scene dividers,
 * bullet markers, or underscores inside words (snake_case, file_names).
 */
function chStripEmphasis(line: string, breakToken?: string): string {
    if (!line || chIsDivider(line, breakToken)) return line;
    let out = line;
    out = out.replace(/\*\*\*(\S(?:[^*\n]*?\S)?)\*\*\*/g, "$1");
    out = out.replace(/\*\*(\S(?:[^*\n]*?\S)?)\*\*/g, "$1");
    out = out.replace(/\*(\S(?:[^*\n]*?\S)?)\*/g, "$1");
    // Underscore emphasis only counts at word boundaries
    out = out.replace(/(^|[^A-Za-z0-9_])___(\S(?:[^_\n]*?\S)?)___(?![A-Za-z0-9_])/g, "$1$2");
    out = out.replace(/(^|[^A-Za-z0-9_])__(\S(?:[^_\n]*?\S)?)__(?![A-Za-z0-9_])/g, "$1$2");
    out = out.replace(/(^|[^A-Za-z0-9_])_(\S(?:[^_\n]*?\S)?)_(?![A-Za-z0-9_])/g, "$1$2");
    return out;
}

/** Word count without allocating large arrays */
function chCountWords(str: string): number {
    if (!str) return 0;
    let count = 0;
    let inWord = false;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 32) {
            if (!inWord) {
                count++;
                inWord = true;
            }
        } else {
            inWord = false;
        }
    }
    return count;
}
