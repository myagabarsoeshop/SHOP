/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - ENTERPRISE OFFLINE-FIRST SYNC ENGINE
 * File: cashbook-frontend/js/offline.js
 * Standard: Progressive Web App (PWA) Offline-First / Outbox Pattern
 * Storage: HTML5 IndexedDB (Zero 5MB Quota Limit, Asynchronous)
 * ==============================================================================
 */

"use strict";

const OfflineEngine = (function () {
  const DB_NAME = "MyaGabarSoe_CashBook_DB";
  const DB_VERSION = 1;
  const STORE_OUTBOX = "sync_outbox";       // အော့ဖ်လိုင်း သိမ်းထားမည့် စာရင်းများ
  const STORE_SNAPSHOTS = "data_snapshots"; // အော့ဖ်လိုင်း ဖတ်ရှုနိုင်မည့် ဒေတာများ

  let dbInstance = null;
  let isSyncing = false;

  // ============================================================================
  // 💡 1. INDEXEDDB DATABASE INITIALIZATION
  // ============================================================================
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

        // ၁။ Outbox Queue Store (ဆာဗာသို့ ပို့ရန် ကျန်ရှိနေသော စာရင်းများ)
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: "client_tx_id" });
          outboxStore.createIndex("status", "status", { unique: false });
          outboxStore.createIndex("timestamp", "timestamp", { unique: false });
        }

        // ၂။ Local Read Cache Store (အော့ဖ်လိုင်းကြည့်ရှုရန် ဒေတာများ)
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

  // ============================================================================
  // 💡 2. UNIQUE TRANSACTION ID GENERATOR (Idempotency Key)
  // ============================================================================
  function generateTxId() {
    return "tx_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);
  }

  return {
    /**
     * အင်တာနက် ချိတ်ဆက်မှု ရှိ/မရှိ စစ်ဆေးခြင်း
     */
    isOnline() {
      return navigator.onLine;
    },

    /**
     * အော့ဖ်လိုင်းဖြစ်နေစဉ် စာရင်းသွင်းမှုများကို Outbox ထဲသို့ ထည့်သွင်းခြင်း
     * @param {string} action - e.g. "saveVoucher", "updateVoucher", "deleteVoucher"
     * @param {object} payload - စာရင်းဒေတာ အချက်အလက်များ
     */
    async enqueueMutation(action, payload = {}) {
      try {
        const db = await openDB();
        const clientTxId = payload.client_tx_id || generateTxId();

        const outboxItem = {
          client_tx_id: clientTxId,
          action: action,
          payload: { ...payload, client_tx_id: clientTxId },
          timestamp: Date.now(),
          iso_time: new Date().toISOString(),
          retry_count: 0,
          status: "pending" // pending | syncing | failed
        };

        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_OUTBOX], "readwrite");
          const store = transaction.objectStore(STORE_OUTBOX);
          const req = store.put(outboxItem);

          req.onsuccess = () => {
            console.log(`[OfflineEngine] Outbox တွင် သိမ်းဆည်းပြီး: ${action} (${clientTxId})`);
            this.updateSyncBadge();
            if (window.showToast) {
              window.showToast("SUCCESS", "အင်တာနက်လိုင်း မရှိသေးသဖြင့် စက်ထဲတွင် အော့ဖ်လိုင်း သိမ်းဆည်းထားပါသည် (လိုင်းရပါက Auto-Sync လုပ်ပေးမည်)");
            }
            resolve(outboxItem);
          };

          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        console.error("[OfflineEngine] Enqueue Mutation Failed:", err);
        throw err;
      }
    },

    /**
     * Outbox ထဲတွင် ကျန်ရှိနေသော အော့ဖ်လိုင်း စာရင်းအားလုံးကို ရယူခြင်း
     */
    async getPendingMutations() {
      try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const transaction = db.transaction([STORE_OUTBOX], "readonly");
          const store = transaction.objectStore(STORE_OUTBOX);
          const req = store.getAll();

          req.onsuccess = () => {
            const items = req.result || [];
            // အချိန်အလိုက် စီပေးခြင်း (အဟောင်းမှ အသစ်သို့ အစဉ်အတိုင်း ပို့ရန်)
            items.sort((a, b) => a.timestamp - b.timestamp);
            resolve(items);
          };

          req.onerror = () => reject(req.error);
        });
      } catch (err) {
        return [];
      }
    },

    /**
     * အောင်မြင်စွာ ဆာဗာသို့ ရောက်သွားသော စာရင်းကို Outbox မှ ဖျက်ထုတ်ခြင်း
     */
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
     * 💡 အဓိက လုပ်ဆောင်ချက်: အင်တာနက်လိုင်းရချိန်တွင် Outbox စာရင်းများကို ဆာဗာသို့ တစ်ခုချင်း လှမ်းပို့ခြင်း
     */
    async syncOutbox() {
      if (!this.isOnline()) {
        console.log("[OfflineEngine] အင်တာနက် မရှိသေးသဖြင့် Sync မလုပ်သေးပါ။");
        return;
      }

      if (isSyncing) {
        console.log("[OfflineEngine] Sync လုပ်ဆောင်ဆဲဖြစ်သဖြင့် စောင့်ဆိုင်းနေပါသည်...");
        return;
      }

      const pendingItems = await this.getPendingMutations();
      if (pendingItems.length === 0) {
        this.updateSyncBadge();
        return;
      }

      isSyncing = true;
      console.log(`[OfflineEngine] စာရင်း (${pendingItems.length}) ခုကို ဆာဗာသို့ စတင်ပို့နေပါသည်...`);

      let successCount = 0;

      for (const item of pendingItems) {
        try {
          if (!window.callApi) {
            console.error("[OfflineEngine] window.callApi မတွေ့ရှိပါ။");
            break;
          }

          // D1 Database သို့ စာရင်းလှမ်းပို့ခြင်း
          const res = await window.callApi(item.action, item.payload, "POST");

          if (res && res.success) {
            // အောင်မြင်ပါက Outbox ထဲမှ အပြီးဖယ်ရှားမည်
            await this.removeMutation(item.client_tx_id);
            successCount++;
          } else {
            console.warn(`[OfflineEngine] Mutation ${item.client_tx_id} rejected by server:`, res?.message);
          }
        } catch (postErr) {
          console.error(`[OfflineEngine] Sync Failed for ${item.client_tx_id}:`, postErr);
          // Network Error ဖြစ်ပါက ဆက်မပို့ဘဲ ရပ်တန့်မည် (နောက်တစ်ကြိမ် လိုင်းကောင်းမှ ဆက်ပို့မည်)
          break;
        }
      }

      isSyncing = false;
      this.updateSyncBadge();

      if (successCount > 0) {
        if (window.showToast) {
          window.showToast("SUCCESS", `အော့ဖ်လိုင်း စာရင်း (${successCount}) ခုကို ဆာဗာသို့ အောင်မြင်စွာ တင်ပို့ပြီးပါပြီ!`);
        }
        // UI Dashboard စာရင်းများကို အသစ်ပြန်လည် ရယူခိုင်းခြင်း
        if (window.invalidateApiCache) {
          window.invalidateApiCache();
        }
        if (window.refreshCurrentTab) {
          window.refreshCurrentTab();
        }
      }
    },

    /**
     * စာရင်းဘယ်နှခု အော့ဖ်လိုင်းကျန်နေသေးလဲ Badge ပြသပေးခြင်း
     */
    async updateSyncBadge() {
      const pendingItems = await this.getPendingMutations();
      const count = pendingItems.length;

      let badgeEl = document.getElementById("offline-sync-badge");
      if (!badgeEl) {
        const headerContainer = document.querySelector("#network-status")?.parentElement;
        if (headerContainer) {
          badgeEl = document.createElement("div");
          badgeEl.id = "offline-sync-badge";
          badgeEl.className = "hidden items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30 cursor-pointer animate-pulse";
          badgeEl.title = "Click to Sync Now";
          badgeEl.onclick = () => this.syncOutbox();
          headerContainer.insertBefore(badgeEl, headerContainer.firstChild);
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

    /**
     * အော့ဖ်လိုင်း အင်ဂျင် စတင်လည်ပတ်ခြင်း
     */
    init() {
      openDB().then(() => {
        this.updateSyncBadge();

        // အင်တာနက် ပြန်ရသည်နှင့် Auto-Sync ချက်ချင်း ပြုလုပ်မည်
        window.addEventListener("online", () => {
          console.log("[OfflineEngine] အင်တာနက်လိုင်း ပြန်လည်ရရှိပါပြီ။ Auto-Sync စတင်ပါမည်...");
          setTimeout(() => this.syncOutbox(), 1500);
        });

        // ၅ မိနစ်တစ်ကြိမ် အလိုအလျောက် စစ်ဆေးပြီး Sync လုပ်မည်
        setInterval(() => {
          if (this.isOnline()) this.syncOutbox();
        }, 5 * 60 * 1000);

        // စနစ်စဖွင့်ချိန်တွင် စာရင်းကျန်ရှိပါက တန်းပို့မည်
        if (this.isOnline()) {
          setTimeout(() => this.syncOutbox(), 2000);
        }
      }).catch(err => {
        console.warn("[OfflineEngine] Initialization Error:", err);
      });
    }
  };
})();

// Global Window တွင် သတ်မှတ်ခြင်း
window.OfflineEngine = OfflineEngine;

// စာမျက်နှာ စတင်သည်နှင့် အလိုအလျောက် Run မည်
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    OfflineEngine.init();
  });
}
