/** 
 * ==============================================================================
 * GOLDEN ERP SYSTEM - INPUT VALIDATION & SANITIZATION ENGINE 
 * File: validation.js (Location: cashbook-api/validation.js)     
 * 💡 Features: 🛡️ Strict Prototype Pollution Immunity & Recursion Depth Guard,
 *              🎯 Real Calendar Date Validation (Zero 2026-02-31 JS Rollover Bug),
 *              Accounting Parentheses (1000) & Comma-Separated Number Support,
 *              Smarter Formula Injection Defense (Preserves Phone +95 & Bullet - Text),
 *              ⚡ FIX: Income & Student Money Description Bypass (Remark is optional),
 *              🚀 ARCHITECT FIX: Array Payload Crash Protection & Exact Float Rounding
 * ==============================================================================
 */

// 🛡️ Fields exempt from formula injection sanitization
const EXEMPT_FORMULA_FIELDS = new Set([
  'excelBase64',
  'token',
  'authToken',
  'password',
  'password_hash',
  'uniqueId',
  'uniqueid',
  'csvText',
  'action'
]);

/**
 * 💡 SANITIZE FORMULA INJECTION ATTACKS FOR SPREADSHEET EXPORTS
 * Escapes special leading characters (=, +, -, @, \t, \r) to prevent formula execution exploits.
 * Preserves pure numbers, accounting formats e.g. (1,000), phone numbers (+95...), and bullet points.
 */
export function sanitizeFormulaInput(str) {
  if (typeof str !== 'string') return str;
  const trimmed = str.trim();

  if (!trimmed) return str;

  // 🛡️ 1. Pure numbers & Accounting Parentheses (e.g., "-1000", "+50", "125.50", "(1,500.00)")
  let cleanNumStr = trimmed.replace(/,/g, '');
  if (cleanNumStr.startsWith('(') && cleanNumStr.endsWith(')')) {
    cleanNumStr = '-' + cleanNumStr.slice(1, -1).trim();
  }
  if (!isNaN(Number(cleanNumStr)) && Number.isFinite(Number(cleanNumStr))) {
    return str;
  }

  // 🛡️ 2. Phone numbers with country codes (e.g. "+95 9 12345678", "+1-800-...")
  if (/^\+[\d\s\-()]{6,25}$/.test(trimmed)) {
    return str;
  }

  // 🛡️ 3. Legitimate text bullet points (e.g. "- Office stationery", "+ Extra bonus")
  if (/^[\-\+]\s+[^\=\+\-\@]/.test(trimmed)) {
    return str;
  }

  // 🛡️ 4. Prevent double single-quote escaping if already escaped
  if (trimmed.startsWith("'")) {
    return str;
  }

  // 🛡️ 5. Escape formula execution triggers with a leading single-quote
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return str;
}

/**
 * 💡 RECURSIVELY SANITIZE ALL STRING FIELDS IN AN OBJECT (Supports Arrays)
 * Includes Prototype Pollution Defense & Maximum Depth Guard (Depth <= 6)
 */
export function sanitizeObjectFormulas(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return obj;

  // 🚀 ARCHITECT FIX: Support Arrays safely
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = sanitizeFormulaInput(obj[i]);
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        sanitizeObjectFormulas(obj[i], depth + 1);
      }
    }
    return obj;
  }

  for (const key of Object.keys(obj)) {
    // 🔒 Prototype Pollution Defense
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete obj[key];
      continue;
    }

    // Skip binary payloads, Base64 files, tokens, and passwords
    if (EXEMPT_FORMULA_FIELDS.has(key)) {
      continue;
    }

    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeFormulaInput(obj[key]);
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      sanitizeObjectFormulas(obj[key], depth + 1);
    }
  }
  return obj;
}

/**
 * 💡 Strict Real-Calendar Date Validation (YYYY-MM-DD)
 * 🎯 FIX: Prevents JavaScript date rollover (e.g., Feb 31 becoming March 3)
 */
export function validateDateStr(dateStr, fieldName = "Date") {
  if (!dateStr || typeof dateStr !== "string") {
    return { valid: false, message: `${fieldName} ဖြည့်သွင်းရန် လိုအပ်ပါသည်။` };
  }

  const cleanDateStr = dateStr.trim().split('T')[0];

  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(cleanDateStr)) {
    return { valid: false, message: `${fieldName} ၏ ပုံစံမှာ YYYY-MM-DD ဖြစ်ရပါမည်။ (ဥပမာ - 2026-07-26)` };
  }

  const parts = cleanDateStr.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1; // 0-based month
  const d = parseInt(parts[2], 10);

  const dateObj = new Date(Date.UTC(y, m, d));

  // 🎯 STRICT CALENDAR CHECK: Check if rollover occurred
  if (
    isNaN(dateObj.getTime()) ||
    dateObj.getUTCFullYear() !== y ||
    dateObj.getUTCMonth() !== m ||
    dateObj.getUTCDate() !== d
  ) {
    return { valid: false, message: `မမှန်ကန်သော ပြက္ခဒိန်ရက်စွဲ (${cleanDateStr}) ဖြစ်နေပါသည်။` };
  }

  return { valid: true, cleanDate: cleanDateStr };
}

/**
 * 💡 Validate Currency / Numeric Amount (Comma-Safe & Accounting Parentheses Support)
 */
export function validateAmount(val, fieldName = "Amount", allowNegative = false) {
  if (val === undefined || val === null || val === "") {
    return { valid: true, value: 0 };
  }

  let cleanStr = String(val).trim().replace(/,/g, '');

  // 🎯 ACCOUNTING FORMAT SUPPORT: (1000) -> -1000
  if (cleanStr.startsWith('(') && cleanStr.endsWith(')')) {
    cleanStr = '-' + cleanStr.slice(1, -1).trim();
  }

  const num = Number(cleanStr);

  if (!Number.isFinite(num)) {
    return { valid: false, message: `${fieldName} တွင် ဂဏန်းသန့်သန့်သာ ရေးသွင်းရပါမည်။` };
  }

  if (!allowNegative && num < 0) {
    return { valid: false, message: `${fieldName} သည် ၀ ထက် ငယ်၍ မရပါ။` };
  }

  // 🚀 ARCHITECT FIX: Strict IEEE 754 float rounding to 2 decimals to prevent False Positives in D1 Recalc Engine
  const exactValue = Math.round((num + Number.EPSILON) * 100) / 100;

  return { valid: true, value: exactValue };
}

/**
 * 💡 Validate Required Text Input with Length & Formula Injection Sanitization
 */
export function validateRequiredText(str, fieldName = "Field", minLen = 1, maxLen = 500) {
  const cleanStr = String(str || "").trim();

  if (!cleanStr || cleanStr.length < minLen) {
    return { valid: false, message: `${fieldName} ဖြည့်သွင်းရန် လိုအပ်ပါသည်။` };
  }

  if (cleanStr.length > maxLen) {
    return { valid: false, message: `${fieldName} သည် စာလုံးရေ ${maxLen} လုံးထက် မကျော်လွန်ရပါ။` };
  }

  const safeValue = sanitizeFormulaInput(cleanStr);
  return { valid: true, cleanValue: safeValue };
}

/**
 * 💡 Validate Standard Ledger Payload (Bank, Cash, Office, Kitchen, Cashier)
 * ⚡ NOTE: Income and StudentMoney are handled separately because they use optional 'remark' instead of 'description'.
 */
export function validateLedgerPayload(body = {}) {
  const dateCheck = validateDateStr(body.date, "Transaction Date (ရက်စွဲ)");
  if (!dateCheck.valid) return dateCheck;

  const descCheck = validateRequiredText(body.description, "Description (အကြောင်းအရာ)", 1, 1000);
  if (!descCheck.valid) return descCheck;

  const debitCheck = validateAmount(body.debit, "Debit Amount (ဝင်ငွေ)", false);
  if (!debitCheck.valid) return debitCheck;

  const creditCheck = validateAmount(body.credit, "Credit Amount (ထွက်ငွေ)", false);
  if (!creditCheck.valid) return creditCheck;

  // Liabilities support negative and (1000) format
  if (body.liabilities !== undefined && body.liabilities !== null && body.liabilities !== "") {
    const liabCheck = validateAmount(body.liabilities, "Liabilities (ပေးရန်ကျန်ငွေ)", true);
    if (!liabCheck.valid) return liabCheck;
  }

  return { valid: true };
}

/**
 * 💡 Validate Student Profile Body Payload
 */
export function validateStudentPayload(body = {}) {
  const nameCheck = validateRequiredText(body.name, "Student Name (ကျောင်းသားအမည်)", 1, 150);
  if (!nameCheck.valid) return nameCheck;

  if (body.date) {
    const dateCheck = validateDateStr(body.date, "Registration Date (စာရင်းသွင်းရက်စွဲ)");
    if (!dateCheck.valid) return dateCheck;
  }

  if (body.transferDate || body.transfer_date) {
    const transCheck = validateDateStr(body.transferDate || body.transfer_date, "Transfer Date (နုတ်ထွက်ရက်စွဲ)");
    if (!transCheck.valid) return transCheck;
  }

  return { valid: true };
}

/**
 * 💡 Validate Staff Profile Body Payload
 */
export function validateStaffPayload(body = {}) {
  const nameCheck = validateRequiredText(body.name, "Staff Name (ဝန်ထမ်းအမည်)", 1, 150);
  if (!nameCheck.valid) return nameCheck;

  if (body.joinDate || body.join_date) {
    const joinCheck = validateDateStr(body.joinDate || body.join_date, "Join Date (စတင်ဝင်ရောက်သည့်ရက်)");
    if (!joinCheck.valid) return joinCheck;
  }

  if (body.resignedDate || body.resigned_date) {
    const resCheck = validateDateStr(body.resignedDate || body.resigned_date, "Resigned Date (နုတ်ထွက်ရက်)");
    if (!resCheck.valid) return resCheck;
  }

  return { valid: true };
}

/**
 * 💡 Validate Uniform Inventory Payload
 */
export function validateUniformPayload(body = {}) {
  const nameCheck = validateRequiredText(body.productName || body.product_name, "Product Name (ပစ္စည်းအမည်)", 1, 150);
  if (!nameCheck.valid) return nameCheck;

  const stockCheck = validateAmount(body.openingStock ?? body.opening_stock, "Opening Stock (အဖွင့်လက်ကျန်)", false);
  if (!stockCheck.valid) return stockCheck;

  const priceCheck = validateAmount(body.unitPrice ?? body.unit_price, "Unit Price (ဝယ်ရင်းဈေး)", false);
  if (!priceCheck.valid) return priceCheck;

  return { valid: true };
}

/**
 * 💡 UNIFIED SERVER-SIDE INPUT VALIDATOR & FORMULA INJECTION SANITIZER
 * Invoked directly by worker.js on all mutating POST/PUT/DELETE requests.
 */
export function validateLedgerInput(body = {}) {
  if (!body || typeof body !== 'object') {
    return { success: false, message: "Request Payload မမှန်ကန်ပါ။" };
  }

  // 🛡️ 1. Sanitize string fields against Formula Injection & Prototype Pollution
  sanitizeObjectFormulas(body);

  const action = String(body.action || "").trim();

  // 🛡️ 2. Standard Ledger Mutations Validation (Bank, Cash, Office, Kitchen, Cashier)
  // ⚡ FIX: Income နှင့် StudentMoney တွင် 'Description' အစား 'Remark' ကိုသုံးသဖြင့် ဤနေရာမှ ဖြုတ်ထုတ်လိုက်ပါသည်
  const isLedgerMutation = /^(save|update)(BankCash|Expense|Cashier)Entry$/i.test(action);
  if (isLedgerMutation) {
    const ledgerCheck = validateLedgerPayload(body);
    if (!ledgerCheck.valid) {
      return { success: false, message: ledgerCheck.message };
    }
  }

  // 🛡️ 3. Generic Date Validations if present
  if (body.date && String(body.date).trim() !== "") {
    const dateCheck = validateDateStr(body.date, "Date (ရက်စွဲ)");
    if (!dateCheck.valid) return { success: false, message: dateCheck.message };
  }

  if (body.effDate && String(body.effDate).trim() !== "") {
    const effDateCheck = validateDateStr(body.effDate, "Effect Date (ကျသင့်လရက်စွဲ)");
    if (!effDateCheck.valid) return { success: false, message: effDateCheck.message };
  }

  // 🛡️ 4. Income & Student Money Custom Validation (Description-free)
  const isIncomeOrMoney = /^(save|update)(Income|StudentMoney)Entry$/i.test(action);
  if (isIncomeOrMoney) {
    if (body.debit !== undefined && body.debit !== null && body.debit !== "") {
      const debCheck = validateAmount(body.debit, "Debit Amount (ဝင်ငွေ/ပြန်အမ်းငွေ)", false);
      if (!debCheck.valid) return { success: false, message: debCheck.message };
    }
    if (body.credit !== undefined && body.credit !== null && body.credit !== "") {
      const credCheck = validateAmount(body.credit, "Credit Amount (ထွက်ငွေ/ပေးချေငွေ)", false);
      if (!credCheck.valid) return { success: false, message: credCheck.message };
    }
  }

  // 🛡️ 5. Student Payload Validation
  if (action.includes("Student") && (action.startsWith("save") || action.startsWith("update")) && !action.includes("Money")) {
    const stuCheck = validateStudentPayload(body);
    if (!stuCheck.valid) return { success: false, message: stuCheck.message };
  }

  // 🛡️ 6. Staff Payload Validation
  if (action.includes("Staff") && (action.startsWith("save") || action.startsWith("update"))) {
    const staffCheck = validateStaffPayload(body);
    if (!staffCheck.valid) return { success: false, message: staffCheck.message };
  }

  // 🛡️ 7. Uniform Inventory Payload Validation
  if (action.includes("Uniform") && (action.startsWith("save") || action.startsWith("update"))) {
    const uniCheck = validateUniformPayload(body);
    if (!uniCheck.valid) return { success: false, message: uniCheck.message };
  }

  return { success: true };
}