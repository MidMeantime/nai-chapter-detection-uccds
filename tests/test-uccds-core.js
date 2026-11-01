// Tests for the chapter segmenter (src/uccds-core.ts), run on the real TypeScript source.
const assert = require('assert');
const { loadParts, createRunner, settle } = require('../tools/harness.js');

const CORE_PARTS = ['src/chapter-headers.ts', 'src/uccds-types.ts', 'src/uccds-helpers.ts', 'src/uccds-core.ts'];
const { run } = loadParts(CORE_PARTS);
const t = createRunner('UCCDS core: sections -> chapters');

let nextId = 1;
const sections = (texts) => texts.map((text) => ({ sectionId: nextId++, text }));
const detect = (texts, settings, options) => JSON.parse(JSON.stringify(run('uccdsDetectChapters')(sections(texts), settings, options)));
const brief = (result) => result.chapters.map((c) => `${c.kind}|${c.title}|${c.number}|${c.sequence}|${c.paragraphs.join('/')}`);

t.test('headers mode: headers start chapters, inner *** stays as a scene break', () => {
    const r = detect(['[Chapter 1: Dawn]', 'One.', '***', 'Two.', '', '***', '', '[Chapter 2: Dusk]', 'Three.']);
    assert.deepStrictEqual(brief(r), [
        'chapter|Chapter 1: Dawn|1|1|One./***/Two.',
        'chapter|Chapter 2: Dusk|2|2|Three.'
    ]);
    const ch2 = r.chapters[1];
    assert.strictEqual(ch2.sectionIds.length, 4, 'boundary divider + blank + header + body');
    assert.strictEqual(ch2.startSectionId, ch2.sectionIds[0]);
    assert.notStrictEqual(ch2.startSectionId, ch2.headerSectionId);
    assert.strictEqual(ch2.key, ch2.headerSectionId);
    assert.strictEqual(r.chapters[0].wordCount, 2, 'dividers are not words');
    assert.strictEqual(r.hasHeaders, true);
});

t.test('opening text, prologue, interlude, epilogue', () => {
    const r = detect(['A note before anything.', 'Prologue: The Fall', 'p', '# Chapter 5', 'a', '## The Gathering', 'b', 'Interlude', 'i', 'Epilogue', 'e']);
    assert.deepStrictEqual(brief(r), [
        'opening|Opening text|null|null|A note before anything.',
        'prologue|Prologue: The Fall|null|null|p',
        'chapter|Chapter 5|5|1|a',
        'title|The Gathering|6|2|b',
        'interlude|Interlude|null|null|i',
        'epilogue|Epilogue|null|null|e'
    ]);
    assert.deepStrictEqual(r.chapters.map((c) => c.label), ['Opening', 'Prologue', 'Ch. 5', 'Ch. 6', 'Interlude', 'Epilogue']);
    const ignored = detect(['A note.', '# Chapter 1', 'a'], { openingText: 'ignore' });
    assert.deepStrictEqual(brief(ignored), ['chapter|Chapter 1|1|1|a']);
});

t.test('no headers: single chapter, or split on dividers', () => {
    const single = detect(['a', '***', 'b']);
    assert.deepStrictEqual(brief(single), ['untitled|Full story|1|1|a/***/b']);
    assert.strictEqual(single.hasHeaders, false);
    const split = detect(['a', '***', 'b', '***'], { noHeaderFallback: 'dividers' });
    assert.deepStrictEqual(brief(split), ['untitled|Chapter 1|1|1|a', 'untitled|Chapter 2|2|2|b/***']);
    assert.deepStrictEqual(detect(['', '  ']).chapters, [], 'blank story has no chapters');
});

t.test('headers_and_dividers: a divider not above a header starts an untitled chapter', () => {
    const r = detect(['# Chapter 1', 'a', '***', 'b', '***', '# Chapter 3', 'c'], { boundaryMode: 'headers_and_dividers' });
    assert.deepStrictEqual(brief(r), [
        'chapter|Chapter 1|1|1|a',
        'untitled|Chapter 2|2|2|b',
        'chapter|Chapter 3|3|3|c'
    ]);
});

t.test('dividers mode: only dividers split; a header under a divider names the chapter', () => {
    const r = detect(['[Chapter 1: Dawn]', 'a', '# Not a split', 'b', '***', '[Dusk]', 'c', '***', 'd'], { boundaryMode: 'dividers' });
    assert.deepStrictEqual(brief(r), [
        'chapter|Chapter 1: Dawn|1|1|a/# Not a split/b',
        'title|Dusk|2|2|c',
        'untitled|Chapter 3|3|3|d'
    ]);
    const embedded = detect(['x', '***\n# Chapter 2: Rain', 'y'], { boundaryMode: 'dividers' });
    assert.deepStrictEqual(brief(embedded), ['opening|Opening text|null|null|x', 'chapter|Chapter 2: Rain|2|1|y']);
    assert.strictEqual(embedded.chapters[1].rawHeader, '# Chapter 2: Rain');
});

t.test('Books / Parts: separate divisions, labels and auto-restarting sequence', () => {
    const r = detect(['Book One', '# Chapter 1', 'a', '# Chapter 2', 'b', 'Book Two', 'intro', '# Chapter 1', 'c']);
    assert.deepStrictEqual(r.chapters.map((c) => `${c.kind}|${c.label}|${c.number}|${c.sequence}|${c.division}`), [
        'division|Book One|null|null|',
        'chapter|Book One Ch. 1|1|1|Book One',
        'chapter|Book One Ch. 2|2|2|Book One',
        'division|Book Two|null|null|',
        'chapter|Book Two Ch. 1|1|1|Book Two'
    ]);
    assert.deepStrictEqual(r.chapters[3].paragraphs, ['intro'], 'a part intro stays with its division');
    assert.strictEqual(r.restartsPerDivision, true);
    const cont = detect(['Book One', '# Chapter 1', 'a', 'Book Two', '# Chapter 1', 'c'], { numbering: 'continuous' });
    assert.deepStrictEqual(cont.chapters.filter((c) => c.kind === 'chapter').map((c) => c.sequence), [1, 2]);
    const asChapters = detect(['Part One', 'a', 'Part Two', 'b'], { divisionHeaders: 'chapter' });
    assert.deepStrictEqual(asChapters.chapters.map((c) => `${c.kind}|${c.number}`), ['chapter|1', 'chapter|2']);
});

t.test('inline Book prefixes set the division', () => {
    const r = detect(['[Book 1: Chapter 1: A]', 'a', '[Book 2: Chapter 1: B]', 'b']);
    assert.deepStrictEqual(r.chapters.map((c) => `${c.division}|${c.label}|${c.sequence}`), ['Book 1|Book 1 Ch. 1|1', 'Book 2|Book 2 Ch. 1|1']);
});

t.test('header syntax options and custom break tokens', () => {
    const md = detect(['[Chapter 1]', 'a', '# Chapter 2', 'b'], { headerSyntax: 'markdown_headings' });
    assert.deepStrictEqual(brief(md), ['opening|Opening text|null|null|[Chapter 1]/a', 'chapter|Chapter 2|2|1|b']);
    const noBr = detect(['[Chapter 1]', 'a', 'Chapter 2', 'b'], { detectBracketedTitles: false });
    assert.strictEqual(noBr.chapters[0].kind, 'opening');
    const token = detect(['a', '~~~', 'b', '---', 'c'], { boundaryMode: 'dividers', breakToken: '~~~', onlyBreakToken: true });
    assert.deepStrictEqual(brief(token), ['untitled|Chapter 1|1|1|a', 'untitled|Chapter 2|2|2|b/---/c']);
    assert.strictEqual(detect(['[ Author: X; Tags: y ]', 'a']).hasHeaders, false, 'NovelAI metadata is never a header');
});

t.test('settings are normalised: bad values fall back to defaults', () => {
    const s = JSON.parse(JSON.stringify(run('uccdsNormalizeSettings')({ boundaryMode: 'nope', breakToken: '  ', numbering: 'RESTART', detectBracketedTitles: 'yes' })));
    assert.strictEqual(s.boundaryMode, 'headers');
    assert.strictEqual(s.breakToken, '***');
    assert.strictEqual(s.numbering, 'restart');
    assert.strictEqual(s.detectBracketedTitles, true);
});

t.test('includeText false keeps ids and counts, drops paragraphs; signature changes with text and settings', () => {
    const texts = ['# Chapter 1', 'one two', '# Chapter 2', 'three'];
    nextId = 500;
    const a = detect(texts);
    nextId = 500;
    const b = detect(texts, null, { includeText: false });
    assert.deepStrictEqual(b.chapters[0].paragraphs, []);
    assert.strictEqual(b.chapters[0].wordCount, 2);
    assert.strictEqual(b.includesText, false);
    assert.notStrictEqual(a.signature, b.signature);
    nextId = 500;
    assert.strictEqual(detect(texts).signature, a.signature);
    nextId = 500;
    assert.notStrictEqual(detect(texts, { openingText: 'ignore' }).signature, a.signature);
});

t.test('helpers: chapter text, chapter at a section, kind filter', () => {
    const result = run('uccdsDetectChapters')(sections(['# Chapter 1: A', 'x', '***', 'y', 'Epilogue', 'z']));
    const ch = result.chapters[0];
    assert.strictEqual(run('uccdsChapterText')(ch), 'x\n***\ny');
    assert.strictEqual(run('uccdsChapterText')(ch, { includeHeader: true, separator: '\n\n', dropDividers: true }), '# Chapter 1: A\n\nx\n\ny');
    assert.strictEqual(run('uccdsChapterAt')(result, ch.bodySectionIds[1]).index, 0);
    assert.strictEqual(run('uccdsChapterAt')(result, -1), null);
    assert.strictEqual(run('uccdsChaptersOfKind')(result, ['epilogue']).length, 1);
    assert.strictEqual(run('uccdsChapterByKey')(result, result.chapters[1].key).kind, 'epilogue');
    assert.strictEqual(run('uccdsChapterText')(result.chapters[0], { dropDividers: true, dropBlank: true }), 'x\ny');
});

t.test('uccdsLoadSettings reads config, maps Menagerie break_token mode, honours renamed keys', async () => {
    const { run: r1 } = loadParts(CORE_PARTS, { config: { chapter_boundary_mode: 'dividers', chapter_break_token: '~~~', detect_bracketed_titles: false, chapter_numbering: 'bogus' } });
    const s1 = JSON.parse(JSON.stringify(await r1('uccdsLoadSettings')()));
    assert.deepStrictEqual([s1.boundaryMode, s1.breakToken, s1.detectBracketedTitles, s1.numbering], ['dividers', '~~~', false, 'auto']);
    const { run: r2 } = loadParts(CORE_PARTS, { config: { chapter_detection_mode: 'break_token' } });
    const s2 = JSON.parse(JSON.stringify(await r2('uccdsLoadSettings')()));
    assert.deepStrictEqual([s2.headerSyntax, s2.boundaryMode], ['auto', 'dividers']);
    const { run: r3 } = loadParts(CORE_PARTS, { config: { my_token: '%%%' } });
    const s3 = JSON.parse(JSON.stringify(await r3('uccdsLoadSettings')({ openingText: 'ignore' }, { breakToken: 'my_token' })));
    assert.deepStrictEqual([s3.breakToken, s3.openingText], ['%%%', 'ignore']);
});

t.test('uccdsDetectDocument scans the live document', async () => {
    const { run: r } = loadParts(CORE_PARTS, { doc: ['# Chapter 1', 'hello world'] });
    const result = await r('uccdsDetectDocument')();
    await settle();
    assert.strictEqual(result.chapters.length, 1);
    assert.strictEqual(result.totalWords, 2);
});

t.test("custom words: the [ Intro: ] / [ Section N: ] story", () => {
    const story = ['[ Intro: ]', 'Before it all.', '[ Section 1: ]', 'a', '***', 'b', '[ Section 2: The Pass ]', 'c', '[ Intro: ]', 'between', '[ Section 3: ]', 'd', '[ Intro: ]', 'after'];
    const before = detect(story);
    assert.notDeepStrictEqual(before.chapters.map((c) => c.kind), ['prologue', 'chapter', 'chapter', 'interlude', 'chapter', 'epilogue'], 'built-ins alone get it wrong');
    const r = detect(story, { chapterKeywords: 'Section', specialKeywords: 'Intro' });
    assert.deepStrictEqual(r.chapters.map((c) => `${c.kind}|${c.title}|${c.label}|${c.number}`), [
        'prologue|Intro|Intro|null',
        'chapter|Section 1|Section 1|1',
        'chapter|Section 2: The Pass|Section 2|2',
        'interlude|Intro|Intro|null',
        'chapter|Section 3|Section 3|3',
        'epilogue|Intro|Intro|null'
    ]);
    assert.deepStrictEqual(r.chapters[1].paragraphs, ['a', '***', 'b']);
    assert.strictEqual(run('uccdsHeaderWord')(r.chapters[1]), 'Section');
    assert.strictEqual(run('uccdsHeaderWord')(r.chapters[0]), 'Intro');
    assert.deepStrictEqual(r.settings.chapterKeywords, ['Section']);
});

t.test('custom words: built-in specials keep their kind wherever they are; lists parse from text', () => {
    const r = detect(['# Chapter 1', 'a', 'Prologue', 'odd spot', '# Chapter 2', 'b', 'Foreword', 'f'], { specialKeywords: ['Foreword'] });
    assert.deepStrictEqual(r.chapters.map((c) => c.kind), ['chapter', 'prologue', 'chapter', 'epilogue']);
    const s = JSON.parse(JSON.stringify(run('uccdsNormalizeSettings')({ chapterKeywords: 'Section, Episode; Scene\nCh4, , section', specialKeywords: 42 })));
    assert.deepStrictEqual(s.chapterKeywords, ['Section', 'Episode', 'Scene']);
    assert.deepStrictEqual(s.specialKeywords, []);
    const labels = detect(['[Chapter 1]', 'a', '[Ch. 2]', 'b'], null).chapters.map((c) => c.label);
    assert.deepStrictEqual(labels, ['Ch. 1', 'Ch. 2'], 'Chapter / Ch. still label as Ch.');
    const fixed = [{ sectionId: 1, text: 'x' }];
    const sig = (settings) => run('uccdsDetectChapters')(fixed, settings).signature;
    assert.strictEqual(sig({ chapterKeywords: ['Section'] }), sig({ chapterKeywords: 'Section' }));
    assert.notStrictEqual(sig({ chapterKeywords: ['Section'] }), sig(null), 'words are part of the signature');
});

t.test('custom words from config options', async () => {
    const { run: r } = loadParts(CORE_PARTS, { config: { chapter_custom_chapter_words: 'Section', chapter_custom_unnumbered_words: 'Intro, Outro', chapter_custom_part_words: '' } });
    const s = JSON.parse(JSON.stringify(await r('uccdsLoadSettings')()));
    assert.deepStrictEqual([s.chapterKeywords, s.specialKeywords, s.divisionKeywords], [['Section'], ['Intro', 'Outro'], []]);
});

t.run();
