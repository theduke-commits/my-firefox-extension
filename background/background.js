// --- 1. RECHTSKLICK-EINTRAG BEIM START ERSTELLEN ---
browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
        id: "send-to-ai-assistant",
        title: "An KI Assistenten senden",
        contexts: ["selection"] // Wird NUR angezeigt, wenn Text markiert ist!
    });
});

// --- 2. KLICK-EVENT ABFANGEN & TEXT SPEICHERN ---
browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "send-to-ai-assistant" && info.selectionText) {
        // Speichert den markierten Text im temporären Firefox-Speicher ab
        browser.storage.local.set({ "shared_selection_text": info.selectionText }, () => {
            console.log("🟢 Text erfolgreich im Speicher abgelegt:", info.selectionText);
        });
    }
});