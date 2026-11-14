// =============================================================================
// FILE: cashbook-frontend/js/core/ui.js  
// GLOBAL UI UTILITIES: TOASTS, CONFIRM DIALOG, STATUS BADGES & XSS SANITIZER
// Version: 4.1.0 (Spec 5.6 Status Badges & Spec 9.7 XSS Escape Helpers)
// =============================================================================

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

/**
 * XSS ကာကွယ်ရေး Single-Source String Sanitizer (Single Quote အပါအဝင် - Spec 9.7)
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

/**
 * Opening Stock, Adjustment နှင့် Transfer State Machine အတွက် Status Badge HTML ထုတ်ပေးခြင်း (Spec 4.3 & 5.6)
 */
export function statusBadge(status) {
    const s = String(status || "").trim().toLowerCase();
    const map = {
        draft: {
            label: "မူကြမ်း (Draft)",
            cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30",
            icon: "fa-file-pen"
        },
        submitted: {
            label: "အတည်ပြုရန်တင်ထား (Submitted)",
            cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
            icon: "fa-clock"
        },
        approved: {
            label: "အတည်ပြုပြီး (Approved)",
            cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
            icon: "fa-circle-check"
        },
        rejected: {
            label: "ပယ်ချထား (Rejected)",
            cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
            icon: "fa-circle-xmark"
        },
        pending: {
            label: "ပို့ရန်စောင့်ဆိုင်း (Pending)",
            cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
            icon: "fa-hourglass-half"
        },
        dispatched: {
            label: "လမ်းခရီး/ပို့ထားပြီး (Dispatched)",
            cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30",
            icon: "fa-truck-fast"
        },
        received: {
            label: "လက်ခံပြီး (Received)",
            cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
            icon: "fa-box-open"
        },
        completed: {
            label: "ပြီးဆုံး (Completed)",
            cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
            icon: "fa-check-double"
        },
        cancelled: {
            label: "ပယ်ဖျက်ထား (Cancelled)",
            cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30",
            icon: "fa-ban"
        }
    };

    const cfg = map[s] || {
        label: escapeHtml(status || "Unknown"),
        cls: "bg-slate-500/10 text-slate-500 border-slate-500/20",
        icon: "fa-circle-info"
    };

    return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-extrabold border ${cfg.cls}">
        <i class="fa-solid ${cfg.icon}"></i>
        <span>${cfg.label}</span>
    </span>`;
}

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return console.warn("Toast container not found");

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

// Support both ui.toast("msg", "error") and ui.toast.error("msg")
const toastCallable = (msg, type = "success") => showToast(msg, type);
toastCallable.success = (msg) => showToast(msg, "success");
toastCallable.error = (msg) => showToast(msg, "error");
toastCallable.warning = (msg) => showToast(msg, "warning");
toastCallable.info = (msg) => showToast(msg, "info");

export const ui = {
    toast: toastCallable,
    confirm: confirmDialog,
    statusBadge,
    escapeHtml,
    escapeCsv,
    formatMoney
};
