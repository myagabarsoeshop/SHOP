/**
 * ==============================================================================
 * မြကမ္ဘာစိုး ပိုးထည်တိုက် - EXECUTIVE DASHBOARD CONTROLLER ENGINE
 * File: js/dashboard.js (သို့မဟုတ် dashboard.js)
 * Standard: Dual Analytics (Daily Cash/Bank Settlement & Stock Valuation Engine)
 * Features: 🛡️ Multi-Branch RBAC Enforcement (Shop 1-5 Lockdown vs Admin/Finance Multi-View)
 * ==============================================================================
 */

"use strict";

window.currentDashboardShop = "all";

// 💡 ငွေကြေးနှင့် ကိန်းဂဏန်း ဖော်မတ် ပြုပြင်သည့် ဖန်ရှင်များ
function formatMoney(num) {
  return Number(num || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatInt(num) {
  return Number(num || 0).toLocaleString("en-US");
}

function parseCleanNum(val) {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  var str = String(val).replace(/,/g, "").trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// 💡 LocalStorage မှ User အချက်အလက် ရယူခြင်း
function getDashboardUser() {
  const userStr = localStorage.getItem("user") || localStorage.getItem("golden_user");
  if (!userStr) return { username: "Admin", role: "Admin", branch_code: "main" };
  try {
    return JSON.parse(userStr);
  } catch (e) {
    return { username: "Admin", role: "Admin", branch_code: "main" };
  }
}

window.DashboardEngine = {

  // 💡 Dashboard Tab ကို ဖွင့်လိုက်သည့်အခါ အလိုအလျောက် စတင်လုပ်ဆောင်မည့် ဖန်ရှင်
  async init() {
    const container = document.getElementById("view-container");
    if (!container) return;

    // View HTML မရှိသေးပါက ဆွဲယူထည့်သွင်းခြင်း
    if (!window.viewCache["dashboard"]) {
      try {
        var res = await fetch("views/dashboard.html?v=20261020");
        if (res.ok) {
          window.viewCache["dashboard"] = await res.text();
        } else {
          var res2 = await fetch("dashboard.html?v=20261020");
          if (res2.ok) window.viewCache["dashboard"] = await res2.text();
        }
      } catch (e) {
        console.warn("[Dashboard] View fetch error:", e);
      }
    }

    if (window.viewCache["dashboard"]) {
      container.innerHTML = window.viewCache["dashboard"];
    }

    // ၁။ အသုံးပြုသူ Role အလိုက် ဆိုင်ခွဲ Dropdown / Badge ထိန်းချုပ်ခြင်း
    this.setupRoleAccess();

    // ၂။ ယနေ့ရက်စွဲ ပြသခြင်း
    const dateEl = document.getElementById("db-date-display");
    if (dateEl) {
      const today = new Date();
      dateEl.textContent = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }

    // ၃။ ဒေတာအားလုံး ဆွဲယူတွက်ချက်ပြသခြင်း
    await this.loadDashboardData(false, false);
  },

  // 💡 Role-Based UI Setup: Shop 1 to 5 ဝန်ထမ်းများကို အခြားဆိုင်များ လုံးဝမမြင်ရအောင် ပိတ်ပင်ခြင်း
  setupRoleAccess() {
    const user = getDashboardUser();
    const role = String(user.role || "").toLowerCase();
    const branch = String(user.branch_code || "main").toLowerCase();

    const selectWrap = document.getElementById("db-shop-select-wrap");
    const badgeWrap = document.getElementById("db-branch-badge-wrap");
    const badgeText = document.getElementById("db-branch-badge-text");
    const shopSelect = document.getElementById("db-shop-select");

    const shopNames = {
      "main": "🏛️ Main Home Shop (ပင်မ)",
      "shop1": "🏬 ဆိုင်ခွဲ (၁)",
      "shop2": "🏬 ဆိုင်ခွဲ (၂)",
      "shop3": "🏬 ဆိုင်ခွဲ (၃)",
      "shop4": "🏬 ဆိုင်ခွဲ (၄)",
      "shop5": "🏬 ဆိုင်ခွဲ (၅)"
    };

    // Admin / Finance / Staff / Viewer တို့သည် ဆိုင်အားလုံး ရွေးချယ်ခွင့်ရှိသည်
    const canSwitchAll = ["admin", "owner", "finance", "staff", "viewer"].includes(role);

    if (canSwitchAll) {
      if (selectWrap) selectWrap.classList.remove("hidden");
      if (badgeWrap) badgeWrap.classList.add("hidden");
      if (shopSelect) {
        shopSelect.value = window.currentDashboardShop || "all";
      }
    } else {
      // Shop 1 to 5 ဝန်ထမ်းများအတွက် Dropdown ကို ဖျောက်ပြီး မိမိဆိုင် Badge သာ ပြမည်
      if (selectWrap) selectWrap.classList.add("hidden");
      if (badgeWrap) badgeWrap.classList.remove("hidden");
      if (badgeText) badgeText.textContent = shopNames[branch] || branch.toUpperCase();
      window.currentDashboardShop = branch;
    }
  },

  // 💡 ဆိုင်ခွဲ ပြောင်းလဲကြည့်ရှုခြင်း (Admin/Finance သာ)
  async changeShop(shopId) {
    const user = getDashboardUser();
    const role = String(user.role || "").toLowerCase();
    const canSwitchAll = ["admin", "owner", "finance", "staff", "viewer"].includes(role);

    if (!canSwitchAll) {
      alert("⚠️ သင့်တွင် အခြားဆိုင်ခွဲများ၏ စာရင်းကို ကြည့်ရှုခွင့် မရှိပါ။");
      return;
    }

    window.currentDashboardShop = shopId || "all";
    await this.loadDashboardData(false, true);
  },

  // 💡 Dashboard ဒေတာအားလုံး ဆွဲယူတွက်ချက်ခြင်း Engine
  async loadDashboardData(isSilent, forceRefresh) {
    const token = localStorage.getItem("token") || localStorage.getItem("golden_auth_token");
    if (!token) return;

    const user = getDashboardUser();
    const role = String(user.role || "").toLowerCase();
    const canSwitchAll = ["admin", "owner", "finance", "staff", "viewer"].includes(role);

    let activeShop = canSwitchAll ? (window.currentDashboardShop || "all") : (user.branch_code || "main");

    try {
      if (!isSilent && typeof toggleLoading === "function") toggleLoading(true);

      const queryShop = activeShop === "all" ? "" : activeShop;

      // API (၃) ခုမှ ဒေတာများကို Parallel ဆွဲယူခြင်း (ငွေစာရင်း၊ အထည်စတို၊ ချည်စတို)
      const [cbRes, garmentRes, yarnRes] = await Promise.all([
        callApi("getCashbookEntries", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh }),
        callApi("getStoreInventory", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh }),
        callApi("getYarnInventory", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh })
      ]);

      // ၁။ ထိပ်ဆုံး Box ၄ ခု (KPI Stats) ဖြည့်သွင်းခြင်း
      if (cbRes && cbRes.success && cbRes.summary) {
        this.renderKpiCards(cbRes.summary);
      }

      // ၂။ ဇယား (၁) နေ့စဉ် ငွေသား + ဘဏ် ရှင်းတမ်း တွက်ချက်ပြသခြင်း
      this.renderDailySettlement(cbRes ? cbRes.data : [], cbRes ? cbRes.summary : null);

      // ၃။ ဇယား (၂) ပစ္စည်းလက်ကျန် တန်ဖိုးတွက်ချက်ခြင်း
      const garmentData = (garmentRes && garmentRes.success) ? garmentRes.data : [];
      const yarnData = (yarnRes && yarnRes.success) ? yarnRes.data : [];
      this.renderStockValuation(garmentData, yarnData);

    } catch (err) {
      console.error("[Dashboard Load Error]:", err);
      if (err && err.message && err.message.includes("401")) {
        if (typeof showLogin === "function") showLogin();
      }
    } finally {
      if (!isSilent && typeof toggleLoading === "function") toggleLoading(false);
    }
  },

  // 💡 ၁။ ထိပ်ဆုံး Box ၄ ခု ဖြည့်သွင်းခြင်း
  renderKpiCards(summary) {
    if (!summary) return;
    const incomeEl = document.getElementById("lbl-income");
    const expenseEl = document.getElementById("lbl-expense");
    const cashEl = document.getElementById("lbl-cash");
    const bankEl = document.getElementById("lbl-bank");

    if (incomeEl) incomeEl.innerText = formatInt(summary.total_income || 0) + " ကျပ်";
    if (expenseEl) expenseEl.innerText = formatInt(summary.total_expense || 0) + " ကျပ်";
    if (cashEl) cashEl.innerText = formatInt(summary.cash_in_hand || 0) + " ကျပ်";
    if (bankEl) bankEl.innerText = formatInt(summary.bank_balance || 0) + " ကျပ်";
  },

  // 💡 ၂။ ဇယား (၁) - နေ့စဉ် ငွေသား + ဘဏ် ရှင်းတမ်း တွက်ချက်ခြင်း
  renderDailySettlement(entries, summary) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const dataList = Array.isArray(entries) ? entries : [];

    let prevCash = 0, prevBank = 0;
    let todaySaleCash = 0, todaySaleBank = 0;
    let todayTransCash = 0, todayTransBank = 0;

    dataList.forEach(row => {
      const rowDate = (row.tx_date || "").slice(0, 10);
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      const cash = Number(row.cash_amount || 0);
      const bank = Number(row.bank_amount || 0);
      const cat = String(row.category || "").trim();

      // ယခင်နေ့များ၏ စုစုပေါင်း လက်ကျန် (Opening Balance)
      if (rowDate < todayStr) {
        if (cash > 0 || bank > 0) {
          if (debit > 0) { prevCash += cash; prevBank += bank; }
          if (credit > 0) { prevCash -= cash; prevBank -= bank; }
        } else {
          if (debit > 0) prevCash += debit;
          if (credit > 0) prevCash -= credit;
        }
      }
      // ယနေ့ စာရင်းများ
      else if (rowDate === todayStr) {
        // ယနေ့ ရောင်းရငွေ
        if (cat.includes("ရောင်း") || cat.toLowerCase().includes("sale")) {
          todaySaleCash += cash > 0 ? cash : debit;
          todaySaleBank += bank;
        }
        // ယနေ့ စာရင်းပြောင်း / ငွေလွှဲ
        else if (cat.includes("လွှဲ") || cat.toLowerCase().includes("transfer")) {
          todayTransCash += cash > 0 ? cash : credit;
          todayTransBank += bank;
        }
      }
    });

    // 💡 ဖော်မြူလာအတိုင်း စုစုပေါင်း လက်ကျန် တွက်ချက်ခြင်း (ယခင်နေ့ + ယနေ့ရောင်း - စာရင်းပြောင်း)
    const totalCash = prevCash + todaySaleCash - todayTransCash;
    const totalBank = prevBank + todaySaleBank - todayTransBank;

    // Table 1 သို့ တန်ဖိုးများ ထည့်သွင်းခြင်း
    const elPrevCash = document.getElementById("db-settle-prev-cash");
    const elPrevBank = document.getElementById("db-settle-prev-bank");
    const elSaleCash = document.getElementById("db-settle-sale-cash");
    const elSaleBank = document.getElementById("db-settle-sale-bank");
    const elTransCash = document.getElementById("db-settle-trans-cash");
    const elTransBank = document.getElementById("db-settle-trans-bank");

    const elTotalCash = document.getElementById("db-settle-total-cash");
    const elTotalBank = document.getElementById("db-settle-total-bank");

    if (elPrevCash) elPrevCash.textContent = formatMoney(prevCash);
    if (elPrevBank) elPrevBank.textContent = formatMoney(prevBank);
    if (elSaleCash) elSaleCash.textContent = formatMoney(todaySaleCash);
    if (elSaleBank) elSaleBank.textContent = formatMoney(todaySaleBank);
    if (elTransCash) elTransCash.textContent = formatMoney(todayTransCash);
    if (elTransBank) elTransBank.textContent = formatMoney(todayTransBank);

    if (elTotalCash) elTotalCash.textContent = formatMoney(totalCash) + " ကျပ်";
    if (elTotalBank) elTotalBank.textContent = formatMoney(totalBank) + " ကျပ်";
  },

  // 💡 ၃။ ဇယား (၂) - ပစ္စည်းလက်ကျန် တန်ဖိုးတွက်ချက်ခြင်း (Inventory Valuation)
  renderStockValuation(garments, yarns) {
    // ကုန်ချော (အထည်) တွက်ချက်မှု
    const garmentCatSet = new Set();
    let garmentQty = 0, garmentCost = 0, garmentRetail = 0, garmentWholesale = 0;

    (garments || []).forEach(g => {
      if (g.category) garmentCatSet.add(g.category.trim());
      const qty = Number(g.current_stock || 0);
      garmentQty += qty;
      garmentCost += qty * Number(g.cost_price || 0);
      garmentRetail += qty * Number(g.retail_price || 0);
      garmentWholesale += qty * Number(g.wholesale_price || 0);
    });

    // ချည်စတို တွက်ချက်မှု
    const yarnTypeSet = new Set();
    let yarnQty = 0, yarnCost = 0, yarnRetail = 0, yarnWholesale = 0;

    (yarns || []).forEach(y => {
      if (y.yarn_type) yarnTypeSet.add(y.yarn_type.trim());
      const qty = Number(y.current_stock || 0);
      yarnQty += qty;
      yarnCost += qty * Number(y.cost_price || 0);
      yarnRetail += qty * Number(y.retail_price || 0);
      yarnWholesale += qty * Number(y.wholesale_price || 0);
    });

    // စုစုပေါင်း (Total)
    const totalCatCount = garmentCatSet.size + yarnTypeSet.size;
    const totalQty = garmentQty + yarnQty;
    const totalCost = garmentCost + yarnCost;
    const totalRetail = garmentRetail + yarnRetail;
    const totalWholesale = garmentWholesale + yarnWholesale;

    // Row 1: အထည်တန်ဖိုးများ ထည့်သွင်းခြင်း
    this.setElText("db-stock-garment-cat", formatInt(garmentCatSet.size));
    this.setElText("db-stock-garment-qty", formatInt(garmentQty));
    this.setElText("db-stock-garment-cost", formatMoney(garmentCost));
    this.setElText("db-stock-garment-retail", formatMoney(garmentRetail));
    this.setElText("db-stock-garment-wholesale", formatMoney(garmentWholesale));

    // Row 2: ချည်တန်ဖိုးများ ထည့်သွင်းခြင်း
    this.setElText("db-stock-yarn-cat", formatInt(yarnTypeSet.size));
    this.setElText("db-stock-yarn-qty", formatInt(yarnQty));
    this.setElText("db-stock-yarn-cost", formatMoney(yarnCost));
    this.setElText("db-stock-yarn-retail", formatMoney(yarnRetail));
    this.setElText("db-stock-yarn-wholesale", formatMoney(yarnWholesale));

    // Footer: စုစုပေါင်း တန်ဖိုးများ ထည့်သွင်းခြင်း
    this.setElText("db-stock-total-cat", formatInt(totalCatCount));
    this.setElText("db-stock-total-qty", formatInt(totalQty));
    this.setElText("db-stock-total-cost", formatMoney(totalCost));
    this.setElText("db-stock-total-retail", formatMoney(totalRetail));
    this.setElText("db-stock-total-wholesale", formatMoney(totalWholesale));
  },

  setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
};

// 💡 Global Expose ပြုလုပ်ခြင်း
window.loadDashboardData = function() { window.DashboardEngine.loadDashboardData(); };
window.updateSummaryCards = function(s) { window.DashboardEngine.renderKpiCards(s); };
