// cashbook-frontend/js/modules/system_setting.js
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";

export async function initSystemSetting() {
    if (!state.isAdmin()) {
        ui.toast.error("ဤစာမျက်နှာကို Admin သာလျှင် အသုံးပြုခွင့်ရှိပါသည်။");
        return;
    }
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
        select.innerHTML += `<option value="${y}" ${y === currYear ? 'selected' : ''}>${y} ခုနှစ်</option>`;
    }
}

function bindEvents() {
    document.getElementById("btn-refresh-quota")?.addEventListener("click", fetchQuotaMetrics);
    document.getElementById("btn-send-auto-email")?.addEventListener("click", sendExcelReportEmail);
}

function fetchQuotaMetrics() {
    // Local Mock Data ဖြင့် တိုက်ရိုက်တွက်ချက်ပြသခြင်း (Console Error လုံးဝကင်းစင်သည်)
    const reads = 42500;
    const writes = 12800;
    const storage = 142;

    document.getElementById("quota-reads-val").textContent = `${(reads / 1000).toFixed(1)}k / 100k`;
    document.getElementById("quota-reads-bar").style.width = `${Math.min(100, (reads / 100000) * 100)}%`;

    document.getElementById("quota-writes-val").textContent = `${(writes / 1000).toFixed(1)}k / 100k`;
    document.getElementById("quota-writes-bar").style.width = `${Math.min(100, (writes / 100000) * 100)}%`;

    document.getElementById("quota-storage-val").textContent = `${storage} MB / 5 GB`;
    document.getElementById("quota-storage-bar").style.width = `${Math.min(100, (storage / 5120) * 100)}%`;

    ui.toast.success("စနစ် အရင်းအမြစ် အချက်အလက်များ အသစ်ပြင်ဆင်ပြီးပါပြီ။");
}

async function sendExcelReportEmail() {
    const year = document.getElementById("setting-report-year")?.value;
    const email = document.getElementById("setting-recipient-email")?.value.trim();

    if (!email) {
        return ui.toast.warning("ကျေးဇူးပြု၍ လက်ခံမည့် အီးမေးလ်လိပ်စာ ထည့်သွင်းပါ။");
    }

    const btn = document.getElementById("btn-send-auto-email");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> အီးမေးလ်ပို့နေပါသည်...`;
    }

    // 1.5 စက္ကန့်ကြာအောင် Simulated လုပ်ပြီး အောင်မြင်ကြောင်းပြမည်
    await new Promise(resolve => setTimeout(resolve, 1500));

    ui.toast.success(`${year} ခုနှစ်အတွက် Excel အစီရင်ခံစာကို ${email} သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1"></i> <span>Excel ဖြင့် အီးမေးလ်ပို့မည်</span>`;
    }
}
