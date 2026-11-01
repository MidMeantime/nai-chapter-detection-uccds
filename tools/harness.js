// Test harness: runs a REAL bundled script (TypeScript stripped) inside a Node vm with a mock
// `api.v1`, so tests exercise the shipped code instead of a pasted copy of it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTypescript() {
    try {
        return require(require.resolve('typescript', { paths: [path.resolve(__dirname, '..')] }));
    } catch {
        throw new Error('The test harness needs TypeScript: run `npm install` in the UCCDS folder first.');
    }
}

/** In-memory NovelAI document: ordered paragraphs with numeric section ids */
function createDocument(texts) {
    let nextId = 1000;
    const doc = { sections: [], ops: [] };
    const newSection = (text) => ({ id: nextId++, text: text == null ? '' : String(text) });
    doc.sections = (texts || []).map(newSection);
    const indexOf = (id) => {
        const idx = doc.sections.findIndex((s) => s.id === id);
        if (idx === -1) throw new Error(`Unknown section id ${id}`);
        return idx;
    };
    doc.texts = () => doc.sections.map((s) => s.text);
    doc.api = {
        scan: async (callback) => doc.sections.map((s, index) => {
            const section = { text: s.text, origin: [], formatting: [] };
            if (callback) callback(s.id, section, index);
            return { sectionId: s.id, section, index };
        }),
        sectionIds: async () => doc.sections.map((s) => s.id),
        append: async (text) => { String(text).split('\n').forEach((t) => doc.sections.push(newSection(t))); doc.ops.push('append'); },
        appendParagraph: async (section) => { doc.sections.push(newSection(section.text)); doc.ops.push('appendParagraph'); },
        appendParagraphs: async (sections) => { sections.forEach((s) => doc.sections.push(newSection(s.text))); doc.ops.push('appendParagraphs'); },
        insertParagraphAfter: async (id, section) => { doc.sections.splice(indexOf(id) + 1, 0, newSection(section.text)); doc.ops.push('insertParagraphAfter'); },
        insertParagraphsAfter: async (id, sections) => { doc.sections.splice(indexOf(id) + 1, 0, ...sections.map((s) => newSection(s.text))); doc.ops.push('insertParagraphsAfter'); },
        updateParagraph: async (id, section) => { doc.sections[indexOf(id)].text = String(section.text); doc.ops.push('updateParagraph'); },
        updateParagraphs: async (updates) => { updates.forEach((u) => { doc.sections[indexOf(u.sectionId)].text = String(u.section.text); }); doc.ops.push('updateParagraphs'); },
        removeParagraph: async (id) => { doc.sections.splice(indexOf(id), 1); doc.ops.push('removeParagraph'); },
        removeParagraphs: async (ids) => {
            ids.forEach((id) => indexOf(id)); // throws on stale ids, like a real failed edit would
            doc.sections = doc.sections.filter((s) => !ids.includes(s.id));
            doc.ops.push('removeParagraphs');
        }
    };
    return doc;
}

function createStorage() {
    const map = new Map();
    return {
        map,
        get: async (k) => (map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : undefined),
        getOrDefault: async (k, d) => (map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : d),
        set: async (k, v) => { map.set(k, v); },
        setIfAbsent: async (k, v) => { if (!map.has(k)) map.set(k, v); },
        has: async (k) => map.has(k),
        remove: async (k) => { map.delete(k); },
        list: async () => Array.from(map.keys())
    };
}

/**
 * Shared messaging bus so several loaded bundles (each its own "script") can talk through
 * api.v1.messaging like they do in NovelAI. Delivery is async, like the real worker bridge.
 */
function createBus() {
    const subs = []; // { scriptId, index, callback, filter }
    let nextIndex = 1;
    const log = [];
    const deliver = (message) => {
        log.push(message);
        for (const s of subs.slice()) {
            if (message.toScriptId !== undefined && message.toScriptId !== s.scriptId) continue;
            if (message.toScriptId === undefined && message.fromScriptId === s.scriptId) continue; // broadcasts skip the sender
            if (s.filter && s.filter.channel !== undefined && s.filter.channel !== message.channel) continue;
            if (s.filter && s.filter.fromScriptId !== undefined && s.filter.fromScriptId !== message.fromScriptId) continue;
            const copy = JSON.parse(JSON.stringify(message));
            setImmediate(() => { Promise.resolve(s.callback(copy)).catch(() => {}); });
        }
    };
    return {
        log,
        subs,
        api: (scriptId) => ({
            send: async (toScriptId, data, channel) => deliver({ fromScriptId: scriptId, toScriptId, channel, data, timestamp: Date.now() }),
            broadcast: async (data, channel) => deliver({ fromScriptId: scriptId, channel, data, timestamp: Date.now() }),
            onMessage: async (callback, filter) => { const index = nextIndex++; subs.push({ scriptId, index, callback, filter }); return index; },
            unsubscribe: async (index) => { const i = subs.findIndex((s) => s.index === index); if (i !== -1) subs.splice(i, 1); }
        })
    };
}

/** Depth-first search through UI parts */
function findParts(parts, predicate, out = []) {
    for (const p of parts || []) {
        if (!p) continue;
        if (predicate(p)) out.push(p);
        if (Array.isArray(p.content)) findParts(p.content, predicate, out);
    }
    return out;
}

function createApi(options = {}) {
    const doc = options.sharedDoc || createDocument(options.doc || []);
    const storage = createStorage();
    const storyStorage = createStorage();
    const tempStorage = createStorage();
    const ui = { panels: new Map(), toasts: [], modals: [], updatedParts: [], modalHandler: options.modalHandler || null };
    const hooks = new Map();
    const files = { saved: [], promptResult: options.filePrompt };
    const logs = [];
    const timerIds = [null]; // ids start at 1
    const story = { memory: options.memory || '', an: options.an || '', title: options.title || 'Test Story', description: options.description || '' };
    // Generation mock: one token per character (so token maths is easy to check in tests)
    const gen = {
        calls: [],
        withStoryCalls: [],
        reply: options.reply !== undefined ? options.reply : 'Mock reply.',
        finishReason: options.finishReason || 'stop',
        impl: options.generateImpl || null,
        maxTokens: options.maxTokens || 4000,
        budget: Object.assign({ output: 100000, input: 100000, waitOutputMs: 0, waitInputMs: 0 }, options.budget || {})
    };
    const lore = { entries: options.loreEntries || [], categories: options.loreCategories || [] };

    const api = {
        v1: {
            log: (...a) => logs.push(['log', ...a]),
            error: (...a) => logs.push(['error', ...a]),
            config: { get: async (k) => (options.config || {})[k] },
            permissions: { has: async () => true, request: async () => true, list: async () => [] },
            storage, storyStorage, tempStorage, historyStorage: createStorage(),
            // Short waits (throttles) resolve at once; long ones (polling loops) never fire in tests
            timers: {
                sleep: (ms) => (ms >= 1000 ? new Promise(() => {}) : Promise.resolve()),
                // Real timers, capped at 200ms so request timeouts are quick to test
                setTimeout: async (cb, ms) => { const t = setTimeout(cb, Math.min(ms, 200)); return timerIds.push(t) - 1; },
                clearTimeout: async (id) => { if (timerIds[id]) clearTimeout(timerIds[id]); }
            },
            document: doc.api,
            memory: { get: async () => story.memory, set: async (v) => { story.memory = v; } },
            an: { get: async () => story.an, set: async (v) => { story.an = v; } },
            story: {
                title: { get: async () => story.title, set: async (v) => { story.title = v; } },
                description: { get: async () => story.description, set: async (v) => { story.description = v; } }
            },
            file: {
                prompt: async () => files.promptResult,
                save: async (name, content) => { files.saved.push({ name, content }); }
            },
            hooks: { register: (name, cb) => { hooks.set(name, cb); } },
            messaging: (options.bus || createBus()).api(options.scriptId || 'test-script'),
            tokenizer: {
                encode: async (text) => Array.from(String(text)).map((c) => c.codePointAt(0)),
                decode: async (tokens) => String.fromCodePoint(...tokens)
            },
            maxTokens: async () => gen.maxTokens,
            rolloverTokens: async () => 0,
            script: {
                id: options.scriptId || 'test-script',
                name: options.scriptName || 'Test Script',
                version: '0.0.0',
                getAllowedOutput: () => gen.budget.output,
                getAllowedInput: () => gen.budget.input,
                getTimeUntilAllowedOutput: () => gen.budget.waitOutputMs,
                getTimeUntilAllowedInput: () => gen.budget.waitInputMs,
                waitForAllowedOutput: async () => {},
                waitForAllowedInput: async () => {},
                countUncachedInputTokens: (messages) => messages.reduce((n, m) => n + String(m.content || '').length, 0)
            },
            createCancellationSignal: async () => {
                const signal = { cancelled: false, cancel: async () => { signal.cancelled = true; }, dispose: () => {} };
                return signal;
            },
            generate: async (messages, params, callback, behaviour, signal) => {
                gen.calls.push({ messages, params });
                if (gen.impl) return gen.impl(messages, params, callback, signal);
                const chunks = gen.reply.match(/.{1,4}/gs) || [''];
                for (let i = 0; i < chunks.length; i++) {
                    if (signal && signal.cancelled) throw new Error('cancelled');
                    if (callback) callback([{ text: chunks[i], index: 0, token_ids: [] }], i === chunks.length - 1);
                    await new Promise((r) => setImmediate(r));
                }
                return { choices: [{ text: gen.reply, index: 0, token_ids: [], finish_reason: gen.finishReason }] };
            },
            generateWithStory: async (messages, params, opts, callback, behaviour, signal) => {
                gen.withStoryCalls.push({ messages, params, opts });
                return { choices: [{ text: gen.reply, index: 0, token_ids: [], finish_reason: 'stop' }] };
            },
            lorebook: {
                entries: async () => lore.entries,
                categories: async () => lore.categories
            },
            editor: { selection: { get: async () => ({ from: { sectionId: 0, offset: 0 } }) } },
            ui: {
                // api.v1.ui.part.* factories just stamp the type onto the config, like the real ones
                part: new Proxy({}, { get: (_, type) => (config) => Object.assign({ type: String(type) }, config) }),
                update: async (exts) => { exts.forEach((e) => ui.panels.set(e.id, e)); },
                updateParts: async (parts) => { ui.updatedParts.push(...parts); },
                toast: async (message, opts) => { ui.toasts.push({ message, type: opts && opts.type }); },
                openPanel: async () => {},
                window: {
                    open: async (opts) => {
                        let closeResolve;
                        const closed = new Promise((r) => { closeResolve = r; });
                        const handle = { opts, closed, isClosed: () => false, close: async () => { closeResolve(); }, update: async () => {} };
                        ui.windows = (ui.windows || []).concat([handle]);
                        return handle;
                    }
                },
                modal: {
                    open: async (opts) => {
                        let closeResolve;
                        const closed = new Promise((r) => { closeResolve = r; });
                        const handle = { opts, closed, close: async () => { closeResolve(); }, update: async () => {} };
                        ui.modals.push(handle);
                        if (ui.modalHandler) setImmediate(() => ui.modalHandler(handle, findParts));
                        return handle;
                    }
                }
            }
        }
    };
    doc.api.textFromSelection = async () => options.selectionText || '';
    return { api, doc, storage, storyStorage, tempStorage, ui, hooks, files, logs, story, gen, lore };
}

/**
 * Loads a bundle into a fresh vm context. Returns { ctx, run, mock } where run(expr) evaluates
 * an expression inside the script's scope (top-level consts included).
 */
function loadBundle(bundlePath, options = {}) {
    const ts = loadTypescript();
    const source = fs.readFileSync(bundlePath, 'utf-8');
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
    const mock = createApi(options);
    const ctx = vm.createContext({ api: mock.api, console, setImmediate, Date, JSON, Math });
    vm.runInContext(js, ctx, { filename: path.basename(bundlePath) });
    const run = (expr) => vm.runInContext(expr, ctx);
    /** Same as run, but returns a plain copy (vm-realm arrays fail deepStrictEqual) */
    run.plain = (expr) => JSON.parse(JSON.stringify(vm.runInContext(expr, ctx)));
    return { ctx, run, mock };
}

/** Lets pending async work (script init, UI renders) settle */
async function settle(rounds = 20) {
    for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** Minimal test runner with readable output */
function createRunner(title) {
    const tests = [];
    return {
        test: (name, fn) => tests.push({ name, fn }),
        run: async () => {
            console.log(`\n${title}`);
            let failed = 0;
            for (const t of tests) {
                try {
                    await t.fn();
                    console.log(`  ok   ${t.name}`);
                } catch (err) {
                    failed++;
                    console.log(`  FAIL ${t.name}\n       ${String(err && err.stack || err).split('\n').slice(0, 4).join('\n       ')}`);
                }
            }
            console.log(`${tests.length - failed}/${tests.length} passed`);
            if (failed > 0) process.exitCode = 1;
            return failed === 0;
        }
    };
}

module.exports = { loadBundle, createApi, createDocument, createBus, findParts, settle, createRunner };

/** Loads source parts (paths relative to the UCCDS folder) without building a file first */
function loadParts(parts, options = {}) {
    const os = require('os');
    const { bundleParts } = require('./bundle.js');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nai-parts-')), 'bundle.ts');
    fs.writeFileSync(tmp, bundleParts(parts));
    return loadBundle(tmp, options);
}

module.exports.loadParts = loadParts;
