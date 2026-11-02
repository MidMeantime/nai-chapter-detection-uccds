// --- UCCDS dual: the embedded detector, plus the UCCDS dependency script whenever it's installed ---
// Built on the core (embedded detection) and the client (dependency). The script works on its own
// with its own config options; if the user also has the UCCDS script enabled in the story, chapters
// come from it instead, so the user's global UCCDS rules apply and every UCCDS script agrees.
// If the dependency stops answering (disabled mid-session), the next request falls back to the
// embedded detector; if it comes back (re-enabled, reloaded), it's picked up again.
//
//   await uccdsDualStart({ onChange: async () => redraw() });   // never waits for the dependency
//   let result = await uccdsDualGetChapters();                   // from whichever source is active
//   const next = await uccdsDualGetChaptersIfChanged(result);    // null when nothing changed
//   uccdsDualSource();                                           // 'embedded' | 'dependency'

/** Where chapters come from right now */
type UccdsSource = 'embedded' | 'dependency';

/** Why an onChange listener was called */
type UccdsDualChangeReason = 'source' | 'chapters';

interface UccdsDualOptions {
    /**
     * The embedded rules. Default: uccdsLoadSettings() (the config options from the snippet).
     * Pass your own loader to rename options, add overrides, or migrate older option values.
     */
    loadSettings?: () => Promise<UccdsSettings>;
    /**
     * Called when the source switches ('source': the dependency turned up, or stopped answering) or
     * the dependency reports changed chapters ('chapters'). Re-fetch inside: uccdsDualGetChapters().
     */
    onChange?: (reason: UccdsDualChangeReason) => void | Promise<void>;
    /** Ask the dependency to override some of the user's UCCDS rules for this script only */
    dependencyOverrides?: Partial<UccdsSettings>;
}

const uccdsDual: {
    started: boolean;
    source: UccdsSource;
    settings: UccdsSettings;
    loadSettings: () => Promise<UccdsSettings>;
    overrides: Partial<UccdsSettings> | undefined;
    listeners: ((reason: UccdsDualChangeReason) => void | Promise<void>)[];
    switching: Promise<void> | null;
} = {
    started: false,
    source: 'embedded',
    settings: uccdsNormalizeSettings(null),
    loadSettings: () => uccdsLoadSettings(),
    overrides: undefined,
    listeners: [],
    switching: null
};

function uccdsDualNotify(reason: UccdsDualChangeReason): void {
    for (const listener of uccdsDual.listeners.slice()) {
        try {
            const r = listener(reason);
            if (r && typeof (r as any).catch === 'function') (r as Promise<void>).catch((err: any) => api.v1.log("UCCDS dual: change listener failed:", err));
        } catch (err: any) {
            api.v1.log("UCCDS dual: change listener failed:", err);
        }
    }
}

/** Switches source and loads the matching rules. Returns false (and stays put) if the dependency doesn't send its rules */
async function uccdsDualUse(source: UccdsSource): Promise<boolean> {
    if (source === 'dependency') {
        try {
            const settings = await uccdsGetUserSettings();
            uccdsDual.settings = uccdsNormalizeSettings({ ...settings, ...(uccdsDual.overrides || {}) });
        } catch {
            return false;
        }
    } else {
        uccdsDual.settings = await uccdsDual.loadSettings();
    }
    const changed = uccdsDual.source !== source;
    uccdsDual.source = source;
    if (changed) uccdsDualNotify('source');
    return true;
}

/** Client event (dependency loaded, reloaded or changed): switch over, or pass the change on */
async function uccdsDualOnEvent(_event: UccdsEventMessage): Promise<void> {
    if (uccdsDual.source === 'dependency') {
        uccdsDualNotify('chapters');
        return;
    }
    if (!uccdsDependencyInfo()) return;
    if (!uccdsDual.switching) {
        uccdsDual.switching = uccdsDualUse('dependency').then(
            () => { uccdsDual.switching = null; },
            (err: any) => { uccdsDual.switching = null; api.v1.log("UCCDS dual: switching to the dependency failed:", err); }
        );
    }
    await uccdsDual.switching;
}

/**
 * Starts dual mode: loads the embedded rules (awaited, quick) and starts looking for the UCCDS
 * script in the background (not awaited; that can take a few seconds when it isn't installed).
 * Safe to call more than once; later calls only add their onChange listener.
 */
async function uccdsDualStart(options?: UccdsDualOptions): Promise<void> {
    const o = options || {};
    if (o.onChange) uccdsDual.listeners.push(o.onChange);
    if (uccdsDual.started) return;
    uccdsDual.started = true;
    if (o.loadSettings) uccdsDual.loadSettings = o.loadSettings;
    uccdsDual.overrides = o.dependencyOverrides;
    uccdsDual.settings = await uccdsDual.loadSettings();
    // Keeps listening after this, so a UCCDS that loads later (or reloads) is picked up too
    uccdsOnChaptersChanged(uccdsDualOnEvent, { waitForService: true })
        .then(async () => {
            if (uccdsDependencyInfo() && uccdsDual.source !== 'dependency') await uccdsDualOnEvent({ type: 'uccds:ready', protocol: UCCDS_PROTOCOL, version: "" });
        })
        .catch((err: any) => api.v1.log("UCCDS dual: dependency watch failed:", err));
}

/** Adds a change listener (same as onChange in uccdsDualStart) */
function uccdsDualOnChange(listener: (reason: UccdsDualChangeReason) => void | Promise<void>): void {
    uccdsDual.listeners.push(listener);
}

/** 'embedded' or 'dependency' */
function uccdsDualSource(): UccdsSource {
    return uccdsDual.source;
}

/** The chapter rules in effect: your config's (embedded) or the user's UCCDS rules (dependency) */
function uccdsDualSettings(): UccdsSettings {
    return uccdsDual.settings;
}

/** The dependency's info while it's the source, else null */
function uccdsDualDependencyInfo(): UccdsServiceInfo | null {
    return uccdsDual.source === 'dependency' ? uccdsDependencyInfo() : null;
}

/** Reloads the embedded rules (e.g. after your own settings UI changed them) */
async function uccdsDualReloadSettings(): Promise<void> {
    if (uccdsDual.source === 'embedded') uccdsDual.settings = await uccdsDual.loadSettings();
}

/**
 * The story's chapters from the active source, or null when nothing changed since `previous`.
 * A dependency that doesn't answer is dropped (onChange gets 'source') and the embedded detector
 * answers instead, so this only throws on errors that aren't about the dependency.
 */
async function uccdsDualGetChaptersIfChanged(previous: UccdsResult | null, options?: { includeText?: boolean }): Promise<UccdsResult | null> {
    const includeText = !options || options.includeText !== false;
    if (uccdsDual.source === 'dependency') {
        try {
            return await uccdsGetChaptersIfChanged(previous, { includeText, settings: uccdsDual.overrides });
        } catch (err: any) {
            api.v1.log("UCCDS dual: the UCCDS script stopped answering; using the embedded detector.", err);
            await uccdsDualUse('embedded');
            previous = null; // the old result came from the other source
        }
    }
    const sections = await uccdsScanSections();
    if (previous && previous.signature === uccdsSignature(sections, uccdsDual.settings, includeText)) return null;
    return uccdsDetectChapters(sections, uccdsDual.settings, { includeText });
}

/** The story's chapters from the active source (embedded fallback as above) */
async function uccdsDualGetChapters(options?: { includeText?: boolean }): Promise<UccdsResult> {
    const result = await uccdsDualGetChaptersIfChanged(null, options);
    // previous = null never returns null; this keeps the type honest
    return result || uccdsDetectChapters(await uccdsScanSections(), uccdsDual.settings, options);
}
