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

    // Admin ဖြစ်မှသာ ဝန်ထမ်းများ၏ Force Password Reset card ကို ပြသမည်
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

    const btnJsonBackup = document.getElementById("btn-download-json-backup");
    if (btnJsonBackup) {
        if (!state.isAdmin()) {
            btnJsonBackup.disabled = true;
            btnJsonBackup.classList.add("opacity-50", "cursor-not-allowed");
            btnJsonBackup.title = "Admin သာလျှင် Full JSON Backup ဒေါင်းလုဒ်ဆွဲနိုင်ပါသည်";
        } else {
            btnJsonBackup.onclick = downloadJsonBackup;
        }
    }

    const pwdForm = document.getElementById("change-password-form");
    if (pwdForm) {
        pwdForm.onsubmit = submitPasswordChange;
    }

    // Admin: User select change event (Displays Username & Role/Branch — Never Plaintext Password)
    const userSelect = document.getElementById("setting-user-select");
    if (userSelect) {
        userSelect.onchange = (e) => {
            const selectedId = Number(e.target.value);
            const userObj = allSystemUsers.find(u => Number(u.id) === selectedId);
            const usernameField = document.getElementById("setting-selected-username");
            const roleBranchField = document.getElementById("setting-selected-role-branch");

            if (userObj) {
                if (usernameField) usernameField.value = userObj.username || "-";
                if (roleBranchField) {
                    const roleLabel = String(userObj.role || "cashier").toUpperCase();
                    const branchLabel = userObj.branch_name || (userObj.role === "admin" || userObj.role === "finance" ? "All Branches" : "Main Shop");
                    roleBranchField.value = `${roleLabel} • ${branchLabel}`;
                }
            } else {
                if (usernameField) usernameField.value = "";
                if (roleBranchField) roleBranchField.value = "";
            }
        };
    }

    // Admin: Force Reset user password form submit
    const adminPwdForm = document.getElementById("admin-reset-password-form");
    if (adminPwdForm) {
        adminPwdForm.onsubmit = submitAdminResetPassword;
    }
}

async function loadSystemUsersForAdmin() {
    try {
        const res = await api.get("/system/users");
        allSystemUsers = res?.data || (Array.isArray(res) ? res : []);
        const select = document.getElementById("setting-user-select");
        if (!select) return;

        select.innerHTML = `<option value="">-- အသုံးပြုသူ (User) ရွေးချယ်ပါ --</option>`;
        allSystemUsers.forEach(u => {
            const opt = document.createElement("option");
            opt.value = u.id;
            const branchLabel = u.branch_name || (u.role === "admin" || u.role === "finance" ? "Global" : "Main");
            opt.textContent = `${u.full_name || u.username} (${u.role}) - [${branchLabel}]`;
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
    if (!newPassword || newPassword.length < 6) {
        newPwdInput?.focus();
        return ui.toast.warning("စကားဝှက်အသစ်သည် အနည်းဆုံး (၆) လုံး ရှိရပါမည်။");
    }

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> သိမ်းဆည်းနေပါသည်...`;
    }

    try {
        const res = await api.post("/system/reset-password", {
            user_id: userId,
            new_password: newPassword
        });
        const msg = res?.data?.message || res?.message || "စကားဝှက်အသစ် ပြောင်းလဲသိမ်းဆည်းပြီးပါပြီ။";
        ui.toast.success(msg);

        if (newPwdInput) newPwdInput.value = "";

        // If Admin reset their own password, their token_version incremented — force re-login
        const currentAdminId = Number(state.user?.id || 0);
        if (currentAdminId && userId === currentAdminId) {
            setTimeout(() => {
                localStorage.removeItem("pos_token");
                window.location.reload();
            }, 1200);
        }
    } catch (err) {
        ui.toast.error("စကားဝှက် ပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-key"></i> <span>Reset လုပ်မည်</span>`;
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
        const res = await api.post(`/system/send-report-email?year=${encodeURIComponent(year)}`, { year, email });
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
            btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> <span>Excel အီးမေးလ်ပို့မည်</span>`;
        }
    }
}

async function downloadJsonBackup() {
    if (!state.isAdmin()) {
        return ui.toast.error("စနစ်ပိုင်ရှင် (Admin) သာလျှင် Full JSON Backup ဒေါင်းလုဒ်ဆွဲနိုင်ပါသည်။");
    }

    const yearSelect = document.getElementById("setting-report-year");
    const btn = document.getElementById("btn-download-json-backup");
    const year = yearSelect ? yearSelect.value : new Date().getFullYear();

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>ဒေါင်းနေပါသည်...</span>`;
    }

    try {
        const res = await api.get("/system/backup-json", { year });
        const backupPayload = res?.data || res;

        const jsonStr = JSON.stringify(backupPayload, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `Garment_ERP_Full_Backup_${year}_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        ui.toast.success(`${year} ခုနှစ် Full JSON Database Backup ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ။`);
    } catch (err) {
        ui.toast.error(`Backup ဒေါင်းလုဒ်မရပါ: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-download text-emerald-400"></i> <span>Full JSON ဒေါင်းမည်</span>`;
        }
    }
}

async function submitPasswordChange(e) {
    e.preventDefault();
    const oldPwdInput = document.getElementById("setting-old-password");
    const newPwdInput = document.getElementById("setting-new-password");
    const btn = document.getElementById("btn-change-password");

    const oldPassword = oldPwdInput?.value || "";
    const newPassword = newPwdInput?.value?.trim() || "";

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
        ui.toast.success("စကားဝှက် အောင်မြင်စွာ ပြောင်းလဲပြီးပါပြီ။ စကားဝှက်အသစ်ဖြင့် ပြန်လည်ဝင်ရောက်ပါ။");
        document.getElementById("change-password-form")?.reset();

        // Password change increments token_version on backend, invalidating old token
        setTimeout(() => {
            localStorage.removeItem("pos_token");
            window.location.reload();
        }, 1200);
    } catch (err) {
        ui.toast.error("စကားဝှက် ပြောင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check-circle mr-1"></i> <span>စကားဝှက် အသစ်ပြောင်းလဲမည်</span>`;
        }
    }
}
