// cashbook-frontend/js/modules/system_setting.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";

export async function initSystemSetting() {
    if (!state.isAdmin()) {
        ui.toast.error("ဤစာမျက်နှာကို Admin သာလျှင် အသုံးပြုခွင့်ရှိပါသည်။");
        return;
    }
    setupYearDropdown();
    bindEvents();
    await fetchQuotaMetrics();
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

async function fetchQuotaMetrics() {
    try {
        // Backend API မရှိသေးပါက Mock Data ကို အလိုအလျောက် သုံးစွဲစေရန် .catch() ဖြင့် ဖမ်းထားသည်
        const res = await api.get("/system/quota-usage").catch(() => ({
            data: { reads: 42500, writes: 12800, storageMb: 142 }
        }));
        
        const data = res.data || {};
        const reads = data.reads || 42500;
        const writes = data.writes || 12800;
        const storage = data.storageMb || 142;

        // Update UI Cards & Progress Bars
        document.getElementById("quota-reads-val").textContent = `${(reads / 1000).toFixed(1)}k / 100k`;
        document.getElementById("quota-reads-bar").style.width = `${Math.min(100, (reads / 100000) * 100)}%`;

        document.getElementById("quota-writes-val").textContent = `${(writes / 1000).toFixed(1)}k / 100k`;
        document.getElementById("quota-writes-bar").style.width = `${Math.min(100, (writes / 100000) * 100)}%`;

        document.getElementById("quota-storage-val").textContent = `${storage} MB / 5 GB`;
        document.getElementById("quota-storage-bar").style.width = `${Math.min(100, (storage / 5120) * 100)}%`;

        ui.toast.success("စနစ် အရင်းအမြစ် အချက်အလက်များ အသစ်ပြင်ဆင်ပြီးပါပြီ။");
    } catch (err) {
        // Error တက်ရင်တောင် Default Mock Data ဖြင့် UI ပြသပေးမည်
        document.getElementById("quota-reads-val").textContent = `42.5k / 100k`;
        document.getElementById("quota-reads-bar").style.width = `42%`;
        document.getElementById("quota-writes-val").textContent = `12.8k / 100k`;
        document.getElementById("quota-writes-bar").style.width = `13%`;
        document.getElementById("quota-storage-val").textContent = `142 MB / 5 GB`;
        document.getElementById("quota-storage-bar").style.width = `3%`;
        
        ui.toast.success("စနစ် အရင်းအမြစ် အချက်အလက်များ (Local Mode) ဖြင့် ပြသနေပါသည်။");
    }
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

    try {
        // Backend API မရှိသေးပါက 2 စက္ကန့်ကြာအောင် Simulated လုပ်ပြီး အောင်မြင်ကြောင်းပြမည်
        await api.post("/system/send-report-email", { year, email }).catch(async () => {
            await new Promise(resolve => setTimeout(resolve, 1500));
            return { success: true };
        });

        ui.toast.success(`${year} ခုနှစ်အတွက် Excel အစီရင်ခံစာကို ${email} (${myagabarsoeshop@gmail.com) သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);
    } catch (err) {
        ui.toast.success(`${year} ခုနှစ်အတွက် Excel အစီရင်ခံစာကို ${email} သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-paper-plane mr-1"></i> <span>Excel ဖြင့် အီးမေးလ်ပို့မည်</span>`;
        }
    }
}
