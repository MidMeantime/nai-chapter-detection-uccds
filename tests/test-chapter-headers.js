// Unit tests for the header parser, src/chapter-headers.ts (runs the real TypeScript source).
const assert = require('assert');
const { loadParts, createRunner } = require('../tools/harness.js');

const { run } = loadParts(['src/chapter-headers.ts']);
const parse = (text, opts) => run('chParseHeader')(text, opts);
const name = (text, opts) => parse(text, opts).cleanName;
const t = createRunner('Shared chapter headers');

t.test('markdown, bracket and keyword headers (carried over from linter tests)', () => {
    assert.strictEqual(name('# Chapter 1: The Dark Forest'), 'The Dark Forest');
    assert.strictEqual(name('## The Gathering'), 'The Gathering');
    assert.strictEqual(name('[Chapter 9: Whispers in the Deep]'), 'Whispers in the Deep');
    assert.strictEqual(name('[ Chapter 9: Whispers in the Deep ]'), 'Whispers in the Deep');
    assert.strictEqual(name('[Title: Blood & Roses]'), 'Blood & Roses');
    assert.strictEqual(parse('[Chapter 4]').isHeader, true);
    assert.strictEqual(name('[Chapter 4]'), '');
    assert.strictEqual(name('Chapter IV: Echoes'), 'Echoes');
    assert.strictEqual(name('Chapter Three'), '');
    const pro = parse('Prologue: The Fall');
    assert.strictEqual(pro.kind, 'prologue');
    assert.strictEqual(pro.cleanName, 'The Fall');
    assert.strictEqual(parse('Epilogue').kind, 'epilogue');
});

t.test('non-headers', () => {
    for (const text of ['***', '---', '* * *', 'Alice looked across the misty harbor.',
        'Part of me wanted to run.', 'Chapter after chapter, she read on.', 'Book in hand, he left.',
        'Act now, think later.', 'Prologues are overrated, she thought.', 'Chapter 2\nShe woke late.']) {
        assert.strictEqual(parse(text).isHeader, false, text);
    }
});

t.test('NovelAI metadata brackets are ignored', () => {
    assert.strictEqual(parse('[ Author: Jane Doe; Title: Night; Tags: noir; Genre: mystery ]').isHeader, false);
    assert.strictEqual(parse('[ Style: terse, cold ]').isHeader, false);
    assert.strictEqual(parse('[Knowledge: the city has no moon]').isHeader, false);
    assert.strictEqual(parse('[ Mid: note to self ]').isHeader, false);
    assert.strictEqual(parse('[ 1: a; b ]').isHeader, false);
    assert.strictEqual(name('[The Long Night]'), 'The Long Night');
    assert.strictEqual(name('[Part 2: The Return]'), 'The Return');
});

t.test('keyword-less numbers left by imports', () => {
    assert.strictEqual(name('[ 1: Sandor ]'), 'Sandor');
    assert.strictEqual(parse('[ 1: Sandor ]').number, 1);
    assert.strictEqual(name('[12: The Hound]'), 'The Hound');
    assert.strictEqual(name('[IV: Ashfall]'), 'Ashfall');
    assert.strictEqual(parse('[IV: Ashfall]').number, 4);
    assert.strictEqual(name('[Twenty-One: Rain]'), 'Rain');
    assert.strictEqual(name('[ 7 ]'), '');
    assert.strictEqual(name('[Chapter 3: 1984]'), '1984');
    assert.strictEqual(name('[Ivy League]'), 'Ivy League');
    assert.strictEqual(parse('[Ivy League]').number, null);
});

t.test('number words, separators and emphasis', () => {
    assert.strictEqual(name('Chapter Twenty-One'), '');
    assert.strictEqual(parse('Chapter Twenty-One').number, 21);
    assert.strictEqual(name('Chapter Twenty-One: Ashes'), 'Ashes');
    assert.strictEqual(name('Chapter 1. The Beginning'), 'The Beginning');
    assert.strictEqual(name('Ch. 7 - Smoke'), 'Smoke');
    assert.strictEqual(parse('Ch. 7 - Smoke').number, 7);
    assert.strictEqual(name('**Chapter 3: Fire**'), 'Fire');
    assert.strictEqual(name('# Chapter 4 The Forest'), 'The Forest');
    assert.strictEqual(name('# Part of the Plan'), 'Part of the Plan');
    assert.strictEqual(name('## Part 1: Chapter 3: Embers'), 'Embers');
    assert.strictEqual(name('[Chapter 3: Act of Faith]'), 'Act of Faith');
});

t.test('header kinds and innermost label', () => {
    assert.strictEqual(parse('# Chapter 1').kind, 'chapter');
    assert.strictEqual(parse('## The Gathering').kind, 'title');
    assert.strictEqual(parse('Part Two').kind, 'division');
    assert.strictEqual(parse('Part Two').number, 2);
    assert.strictEqual(parse('[Book 3: Ashes]').kind, 'division');
    assert.strictEqual(parse('Act II').kind, 'division');
    const stacked = parse('## Part 1: Chapter 3: Embers');
    assert.strictEqual(stacked.kind, 'chapter');
    assert.strictEqual(stacked.number, 3);
    assert.strictEqual(stacked.labelText, 'Part 1: Chapter 3');
    assert.strictEqual(parse('# Chapter 8').level, 1);
    assert.strictEqual(parse('[ Chapter 8 ]').syntax, 'bracket');
});

t.test('strict roman numerals: words are not numbers', () => {
    assert.strictEqual(parse('Book Mill').isHeader, false);
    assert.strictEqual(parse('Chapter Mild').isHeader, false);
    assert.strictEqual(parse('Chapter iv').number, 4);
    assert.strictEqual(run('chParseNumber')('IV'), 4);
    assert.strictEqual(run('chParseNumber')('XIV'), 14);
    assert.strictEqual(run('chParseNumber')('MCMXCIV'), 1994);
    assert.strictEqual(run('chParseNumber')('IIII'), null);
    assert.strictEqual(run('chParseNumber')('thirty two'), 32);
    assert.strictEqual(run('chToRoman')(14), 'XIV');
});

t.test('dividers, embedded dividers and custom tokens', () => {
    const embedded = parse('***\n# Chapter 1: Dawn');
    assert.strictEqual(embedded.cleanName, 'Dawn');
    assert.strictEqual(embedded.hasEmbeddedDivider, true);
    assert.strictEqual(parse('~~~', { detectionMode: 'auto', detectBracketedTitles: true, breakToken: '~~~' }).isHeader, false);
    assert.strictEqual(run('chIsDivider')('~~~', '~~~'), true);
    assert.strictEqual(run('chIsDivider')('* * *'), true);
    assert.strictEqual(run('chIsDivider')('**'), false);
});

t.test('detection options', () => {
    const mdOnly = { detectionMode: 'markdown_headings', detectBracketedTitles: true };
    assert.strictEqual(parse('# Chapter 1', mdOnly).isHeader, true);
    assert.strictEqual(parse('[Chapter 1]', mdOnly).isHeader, false);
    assert.strictEqual(parse('Chapter 1: Dawn', mdOnly).isHeader, false);
    const noBrackets = { detectionMode: 'auto', detectBracketedTitles: false };
    assert.strictEqual(parse('[Chapter 1]', noBrackets).isHeader, false);
    assert.strictEqual(parse('Chapter 1', noBrackets).isHeader, true);
});

t.test('display titles', () => {
    const dt = (text) => run('chDisplayTitle')(parse(text));
    assert.strictEqual(dt('[ Chapter 8 ]'), 'Chapter 8');
    assert.strictEqual(dt('# Chapter 3: The Fall'), 'Chapter 3: The Fall');
    assert.strictEqual(dt('[ 1: Sandor ]'), 'Chapter 1: Sandor');
    assert.strictEqual(dt('## The Gathering'), 'The Gathering');
    assert.strictEqual(dt('Prologue: The Fall'), 'Prologue: The Fall');
    assert.strictEqual(dt('Chapter IV: Echoes'), 'Chapter IV: Echoes');
    assert.strictEqual(dt('[Title: Blood & Roses]'), 'Blood & Roses');
});

t.test('emphasis stripping leaves dividers, bullets and snake_case alone', () => {
    const strip = run('chStripEmphasis');
    assert.strictEqual(strip('***'), '***');
    assert.strictEqual(strip('* * *'), '* * *');
    assert.strictEqual(strip('She was *so* tired, **really**.'), 'She was so tired, really.');
    assert.strictEqual(strip('***Loud*** words'), 'Loud words');
    assert.strictEqual(strip('the _quiet_ one'), 'the quiet one');
    assert.strictEqual(strip('open my_file_name.txt'), 'open my_file_name.txt');
    assert.strictEqual(strip('* list item'), '* list item');
    assert.strictEqual(strip('__init__ and __bold__'), 'init and bold');
});

t.test('title normalisation keeps accented letters', () => {
    const norm = run('chNormalizeTitle');
    assert.strictEqual(norm('  The Fall!  '), 'the fall');
    assert.strictEqual(norm('Café — Noir'), 'café noir');
});

t.test('ideas from the Menagerie parser: interlude/prelude, Section/Arc, specials inside divisions', () => {
    assert.strictEqual(parse('Interlude').kind, 'interlude');
    assert.strictEqual(parse('[Prelude: Before]').kind, 'prologue');
    assert.strictEqual(parse('[Prelude: Before]').keyword, 'Prelude');
    assert.strictEqual(parse('Section 2: Logistics').kind, 'division');
    assert.strictEqual(parse('Arc III').number, 3);
    const actPro = parse('# Act II: Prologue');
    assert.strictEqual(actPro.kind, 'prologue');
    assert.strictEqual(actPro.labelText, 'Act II: Prologue');
    const partInter = parse('Part 1, Interlude: Rain');
    assert.strictEqual(partInter.kind, 'interlude');
    assert.strictEqual(partInter.cleanName, 'Rain');
    assert.strictEqual(parse('Part 1, Chapter 3').number, 3);
    assert.strictEqual(parse('Section by section, she read.').isHeader, false);
});

t.test("the Menagerie plan's false positives stay rejected", () => {
    for (const text of ['Act now — before it is too late.', 'Act fast-', 'Volume up—', 'Scene-stealer',
        '[He looked away.]', '[ Style: dark, gritty ]', '[ Author: Me; Tags: x ]', 'Part of me wanted to leave.']) {
        assert.strictEqual(parse(text).isHeader, false, text);
    }
    assert.strictEqual(parse('Chapter 7.').isHeader, true, 'near miss from the plan is now caught');
    assert.strictEqual(parse('[Chapter 7.]').isHeader, true);
    assert.strictEqual(parse('Part two - the end').kind, 'division');
});

t.test('number filling: untitled after Chapter 5 is 6, specials get none', () => {
    const fill = (texts) => JSON.parse(JSON.stringify(run('chFillNumbers')(texts.map((x) => x === null ? null : parse(x)))));
    assert.deepStrictEqual(fill(['Prologue', '# Chapter 5', '## The Gathering', 'Interlude', '[Title: Dusk]', 'Epilogue']), [null, 5, 6, null, 7, null]);
    assert.deepStrictEqual(fill(['# Dawn', '# Dusk']), [1, 2]);
});

t.test('onlyBreakToken: a lone --- stays text', () => {
    assert.strictEqual(run('chIsDivider')('---', '~~~', true), false);
    assert.strictEqual(run('chIsDivider')('~~~', '~~~', true), true);
    assert.strictEqual(run('chIsDivider')('---', '~~~', false), true);
});

t.test('"Chapter: N" numbers and inline Book prefixes', () => {
    assert.strictEqual(parse('Chapter: 1').number, 1);
    assert.strictEqual(parse('Chapter: 1').cleanName, '');
    assert.strictEqual(parse('Chapter: 3: The Fall').cleanName, 'The Fall');
    const b = parse('Book 2: Chapter: 4 - Ashes');
    assert.deepStrictEqual([b.kind, b.number, b.cleanName, b.divisionLabel, b.divisionNumber], ['chapter', 4, 'Ashes', 'Book 2', 2]);
    assert.strictEqual(parse('[ Book II - Chapter IV: Rain ]').divisionNumber, 2);
    assert.strictEqual(parse('Chapter: Mix').number, null, 'a word title is not a numeral');
    assert.strictEqual(parse('[Chapter 3: 1984]').cleanName, '1984', 'numbered chapter keeps a numeric title');
    assert.strictEqual(parse('Book 1:').kind, 'division');
    assert.strictEqual(parse('Book 1:').divisionLabel, '');
});

t.test('custom header words: user-defined chapter / part / unnumbered words', () => {
    // The motivating story: [ Intro: ] then [ Section N: ] as chapter headers
    assert.strictEqual(parse('[ Intro: ]').isHeader, false, 'unknown word: not a header by default');
    assert.strictEqual(parse('[ Section 3: ]').kind, 'division', 'Section is a Part word by default');
    const opts = { detectionMode: 'auto', detectBracketedTitles: true, chapterKeywords: ['Section'], specialKeywords: ['Intro'] };
    const intro = parse('[ Intro: ]', opts);
    assert.deepStrictEqual([intro.isHeader, intro.kind, intro.keyword, intro.cleanName], [true, 'prologue', 'Intro', '']);
    const sec = parse('[ Section 3: ]', opts);
    assert.deepStrictEqual([sec.kind, sec.keyword, sec.number, sec.labelText, sec.cleanName], ['chapter', 'Section', 3, 'Section 3', '']);
    assert.strictEqual(run('chDisplayTitle')(sec), 'Section 3');
    assert.strictEqual(parse('[ Section Four: The Pass ]', opts).cleanName, 'The Pass');
    assert.strictEqual(parse('Section 3: The Fall', opts).number, 3, 'keyword lines too');
    assert.strictEqual(parse('# Intro', opts).kind, 'prologue', 'markdown too');
    assert.strictEqual(parse('Section by section, she read.', opts).isHeader, false, 'prose stays prose');
    assert.strictEqual(parse('Intro music played softly.', opts).isHeader, false);
    assert.strictEqual(parse('[ Part 2: Chapter 1 ]', opts).kind, 'chapter', 'built-ins still work alongside');
});

t.test('custom header words: multi-word, case, parts, moving built-ins, bad input', () => {
    const p = (text, o) => parse(text, Object.assign({ detectionMode: 'auto', detectBracketedTitles: true }, o));
    assert.strictEqual(p('Side Story 2: Rain', { chapterKeywords: ['Side Story'] }).number, 2);
    assert.strictEqual(p('SIDE  STORY 2', { chapterKeywords: ['side story'] }).isHeader, true);
    assert.strictEqual(p('Ep. 4: Pilot', { chapterKeywords: ['Ep.'] }).number, 4, 'trailing dot optional');
    assert.strictEqual(p('Ep 4: Pilot', { chapterKeywords: ['Ep.'] }).number, 4);
    const season = p('[ Season 2: Episode 5 ]', { divisionKeywords: ['Season'], chapterKeywords: ['Episode'] });
    assert.deepStrictEqual([season.kind, season.number, season.divisionLabel, season.divisionNumber], ['chapter', 5, 'Season 2', 2]);
    assert.strictEqual(p('Season 3', { divisionKeywords: ['Season'] }).kind, 'division');
    assert.strictEqual(p('Act 2: Storm', { chapterKeywords: ['Act'] }).kind, 'chapter', 'a built-in Part word can become a chapter word');
    assert.strictEqual(p('Interlude 2', { chapterKeywords: ['Interlude'] }).number, 2, 'and a built-in special');
    assert.strictEqual(p('Epilogue', { divisionKeywords: ['Epilogue'] }).kind, 'division');
    const both = p('Section 1', { chapterKeywords: ['Section'], divisionKeywords: ['Section'] });
    assert.strictEqual(both.kind, 'chapter', 'chapter list wins over part list');
    for (const bad of ['Ch4', '[x]', 'a:b', '', '   ', '...', 'x(y)', 'a|b']) {
        assert.doesNotThrow(() => p('Chapter 1', { chapterKeywords: [bad] }), bad);
        assert.strictEqual(p('Chapter 1', { chapterKeywords: [bad] }).number, 1, `bad word ${JSON.stringify(bad)} is ignored`);
    }
    assert.deepStrictEqual(JSON.parse(JSON.stringify(run('chCleanWords')(['Section', 'section', ' Episode ', 'Ch4', 42]))), ['Section', 'Episode']);
    const g1 = run('chGrammar')({ detectionMode: 'auto', detectBracketedTitles: true, chapterKeywords: ['Section'] });
    const g2 = run('chGrammar')({ detectionMode: 'auto', detectBracketedTitles: false, chapterKeywords: ['section'] });
    assert.strictEqual(g1 === run('chGrammar')({ detectionMode: 'auto', detectBracketedTitles: true, chapterKeywords: ['Section'] }), true, 'grammars are cached');
    assert.ok(g2, 'grammar built for a differently-cased list');
});

t.run();
