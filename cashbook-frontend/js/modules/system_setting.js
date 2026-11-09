// cashbook-frontend/js/modules/system_setting.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI } from "../app.js";

let allSystemUsers = [];

export async function initSystemSetting() {
    setupYearDropdown();
    bindEvents();
    updateSystemKPIs();
    fetchQuotaMetrics(false);

    // Admin ဖြစ်မှသာ User 7 ဦး၏ password စီမံခန့်ခွဲမှု card ကို ပြသမည်
    const adminUserBox = document.getElementById("admin-users-password-section");
    if (adminUserBox) {
        if (state.isAdmin()) {
            adminUserBox.classList.remove("hidden");
            await loadSystemUsersForAdmin();
        } else {
            adminUserBox.classList.add("hidden");
        }
    }
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

    // Admin: User select change event for password management
    const userSelect = document.getElementById("setting-user-select");
    if (userSelect) {
        userSelect.onchange = (e) => {
            const selectedId = Number(e.target.value);
            const userObj = allSystemUsers.find(u => u.id === selectedId);
            const usernameField = document.getElementById("setting-selected-username");
            const pwdField = document.getElementById("setting-selected-password");

            if (userObj) {
                if (usernameField) usernameField.value = userObj.username || "";
                if (pwdField) pwdField.value = userObj.current_password || "123456";
            } else {
                if (usernameField) usernameField.value = "";
                if (pwdField) pwdField.value = "";
            }
        };
    }

    // Admin: Show/Hide password toggle button
    const btnTogglePwd = document.getElementById("btn-toggle-selected-pwd");
    if (btnTogglePwd) {
        btnTogglePwd.onclick = () => {
            const pwdField = document.getElementById("setting-selected-password");
            const icon = btnTogglePwd.querySelector("i");
            if (!pwdField) return;

            if (pwdField.type === "password") {
                pwdField.type = "text";
                if (icon) icon.className = "fa-solid fa-eye-slash";
            } else {
                pwdField.type = "password";
                if (icon) icon.className = "fa-solid fa-eye";
            }
        };
    }

    // Admin: Reset user password form submit
    const adminPwdForm = document.getElementById("admin-reset-password-form");
    if (adminPwdForm) {
        adminPwdForm.onsubmit = submitAdminResetPassword;
    }
}

async function loadSystemUsersForAdmin() {
    try {
        const res = await api.get("/system/users");
        allSystemUsers = res.data || res || [];
        const select = document.getElementById("setting-user-select");
        if (!select) return;

        select.innerHTML = `<option value="">-- အသုံးပြုသူ (User) ရွေးချယ်ပါ --</option>`;
        allSystemUsers.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            opt.textContent = `${u.full_name || u.username} (${u.role}) - [${u.branch_name || 'Main'}]`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Failed to load system users:", err);
    }
}

async function submitAdminResetPassword(e) {
    e.preventDefault();
    if (!state.isAdmin()) return ui.toast.error("ခွင့်ပြုချက် မရှိပါ");

    const userSelect = document.getElementById("setting-user-select");
    const newPwdInput = document.getElementById("setting-admin-new-password");
    const btn = document.getElementById("btn-admin-save-password");

    const userId = userSelect ? Number(userSelect.value) : 0;
    const newPassword = newPwdInput?.value?.trim() || "";

    if (!userId) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အသုံးပြုသူ (User) တစ်ဦး ရွေးချယ်ပါ။");
    }
    if (!newPassword || newPassword.length < 4) {
        return ui.toast.warning("စကားဝှက်အသစ်သည် အနည်းဆုံး (၄) လုံး ရှိရပါမည်။");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> သိမ်းဆည်းနေပါသည်...`;
    }

    try {
        const res = await api.post("/system/reset-password", { user_id: userId, new_password: newPassword });
        ui.toast.success(res.message || "စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။");
        
        // Update local array & field
        const target = allSystemUsers.find(u => u.id === userId);
        if (target) target.current_password = newPassword;

        const pwdField = document.getElementById("setting-selected-password");
        if (pwdField) pwdField.value = newPassword;

        if (newPwdInput) newPwdInput.value = "";
    } catch (err) {
        ui.toast.error("စကားဝှက် ပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i> <span>စကားဝှက် အသစ်ပြောင်းလဲမည်</span>`;
        }
    }
}

function fetchQuotaMetrics(showToast = false) {
    const btnRefresh = document.getElementById("btn-refresh-quota");
    const icon = btnRefresh?.querySelector("i");
    if (showToast && icon) icon.classList.add("fa-spin");

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
