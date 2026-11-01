// --- UCCDS dependency: start-up ---

async function uccdsServiceInit(): Promise<void> {
    try {
        await api.v1.messaging.onMessage((message: ScriptMessage) => uccdsServiceHandle(message), { channel: UCCDS_CHANNEL });
        // Scripts that loaded first wait for this before their first request
        await uccdsServiceAnnounce();
        await uccdsRefreshPanel(true);
        uccdsServiceStartWatch();
    } catch (err: any) {
        api.v1.error("UCCDS: initialization error:", err);
    }
}

uccdsServiceInit().catch((err: any) => api.v1.error("UCCDS: init failed:", err));

api.v1.hooks.register("onScriptsLoaded", async () => {
    // Announce again once every script is up, then refresh the preview
    await uccdsServiceAnnounce();
    await uccdsRefreshPanel(false);
});

api.v1.hooks.register("onGenerationEnd", async () => {
    await uccdsRefreshPanel(false);
});

api.v1.hooks.register("onHistoryNavigated", async () => {
    await uccdsRefreshPanel(false);
});
