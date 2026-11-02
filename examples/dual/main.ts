// --- Example: dual UCCDS ---
// Works on its own (embedded detector, this script's Config tab). When the UCCDS script is installed
// in the same story, chapters come from it instead and the user's UCCDS rules apply. The panel says
// which source is in use; nothing else in the script has to care.

const EX_PANEL_ID = "uccds-example-dual.panel";
let exLast: UccdsResult | null = null;

async function exRender(force: boolean): Promise<void> {
    try {
        const result = force ? await uccdsDualGetChapters({ includeText: false }) : await uccdsDualGetChaptersIfChanged(exLast, { includeText: false });
        if (!result) return; // nothing changed
        exLast = result;
        const info = uccdsDualDependencyInfo();
        const source = info ? `the UCCDS script v${info.version || "?"} (its rules)` : `built in (this script's Config tab)`;
        await api.v1.ui.update([{
            type: 'sidebarPanel' as const,
            id: EX_PANEL_ID,
            name: "Chapters (dual)",
            content: [
                api.v1.ui.part.text({ text: `**${result.chapters.length}** entries · ${result.totalWords} words`, markdown: true, noTemplate: true }),
                api.v1.ui.part.text({ text: `Chapters from ${source}`, noTemplate: true, style: { fontSize: '11px', color: 'textDisabled' } }),
                api.v1.ui.part.button({
                    text: "Rescan",
                    disabledWhileCallbackRunning: true,
                    callback: () => { exRender(true).catch((err: any) => api.v1.log("Example: render failed:", err)); }
                }),
                api.v1.ui.part.column({
                    content: result.chapters.map((ch: UccdsChapter) => api.v1.ui.part.text({
                        text: `${ch.label} · ${ch.title} · ${ch.wordCount} words`,
                        noTemplate: true,
                        style: { padding: '2px 0', borderBottom: '1px solid bg2' }
                    }))
                })
            ]
        }]);
    } catch (err: any) {
        api.v1.error("UCCDS example (dual): render failed:", err);
    }
}

async function exInit(): Promise<void> {
    // 'source': the UCCDS script turned up or went away, so the rules changed: redraw everything.
    // 'chapters': the UCCDS script saw the chapters change.
    await uccdsDualStart({ onChange: async (reason: UccdsDualChangeReason) => { await exRender(reason === 'source'); } });
    await exRender(true);
}

exInit().catch((err: any) => api.v1.error("UCCDS example (dual): init failed:", err));
// Embedded mode has no change events (typing has no hook): refresh after generations and undo/redo
api.v1.hooks.register("onGenerationEnd", async () => { await exRender(false); });
api.v1.hooks.register("onHistoryNavigated", async () => { await exRender(false); });
