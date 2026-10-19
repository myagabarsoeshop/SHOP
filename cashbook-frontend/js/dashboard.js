/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - DASHBOARD ENGINE (SPA EDITION)
 * File: js/dashboard.js (သို့မဟုတ် dashboard.js)
 * ==============================================================================
 */

"use strict";

window.DashboardEngine = {
  // 💡 Dashboard Tab ကို ဖွင့်လိုက်သည့်အခါ အလိုအလျောက် အလုပ်လုပ်မည့် ဖန်ရှင်
  async init() {
    var container = document.getElementById("view-container");
    if (!container) return;

    // View Cache ထဲတွင် ရှိမရှိ စစ်ဆေးပြီး မရှိပါက ဆွဲယူထည့်သွင်းခြင်း
    if (!window.viewCache["dashboard"]) {
      try {
        var res = await fetch("views/dashboard.html?v=20261019");
        if (res.ok) {
          window.viewCache["dashboard"] = await res.text();
        } else {
          var res2 = await fetch("dashboard.html?v=20261019");
          if (res2.ok) window.viewCache["dashboard"] = await res2.text();
        }
      } catch (e) {
        console.warn("[Dashboard] View fetch error:", e);
      }
    }

    if (window.viewCache["dashboard"]) {
      container.innerHTML = window.viewCache["dashboard"];
    }

    // ဒေတာများ ချက်ချင်း ဆွဲတင်မည်
    await this.loadDashboardData();
  },

  async loadDashboardData() {
    var token = localStorage.getItem("token") || localStorage.getItem("golden_auth_token");
    if (!token) return;

    var userStr = localStorage.getItem("user") || localStorage.getItem("golden_user");
    var user = { branch_code: "main", role: "admin" };
    if (userStr) {
      try { user = JSON.parse(userStr); } catch (e) {}
    }

    var targetShop = user.branch_code || "main";
    if ((user.role === "admin" || user.role === "finance") && window.selectedShop) {
      targetShop = window.selectedShop;
    }

    try {
      if (typeof toggleLoading === "function") toggleLoading(true);

      // callApi သို့မဟုတ် direct fetch ဖြင့် ဒေတာဆွဲယူခြင်း
      var res = null;
      if (typeof callApi === "function") {
        res = await callApi("getCashbookEntries", { shop_id: targetShop, branch: targetShop });
      } else {
        var apiUrl = (window.CONFIG && window.CONFIG.API_URL) || "https://shop.myagabarsoeshop.workers.dev/api";
        var raw = await fetch(`${apiUrl}?action=getCashbookEntries&shop_id=${targetShop}`, {
          headers: { "Authorization": `Bearer ${token}` }
        });
        res = await raw.json();
      }

      if (res && res.success && res.summary) {
        this.updateSummaryCards(res.summary);
      }
    } catch (err) {
      console.error("[Dashboard] Load Error:", err);
    } finally {
      if (typeof toggleLoading === "function") toggleLoading(false);
    }
  },

  updateSummaryCards(summary) {
    if (!summary) return;
    var incomeEl = document.getElementById("lbl-income");
    var expenseEl = document.getElementById("lbl-expense");
    var cashEl = document.getElementById("lbl-cash");
    var bankEl = document.getElementById("lbl-bank");

    if (incomeEl) incomeEl.innerText = Number(summary.total_income || 0).toLocaleString("en-US") + " ကျပ်";
    if (expenseEl) expenseEl.innerText = Number(summary.total_expense || 0).toLocaleString("en-US") + " ကျပ်";
    if (cashEl) cashEl.innerText = Number(summary.cash_in_hand || 0).toLocaleString("en-US") + " ကျပ်";
    if (bankEl) bankEl.innerText = Number(summary.bank_balance || 0).toLocaleString("en-US") + " ကျပ်";
  }
};

// လိုအပ်ပါက အပြင်မှ တိုက်ရိုက် ခေါ်သုံးနိုင်ရန် ချိတ်ဆက်ပေးထားခြင်း
window.loadDashboardData = function() { window.DashboardEngine.loadDashboardData(); };
window.updateSummaryCards = function(s) { window.DashboardEngine.updateSummaryCards(s); };
