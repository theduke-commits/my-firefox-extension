document.addEventListener("DOMContentLoaded", () => {
    const appTitle = document.getElementById("app-title");
    const welcomeText = document.getElementById("welcome-text");
    const sendBtn = document.getElementById("send-btn");
    const clearVramBtn = document.getElementById("clear-vram-btn");
    const userPrompt = document.getElementById("user-prompt");
    const outputDiv = document.getElementById("response-output");
    const vramStatus = document.getElementById("vram-status");
    const backendUrl = "http://127.0.0.1:8000";
    const vramPercentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
    let vramRequestId = 0;

    try {
        const nameTranslation = (typeof browser !== "undefined" && browser.i18n) ? browser.i18n.getMessage("extensionName") : "Mein KI Assistent";
        const welcomeTranslation = (typeof browser !== "undefined" && browser.i18n) ? browser.i18n.getMessage("welcomeMessage") : "Willkommen im Kontrollzentrum!";
        
        if (appTitle && nameTranslation) appTitle.textContent = nameTranslation;
        if (welcomeText) welcomeText.textContent = welcomeTranslation ? welcomeTranslation : "Willkommen im Kontrollzentrum!";
    } catch (e) {}

    // AUTOMATISCHER TEXT-IMPORT
    if (userPrompt) {
        try {
            browser.storage.local.get("shared_selection_text", (result) => {
                if (result && result.shared_selection_text) {
                    userPrompt.value = result.shared_selection_text;
                    browser.storage.local.remove("shared_selection_text");
                }
            });
        } catch (storageError) {
            console.error("Fehler beim Laden des Selektionstextes:", storageError);
        }
    }

    async function refreshVramStatus() {
        if (!vramStatus) return;
        const requestId = ++vramRequestId;
        try {
            const response = await fetch(backendUrl + "/vram-status", { cache: "no-store" });
            if (!response.ok) throw new Error("VRAM-Status (HTTP " + response.status + ")");
            const { percentage } = await response.json();
            if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
                throw new Error("Ungültiger VRAM-Prozentwert.");
            }

            if (requestId !== vramRequestId) return;
            const displayPercent = vramPercentFormat.format(percentage);
            const critical = percentage > 80;
            vramStatus.dataset.level = critical ? "critical" : "ok";
            vramStatus.textContent = critical
                ? "⚠️ VRAM kritisch: " + displayPercent + "%! Bitte reinigen."
                : "🟢 VRAM optimal: " + displayPercent + "%";
        } catch (error) {
            if (requestId !== vramRequestId) return;
            console.error("VRAM-Status konnte nicht geladen werden:", error);
            vramStatus.dataset.level = "unavailable";
            vramStatus.textContent = "VRAM-Status nicht verfügbar.";
        }
    }

    void refreshVramStatus();

    function setActionsDisabled(disabled) {
        if (sendBtn) sendBtn.disabled = disabled;
        if (clearVramBtn) clearVramBtn.disabled = disabled;
    }

    async function postToBackend(path, responseField, body = {}) {
        let response;
        try {
            response = await fetch(backendUrl + path, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        } catch (error) {
            console.error("FastAPI-Verbindung fehlgeschlagen:", error);
            throw new Error("FastAPI unter 127.0.0.1:8000 ist nicht erreichbar.");
        }

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            const detail = typeof data?.detail === "string" ? " – " + data.detail : "";
            throw new Error("Backend-Fehler (HTTP " + response.status + ")" + detail);
        }
        if (typeof data?.[responseField] !== "string") {
            throw new Error("Das Backend hat eine Antwort in einem unerwarteten Format geliefert.");
        }
        return data[responseField];
    }

    if (sendBtn && userPrompt && outputDiv) {
        sendBtn.addEventListener("click", async () => {
            const text = userPrompt.value.trim();
            if (!text) {
                outputDiv.textContent = "❌ Bitte schreibe zuerst einen Befehl in das Feld.";
                outputDiv.style.color = "#ef4444";
                return;
            }
            
            setActionsDisabled(true);
            sendBtn.textContent = "KI denkt nach...";
            outputDiv.textContent = "⚡ Sende an FastAPI-Backend...";
            outputDiv.style.color = "#38bdf8";

            try {
                const answer = await postToBackend("/generate", "response", {
                    prompt: text,
                    model_name: "qwen2.5-coder:7b"
                });
                outputDiv.style.color = "#cbd5e1";
                outputDiv.textContent = answer;
            } catch (error) {
                outputDiv.style.color = "#ef4444";
                outputDiv.textContent = error.message;
            } finally {
                setActionsDisabled(false);
                sendBtn.textContent = "Prompt senden";
                void refreshVramStatus();
            }
        });
    }

    if (clearVramBtn && outputDiv) {
        clearVramBtn.addEventListener("click", async () => {
            const originalLabel = clearVramBtn.textContent;
            setActionsDisabled(true);
            clearVramBtn.textContent = "Reinige...";
            outputDiv.style.color = "#38bdf8";
            outputDiv.textContent = "Ollama entlädt das Modell...";

            try {
                const message = await postToBackend("/vram-clear", "message");
                outputDiv.style.color = "#86efac";
                outputDiv.textContent = message;
            } catch (error) {
                outputDiv.style.color = "#ef4444";
                outputDiv.textContent = error.message;
            } finally {
                setActionsDisabled(false);
                clearVramBtn.textContent = originalLabel;
                void refreshVramStatus();
            }
        });
    }
});
