// --- Example: UCCDS as a dependency ---
// No detector in here: chapters come from the UCCDS script over api.v1.messaging, using the
// chapter rules the user set once in UCCDS.

const EX_PANEL_ID = "uccds-example-dependency.panel";
let exLast: UccdsResult | null = null;

async function exShow(content: UIPart[]): Promise<void> {
    await api.v1.ui.update([{ type: 'sidebarPanel' as const, id: EX_PANEL_ID, name: "Chapters (dependency)", content }]);
}

async function exRender(force: boolean): Promise<void> {
    try {
        // includeText: false keeps the message small; ask for text only when you need it
        const result = force ? await uccdsGetChapters({ includeText: false }) : await uccdsGetChaptersIfChanged(exLast, { includeText: false });
        if (!result) return; // nothing changed
        exLast = result;
        const info = uccdsDependencyInfo();
        await exShow([
            api.v1.ui.part.text({ text: `**${result.chapters.length}** entries · ${result.totalWords} words · UCCDS v${info ? info.version : "?"}`, markdown: true, noTemplate: true }),
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
        ]);
    } catch (err: any) {
        await exShow([api.v1.ui.part.text({
            text: `Couldn't reach UCCDS: ${err && err.message ? err.message : String(err)}\n\nInstall and enable the **UCCDS: Universal Customizable Chapter Detection System** script, then reload.`,
            markdown: true,
            noTemplate: true
        })]);
    }
}

async function exShowInstallHint(): Promise<void> {
    await exShow([api.v1.ui.part.text({
        text: "This script needs **UCCDS: Universal Customizable Chapter Detection System**. Install and enable it, then reload.",
        markdown: true,
        noTemplate: true
    })]);
}

async function exInit(): Promise<void> {
    if (!(await uccdsIsAvailable())) {
        await exShowInstallHint();
        return;
    }
    await exRender(true);
    await uccdsOnChaptersChanged(async () => { await exRender(false); });
}

exInit().catch((err: any) => api.v1.error("UCCDS example (dependency): init failed:", err));
