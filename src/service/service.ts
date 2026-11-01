// --- UCCDS dependency: answers chapter requests from other scripts over api.v1.messaging ---

const uccdsService = {
    /** Script ids that asked to hear about chapter changes */
    subscribers: new Set<string>(),
    /** Signature of the chapters under the user's settings, as last checked */
    lastSignature: "",
    lastChapterCount: 0,
    watchStarted: false,
    checking: false,
    requestsServed: 0
};

async function uccdsServiceWatchMs(): Promise<number> {
    try {
        const v = await api.v1.config.get("uccds_watch_seconds");
        const secs = typeof v === 'number' && isFinite(v) ? v : 10;
        return Math.max(3, Math.min(120, Math.round(secs))) * 1000;
    } catch {
        return 10000;
    }
}

/** User config, or defaults when the request asks to ignore it, plus the request's overrides */
async function uccdsServiceSettings(overrides: any, ignoreUserConfig: boolean): Promise<UccdsSettings> {
    const base = ignoreUserConfig ? uccdsNormalizeSettings(null) : await uccdsLoadSettings();
    const extra = overrides && typeof overrides === 'object' ? overrides : {};
    return uccdsNormalizeSettings({ ...base, ...extra });
}

function uccdsServiceInfo(): UccdsServiceInfo {
    return { scriptId: api.v1.script.id, version: UCCDS_VERSION, protocol: UCCDS_PROTOCOL };
}

async function uccdsServiceReply(toScriptId: string, requestId: string, ok: boolean, data: any, error?: string): Promise<void> {
    const reply: UccdsReplyMessage = { type: 'uccds:reply', requestId, protocol: UCCDS_PROTOCOL, ok, data };
    if (error) reply.error = error;
    await api.v1.messaging.send(toScriptId, reply, UCCDS_CHANNEL);
}

async function uccdsServiceAnnounce(): Promise<void> {
    const ready: UccdsEventMessage = { type: 'uccds:ready', protocol: UCCDS_PROTOCOL, version: UCCDS_VERSION };
    await api.v1.messaging.broadcast(ready, UCCDS_CHANNEL);
}

/** Runs a detect request. Skips the segmenting when the caller's signature is still current. */
async function uccdsServiceDetect(payload: UccdsDetectRequest): Promise<any> {
    const p: UccdsDetectRequest = payload && typeof payload === 'object' ? payload : {};
    const settings = await uccdsServiceSettings(p.settings, p.ignoreUserConfig === true);
    const includeText = p.includeText !== false;
    const sections = await uccdsScanSections();
    const signature = uccdsSignature(sections, settings, includeText);
    if (p.sinceSignature && p.sinceSignature === signature) {
        return { unchanged: true, signature };
    }
    return { unchanged: false, signature, result: uccdsDetectChapters(sections, settings, { includeText }) };
}

async function uccdsServiceHandle(message: ScriptMessage): Promise<void> {
    const req: any = message.data;
    if (!req || typeof req !== 'object' || typeof req.type !== 'string' || typeof req.requestId !== 'string') return;
    if (req.type === 'uccds:reply' || req.type === 'uccds:ready' || req.type === 'uccds:changed') return;
    if (req.type.indexOf('uccds:') !== 0) return;
    const from = message.fromScriptId;
    const id: string = req.requestId;

    try {
        // A ping always answers, so a client on another protocol version can say what is wrong
        if (req.type === 'uccds:ping') {
            await uccdsServiceReply(from, id, true, uccdsServiceInfo());
            return;
        }
        if (req.protocol !== UCCDS_PROTOCOL) {
            await uccdsServiceReply(from, id, false, uccdsServiceInfo(),
                `UCCDS protocol mismatch: this dependency speaks protocol ${UCCDS_PROTOCOL} (v${UCCDS_VERSION}), the request used ${req.protocol}. Update UCCDS or the script that uses it.`);
            return;
        }
        uccdsService.requestsServed++;
        const payload: any = req.payload || {};
        switch (req.type) {
            case 'uccds:detect':
                await uccdsServiceReply(from, id, true, await uccdsServiceDetect(payload));
                break;
            case 'uccds:parseHeader': {
                const settings = await uccdsServiceSettings(payload.settings, payload.ignoreUserConfig === true);
                const texts: string[] = Array.isArray(payload.texts) ? payload.texts.map((t: any) => String(t == null ? "" : t)) : [String(payload.text == null ? "" : payload.text)];
                const parsed = texts.map((t: string) => uccdsParseHeader(t, settings));
                await uccdsServiceReply(from, id, true, Array.isArray(payload.texts) ? parsed : parsed[0]);
                break;
            }
            case 'uccds:getSettings':
                await uccdsServiceReply(from, id, true, await uccdsServiceSettings(payload.settings, payload.ignoreUserConfig === true));
                break;
            case 'uccds:subscribe':
                uccdsService.subscribers.add(from);
                await uccdsServiceCheckForChanges(true);
                await uccdsServiceReply(from, id, true, { signature: uccdsService.lastSignature, chapterCount: uccdsService.lastChapterCount });
                uccdsServiceStartWatch();
                await uccdsRenderPanel();
                break;
            case 'uccds:unsubscribe':
                uccdsService.subscribers.delete(from);
                await uccdsServiceReply(from, id, true, { subscribed: false });
                await uccdsRenderPanel();
                break;
            default:
                await uccdsServiceReply(from, id, false, null, `Unknown UCCDS request "${req.type}".`);
        }
    } catch (err: any) {
        api.v1.log("UCCDS: request failed:", err);
        try {
            await uccdsServiceReply(from, id, false, null, `UCCDS error: ${err && err.message ? err.message : String(err)}`);
        } catch {
            // the requester is gone
        }
    }
}

/**
 * Re-checks the chapters under the user's settings. When they changed and `notify` is set,
 * every subscriber gets a 'uccds:changed' event (it then asks again with its own settings).
 */
async function uccdsServiceCheckForChanges(notify: boolean): Promise<boolean> {
    if (uccdsService.checking) return false;
    uccdsService.checking = true;
    try {
        const settings = await uccdsLoadSettings();
        const sections = await uccdsScanSections();
        const signature = uccdsSignature(sections, settings, true);
        if (signature === uccdsService.lastSignature) return false;
        const result = uccdsDetectChapters(sections, settings, { includeText: false });
        const first = uccdsService.lastSignature === "";
        uccdsService.lastSignature = signature;
        uccdsService.lastChapterCount = result.chapters.length;
        uccdsPanelState.result = result;
        if (notify && !first) {
            const event: UccdsEventMessage = {
                type: 'uccds:changed', protocol: UCCDS_PROTOCOL, version: UCCDS_VERSION,
                signature, chapterCount: result.chapters.length
            };
            for (const id of Array.from(uccdsService.subscribers)) {
                try {
                    await api.v1.messaging.send(id, event, UCCDS_CHANNEL);
                } catch {
                    uccdsService.subscribers.delete(id);
                }
            }
        }
        return true;
    } catch (err: any) {
        api.v1.log("UCCDS: change check failed:", err);
        return false;
    } finally {
        uccdsService.checking = false;
    }
}

/** Polls for chapter changes while anyone is subscribed (typing has no hook). Started once per load. */
function uccdsServiceStartWatch(): void {
    if (uccdsService.watchStarted) return;
    uccdsService.watchStarted = true;
    (async () => {
        while (true) {
            await api.v1.timers.sleep(await uccdsServiceWatchMs());
            if (uccdsService.subscribers.size === 0) continue;
            if (await uccdsServiceCheckForChanges(true)) await uccdsRenderPanel();
        }
    })().catch((err: any) => api.v1.log("UCCDS: watch stopped:", err));
}
