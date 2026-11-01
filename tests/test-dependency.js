// End-to-end tests: the built UCCDS dependency and a client script talking over a mock
// api.v1.messaging bus, sharing one story document (like two scripts in the same NovelAI story).
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { loadBundle, loadParts, createBus, createDocument, settle, createRunner } = require('../tools/harness.js');
const { CLIENT_PARTS } = require('../scripts/build.js');

const DIST = path.resolve(__dirname, '..', 'dist');
const SERVICE = fs.readdirSync(DIST).find((f) => /^UCCDS_v.+\.naiscript$/.test(f));
if (!SERVICE) throw new Error('Build first: npm run build');
const SERVICE_PATH = path.join(DIST, SERVICE);
const t = createRunner('UCCDS dependency + client over messaging');

const STORY = ['A note first.', '[Chapter 1: Dawn]', 'one two three', '***', 'four', '[Chapter 2: Dusk]', 'five'];

function world(options = {}) {
    const bus = createBus();
    const doc = createDocument(options.doc || STORY);
    const startService = () => loadBundle(SERVICE_PATH, { bus, sharedDoc: doc, scriptId: 'uccds-service', config: options.serviceConfig || {} });
    const client = loadParts(CLIENT_PARTS, { bus, sharedDoc: doc, scriptId: 'client-a' });
    return { bus, doc, startService, client };
}
const plain = (x) => JSON.parse(JSON.stringify(x));

t.test('client finds a dependency that loads after it, and gets chapters', async () => {
    const w = world();
    const connecting = w.client.run('uccdsConnect')(3000);
    await settle(5);
    const service = w.startService();
    const info = plain(await connecting);
    assert.strictEqual(info.scriptId, 'uccds-service');
    assert.strictEqual(info.protocol, 1);
    const result = plain(await w.client.run('uccdsGetChapters')());
    assert.deepStrictEqual(result.chapters.map((c) => c.title), ['Opening text', 'Chapter 1: Dawn', 'Chapter 2: Dusk']);
    assert.deepStrictEqual(result.chapters[1].paragraphs, ['one two three', '***', 'four']);
    assert.ok(service.mock.ui.panels.has('uccds.panel'), 'dependency shows its preview panel');
});

t.test("the user's config in the dependency applies; request overrides win", async () => {
    const w = world({ serviceConfig: { chapter_opening_text: 'ignore', chapter_boundary_mode: 'headers_and_dividers' } });
    w.startService();
    await settle();
    const r1 = plain(await w.client.run('uccdsGetChapters')());
    // Opening dropped, the bare *** split. `number` follows the written headers (so the split-off part is
    // "previous + 1" = 2, same as the next header); `sequence` is the running count.
    assert.deepStrictEqual(r1.chapters.map((c) => `${c.kind}:${c.number}:${c.sequence}`), ['chapter:1:1', 'untitled:2:2', 'chapter:2:3']);
    const r2 = plain(await w.client.run('uccdsGetChapters')({ settings: { boundaryMode: 'headers' }, includeText: false }));
    assert.deepStrictEqual(r2.chapters.map((c) => c.label), ['Ch. 1', 'Ch. 2']);
    assert.deepStrictEqual(r2.chapters[0].paragraphs, []);
    const r3 = plain(await w.client.run('uccdsGetChapters')({ ignoreUserConfig: true }));
    assert.strictEqual(r3.chapters[0].kind, 'opening');
    const s = plain(await w.client.run('uccdsGetUserSettings')());
    assert.strictEqual(s.openingText, 'ignore');
});

t.test('IfChanged returns null until the story changes', async () => {
    const w = world();
    w.startService();
    await settle();
    const first = await w.client.run('uccdsGetChapters')();
    assert.strictEqual(await w.client.run('uccdsGetChaptersIfChanged')(first), null);
    await w.doc.api.appendParagraph({ text: 'Epilogue' });
    const next = plain(await w.client.run('uccdsGetChaptersIfChanged')(first));
    assert.strictEqual(next.chapters[next.chapters.length - 1].kind, 'epilogue');
});

t.test('remote header parsing uses the same parser', async () => {
    const w = world();
    w.startService();
    await settle();
    const h = plain(await w.client.run('uccdsParseHeaderRemote')('Book 2: Chapter IV - Rain'));
    assert.deepStrictEqual([h.kind, h.number, h.cleanName, h.divisionLabel], ['chapter', 4, 'Rain', 'Book 2']);
    const many = plain(await w.client.run('uccdsParseHeadersRemote')(['Prologue', 'just prose.']));
    assert.deepStrictEqual(many.map((x) => x.isHeader), [true, false]);
});

t.test('change listeners fire after a generation, and re-subscribe when the dependency reloads', async () => {
    const w = world();
    const service = w.startService();
    await settle();
    const events = [];
    await w.client.run('uccdsOnChaptersChanged')((e) => { events.push(e); });
    await w.doc.api.appendParagraph({ text: '[Chapter 3: Night]' });
    await service.mock.hooks.get('onGenerationEnd')();
    await settle();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'uccds:changed');
    assert.strictEqual(events[0].chapterCount, 4);

    // Same dependency reloads (new instance, empty subscriber list): its ready broadcast makes the client sign up again
    w.bus.subs.splice(0, w.bus.subs.length, ...w.bus.subs.filter((s) => s.scriptId !== 'uccds-service'));
    const reloaded = w.startService();
    await settle(40);
    assert.strictEqual(events.length, 2, 'the reload itself is announced to listeners');
    await w.doc.api.appendParagraph({ text: 'Epilogue' });
    await reloaded.mock.hooks.get('onGenerationEnd')();
    await settle();
    assert.strictEqual(events.length, 3, 'listener still fires after the dependency reloaded');
    await w.client.run('uccdsStopListening')();
});

t.test('without the dependency: unavailable, and requests fail with an install hint', async () => {
    const w = world();
    assert.strictEqual(await w.client.run('uccdsIsAvailable')(300), false);
    await assert.rejects(() => w.client.run('uccdsRequest')('uccds:detect', {}, 150), /UCCDS didn't answer/);
});

t.test('a request on another protocol version gets a clear error; ping still answers', async () => {
    const w = world();
    w.startService();
    await settle();
    const bus = w.bus.api('old-client');
    const replies = [];
    await bus.onMessage((m) => replies.push(m.data), { channel: 'uccds' });
    await bus.broadcast({ type: 'uccds:detect', requestId: 'x1', protocol: 99, payload: {} }, 'uccds');
    await bus.broadcast({ type: 'uccds:ping', requestId: 'x2', protocol: 99 }, 'uccds');
    await settle();
    const r1 = replies.find((r) => r.requestId === 'x1');
    const r2 = replies.find((r) => r.requestId === 'x2');
    assert.strictEqual(r1.ok, false);
    assert.match(r1.error, /protocol mismatch/);
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.data.protocol, 1);
});

t.test('dependency ignores chatter that is not a UCCDS request', async () => {
    const w = world();
    w.startService();
    await settle();
    const bus = w.bus.api('noisy');
    const before = w.bus.log.length;
    await bus.broadcast({ hello: 'world' }, 'uccds');
    await bus.broadcast({ type: 'other:thing', requestId: 'n' }, 'uccds');
    await settle();
    assert.strictEqual(w.bus.log.length, before + 2, 'no replies sent');
});

t.test("the user's own header words set in the dependency reach every client", async () => {
    const w = world({
        doc: ['[ Intro: ]', 'x', '[ Section 1: ]', 'a', '[ Section 2: ]', 'b'],
        serviceConfig: { chapter_custom_chapter_words: 'Section', chapter_custom_unnumbered_words: 'Intro' }
    });
    w.startService();
    await settle();
    const r = plain(await w.client.run('uccdsGetChapters')());
    assert.deepStrictEqual(r.chapters.map((c) => c.label), ['Intro', 'Section 1', 'Section 2']);
    const h = plain(await w.client.run('uccdsParseHeaderRemote')('[ Section 7: ]'));
    assert.deepStrictEqual([h.kind, h.number], ['chapter', 7]);
    const override = plain(await w.client.run('uccdsGetChapters')({ settings: { chapterKeywords: [] } }));
    assert.strictEqual(override.chapters[1].kind, 'division', 'an override list replaces the user list');
});

t.test('waitForService: a listener added before UCCDS loads starts working when it does', async () => {
    const w = world();
    const events = [];
    await w.client.run('uccdsOnChaptersChanged')((e) => { events.push(e); }, { waitForService: true });
    await assert.rejects(() => w.client.run('uccdsOnChaptersChanged')(() => {}), /UCCDS didn't answer/, 'without the option it still throws');
    const service = w.startService();
    await settle(40);
    assert.strictEqual(events.length, 1, 'told once when UCCDS turned up');
    assert.ok(w.client.run('uccdsDependencyInfo')(), 'and now connected');
    await w.doc.api.appendParagraph({ text: '[Chapter 3: Late]' });
    await service.mock.hooks.get('onGenerationEnd')();
    await settle();
    assert.strictEqual(events.length, 2, 'then gets normal change events');
});

const EXAMPLES = path.join(DIST, 'examples');
const example = (prefix) => path.join(EXAMPLES, fs.readdirSync(EXAMPLES).find((f) => f.startsWith(prefix)));
const panelText = (panel) => JSON.stringify(panel.content);

t.test('example scripts: embedded lists chapters, dependency lists them through UCCDS or shows an install hint', async () => {
    const embedded = loadBundle(example('UCCDS Example (Embedded)'), { doc: STORY, config: { chapter_opening_text: 'ignore' } });
    await settle(40);
    const ePanel = embedded.mock.ui.panels.get('uccds-example-embedded.panel');
    assert.ok(ePanel && panelText(ePanel).includes('Ch. 2 · Chapter 2: Dusk'));
    assert.ok(!panelText(ePanel).includes('Opening'), 'reads the chapter options from its own config');

    const w = world();
    w.startService();
    const dep = loadBundle(example('UCCDS Example (Dependency)'), { bus: w.bus, sharedDoc: w.doc, scriptId: 'example-dep' });
    await new Promise((r) => setTimeout(r, 300));
    await settle(40);
    const dPanel = dep.mock.ui.panels.get('uccds-example-dependency.panel');
    assert.ok(dPanel && panelText(dPanel).includes('Chapter 1: Dawn'), 'lists chapters from the dependency');

    const lonely = loadBundle(example('UCCDS Example (Dependency)'), { doc: STORY, scriptId: 'example-alone' });
    await new Promise((r) => setTimeout(r, 4500));
    await settle(40);
    assert.ok(panelText(lonely.mock.ui.panels.get('uccds-example-dependency.panel')).includes('Install and enable'));
});

t.run();
