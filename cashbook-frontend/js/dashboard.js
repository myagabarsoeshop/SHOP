/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - DASHBOARD LOGIC
 * File: cashbook-frontend/dashboard.js
 * ==============================================================================
 */

const API_URL = "https://shop.myagabarsoeshop.workers.dev/api"; // Cloudflare Worker URL

document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");

    if (!token || !userStr) {
        window.location.href = "index.html"; // Login မရှိလျှင် ပြန်ပို့မည်
        return;
    }

    const user = JSON.parse(userStr);
    document.getElementById("user-info").innerText = `User: ${user.username} (${user.role.toUpperCase()} - ${user.branch_code.toUpperCase()})`;

    // Load initial dashboard data based on role and branch
    loadDashboardData(user.branch_code, user.role);
});

async function loadDashboardData(branchCode, role) {
    const token = localStorage.getItem("token");
    
    // If admin or finance viewing main, can view global or specify shop
    let targetShop = branchCode;
    if ((role === 'admin' || role === 'finance') && window.selectedShop) {
        targetShop = window.selectedShop;
    }

    try {
        const response = await fetch(`${API_URL}?action=getCashbookEntries&shop_id=${targetShop}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        const result = await response.json();
        if (result.success) {
            updateSummaryCards(result.summary);
        } else {
            console.error("Failed to load summary:", result.message);
        }
    } catch (err) {
        console.error("Network Error:", err);
    }
}

function updateSummaryCards(summary) {
    if (!summary) return;
    document.getElementById("lbl-income").innerText = Number(summary.total_income || 0).toLocaleString() + " ကျပ်";
    document.getElementById("lbl-expense").innerText = Number(summary.total_expense || 0).toLocaleString() + " ကျပ်";
    document.getElementById("lbl-cash").innerText = Number(summary.cash_in_hand || 0).toLocaleString() + " ကျပ်";
    document.getElementById("lbl-bank").innerText = Number(summary.bank_balance || 0).toLocaleString() + " ကျပ်";
}

function switchShop(shopId) {
    const userStr = localStorage.getItem("user");
    if (!userStr) return;
    const user = JSON.parse(userStr);

    // If staff/viewer tries to switch to other shop, restrict them
    if (user.role !== 'admin' && user.role !== 'finance' && user.branch_code !== shopId) {
        alert("သင့်တွင် ဤဆိုင်ခွဲကို ဝင်ရောက်ကြည့်ရှုခွင့် မရှိပါ။");
        return;
    }

    window.selectedShop = shopId;
    document.getElementById("page-title").innerText = `Dashboard - ${shopId.toUpperCase()}`;
    loadDashboardData(shopId, user.role);
}

function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "index.html";
}
