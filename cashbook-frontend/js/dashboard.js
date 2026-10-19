/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - DASHBOARD LOGIC (STABLE & CRASH-PROOF)
 * File: cashbook-frontend/dashboard.js (သို့မဟုတ် js/dashboard.js)
 * 💡 Features: Infinite Loop Protection, Null-Safety DOM Updates, Unified Auth Check
 * ==============================================================================
 */

const API_URL = "https://shop.myagabarsoeshop.workers.dev/api"; // Cloudflare Worker URL

// 💡 Auth Token ရယူခြင်း (token သို့မဟုတ် golden_auth_token နှစ်မျိုးလုံးကို ထောက်ပံ့သည်)
function getAuthToken() {
    return localStorage.getItem("token") || localStorage.getItem("golden_auth_token") || "";
}

// 💡 User Data ရယူခြင်း (user သို့မဟုတ် golden_user နှစ်မျိုးလုံးကို ထောက်ပံ့သည်)
function getAuthUser() {
    const userStr = localStorage.getItem("user") || localStorage.getItem("golden_user");
    if (!userStr) return null;
    try {
        return JSON.parse(userStr);
    } catch (e) {
        console.error("User JSON parse error:", e);
        return null;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const token = getAuthToken();
    const user = getAuthUser();

    // 🛑 Infinite Reload Loop ကာကွယ်ခြင်း:
    // လက်ရှိ index.html ပေါ် ရောက်နေပါက index.html သို့ ထပ်မံ redirect မလုပ်စေဘဲ ရပ်တန့်ပေးသည်
    const currentPath = window.location.pathname;
    const isIndexPage = currentPath.endsWith("index.html") || 
                        currentPath === "/" || 
                        currentPath === "";
    
    // Login မဝင်ရသေးပါက index.html သို့ ပြန်ပို့မည် (index.html တွင် ရောက်နေပါက မပို့ပါ)
    if (!token || !user) {
        if (!isIndexPage) {
            window.location.href = "index.html";
        }
        return;
    }

    const username = user.username || user.name || "Admin";
    const role = (user.role || "admin").toLowerCase();
    const branchCode = (user.branch_code || "main").toLowerCase();

    // 💡 Null-Safety: HTML ထဲတွင် user-info ရှိမှသာ ထည့်သွင်းမည် (Error မတက်စေရန်)
    const userInfoEl = document.getElementById("user-info");
    if (userInfoEl) {
        userInfoEl.innerText = `User: ${username} (${role.toUpperCase()} - ${branchCode.toUpperCase()})`;
    }

    // ဆိုင်ခွဲအလိုက် သို့မဟုတ် မိမိ Role အလိုက် ဒေတာများ စတင်ဆွဲယူမည်
    loadDashboardData(branchCode, role);
});

async function loadDashboardData(branchCode, role) {
    const token = getAuthToken();
    if (!token) return;

    // Admin သို့မဟုတ် Finance ဖြစ်ပါက ရွေးချယ်ထားသော ဆိုင်ခွဲကို ပြမည်
    let targetShop = branchCode || "main";
    if ((role === 'admin' || role === 'finance') && window.selectedShop) {
        targetShop = window.selectedShop;
    }

    try {
        const response = await fetch(`${API_URL}?action=getCashbookEntries&shop_id=${targetShop}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (!response.ok) {
            console.warn("Dashboard API Response Error:", response.status);
            return;
        }

        const result = await response.json();
        if (result && result.success) {
            updateSummaryCards(result.summary);
        } else {
            console.error("Failed to load summary:", result ? result.message : "Unknown error");
        }
    } catch (err) {
        console.error("Network Error:", err);
    }
}

// 💡 Summary Card များသို့ ဒေတာထည့်သွင်းခြင်း (Dashboard HTML ရော Cashbook HTML ရော ပါ Support လုပ်သည်)
function updateSummaryCards(summary) {
    if (!summary) return;

    // Dashboard HTML ရှိ ID (lbl-*) သို့မဟုတ် Cashbook HTML ရှိ ID (cb-*) နှစ်မျိုးလုံးကို စစ်ဆေးသည်
    const incomeEl = document.getElementById("lbl-income") || document.getElementById("cb-total-income");
    const expenseEl = document.getElementById("lbl-expense") || document.getElementById("cb-total-expense");
    const cashEl = document.getElementById("lbl-cash") || document.getElementById("cb-cash-in-hand");
    const bankEl = document.getElementById("lbl-bank") || document.getElementById("cb-bank-balance");

    if (incomeEl) {
        incomeEl.innerText = Number(summary.total_income || 0).toLocaleString() + " ကျပ်";
    }
    if (expenseEl) {
        expenseEl.innerText = Number(summary.total_expense || 0).toLocaleString() + " ကျပ်";
    }
    if (cashEl) {
        cashEl.innerText = Number(summary.cash_in_hand || 0).toLocaleString() + " ကျပ်";
    }
    if (bankEl) {
        bankEl.innerText = Number(summary.bank_balance || 0).toLocaleString() + " ကျပ်";
    }
}

// 💡 ဆိုင်ခွဲပြောင်းလဲကြည့်ရှုခြင်း
function switchShop(shopId) {
    const user = getAuthUser();
    if (!user) return;

    const role = (user.role || "").toLowerCase();
    const branchCode = (user.branch_code || "").toLowerCase();
    const target = (shopId || "").toLowerCase();

    // Staff သို့မဟုတ် Viewer က အခြားဆိုင်ခွဲကို ဝင်ကြည့်ပါက ကန့်သတ်ခြင်း
    if (role !== 'admin' && role !== 'finance' && branchCode !== target) {
        alert("သင့်တွင် ဤဆိုင်ခွဲကို ဝင်ရောက်ကြည့်ရှုခွင့် မရှိပါ။");
        return;
    }

    window.selectedShop = shopId;
    const pageTitle = document.getElementById("page-title");
    if (pageTitle) {
        pageTitle.innerText = `Dashboard - ${shopId.toUpperCase()}`;
    }
    loadDashboardData(shopId, role);
}

// 💡 Logout ပြုလုပ်ခြင်း (သိမ်းထားသော Token များကို အကုန်ရှင်းလင်းမည်)
function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("golden_auth_token");
    localStorage.removeItem("golden_user");
    window.location.href = "index.html";
}

// Global Window သို့ Function များကို ထုတ်ပေးထားခြင်း
window.loadDashboardData = loadDashboardData;
window.updateSummaryCards = updateSummaryCards;
window.switchShop = switchShop;
window.logout = logout;
