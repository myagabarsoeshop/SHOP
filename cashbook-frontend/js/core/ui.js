// cashbook-frontend/js/core/ui.js

/**
 * Global UI Utilities for Professional Notifications, Confirmations & Security Helpers
 */

const toastConfig = {
    duration: 3000,
    colors: {
        success: { bg: 'bg-emerald-50 dark:bg-emerald-950/80', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-700 dark:text-emerald-400', icon: 'fa-circle-check' },
        error: { bg: 'bg-rose-50 dark:bg-rose-950/80', border: 'border-rose-200 dark:border-rose-800', text: 'text-rose-700 dark:text-rose-400', icon: 'fa-circle-xmark' },
        warning: { bg: 'bg-amber-50 dark:bg-amber-950/80', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-700 dark:text-amber-400', icon: 'fa-triangle-exclamation' },
        info: { bg: 'bg-blue-50 dark:bg-blue-950/80', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-400', icon: 'fa-circle-info' }
    }
};

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return console.warn("Toast container not found");

    const theme = toastConfig.colors[type] || toastConfig.colors.success;
    
    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg shadow-black/5 animate-slide-in-right pointer-events-auto min-w-[300px] max-w-sm ${theme.bg} ${theme.border} ${theme.text}`;
    
    toast.innerHTML = `
        <i class="fa-solid ${theme.icon} text-lg shrink-0"></i>
        <div class="text-sm font-bold flex-1 leading-snug">${escapeHtml(message)}</div>
        <button type="button" class="text-current opacity-60 hover:opacity-100 cursor-pointer shrink-0 transition p-1">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;

    container.appendChild(toast);

    let timeoutId;
    const removeToast = () => {
        toast.classList.remove('animate-slide-in-right');
        toast.classList.add('animate-fade-out');
        setTimeout(() => toast.remove(), 300);
    };

    timeoutId = setTimeout(removeToast, toastConfig.duration);

    toast.querySelector('button').addEventListener('click', () => {
        clearTimeout(timeoutId);
        removeToast();
    });
}

/**
 * Global Confirm Dialog Promise
 * Usage: const confirmed = await ui.confirm("ဖျက်သိမ်းရန် သေချာပါသလား?", "error");
 */
function confirmDialog(message, type = 'warning') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('global-confirm-dialog');
        const box = document.getElementById('confirm-box');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-message');
        const iconBoxEl = document.getElementById('confirm-icon-box');
        
        const btnCancel = document.getElementById('btn-confirm-cancel');
        const btnOk = document.getElementById('btn-confirm-ok');

        if (!dialog) {
            resolve(window.confirm(message));
            return;
        }

        if (type === 'error') {
            if (iconBoxEl) iconBoxEl.className = 'w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl bg-rose-500/10 text-rose-500';
            if (btnOk) {
                btnOk.className = 'flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition shadow-md cursor-pointer bg-rose-600 hover:bg-rose-500 shadow-rose-500/20';
                btnOk.textContent = 'ဖျက်သိမ်းမည်';
            }
            if (titleEl) titleEl.textContent = 'ဖျက်သိမ်းရန် သေချာပါသလား?';
        } else {
            if (iconBoxEl) iconBoxEl.className = 'w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl bg-amber-500/10 text-amber-500';
            if (btnOk) {
                btnOk.className = 'flex-1 py-2.5 rounded-xl font-bold text-sm text-white transition shadow-md cursor-pointer bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20';
                btnOk.textContent = 'အတည်ပြုမည်';
            }
            if (titleEl) titleEl.textContent = 'အတည်ပြုပါ';
        }

        if (msgEl) msgEl.textContent = message;
        
        dialog.classList.remove('hidden');
        setTimeout(() => {
            if (box) {
                box.classList.remove('scale-90', 'opacity-0');
                box.classList.add('scale-100', 'opacity-100');
            }
        }, 10);

        const closeAndResolve = (result) => {
            if (box) {
                box.classList.remove('scale-100', 'opacity-100');
                box.classList.add('scale-90', 'opacity-0');
            }
            setTimeout(() => {
                dialog.classList.add('hidden');
                btnCancel?.removeEventListener('click', onCancel);
                btnOk?.removeEventListener('click', onOk);
                resolve(result);
            }, 200);
        };

        const onCancel = () => closeAndResolve(false);
        const onOk = () => closeAndResolve(true);

        btnCancel?.addEventListener('click', onCancel);
        btnOk?.addEventListener('click', onOk);
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
        success: (msg) => showToast(msg, 'success'),
        error: (msg) => showToast(msg, 'error'),
        warning: (msg) => showToast(msg, 'warning'),
        info: (msg) => showToast(msg, 'info')
    },
    confirm: confirmDialog,
    escapeHtml,
    escapeCsv,
    formatMoney
};
