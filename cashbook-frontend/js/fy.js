/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - FINANCIAL YEAR (FY) ENGINE
 * File: cashbook-frontend/js/fy.js
 * Standard: International Calendar Fiscal Year (Jan 1 - Dec 31)
 * Architecture: Singleton Module, Defensive Input Handling, Pure Functions
 * ==============================================================================
 */

"use strict";

const FY = (function () {
  // 💡 Default Configuration (1 = January, 12 = December)
  const CONFIG = {
    START_MONTH: 1, // January
    END_MONTH: 12,  // December
    PREFIX: "FY ",
  };

  /**
   * Helper: Date Object အဖြစ် လုံခြုံစွာ ပြောင်းလဲပေးခြင်း
   * @param {Date|string|number} input 
   * @returns {Date}
   */
  function toSafeDate(input) {
    if (!input) return new Date();
    if (input instanceof Date && !isNaN(input.getTime())) return new Date(input.getTime());
    const parsed = new Date(input);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  /**
   * Helper: "YYYY-MM-DD" Format ပြုလုပ်ပေးခြင်း
   * @param {Date} date 
   * @returns {string}
   */
  function formatIsoDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return {
    /**
     * ၁။ လက်ရှိ စာရင်းနှစ်ကို ရယူခြင်း (ဥပမာ - "FY 2026" သို့မဟုတ် 2026)
     * @param {'label'|'number'} format 
     * @returns {string|number}
     */
    getCurrentFY(format = "label") {
      const year = new Date().getFullYear();
      return format === "number" ? year : `${CONFIG.PREFIX}${year}`;
    },

    /**
     * ၂။ ပေးထားသော ရက်စွဲမှ စာရင်းနှစ်ကို တွက်ယူခြင်း
     * @param {Date|string} dateInput 
     * @returns {string} e.g. "FY 2026"
     */
    getFYFromDate(dateInput) {
      const date = toSafeDate(dateInput);
      return `${CONFIG.PREFIX}${date.getFullYear()}`;
    },

    /**
     * ၃။ စာရင်းနှစ်တစ်ခု၏ အစရက်နှင့် အဆုံးရက် (Date Range) ကို ရယူခြင်း
     * @param {string|number} fyInput e.g. "FY 2026" သို့မဟုတ် 2026
     * @returns {{ startDate: string, endDate: string, startTimestamp: number, endTimestamp: number }}
     */
    getDateRange(fyInput) {
      let yearNumber;
      if (typeof fyInput === "number") {
        yearNumber = fyInput;
      } else {
        const extracted = String(fyInput || "").match(/\d{4}/);
        yearNumber = extracted ? parseInt(extracted[0], 10) : new Date().getFullYear();
      }

      const start = new Date(yearNumber, 0, 1, 0, 0, 0, 0);       // Jan 1, 00:00:00
      const end = new Date(yearNumber, 11, 31, 23, 59, 59, 999);  // Dec 31, 23:59:59

      return {
        startDate: formatIsoDate(start),
        endDate: formatIsoDate(end),
        startTimestamp: start.getTime(),
        endTimestamp: end.getTime(),
        year: yearNumber,
        label: `${CONFIG.PREFIX}${yearNumber}`
      };
    },

    /**
     * ၄။ ရက်စွဲတစ်ခုသည် သတ်မှတ်ထားသော စာရင်းနှစ်အတွင်း ကျရောက်ခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
     * @param {Date|string} targetDate 
     * @param {string|number} targetFY 
     * @returns {boolean}
     */
    isDateInFY(targetDate, targetFY) {
      const date = toSafeDate(targetDate);
      const range = this.getDateRange(targetFY);
      const time = date.getTime();
      return time >= range.startTimestamp && time <= range.endTimestamp;
    },

    /**
     * ၅။ သုံးလပတ် (Quarter) စာရင်း အသေးစိတ် ရယူခြင်း
     * @param {Date|string} dateInput 
     * @returns {{ quarter: string, label: string, startDate: string, endDate: string }}
     */
    getQuarter(dateInput) {
      const date = toSafeDate(dateInput);
      const month = date.getMonth(); // 0 - 11
      const year = date.getFullYear();

      let q = 1, startM = 0, endM = 2, endD = 31;
      if (month >= 3 && month <= 5) { q = 2; startM = 3; endM = 5; endD = 30; }
      else if (month >= 6 && month <= 8) { q = 3; startM = 6; endM = 8; endD = 30; }
      else if (month >= 9 && month <= 11) { q = 4; startM = 9; endM = 11; endD = 31; }

      return {
        quarter: `Q${q}`,
        label: `${CONFIG.PREFIX}${year} Q${q}`,
        startDate: formatIsoDate(new Date(year, startM, 1)),
        endDate: formatIsoDate(new Date(year, endM, endD)),
      };
    },

    /**
     * ၆။ Report Dropdown Filter များအတွက် ရွေးချယ်နိုင်သော စာရင်းနှစ်များ ထုတ်ပေးခြင်း
     * @param {number} pastYears 
     * @param {number} futureYears 
     * @returns {string[]} e.g. ["FY 2024", "FY 2025", "FY 2026", "FY 2027"]
     */
    getFYList(pastYears = 2, futureYears = 1) {
      const currentYear = new Date().getFullYear();
      const list = [];
      for (let y = currentYear - pastYears; y <= currentYear + futureYears; y++) {
        list.push(`${CONFIG.PREFIX}${y}`);
      }
      return list;
    },

    /**
     * ၇။ Header အပေါ်ဘားရှိ Metadata (အချိန်၊ ရက်စွဲ၊ User) ကို Real-Time တိုက်ရိုက် မွမ်းမံခြင်း
     */
    startLiveTicker() {
      const metadataEl = document.getElementById("live-metadata");
      if (!metadataEl) return;

      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

      const update = () => {
        const now = new Date();
        const fyLabel = this.getCurrentFY("label");
        const day = days[now.getDay()];

        // 12-Hour Format (hh:mm A)
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, "0");
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12;
        hours = hours ? String(hours).padStart(2, "0") : "12";
        const timeStr = `${hours}:${minutes} ${ampm}`;

        // Get logged in user name
        let userName = "Admin";
        try {
          const storedUser = localStorage.getItem("golden_user");
          if (storedUser) {
            const parsed = JSON.parse(storedUser);
            userName = parsed.name || parsed.username || "Admin";
          }
        } catch (e) {}

        metadataEl.textContent = `${fyLabel} | ${day} | ${timeStr} | User: ${userName}`;
      };

      update();
      // စက္ကန့် ၃၀ တိုင်း တစ်ကြိမ် အချိန်ကို အလိုအလျောက် Update လုပ်မည်
      setInterval(update, 30000);
    }
  };
})();

// Global Window တွင် အဆင်သင့် ခေါ်သုံးနိုင်ရန် သတ်မှတ်ခြင်း
window.FY = FY;

// DOM Load ပြီးသည်နှင့် Header Ticker အလိုအလျောက် စတင်လည်ပတ်မည်
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    FY.startLiveTicker();
  });
}
