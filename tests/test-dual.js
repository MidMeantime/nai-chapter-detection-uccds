// End-to-end tests for dual mode: a script built from the dual parts (core + client + dual layer),
// alone and next to the built UCCDS dependency on a mock api.v1.messaging bus, sharing one document.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { loadBundle, loadParts, createBus, createDocument, settle, createRunner } = require('../tools/harness.js');
const { DUAL_PARTS } = require('../scripts/build.js');

const DIST = path.resolve(__dirname, '..', 'dist');
const SERVICE = fs.readdirSync(DIST).find((f) => /^UCCDS_v.+\.naiscript$/.test(f));
if (!SERVICE) throw new Error('Build first: npm run build');
const SERVICE_PATH = path.join(DIST, SERVICE);
const t = createRunner('UCCDS dual mode (embedded + dependency)');

// "Scene 2" is only a chapter when the custom word list says so: lets tests tell whose rules apply
const STORY = ['[Chapter 1: Dawn]', 'one two three', 'Scene 2', 'four', '[Chapter 2: Dusk]', 'five'];
const plain = (x) => JSON.parse(JSON.stringify(x));
const titles = (r) => plain(r).chapters.map((c) => c.title);

function world(options = {}) {
    const bus = createBus();
    const doc = createDocument(options.doc || STORY);
    const startService = (config) => loadBundle(SERVICE_PATH, { bus, sharedDoc: doc, scriptId: 'uccds-service', config: config || options.serviceConfig || {} });
    const client = loadParts(DUAL_PARTS, { bus, sharedDoc: doc, scriptId: 'dual-client', config: options.clientConfig || {} });
    const events = [];
    const start = (extra) => client.run('uccdsDualStart')(Object.assign({ onChange: (reason) => { events.push(reason); } }, extra || {}));
    return { bus, doc, startService, client, events, start };
}
async function waitFor(fn, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await fn()) return;
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error('waitFor timed out');
}
const stopService = (w) => w.bus.subs.splice(0, w.bus.subs.length, ...w.bus.subs.filter((s) => s.scriptId !== 'uccds-service'));

t.test('alone: embedded detector with the script\'s own config, start never waits', async () => {
    const w = world({ clientConfig: { chapter_custom_chapter_words: 'Scene' } });
    const started = Date.now();
    await w.start();
    assert.ok(Date.now() - started < 1000, 'uccdsDualStart returned before the dependency search finished');
    assert.strictEqual(w.client.run('uccdsDualSource')(), 'embedded');
    const r = await w.client.run('uccdsDualGetChapters')();
    assert.deepStrictEqual(titles(r), ['Chapter 1: Dawn', 'Scene 2', 'Chapter 2: Dusk']);
    assert.strictEqual(w.client.run('uccdsDualDependencyInfo')(), null);
});

t.test('alone: getChaptersIfChanged is null until the document changes', async () => {
    const w = world();
    await w.start();
    const r1 = await w.client.run('uccdsDualGetChapters')({ includeText: false });
    assert.strictEqual(await w.client.run('uccdsDualGetChaptersIfChanged')(r1, { includeText: false }), null);
    w.doc.sections.push({ id: 5000, text: '[Chapter 3: Night]' }, { id: 5001, text: 'six' });
    const r2 = await w.client.run('uccdsDualGetChaptersIfChanged')(r1, { includeText: false });
    assert.strictEqual(plain(r2).chapters.length, 3);
});

t.test('dependency present: switches to it, the USER\'s UCCDS rules apply, onChange says "source"', async () => {
    const w = world({ serviceConfig: { chapter_custom_chapter_words: 'Scene' } }); // client config has no custom words
    w.startService();
    await settle();
    await w.start();
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency');
    assert.deepStrictEqual(w.events, ['source']);
    const r = await w.client.run('uccdsDualGetChapters')();
    assert.deepStrictEqual(titles(r), ['Chapter 1: Dawn', 'Scene 2', 'Chapter 2: Dusk']);
    assert.deepStrictEqual(plain(w.client.run('uccdsDualSettings')()).chapterKeywords, ['Scene']);
    assert.strictEqual(plain(w.client.run('uccdsDualDependencyInfo')()).version, '1.0.0');
});

t.test('dependency overrides apply on top of the user\'s rules', async () => {
    const w = world({ serviceConfig: { chapter_custom_chapter_words: 'Scene' } });
    w.startService();
    await settle();
    await w.start({ dependencyOverrides: { chapterKeywords: [] } });
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency');
    assert.deepStrictEqual(titles(await w.client.run('uccdsDualGetChapters')()), ['Chapter 1: Dawn', 'Chapter 2: Dusk']);
});

t.test('dependency that loads later is picked up', async () => {
    const w = world();
    await w.start();
    assert.strictEqual(w.client.run('uccdsDualSource')(), 'embedded');
    w.startService();
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency', 6000);
    assert.ok(w.events.includes('source'));
});

t.test('dependency change events reach onChange as "chapters"', async () => {
    const w = world();
    const service = w.startService({ uccds_watch_seconds: 3 });
    await settle();
    await w.start();
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency');
    await w.client.run('uccdsDualGetChapters')();
    w.doc.sections.push({ id: 6000, text: '[Chapter 3: Night]' }, { id: 6001, text: 'six' });
    // the dependency notices changes on its own poll or after a generation; trigger the latter
    await service.mock.hooks.get('onGenerationEnd')({});
    await waitFor(() => w.events.includes('chapters'));
});

t.test('dependency stops answering: falls back to embedded in the same call, then comes back on reload', async () => {
    const w = world({ clientConfig: {}, serviceConfig: { chapter_custom_chapter_words: 'Scene' } });
    w.startService();
    await settle();
    await w.start();
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency');
    const before = await w.client.run('uccdsDualGetChapters')();
    assert.strictEqual(plain(before).chapters.length, 3);
    stopService(w);
    const r = await w.client.run('uccdsDualGetChaptersIfChanged')(before);
    assert.ok(r, 'a fresh result, not "unchanged"');
    assert.deepStrictEqual(titles(r), ['Chapter 1: Dawn', 'Chapter 2: Dusk'], 'embedded rules (no custom words)');
    assert.strictEqual(w.client.run('uccdsDualSource')(), 'embedded');
    assert.deepStrictEqual(w.events, ['source', 'source']);
    w.startService(); // re-enabled: broadcasts uccds:ready
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency', 6000);
});

t.test('start is idempotent; extra calls only add listeners', async () => {
    const w = world();
    const extra = [];
    await w.start();
    await w.client.run('uccdsDualStart')({ onChange: (r) => { extra.push(r); } });
    w.startService();
    await waitFor(() => w.client.run('uccdsDualSource')() === 'dependency', 6000);
    assert.deepStrictEqual(extra, ['source']);
    assert.deepStrictEqual(w.events, ['source']);
});

t.run();
