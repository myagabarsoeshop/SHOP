/**
 * ==============================================================================
 * မြကမ္ဘာစိုး ပိုးထည်တိုက် - EXECUTIVE DASHBOARD CONTROLLER ENGINE
 * File: js/dashboard.js (သို့မဟုတ် dashboard.js)
 * Standard: Clean Integer (Zero Decimals / No Suffix), Preset Ranges (1D/3D/7D)
 * Features: 🛡️ Multi-Branch RBAC Enforcement & Stock/Settlement Analytics
 * ==============================================================================
 */

"use strict";

window.currentDashboardShop = "all";
window.currentDashboardRange = "today"; // 'today' | 'yesterday' | '3days' | '7days'

// 💡 ဒသမမပါသော ကိန်းပြည့်သီးသန့် (Clean Integer) ဖော်မတ်ပြောင်းသည့် ဖန်ရှင်
function formatInt(num) {
  const n = Math.round(Number(num || 0));
  return n.toLocaleString("en-US");
}

function parseCleanNum(val) {
  if (val === undefined || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  var str = String(val).replace(/,/g, "").trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// 💡 ရက်စွဲ ကာလတွက်ချက်မှု Helper
function getDateNDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// 💡 LocalStorage မှ အသုံးပြုသူ အချက်အလက် ရယူခြင်း
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

  // 💡 Dashboard Tab ကို စတင်ဖွင့်လှစ်ချိန် လုပ်ဆောင်ချက်
  async init() {
    const container = document.getElementById("view-container");
    if (!container) return;

    if (!window.viewCache["dashboard"]) {
      try {
        var res = await fetch("views/dashboard.html?v=20261021");
        if (res.ok) {
          window.viewCache["dashboard"] = await res.text();
        } else {
          var res2 = await fetch("dashboard.html?v=20261021");
          if (res2.ok) window.viewCache["dashboard"] = await res2.text();
        }
      } catch (e) {
        console.warn("[Dashboard] View fetch error:", e);
      }
    }

    if (window.viewCache["dashboard"]) {
      container.innerHTML = window.viewCache["dashboard"];
    }

    // ၁။ Role အလိုက် ဆိုင်ခွဲ Dropdown / Badge ထိန်းချုပ်ခြင်း
    this.setupRoleAccess();

    // ၂။ ကာလခလုတ် UI နှင့် ရက်စွဲ အညွှန်း သတ်မှတ်ခြင်း
    this.updateRangeUI();

    // ၃။ ဒေတာများ ဆွဲယူတွက်ချက်ပြသခြင်း
    await this.loadDashboardData(false, false);
  },

  // 💡 Role-Based UI: Shop 1 to 5 သမားများကို ဆိုင်ခွဲမပြောင်းနိုင်အောင် ကန့်သတ်ခြင်း
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

    const canSwitchAll = ["admin", "owner", "finance", "staff", "viewer"].includes(role);

    if (canSwitchAll) {
      if (selectWrap) selectWrap.classList.remove("hidden");
      if (badgeWrap) badgeWrap.classList.add("hidden");
      if (shopSelect) shopSelect.value = window.currentDashboardShop || "all";
    } else {
      if (selectWrap) selectWrap.classList.add("hidden");
      if (badgeWrap) badgeWrap.classList.remove("hidden");
      if (badgeText) badgeText.textContent = shopNames[branch] || branch.toUpperCase();
      window.currentDashboardShop = branch;
    }
  },

  // 💡 ဆိုင်ခွဲ ပြောင်းလဲကြည့်ရှုခြင်း
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

  // 💡 ကာလ ရွေးချယ်မှု စနစ် (ယနေ့ / မနေ့က / ၃ ရက်စာ / ၇ ရက်စာ)
  async setDateRange(rangeKey) {
    window.currentDashboardRange = rangeKey;
    this.updateRangeUI();
    await this.loadDashboardData(false, false);
  },

  // 💡 ကာလ ခလုတ်များ၏ အရောင်နှင့် စာသားပြောင်းလဲခြင်း
  updateRangeUI() {
    const activeRange = window.currentDashboardRange || "today";
    const rangeKeys = ["today", "yesterday", "3days", "7days"];

    rangeKeys.forEach(k => {
      const btn = document.getElementById("btn-range-" + k);
      if (btn) {
        if (k === activeRange) {
          btn.className = "px-2.5 py-1 rounded-md transition text-white bg-indigo-600 shadow font-bold";
        } else {
          btn.className = "px-2.5 py-1 rounded-md transition text-slate-400 hover:text-white font-bold";
        }
      }
    });

    const dateDisplay = document.getElementById("db-date-display");
    const settleBadge = document.getElementById("db-settle-badge");
    const today = new Date();

    if (activeRange === "today") {
      if (dateDisplay) dateDisplay.textContent = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      if (settleBadge) settleBadge.textContent = "Today";
    } else if (activeRange === "yesterday") {
      const y = new Date(Date.now() - 86400000);
      if (dateDisplay) dateDisplay.textContent = y.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      if (settleBadge) settleBadge.textContent = "Yesterday";
    } else if (activeRange === "3days") {
      const start = new Date(Date.now() - 2 * 86400000);
      if (dateDisplay) dateDisplay.textContent = `${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${today.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
      if (settleBadge) settleBadge.textContent = "Last 3 Days";
    } else if (activeRange === "7days") {
      const start = new Date(Date.now() - 6 * 86400000);
      if (dateDisplay) dateDisplay.textContent = `${start.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} - ${today.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}`;
      if (settleBadge) settleBadge.textContent = "Last 7 Days";
    }
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

      // API ၃ ခုမှ ဒေတာများကို တစ်ပြိုင်နက် ရယူခြင်း
      const [cbRes, garmentRes, yarnRes] = await Promise.all([
        callApi("getCashbookEntries", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh }),
        callApi("getStoreInventory", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh }),
        callApi("getYarnInventory", { shop_id: queryShop, branch: queryShop, forceRefresh: forceRefresh })
      ]);

      // ၁။ ထိပ်ဆုံး Box ၄ ခု (Clean Integers) ဖြည့်သွင်းခြင်း
      if (cbRes && cbRes.success && cbRes.summary) {
        this.renderKpiCards(cbRes.summary);
      }

      // ၂။ ဇယား (၁) ကာလအပိုင်းအခြားအလိုက် ငွေသား + ဘဏ် ရှင်းတမ်း တွက်ချက်ခြင်း
      this.renderDailySettlement(cbRes ? cbRes.data : []);

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

  // 💡 ၁။ ထိပ်ဆုံး Box ၄ ခု ("ကျပ်" နှင့် ဒသမ မပါသော ကိန်းပြည့်ဂဏန်း သီးသန့်)
  renderKpiCards(summary) {
    if (!summary) return;
    this.setElText("lbl-income", formatInt(summary.total_income || 0));
    this.setElText("lbl-expense", formatInt(summary.total_expense || 0));
    this.setElText("lbl-cash", formatInt(summary.cash_in_hand || 0));
    this.setElText("lbl-bank", formatInt(summary.bank_balance || 0));
  },

  // 💡 ၂။ ဇယား (၁) - ရွေးချယ်ထားသော ကာလ (၁ ရက် / ၃ ရက် / ၇ ရက်) အလိုက် ရှင်းတမ်းတွက်ချက်ခြင်း
  renderDailySettlement(entries) {
    const range = window.currentDashboardRange || "today";
    let startDate = getDateNDaysAgo(0);
    let endDate = getDateNDaysAgo(0);

    if (range === "yesterday") {
      startDate = getDateNDaysAgo(1);
      endDate = getDateNDaysAgo(1);
    } else if (range === "3days") {
      startDate = getDateNDaysAgo(2);
      endDate = getDateNDaysAgo(0);
    } else if (range === "7days") {
      startDate = getDateNDaysAgo(6);
      endDate = getDateNDaysAgo(0);
    }

    const dataList = Array.isArray(entries) ? entries : [];

    let prevCash = 0, prevBank = 0;
    let periodSaleCash = 0, periodSaleBank = 0;
    let periodTransCash = 0, periodTransBank = 0;

    dataList.forEach(row => {
      const rowDate = (row.tx_date || "").slice(0, 10);
      const debit = Number(row.debit || 0);
      const credit = Number(row.credit || 0);
      const cash = Number(row.cash_amount || 0);
      const bank = Number(row.bank_amount || 0);
      const cat = String(row.category || "").trim();

      // ကာလမတိုင်မီ ရက်များ၏ လက်ကျန် (Opening Balance)
      if (rowDate < startDate) {
        if (cash > 0 || bank > 0) {
          if (debit > 0) { prevCash += cash; prevBank += bank; }
          if (credit > 0) { prevCash -= cash; prevBank -= bank; }
        } else {
          if (debit > 0) prevCash += debit;
          if (credit > 0) prevCash -= credit;
        }
      }
      // ရွေးချယ်ထားသော ကာလအတွင်း စာရင်းများ
      else if (rowDate >= startDate && rowDate <= endDate) {
        // ရောင်းရငွေ
        if (cat.includes("ရောင်း") || cat.toLowerCase().includes("sale")) {
          periodSaleCash += cash > 0 ? cash : debit;
          periodSaleBank += bank;
        }
        // စာရင်းပြောင်း / ငွေလွှဲ
        else if (cat.includes("လွှဲ") || cat.toLowerCase().includes("transfer")) {
          periodTransCash += cash > 0 ? cash : credit;
          periodTransBank += bank;
        }
      }
    });

    // ဖော်မြူလာ: ယခင်လက်ကျန် + ရောင်းရငွေ - စာရင်းပြောင်း
    const totalCash = prevCash + periodSaleCash - periodTransCash;
    const totalBank = prevBank + periodSaleBank - periodTransBank;

    // Table 1 သို့ ကိန်းပြည့်သီးသန့် ထည့်သွင်းခြင်း
    this.setElText("db-settle-prev-cash", formatInt(prevCash));
    this.setElText("db-settle-prev-bank", formatInt(prevBank));
    this.setElText("db-settle-sale-cash", formatInt(periodSaleCash));
    this.setElText("db-settle-sale-bank", formatInt(periodSaleBank));
    this.setElText("db-settle-trans-cash", formatInt(periodTransCash));
    this.setElText("db-settle-trans-bank", formatInt(periodTransBank));

    this.setElText("db-settle-total-cash", formatInt(totalCash));
    this.setElText("db-settle-total-bank", formatInt(totalBank));
  },

  // 💡 ၃။ ဇယား (၂) - ပစ္စည်းလက်ကျန် တန်ဖိုးတွက်ချက်ခြင်း (Clean Integers)
  renderStockValuation(garments, yarns) {
    // ကုန်ချော (အထည်)
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

    // ချည်စတို
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

    // Row 1: အထည်တန်ဖိုးများ
    this.setElText("db-stock-garment-cat", formatInt(garmentCatSet.size));
    this.setElText("db-stock-garment-qty", formatInt(garmentQty));
    this.setElText("db-stock-garment-cost", formatInt(garmentCost));
    this.setElText("db-stock-garment-retail", formatInt(garmentRetail));
    this.setElText("db-stock-garment-wholesale", formatInt(garmentWholesale));

    // Row 2: ချည်တန်ဖိုးများ
    this.setElText("db-stock-yarn-cat", formatInt(yarnTypeSet.size));
    this.setElText("db-stock-yarn-qty", formatInt(yarnQty));
    this.setElText("db-stock-yarn-cost", formatInt(yarnCost));
    this.setElText("db-stock-yarn-retail", formatInt(yarnRetail));
    this.setElText("db-stock-yarn-wholesale", formatInt(yarnWholesale));

    // Footer: စုစုပေါင်း တန်ဖိုးများ
    this.setElText("db-stock-total-cat", formatInt(totalCatCount));
    this.setElText("db-stock-total-qty", formatInt(totalQty));
    this.setElText("db-stock-total-cost", formatInt(totalCost));
    this.setElText("db-stock-total-retail", formatInt(totalRetail));
    this.setElText("db-stock-total-wholesale", formatInt(totalWholesale));
  },

  setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
};

// 💡 Global Expose ပြုလုပ်ခြင်း
window.loadDashboardData = function() { window.DashboardEngine.loadDashboardData(); };
window.updateSummaryCards = function(s) { window.DashboardEngine.renderKpiCards(s); };
