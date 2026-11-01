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
