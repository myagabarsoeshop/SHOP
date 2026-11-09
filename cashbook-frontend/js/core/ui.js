// cashbook-frontend/js/core/ui.js

/**
 * Global UI Utilities for Professional Notifications, Confirmations & Security Helpers
 */

const toastConfig = {
    duration: 3000,
    maxVisible: 3,
    colors: {
        success: {
            bg: "bg-emerald-50/95 dark:bg-emerald-950/95",
            border: "border-emerald-200 dark:border-emerald-800",
            text: "text-emerald-800 dark:text-emerald-300",
            icon: "fa-circle-check text-emerald-500"
        },
        error: {
            bg: "bg-rose-50/95 dark:bg-rose-950/95",
            border: "border-rose-200 dark:border-rose-800",
            text: "text-rose-800 dark:text-rose-300",
            icon: "fa-circle-xmark text-rose-500"
        },
        warning: {
            bg: "bg-amber-50/95 dark:bg-amber-950/95",
            border: "border-amber-200 dark:border-amber-800",
            text: "text-amber-800 dark:text-amber-300",
            icon: "fa-triangle-exclamation text-amber-500"
        },
        info: {
            bg: "bg-blue-50/95 dark:bg-blue-950/95",
            border: "border-blue-200 dark:border-blue-800",
            text: "text-blue-800 dark:text-blue-300",
            icon: "fa-circle-info text-blue-500"
        }
    }
};

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return console.warn("Toast container not found");

    // အများဆုံး ၃ ခုထက် ပိုနေပါက အဟောင်းဆုံး Toast ကို ဖယ်ရှားမည်
    while (container.children.length >= toastConfig.maxVisible) {
        container.firstElementChild?.remove();
    }

    const theme = toastConfig.colors[type] || toastConfig.colors.success;
    
    const toast = document.createElement("div");
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-md shadow-xl animate-slide-in-right pointer-events-auto min-w-[290px] max-w-sm ${theme.bg} ${theme.border} ${theme.text}`;
    
    toast.innerHTML = `
        <i class="fa-solid ${theme.icon} text-base shrink-0"></i>
        <div class="text-xs font-extrabold flex-1 leading-relaxed">${escapeHtml(message)}</div>
        <button type="button" class="text-current opacity-60 hover:opacity-100 cursor-pointer shrink-0 transition p-1">
            <i class="fa-solid fa-xmark text-xs"></i>
        </button>
    `;

    container.appendChild(toast);

    let removed = false;
    const removeToast = () => {
        if (removed) return;
        removed = true;
        toast.classList.remove("animate-slide-in-right");
        toast.classList.add("animate-fade-out");
        setTimeout(() => toast.remove(), 250);
    };

    const timeoutId = setTimeout(removeToast, toastConfig.duration);

    toast.querySelector("button")?.addEventListener("click", () => {
        clearTimeout(timeoutId);
        removeToast();
    });
}

/**
 * Global Confirm Dialog Promise
 * Usage: const confirmed = await ui.confirm("ဖျက်သိမ်းရန် သေချာပါသလား?", "error");
 */
function confirmDialog(message, type = "warning") {
    return new Promise((resolve) => {
        const dialog = document.getElementById("global-confirm-dialog");
        const box = document.getElementById("confirm-box");
        const titleEl = document.getElementById("confirm-title");
        const msgEl = document.getElementById("confirm-message");
        const iconBoxEl = document.getElementById("confirm-icon-box");
        const iconEl = document.getElementById("confirm-icon");
        
        const btnCancel = document.getElementById("btn-confirm-cancel");
        const btnOk = document.getElementById("btn-confirm-ok");

        if (!dialog) {
            resolve(window.confirm(message));
            return;
        }

        if (type === "error") {
            if (iconBoxEl) iconBoxEl.className = "w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-2xl bg-rose-500/10 text-rose-500 border border-rose-500/20";
            if (iconEl) iconEl.className = "fa-solid fa-trash-can";
            if (btnOk) {
                btnOk.className = "flex-1 py-2.5 rounded-xl font-extrabold text-xs text-white transition shadow-md cursor-pointer bg-rose-600 hover:bg-rose-500 shadow-rose-600/20 active:scale-95";
                btnOk.textContent = "ဖျက်သိမ်းမည်";
            }
            if (titleEl) titleEl.textContent = "ဖျက်သိမ်းရန် သေချာပါသလား?";
        } else {
            if (iconBoxEl) iconBoxEl.className = "w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20";
            if (iconEl) iconEl.className = "fa-solid fa-circle-exclamation";
            if (btnOk) {
                btnOk.className = "flex-1 py-2.5 rounded-xl font-extrabold text-xs text-white transition shadow-md cursor-pointer bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20 active:scale-95";
                btnOk.textContent = "အတည်ပြုမည်";
            }
            if (titleEl) titleEl.textContent = "အတည်ပြုပါ";
        }

        if (msgEl) msgEl.textContent = message;
        
        dialog.classList.remove("hidden");
        setTimeout(() => {
            if (box) {
                box.classList.remove("scale-90", "opacity-0");
                box.classList.add("scale-100", "opacity-100");
            }
            // ဖျက်သိမ်းမည့် Confirm ဖြစ်ပါက မှားမနှိပ်မိစေရန် Cancel ပေါ်တွင် Focus ထားပေးမည်
            if (type === "error") btnCancel?.focus();
            else btnOk?.focus();
        }, 15);

        const closeAndResolve = (result) => {
            if (box) {
                box.classList.remove("scale-100", "opacity-100");
                box.classList.add("scale-90", "opacity-0");
            }
            setTimeout(() => {
                dialog.classList.add("hidden");
                btnCancel?.removeEventListener("click", onCancel);
                btnOk?.removeEventListener("click", onOk);
                resolve(result);
            }, 180);
        };

        const onCancel = () => closeAndResolve(false);
        const onOk = () => closeAndResolve(true);

        btnCancel?.addEventListener("click", onCancel);
        btnOk?.addEventListener("click", onOk);
    });
}

/**
 * XSS ကာကွယ်ရေး Single-Source String Sanitizer (Single Quote အပါအဝင်)
 */
export function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * CSV Formula Injection (=, +, -, @) ကာကွယ်ရေး Escaper
 */
export function escapeCsv(val) {
    let str = String(val ?? "").trim();
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

/**
 * ငွေပမာဏ ကော်မာထည့်သွင်းဖော်ပြခြင်း
 */
export function formatMoney(val) {
    return `${Number(val || 0).toLocaleString()} Ks`;
}

// Unified UI Object
export const ui = {
    toast: {
        success: (msg) => showToast(msg, "success"),
        error: (msg) => showToast(msg, "error"),
        warning: (msg) => showToast(msg, "warning"),
        info: (msg) => showToast(msg, "info")
    },
    confirm: confirmDialog,
    escapeHtml,
    escapeCsv,
    formatMoney
};
