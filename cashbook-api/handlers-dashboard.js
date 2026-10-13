/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - DASHBOARD HANDLER (D1 DATABASE)
 * File: handlers-dashboard.js
 * 💡 Features: Refactored with utils.js for DRY Principle & Gender Detection
 *              Strict Category-Based Receivables, Resigned Staff Filter,
 *              Full 17-Table System Counter, Active FY Scoped Analytics,
 *              🚀 OPTIMIZED: 37 Parallelized SQL-Side Fast Queries via Promise.all,
 *              🎯 PERFORMANCE: Switched COUNT(*) to COUNT(id) for faster index scans,
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 * ==============================================================================
 */

import { normalizeFyClean, autoDetectGender } from './utils.js';

/**
 * 💡 Crash-Proof First Number SQL Helper (Handles 'total', 'bal', or dynamic first column)
 */
async function safeFirstNum(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const res = await bound.first();
    if (!res) return 0;
    const val = res.total !== undefined ? res.total : (res.bal !== undefined ? res.bal : Object.values(res)[0]);
    const num = parseFloat(val);
    return isNaN(num) ? 0 : num;
  } catch (e) {
    console.error("[Dashboard] safeFirstNum Error:", e.message);
    return 0;
  }
}

/**
 * 💡 Crash-Proof Count SQL Helper
 */
async function safeCount(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const res = await bound.first();
    if (!res) return 0;
    const val = res.cnt !== undefined ? res.cnt : (res.count !== undefined ? res.count : Object.values(res)[0]);
    const num = parseInt(val, 10);
    return isNaN(num) ? 0 : num;
  } catch (e) {
    console.error("[Dashboard] safeCount Error:", e.message);
    return 0;
  }
}

/**
 * 💡 Crash-Proof Row Collection SQL Helper
 */
async function safeAllRows(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const res = await bound.all();
    return res && res.results ? res.results : [];
  } catch (e) {
    console.error("[Dashboard] safeAllRows Error:", e.message);
    return [];
  }
}

/**
 * 💡 Precision Gender Counter Engine (Powered by utils.js autoDetectGender)
 */
function parseGenderCount(rows = []) {
  let m = 0, f = 0;

  rows.forEach(r => {
    const g = String(r.gender || '').toLowerCase().trim();
    const rawName = String(r.name || r.fyid_name || r.staff_idname || '').trim();
    
    // 💡 နာမည်ရှေ့က [2627-STU-0001] သို့မဟုတ် [FID 001] ကို ရှင်းထုတ်ခြင်း
    const cleanName = rawName.replace(/^\[.*?\]\s*/, '').trim();

    // ၁။ Database ထဲရှိ Gender ကော်လံကို အရင်စစ်ဆေးခြင်း
    if (g === 'male' || g === 'm' || g === 'ကျား' || g.startsWith('mal')) {
      m++;
    } else if (g === 'female' || g === 'f' || g === 'မ' || g.startsWith('fem')) {
      f++;
    } else {
      // ၂။ Gender ကော်လံ လွတ်နေပါက utils.js မှ Auto Detect စနစ်ကို အသုံးပြုခြင်း
      const detectedGender = autoDetectGender(cleanName);
      if (detectedGender === 'Female') {
        f++;
      } else {
        m++;
      }
    }
  });

  return { m, f, total: rows.length };
}

/**
 * 💡 Fetch Dashboard Executive Summary & Analytics Data
 * ⚡ OPTIMIZED: Runs all 37 SQL queries concurrently via Promise.all
 */
export async function getDashboardData(db, body) {
  try {
    const activeFy = normalizeFyClean(body.fy || '2026-2027');
    const fyPrefixed = `FY ${activeFy}`;

    // ----------------------------------------------------
    // ⚡ RUN ALL 37 DASHBOARD QUERIES CONCURRENTLY IN 1 WAVE
    // ----------------------------------------------------
    const [
      // 1. Financials (4 Queries)
      totalIncome,
      offExp,
      kitExp,
      payExp,

      // 2. 17-Table System Entry Counts (17 Queries)
      incCnt, cashCnt, bankCnt, offCnt, kitCnt, payCnt, stmCnt,
      caBankCnt, caCashCnt, caOffCnt, caKitCnt, caPayCnt,
      stuCnt, promoCnt, uniCnt, ftStaffCnt, ptStaffCnt,

      // 3. Current Daily Balances (5 Queries)
      bankBal, cashBal, officeBal, kitchenBal, payrollBal,

      // 4. Liabilities (5 Queries)
      bankLoan, cashLoan, officeLiabilities, hrUnpaidBonus, hrUnpaidFund,

      // 5. Receivables (3 Queries)
      advSnack, advUniform, othersAdv,

      // 6. Demographics Rows (3 Queries)
      stuRows, ftRows, ptRows
    ] = await Promise.all([
      // 💡 1. Financial KPI Totals (Active FY Scoped) - 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)`
      safeFirstNum(db, `SELECT COALESCE(SUM(credit - debit), 0) as total FROM income WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM office WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM kitchen WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM payroll WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),

      // 💡 2. All 17-Table Total Entries & Master Records (OPTIMIZATION: Used COUNT(1) or COUNT(id) for faster scan)
      // A. Main Ledgers (6 Books)
      safeCount(db, `SELECT COUNT(id) as cnt FROM income WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM cash WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM bank WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM office WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM kitchen WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM payroll WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),

      // B. Student Money Ledger (1 Book)
      safeCount(db, `SELECT COUNT(id) as cnt FROM student_money WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),

      // C. Cashier Sub-Ledgers (5 Books)
      safeCount(db, `SELECT COUNT(id) as cnt FROM ca_bank WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM ca_cash WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM ca_office WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM ca_kitchen WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM ca_payroll WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),

      // D. Master Lists, Directory & Inventory (5 Tables)
      safeCount(db, `SELECT COUNT(id) as cnt FROM student WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(id) as cnt FROM promotion WHERE fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeCount(db, `SELECT COUNT(product_id) as cnt FROM uniform_ledger`),
      safeCount(db, `SELECT COUNT(id) as cnt FROM staff_fulltime WHERE status NOT LIKE '%inactive%' AND (resigned_date IS NULL OR resigned_date = '')`),
      safeCount(db, `SELECT COUNT(id) as cnt FROM staff_parttime WHERE status NOT LIKE '%inactive%' AND (resigned_date IS NULL OR resigned_date = '')`),

      // 💡 3. Daily Balances (Current Ledger Net Balances)
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM bank"),
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM cash"),
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM office"),
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM kitchen"),
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM payroll"),

      // 💡 4. Liabilities (ပေးရန်ကြွေးမြီ စာရင်းများ)
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM bank WHERE category LIKE '%loan%'"),
      safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM cash WHERE category LIKE '%loan%'"),
      safeFirstNum(db, "SELECT COALESCE(SUM(liabilities), 0) as total FROM office"),
      safeFirstNum(db, "SELECT COALESCE(SUM(unpaid_bonus), 0) as total FROM staff_fulltime"),
      safeFirstNum(db, "SELECT COALESCE(SUM(unpaid_fund), 0) as total FROM staff_fulltime"),

      // 💡 5. Receivables (Strict Category-Based Calculation)
      safeFirstNum(db, `SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE category LIKE '%snack%'`),
      safeFirstNum(db, `SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE category LIKE '%unif%'`),
      safeFirstNum(db, `SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE (category LIKE '%adv%' OR category LIKE '%ကြိုတင်%') AND category NOT LIKE '%snack%' AND category NOT LIKE '%unif%'`),

      // 💡 6. Active Demographic Info Rows (Excludes Resigned/Transferred)
      safeAllRows(db, `SELECT gender, name, fyid_name FROM student WHERE status NOT LIKE '%inactive%' AND (transfer_date IS NULL OR transfer_date = '') AND fy IN (?, ?)`, [activeFy, fyPrefixed]),
      safeAllRows(db, `SELECT gender, name, staff_idname FROM staff_fulltime WHERE status NOT LIKE '%inactive%' AND (resigned_date IS NULL OR resigned_date = '')`),
      safeAllRows(db, `SELECT gender, name, staff_idname FROM staff_parttime WHERE status NOT LIKE '%inactive%' AND (resigned_date IS NULL OR resigned_date = '')`)
    ]);

    // Financial Computations
    const totalExpense = offExp + kitExp + payExp;
    const netProfit = totalIncome - totalExpense;

    // Grand Total Records across all 17 tables
    const totalEntries = incCnt + cashCnt + bankCnt + offCnt + kitCnt + payCnt + stmCnt +
                         caBankCnt + caCashCnt + caOffCnt + caKitCnt + caPayCnt +
                         stuCnt + promoCnt + uniCnt + ftStaffCnt + ptStaffCnt;

    // Demographic Counters
    const stuDemo = parseGenderCount(stuRows);
    const ftDemo = parseGenderCount(ftRows);
    const ptDemo = parseGenderCount(ptRows);

    return {
      success: true,
      fy: activeFy,
      data: {
        financials: {
          totalIncome,
          totalExpense,
          netProfit,
          totalEntries
        },
        balances: {
          bank: bankBal,
          cash: cashBal,
          office: officeBal,
          kitchen: kitchenBal,
          payroll: payrollBal,
          total: bankBal + cashBal + officeBal + kitchenBal + payrollBal
        },
        liabilities: {
          bankLoan,
          cashLoan,
          officeLiabilities,
          hrBonus: hrUnpaidBonus,
          hrFund: hrUnpaidFund,
          total: bankLoan + cashLoan + officeLiabilities + hrUnpaidBonus + hrUnpaidFund
        },
        receivables: {
          advanceSnack: advSnack,
          advanceUniform: advUniform,
          otherAdvance: othersAdv,
          total: advSnack + advUniform + othersAdv
        },
        demographics: {
          students: { male: stuDemo.m, female: stuDemo.f, total: stuDemo.total },
          fullTimeStaff: { male: ftDemo.m, female: ftDemo.f, total: ftDemo.total },
          partTimeStaff: { male: ptDemo.m, female: ptDemo.f, total: ptDemo.total },
          totalActive: stuDemo.total + ftDemo.total + ptDemo.total,
          totalMale: stuDemo.m + ftDemo.m + ptDemo.m,
          totalFemale: stuDemo.f + ftDemo.f + ptDemo.f
        }
      }
    };
  } catch (err) {
    console.error("Error in getDashboardData:", err);
    return { success: false, message: err.message };
  }
}
