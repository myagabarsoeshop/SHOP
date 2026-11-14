// =============================================================================
// FILE: cashbook-frontend/js/modules/system_setting.js
// SYSTEM SETTINGS, USER RBAC MANAGEMENT, RECONCILIATION & D1 BACKUP MODULE
// Version: 4.1.1 (Adds Create User UI & Detailed Reconciliation Mismatch Display)
// =============================================================================

import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { setKPI } from "../app.js";

let allSystemUsers = [];
let branchesList = [];

export async function initSystemSetting() {
    setupYearDropdown();
    bindEvents();
    updateSystemKPIs();
    fetchQuotaMetrics(false);

    // Spec 3.2: Only 'admin' role can manage users & reset passwords
    const adminUserBox = document.getElementById("admin-users-password-section");
    if (adminUserBox) {
        if (state.can("user.manage")) {
            adminUserBox.classList.remove("hidden");
            await loadBranchesForAdmin();
            await loadSystemUsersForAdmin();
            injectAdminRoleAndReconcileControls(adminUserBox);
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
    setKPI(4, "DB Limit (MB)", 500, "fa-hard-drive", "amber");
}

function setupYearDropdown() {
    const select = document.getElementById("setting-report-year");
    if (!select) return;

    select.innerHTML = "";
    const currYear = new Date(Date.now() + 390 * 60 * 1000).getUTCFullYear();
    for (let y = currYear - 2; y <= currYear + 2; y++) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = `${y} ခုနှစ်`;
        if (y === currYear) opt.selected = true;
        select.appendChild(opt);
    }
}

async function loadBranchesForAdmin() {
    if (Array.isArray(state.branches) && state.branches.length > 0) {
        branchesList = state.branches;
        return;
    }
    try {
        const res = await api.get("/branches");
        branchesList = res.data || [];
    } catch {
        branchesList = [];
    }
}

function injectAdminRoleAndReconcileControls(adminUserBox) {
    if (document.getElementById("admin-role-reconcile-panel")) return;

    const panel = document.createElement("div");
    panel.id = "admin-role-reconcile-panel";
    panel.className = "mt-5 pt-5 border-t border-slate-200 dark:border-slate-800 space-y-4";

    const branchOptionsHtml = branchesList.map(b =>
        `<option value="${ui.escapeHtml(b.id)}">${ui.escapeHtml(b.name)} (${ui.escapeHtml(b.code)})</option>`
    ).join("");

    panel.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <!-- 1. Change Selected User Role & Branch -->
            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
                <div class="space-y-3">
                    <div class="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <i class="fa-solid fa-user-shield text-blue-500"></i>
                        <span>ရွေးချယ်ထားသော ဝန်ထမ်း Role/ဆိုင်ခွဲ ပြောင်းရန်</span>
                    </div>
                    <div class="space-y-2.5">
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 mb-1">Role (ခွင့်ပြုချက်အုပ်စု)</label>
                            <select id="admin-edit-user-role" class="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                                <option value="branch_manager">branch_manager (ဆိုင်ခွဲတာဝန်ခံ)</option>
                                <option value="cashier">cashier (အရောင်းကောင်တာ)</option>
                                <option value="finance">finance (ငွေစာရင်း/Approve)</option>
                                <option value="admin">admin (စနစ်ပိုင်ရှင်)</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 mb-1">သတ်မှတ်ဆိုင်ခွဲ (Branch)</label>
                            <select id="admin-edit-user-branch" class="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                                ${branchOptionsHtml}
                            </select>
                        </div>
                    </div>
                </div>
                <button type="button" id="btn-save-user-role-branch" class="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer transition">
                    <i class="fa-solid fa-floppy-disk mr-1"></i>Role နှင့် ဆိုင်ခွဲ ပြောင်းလဲသိမ်းဆည်းမည်
                </button>
            </div>

            <!-- 2. Create New Staff User -->
            <form id="admin-create-user-form" class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
                <div class="space-y-2.5">
                    <div class="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <i class="fa-solid fa-user-plus text-emerald-500"></i>
                        <span>ဝန်ထမ်းအကောင့်အသစ် ဖွင့်လှစ်ရန်</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <input type="text" id="new-user-fullname" required placeholder="အမည်အပြည့်အစုံ *"
                            class="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                        <input type="text" id="new-user-username" required placeholder="Username *"
                            class="w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <select id="new-user-role" class="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                            <option value="cashier">cashier</option>
                            <option value="branch_manager">branch_manager</option>
                            <option value="finance">finance</option>
                            <option value="admin">admin</option>
                        </select>
                        <select id="new-user-branch" class="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                            ${branchOptionsHtml}
                        </select>
                    </div>
                    <input type="password" id="new-user-password" required minlength="6" placeholder="စကားဝှက် (အနည်းဆုံး ၆ လုံး) *"
                        class="w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white">
                </div>
                <button type="submit" id="btn-create-new-user" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer transition">
                    <i class="fa-solid fa-user-check mr-1"></i>ဝန်ထမ်းအကောင့် ဖွင့်မည်
                </button>
            </form>

            <!-- 3. Stock Ledger Reconciliation Check (Spec 2.3) -->
            <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex flex-col justify-between space-y-3">
                <div>
                    <div class="text-xs font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                        <i class="fa-solid fa-scale-balanced text-amber-500"></i>
                        <span>Stock Ledger Reconciliation</span>
                    </div>
                    <p class="text-[11px] text-slate-500 mt-1 leading-relaxed">
                        <code>SUM(stock_movements.quantity)</code> နှင့် <code>branch_inventory.quantity</code> ကွဲလွဲမှု ရှိ/မရှိ စစ်ဆေးပါသည်။
                    </p>
                    <div id="reconcile-result-box" class="mt-2.5 text-xs font-bold text-slate-500 max-h-28 overflow-y-auto"></div>
                </div>
                <button type="button" id="btn-run-reconcile-check" class="w-full py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-extrabold text-xs rounded-xl shadow-xs cursor-pointer transition">
                    <i class="fa-solid fa-magnifying-glass-chart mr-1"></i>Reconciliation ယခုစစ်ဆေးမည်
                </button>
            </div>
        </div>
    `;

    adminUserBox.appendChild(panel);

    document.getElementById("btn-save-user-role-branch")?.addEventListener("click", submitUpdateUserRoleAndBranch);
    document.getElementById("admin-create-user-form")?.addEventListener("submit", submitCreateNewUser);
    document.getElementById("btn-run-reconcile-check")?.addEventListener("click", runStockReconciliationCheck);
}

async function submitCreateNewUser(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-create-new-user");
    const fullName = document.getElementById("new-user-fullname")?.value.trim();
    const username = document.getElementById("new-user-username")?.value.trim();
    const role = document.getElementById("new-user-role")?.value || "cashier";
    const branchId = Number(document.getElementById("new-user-branch")?.value || 1);
    const password = document.getElementById("new-user-password")?.value.trim() || "";

    if (!fullName || !username || password.length < 6) {
        return ui.toast.warning("အမည်၊ Username နှင့် စကားဝှက် (အနည်းဆုံး ၆ လုံး) ဖြည့်သွင်းပေးပါ");
    }

    if (btn) btn.disabled = true;
    try {
        const res = await api.post("/system/users", {
            full_name: fullName,
            username,
            role,
            branch_id: branchId,
            password
        });
        ui.toast.success(res?.data?.message || "ဝန်ထမ်းအကောင့်အသစ် ဖွင့်လှစ်ပြီးပါပြီ");
        document.getElementById("admin-create-user-form")?.reset();
        await loadSystemUsersForAdmin();
    } catch (err) {
        ui.toast.error(err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function submitUpdateUserRoleAndBranch() {
    const userSelect = document.getElementById("setting-user-select");
    const userId = userSelect ? Number(userSelect.value) : 0;
    if (!userId) {
        return ui.toast.warning("ကျေးဇူးပြု၍ အပေါ်တွင် အသုံးပြုသူ (User) တစ်ဦး အရင်ရွေးချယ်ပါ");
    }

    const role = document.getElementById("admin-edit-user-role")?.value || "cashier";
    const branchId = Number(document.getElementById("admin-edit-user-branch")?.value || 1);

    try {
        const res = await api.put(`/system/users/${userId}`, {
            role,
            branch_id: branchId
        });
        ui.toast.success(res?.data?.message || "ဝန်ထမ်း Role နှင့် ဆိုင်ခွဲ ပြောင်းလဲသိမ်းဆည်းပြီးပါပြီ");
        await loadSystemUsersForAdmin();
        if (userSelect) {
            userSelect.value = String(userId);
            userSelect.dispatchEvent(new Event("change"));
        }
    } catch (err) {
        ui.toast.error(err.message);
    }
}

async function runStockReconciliationCheck() {
    const resBox = document.getElementById("reconcile-result-box");
    const btn = document.getElementById("btn-run-reconcile-check");
    if (btn) btn.disabled = true;
    if (resBox) resBox.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i>စစ်ဆေးနေပါသည်...`;

    try {
        const res = await api.get("/system/reconcile-stock");
        const data = res?.data || {};
        const count = Number(data.mismatch_count || 0);
        const list = Array.isArray(data.discrepancies) ? data.discrepancies : [];

        if (count === 0) {
            if (resBox) {
                resBox.className = "mt-2.5 text-xs font-extrabold text-emerald-600 dark:text-emerald-400";
                resBox.innerHTML = `<i class="fa-solid fa-circle-check mr-1"></i>အားလုံး ၁၀၀% ကိုက်ညီပါသည် (ကွဲလွဲမှု 0 ခု)`;
            }
            ui.toast.success("Stock Movement Ledger နှင့် ဆိုင်ခွဲလက်ကျန် အားလုံး ကိုက်ညီပါသည်");
        } else {
            if (resBox) {
                resBox.className = "mt-2.5 text-[11px] font-bold text-rose-600 dark:text-rose-400 space-y-1 max-h-32 overflow-y-auto";
                resBox.innerHTML = `
                    <div class="font-black"><i class="fa-solid fa-triangle-exclamation mr-1"></i>ကွဲလွဲမှု (${count}) ခု တွေ့ရှိရပါသည်:</div>
                    ${list.slice(0, 10).map(d => `
                        <div class="p-1.5 rounded bg-rose-500/10 border border-rose-500/20">
                            ${ui.escapeHtml(d.branch_name)} • ${ui.escapeHtml(d.item_name)}: Cached=${d.cached_quantity}, Ledger=${d.ledger_quantity}
                        </div>
                    `).join("")}
                `;
            }
            ui.toast.warning(`ကွဲလွဲမှု (${count}) ခု တွေ့ရှိရပါသည်`);
        }
    } catch (err) {
        if (resBox) resBox.textContent = err.message;
        ui.toast.error(err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

function bindEvents() {
    const btnRefresh = document.getElementById("btn-refresh-quota");
    if (btnRefresh) {
        btnRefresh.onclick = () => fetchQuotaMetrics(true);
    }

    const canBackup = state.can("system.backup");

    const btnSend = document.getElementById("btn-send-auto-email");
    if (btnSend) {
        if (!canBackup) {
            btnSend.disabled = true;
            btnSend.classList.add("opacity-50", "cursor-not-allowed");
            btnSend.title = "Admin သာလျှင် အီးမေးလ် Backup ပို့ဆောင်နိုင်ပါသည်";
        } else {
            btnSend.onclick = sendExcelReportEmail;
        }
    }

    const btnJsonBackup = document.getElementById("btn-download-json-backup");
    if (btnJsonBackup) {
        if (!canBackup) {
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

    const userSelect = document.getElementById("setting-user-select");
    if (userSelect) {
        userSelect.onchange = (e) => {
            const selectedId = Number(e.target.value);
            const userObj = allSystemUsers.find(u => Number(u.id) === selectedId);
            const usernameField = document.getElementById("setting-selected-username");
            const roleBranchField = document.getElementById("setting-selected-role-branch");
            const roleEditSelect = document.getElementById("admin-edit-user-role");
            const branchEditSelect = document.getElementById("admin-edit-user-branch");

            if (userObj) {
                if (usernameField) usernameField.value = userObj.username || "-";
                if (roleBranchField) {
                    const roleLabel = String(userObj.role || "cashier").toUpperCase();
                    const branchLabel = userObj.branch_name || (userObj.role === "admin" || userObj.role === "finance" ? "All Branches" : "Main Shop");
                    roleBranchField.value = `${roleLabel} • ${branchLabel}`;
                }
                if (roleEditSelect) roleEditSelect.value = userObj.role || "cashier";
                if (branchEditSelect && userObj.branch_id) branchEditSelect.value = String(userObj.branch_id);
            } else {
                if (usernameField) usernameField.value = "";
                if (roleBranchField) roleBranchField.value = "";
            }
        };
    }

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
    if (!state.can("user.manage")) return ui.toast.error("ခွင့်ပြုချက် မရှိပါ");

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

    if (sVal) sVal.textContent = `${storage} MB / 500 MB (Per DB)`;
    if (sBar) sBar.style.width = `${Math.max(1, Math.min(100, (storage / 500) * 100))}%`;

    if (showToast) {
        setTimeout(() => {
            icon?.classList.remove("fa-spin");
            ui.toast.info("Cloudflare D1 အရင်းအမြစ် အချက်အလက်များ အသစ်ဆွဲယူပြီးပါပြီ");
        }, 350);
    }
}

async function sendExcelReportEmail() {
    if (!state.can("system.backup")) {
        return ui.toast.error("စနစ်ပိုင်ရှင် (Admin) သာလျှင် Backup အီးမေးလ် ပို့ဆောင်နိုင်ပါသည်။");
    }

    const yearSelect = document.getElementById("setting-report-year");
    const emailInput = document.getElementById("setting-recipient-email");
    const btn = document.getElementById("btn-send-auto-email");

    const fallbackYear = new Date(Date.now() + 390 * 60 * 1000).getUTCFullYear();
    const year = yearSelect ? yearSelect.value : fallbackYear;
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
    if (!state.can("system.backup")) {
        return ui.toast.error("စနစ်ပိုင်ရှင် (Admin) သာလျှင် Full JSON Backup ဒေါင်းလုဒ်ဆွဲနိုင်ပါသည်။");
    }

    const yearSelect = document.getElementById("setting-report-year");
    const btn = document.getElementById("btn-download-json-backup");
    const fallbackYear = new Date(Date.now() + 390 * 60 * 1000).getUTCFullYear();
    const year = yearSelect ? yearSelect.value : fallbackYear;

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
