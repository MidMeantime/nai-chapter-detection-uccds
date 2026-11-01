// --- Example: embedded UCCDS ---
// The detector is part of this script, so it reads the chapter options from this script's config.

const EX_PANEL_ID = "uccds-example-embedded.panel";

async function exRender(): Promise<void> {
    try {
        const settings = await uccdsLoadSettings();
        const result = await uccdsDetectDocument(settings, { includeText: false });
        const rows: UIPart[] = result.chapters.map((ch: UccdsChapter) => api.v1.ui.part.text({
            text: `${ch.label} · ${ch.title} · ${ch.wordCount} words`,
            noTemplate: true,
            style: { padding: '2px 0', borderBottom: '1px solid bg2' }
        }));
        await api.v1.ui.update([{
            type: 'sidebarPanel' as const,
            id: EX_PANEL_ID,
            name: "Chapters (embedded)",
            content: [
                api.v1.ui.part.text({ text: `**${result.chapters.length}** entries · ${result.totalWords} words`, markdown: true, noTemplate: true }),
                api.v1.ui.part.button({
                    text: "Rescan",
                    disabledWhileCallbackRunning: true,
                    callback: () => { exRender().catch((err: any) => api.v1.log("Example: render failed:", err)); }
                }),
                api.v1.ui.part.column({ content: rows })
            ]
        }]);
    } catch (err: any) {
        api.v1.error("UCCDS example (embedded): render failed:", err);
    }
}

exRender().catch((err: any) => api.v1.error("UCCDS example (embedded): init failed:", err));
api.v1.hooks.register("onGenerationEnd", async () => { await exRender(); });
api.v1.hooks.register("onHistoryNavigated", async () => { await exRender(); });
