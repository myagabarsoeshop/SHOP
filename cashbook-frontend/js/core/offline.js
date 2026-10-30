// cashbook-frontend/js/core/offline.js
import { api } from "./api.js";

const DB_NAME = "MyaGabarSoe_CashBook_DB";
const DB_VERSION = 1;
const STORE_OUTBOX = "sync_outbox";       // အော့ဖ်လိုင်း သိမ်းထားမည့် စာရင်းများ
const STORE_SNAPSHOTS = "data_snapshots"; // အော့ဖ်လိုင်း ဖတ်ရှုနိုင်မည့် ဒေတာများ

let dbInstance = null;
let isSyncing = false;

function openDB() {
    return new Promise((resolve, reject) => {
        if (dbInstance) return resolve(dbInstance);

        if (!window.indexedDB) {
            console.warn("[OfflineEngine] IndexedDB not supported on this browser.");
            return reject(new Error("IndexedDB not supported"));
        }

        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: "client_tx_id" });
                outboxStore.createIndex("status", "status", { unique: false });
                outboxStore.createIndex("timestamp", "timestamp", { unique: false });
            }

            if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
                db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "key" });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error("[OfflineEngine] IndexedDB Open Error:", event.target.error);
            reject(event.target.error);
        };
    });
}

function generateTxId() {
    return "tx_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
}

export const OfflineEngine = {
    isOnline() {
        return navigator.onLine;
    },

    /**
     * အော့ဖ်လိုင်းဖြစ်နေစဉ် စာရင်းသွင်းမှုများကို Outbox ထဲသို့ ထည့်သွင်းခြင်း
     * @param {string} endpoint - ဥပမာ "/pos/checkout" သို့မဟုတ် "/cashbook/entries"
     * @param {object} payload - ပေးပို့မည့် ဒေတာ
     */
    async enqueueMutation(endpoint, payload = {}) {
        try {
            const db = await openDB();
            const clientTxId = payload.client_tx_id || generateTxId();

            const outboxItem = {
                client_tx_id: clientTxId,
                endpoint: endpoint,
                payload: { ...payload, client_tx_id: clientTxId },
                timestamp: Date.now(),
                iso_time: new Date().toISOString(),
                retry_count: 0,
                status: "pending"
            };

            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_OUTBOX], "readwrite");
                const store = transaction.objectStore(STORE_OUTBOX);
                const req = store.put(outboxItem);

                req.onsuccess = () => {
                    console.log(`[OfflineEngine] Outbox တွင် သိမ်းဆည်းပြီး: ${endpoint} (${clientTxId})`);
                    this.updateSyncBadge();
                    resolve(outboxItem);
                };

                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.error("[OfflineEngine] Enqueue Mutation Failed:", err);
            throw err;
        }
    },

    async getPendingMutations() {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_OUTBOX], "readonly");
                const store = transaction.objectStore(STORE_OUTBOX);
                const req = store.getAll();

                req.onsuccess = () => {
                    const items = req.result || [];
                    items.sort((a, b) => a.timestamp - b.timestamp);
                    resolve(items);
                };

                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            return [];
        }
    },

    async removeMutation(clientTxId) {
        try {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([STORE_OUTBOX], "readwrite");
                const store = transaction.objectStore(STORE_OUTBOX);
                const req = store.delete(clientTxId);
                req.onsuccess = () => {
                    this.updateSyncBadge();
                    resolve(true);
                };
                req.onerror = () => reject(req.error);
            });
        } catch (err) {
            console.warn("[OfflineEngine] Remove Mutation Warning:", err);
        }
    },

    /**
     * အင်တာနက်လိုင်းရချိန်တွင် Outbox စာရင်းများကို D1 API သို့ တစ်ခုချင်း လှမ်းပို့ခြင်း
     */
    async syncOutbox() {
        if (!this.isOnline() || isSyncing) return;

        const pendingItems = await this.getPendingMutations();
        if (pendingItems.length === 0) {
            this.updateSyncBadge();
            return;
        }

        isSyncing = true;
        let successCount = 0;

        for (const item of pendingItems) {
            try {
                const targetEndpoint = item.endpoint || item.action;
                const res = await api.post(targetEndpoint, item.payload);

                if (res && res.success !== false) {
                    await this.removeMutation(item.client_tx_id);
                    successCount++;
                }
            } catch (postErr) {
                console.error(`[OfflineEngine] Sync Failed for ${item.client_tx_id}:`, postErr);
                break;
            }
        }

        isSyncing = false;
        this.updateSyncBadge();

        if (successCount > 0) {
            console.log(`[OfflineEngine] အော့ဖ်လိုင်း စာရင်း (${successCount}) ခုကို ဆာဗာသို့ ပို့ပြီးပါပြီ။`);
        }
    },

    /**
     * Topbar ရှိ D1 Online ဘေးတွင် Sync Badge ပြသပေးခြင်း
     */
    async updateSyncBadge() {
        const pendingItems = await this.getPendingMutations();
        const count = pendingItems.length;

        let badgeEl = document.getElementById("offline-sync-badge");
        if (!badgeEl) {
            const headerRight = document.getElementById("live-clock")?.parentElement?.parentElement;
            if (headerRight) {
                badgeEl = document.createElement("button");
                badgeEl.id = "offline-sync-badge";
                badgeEl.type = "button";
                badgeEl.className = "hidden items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-pointer animate-pulse";
                badgeEl.title = "အော့ဖ်လိုင်းစာရင်းများ ဆာဗာသို့ ပို့ရန် နှိပ်ပါ";
                badgeEl.onclick = () => this.syncOutbox();
                headerRight.insertBefore(badgeEl, headerRight.firstChild);
            }
        }

        if (badgeEl) {
            if (count > 0) {
                badgeEl.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Sync: ${count}</span>`;
                badgeEl.classList.remove("hidden");
                badgeEl.classList.add("flex");
            } else {
                badgeEl.classList.add("hidden");
                badgeEl.classList.remove("flex");
            }
        }
    },

    init() {
        openDB().then(() => {
            this.updateSyncBadge();

            window.addEventListener("online", () => {
                setTimeout(() => this.syncOutbox(), 1500);
            });

            setInterval(() => {
                if (this.isOnline()) this.syncOutbox();
            }, 5 * 60 * 1000);

            if (this.isOnline()) {
                setTimeout(() => this.syncOutbox(), 2000);
            }
        }).catch(err => {
            console.warn("[OfflineEngine] Initialization Error:", err);
        });
    }
};

window.OfflineEngine = OfflineEngine;
