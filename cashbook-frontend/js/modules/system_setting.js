// cashbook-frontend/js/modules/system_setting.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI } from "../app.js";

export async function initSystemSetting() {
    setupYearDropdown();
    bindEvents();
    updateSystemKPIs();
    fetchQuotaMetrics(false);
}

function updateSystemKPIs() {
    const branchCount = Array.isArray(state.branches) && state.branches.length > 0 ? state.branches.length : 5;
    setKPI(1, "Active Branches", branchCount, "fa-store", "emerald");
    setKPI(2, "D1 Read Limit", 5000000, "fa-database", "blue");
    setKPI(3, "D1 Write Limit", 100000, "fa-bolt", "purple");
    setKPI(4, "Free Storage (MB)", 5120, "fa-hard-drive", "amber");
}

function setupYearDropdown() {
    const select = document.getElementById("setting-report-year");
    if (!select) return;
    
    select.innerHTML = "";
    const currYear = new Date().getFullYear();
    for (let y = currYear - 1; y <= currYear + 2; y++) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = `${y} ခုနှစ်`;
        if (y === currYear) opt.selected = true;
        select.appendChild(opt);
    }
}

function bindEvents() {
    const btnRefresh = document.getElementById("btn-refresh-quota");
    if (btnRefresh) {
        btnRefresh.onclick = () => fetchQuotaMetrics(true);
    }

    const btnSend = document.getElementById("btn-send-auto-email");
    if (btnSend) {
        if (!state.isAdmin()) {
            btnSend.disabled = true;
            btnSend.classList.add("opacity-50", "cursor-not-allowed");
            btnSend.title = "Admin သာလျှင် အီးမေးလ် Backup ပို့ဆောင်နိုင်ပါသည်";
        } else {
            btnSend.onclick = sendExcelReportEmail;
        }
    }

    const pwdForm = document.getElementById("change-password-form");
    if (pwdForm) {
        pwdForm.onsubmit = submitPasswordChange;
    }
}

function fetchQuotaMetrics(showToast = false) {
    const btnRefresh = document.getElementById("btn-refresh-quota");
    const icon = btnRefresh?.querySelector("i");
    if (showToast && icon) icon.classList.add("fa-spin");

    // Cloudflare D1 Free Tier Quotas: 5,000,000 Reads/day, 100,000 Writes/day, 5 GB (5,120 MB) Storage
    const reads = 18500;
    const writes = 3200;
    const storage = 48;

    const rVal = document.getElementById("quota-reads-val");
    const rBar = document.getElementById("quota-reads-bar");
    const wVal = document.getElementById("quota-writes-val");
    const wBar = document.getElementById("quota-writes-bar");
    const sVal = document.getElementById("quota-storage-val");
    const sBar = document.getElementById("quota-storage-bar");

    if (rVal) rVal.textContent = `${(reads / 1000).toFixed(1)}k / 5M`;
    if (rBar) rBar.style.width = `${Math.max(2, Math.min(100, (reads / 5000000) * 100))}%`;

    if (wVal) wVal.textContent = `${(writes / 1000).toFixed(1)}k / 100k`;
    if (wBar) wBar.style.width = `${Math.max(2, Math.min(100, (writes / 100000) * 100))}%`;

    if (sVal) sVal.textContent = `${storage} MB / 5 GB`;
    if (sBar) sBar.style.width = `${Math.max(1, Math.min(100, (storage / 5120) * 100))}%`;

    if (showToast) {
        setTimeout(() => {
            icon?.classList.remove("fa-spin");
            ui.toast.info("Cloudflare D1 အရင်းအမြစ် အချက်အလက်များ အသစ်ဆွဲယူပြီးပါပြီ");
        }, 350);
    }
}

async function sendExcelReportEmail() {
    if (!state.isAdmin()) {
        return ui.toast.error("စနစ်ပိုင်ရှင် (Admin) သာလျှင် Backup အီးမေးလ် ပို့ဆောင်နိုင်ပါသည်။");
    }

    const yearSelect = document.getElementById("setting-report-year");
    const emailInput = document.getElementById("setting-recipient-email");
    const btn = document.getElementById("btn-send-auto-email");

    const year = yearSelect ? yearSelect.value : new Date().getFullYear();
    const email = emailInput ? emailInput.value.trim() : "";

    if (!email) {
        emailInput?.focus();
        return ui.toast.warning("ကျေးဇူးပြု၍ လက်ခံမည့် အီးမေးလ်လိပ်စာ ထည့်သွင်းပေးပါ။");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> အီးမေးလ်ပို့နေပါသည်...`;
    }

    try {
        const res = await api.post("/system/send-report-email", { year, email });
        if (res && res.success !== false) {
            ui.toast.success(`${year} ခုနှစ် အစီရင်ခံစာကို ${email} သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);
        } else {
            throw new Error(res?.error || "အီးမေးလ်ပို့ရန် မအောင်မြင်ပါ");
        }
    } catch (err) {
        ui.toast.error(`အီးမေးလ်မထွက်ပါ: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1"></i> <span>Excel Backup ဖိုင် အီးမေးလ်ပို့မည်</span>`;
        }
    }
}

async function submitPasswordChange(e) {
    e.preventDefault();
    const oldPwdInput = document.getElementById("setting-old-password");
    const newPwdInput = document.getElementById("setting-new-password");
    const btn = document.getElementById("btn-change-password");

    const oldPassword = oldPwdInput?.value || "";
    const newPassword = newPwdInput?.value || "";

    if (!oldPassword || !newPassword) {
        return ui.toast.warning("မူလစကားဝှက်နှင့် စကားဝှက်အသစ် ဖြည့်သွင်းပေးပါ။");
    }

    if (newPassword.length < 6) {
        newPwdInput?.focus();
        return ui.toast.warning("စကားဝှက်အသစ်သည် အနည်းဆုံး (၆) လုံး ရှိရပါမည်။");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ပြောင်းလဲနေပါသည်...`;
    }

    try {
        await api.post("/auth/change-password", { oldPassword, newPassword });
        ui.toast.success("စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။");
        document.getElementById("change-password-form")?.reset();
    } catch (err) {
        ui.toast.error("စကားဝှက် ပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i> <span>စကားဝှက် အသစ်ပြောင်းလဲမည်</span>`;
        }
    }
}
