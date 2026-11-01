// --- UCCDS dependency: a small script panel to preview what counts as a chapter ---

const UCCDS_NS = "uccds";
const uccdsId = (name: string): string => `${UCCDS_NS}.${name}`;

const UCCDS_STYLE: Record<string, Record<string, string>> = {
    card: { backgroundColor: 'bg1', border: '1px solid bg2', borderRadius: '6px', padding: '8px 10px', margin: '4px 0' },
    muted: { color: 'textDisabled', fontSize: '0.9em' },
    row: { padding: '3px 0', borderBottom: '1px solid bg2' },
    label: { color: 'textHeadings', minWidth: '90px', marginRight: '8px', fontFamily: 'code', fontSize: '0.85em' },
    title: { color: 'textMain', flex: '1' },
    count: { color: 'textDisabled', fontSize: '0.85em', marginLeft: '8px' },
    button: { backgroundColor: 'bg2', color: 'textHeadings', padding: '4px 10px', borderRadius: '4px', margin: '0 6px 0 0' }
};

const UCCDS_PANEL_ROWS = 150;

const uccdsPanelState: { result: UccdsResult | null; rendering: boolean } = { result: null, rendering: false };

const UCCDS_KIND_NOTE: Record<string, string> = {
    division: " (part)",
    opening: " (before the first header)"
};

function uccdsSettingsSummary(s: UccdsSettings): string {
    const where = s.boundaryMode === 'headers' ? "at headers" : s.boundaryMode === 'dividers' ? "at dividers only" : "at headers and bare dividers";
    const syntax = s.headerSyntax === 'auto' ? `headings, ${s.detectBracketedTitles ? "brackets, " : ""}keywords` : "markdown headings";
    const mine: string[] = [];
    if (s.chapterKeywords.length > 0) mine.push(`chapter: ${s.chapterKeywords.join(", ")}`);
    if (s.divisionKeywords.length > 0) mine.push(`part: ${s.divisionKeywords.join(", ")}`);
    if (s.specialKeywords.length > 0) mine.push(`unnumbered: ${s.specialKeywords.join(", ")}`);
    const words = mine.length > 0 ? ` · your words (${mine.join("; ")})` : "";
    return `Chapters start ${where} · headers: ${syntax} · break token ${s.breakToken}${s.onlyBreakToken ? " (only)" : ""}${words}`;
}

function uccdsChapterRow(ch: UccdsChapter): UIPart {
    return api.v1.ui.part.row({
        alignment: 'center',
        style: UCCDS_STYLE.row,
        content: [
            api.v1.ui.part.text({ text: ch.label, style: UCCDS_STYLE.label, noTemplate: true }),
            api.v1.ui.part.text({ text: ch.title + (UCCDS_KIND_NOTE[ch.kind] || ""), style: UCCDS_STYLE.title, noTemplate: true }),
            api.v1.ui.part.text({ text: `${ch.wordCount.toLocaleString()} words`, style: UCCDS_STYLE.count, noTemplate: true })
        ]
    });
}

async function uccdsRenderPanel(): Promise<void> {
    if (uccdsPanelState.rendering) return;
    uccdsPanelState.rendering = true;
    try {
        const result = uccdsPanelState.result;
        const subs = uccdsService.subscribers.size;
        const header = result
            ? `**${result.chapters.length}** chapter entr${result.chapters.length === 1 ? "y" : "ies"} · ${result.totalWords.toLocaleString()} words · ${subs} script${subs === 1 ? "" : "s"} listening for changes`
            : "Scanning...";
        const rows: UIPart[] = result ? result.chapters.slice(0, UCCDS_PANEL_ROWS).map((ch: UccdsChapter) => uccdsChapterRow(ch)) : [];
        if (result && result.chapters.length > UCCDS_PANEL_ROWS) {
            rows.push(api.v1.ui.part.text({ text: `...and ${result.chapters.length - UCCDS_PANEL_ROWS} more`, style: UCCDS_STYLE.muted }));
        }
        if (result && result.chapters.length === 0) {
            rows.push(api.v1.ui.part.text({ text: "No text in this story yet.", style: UCCDS_STYLE.muted }));
        }

        await api.v1.ui.update([{
            type: 'scriptPanel' as const,
            id: uccdsId("panel"),
            name: "UCCDS Chapters",
            content: [
                api.v1.ui.part.container({
                    style: UCCDS_STYLE.card,
                    content: [
                        api.v1.ui.part.text({ text: header, markdown: true, noTemplate: true }),
                        api.v1.ui.part.text({ text: result ? uccdsSettingsSummary(result.settings) : "", style: UCCDS_STYLE.muted, noTemplate: true }),
                        api.v1.ui.part.text({ text: `This is what scripts using UCCDS see as chapters. Change the rules in this script's Config tab. v${UCCDS_VERSION}`, style: UCCDS_STYLE.muted, noTemplate: true }),
                        api.v1.ui.part.row({
                            style: { marginTop: '6px' },
                            content: [
                                api.v1.ui.part.button({
                                    text: "Rescan",
                                    iconId: 'refresh',
                                    disabledWhileCallbackRunning: true,
                                    style: UCCDS_STYLE.button,
                                    callback: () => { uccdsRefreshPanel(true).catch((err: any) => api.v1.log("UCCDS: rescan failed:", err)); }
                                })
                            ]
                        })
                    ]
                }),
                api.v1.ui.part.column({ content: rows })
            ]
        }]);
    } catch (err: any) {
        api.v1.log("UCCDS: panel render failed:", err);
    } finally {
        uccdsPanelState.rendering = false;
    }
}

/** Re-detects with the user's settings and redraws (always when `force`, else only on a change) */
async function uccdsRefreshPanel(force: boolean): Promise<void> {
    const changed = await uccdsServiceCheckForChanges(true);
    if (changed || force) await uccdsRenderPanel();
}
