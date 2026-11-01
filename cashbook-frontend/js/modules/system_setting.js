// cashbook-frontend/js/modules/system_setting.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";

export async function initSystemSetting() {
    setupYearDropdown();
    bindEvents();
    fetchQuotaMetrics();
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
        btnRefresh.onclick = fetchQuotaMetrics;
    }

    const btnSend = document.getElementById("btn-send-auto-email");
    if (btnSend) {
        btnSend.onclick = sendExcelReportEmail;
    }
}

function fetchQuotaMetrics() {
    const reads = 42500;
    const writes = 12800;
    const storage = 142;

    const rVal = document.getElementById("quota-reads-val");
    const rBar = document.getElementById("quota-reads-bar");
    const wVal = document.getElementById("quota-writes-val");
    const wBar = document.getElementById("quota-writes-bar");
    const sVal = document.getElementById("quota-storage-val");
    const sBar = document.getElementById("quota-storage-bar");

    if (rVal) rVal.textContent = `${(reads / 1000).toFixed(1)}k / 100k`;
    if (rBar) rBar.style.width = `${Math.min(100, (reads / 100000) * 100)}%`;

    if (wVal) wVal.textContent = `${(writes / 1000).toFixed(1)}k / 100k`;
    if (wBar) wBar.style.width = `${Math.min(100, (writes / 100000) * 100)}%`;

    if (sVal) sVal.textContent = `${storage} MB / 5 GB`;
    if (sBar) sBar.style.width = `${Math.min(100, (storage / 5120) * 100)}%`;
}

async function sendExcelReportEmail() {
    const yearSelect = document.getElementById("setting-report-year");
    const emailInput = document.getElementById("setting-recipient-email");
    const btn = document.getElementById("btn-send-auto-email");

    const year = yearSelect ? yearSelect.value : new Date().getFullYear();
    const email = emailInput ? emailInput.value.trim() : "";

    if (!email) {
        return ui.toast.warning("ကျေးဇူးပြု၍ လက်ခံမည့် အီးမေးလ်လိပ်စာ ထည့်သွင်းပေးပါ။");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> အီးမေးလ်ပို့နေပါသည်...`;
    }

    try {
        // Backend Worker သို့ တိုက်ရိုက် Post ခေါ်ဆိုခြင်း
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
            btn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1"></i> <span>Excel ဖြင့် အီးမေးလ်ပို့မည်</span>`;
        }
    }
}
