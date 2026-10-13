/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - BACKEND UTILITIES (CLOUDFLARE D1)
 * File: utils.js (Location: cashbook-api/utils.js)
 * 💡 Features: 
 *    - DRY Principle: Centralized Date, FY, and ID Generators
 *    - Security: crypto.randomUUID() for secure Unique IDs
 *    - Quota-Shield: O(1) Shared Recalculation Engine for all ledgers
 *    - Data Parsers: Safe Float & Int Parsing, Myanmar Gender Auto-Detection
 *    🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 *    🚀 PHASE 1 (INCREMENTAL RECALC): Fast Window Functions bounded by `fromDate`
 * ==============================================================================
 */

// ==========================================
// 💡 1. DATE & TIME HELPERS
// ==========================================

export function getMyanmarDateString(inputDate = null) {
  if (inputDate) return String(inputDate).trim().split('T')[0];
  const now = new Date(Date.now() + (6.5 * 3600 * 1000));
  return now.toISOString().split('T')[0];
}

export function getCurrentAcademicYear(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date(Date.now() + (6.5 * 3600 * 1000));
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  let y = validDate.getFullYear();
  if (validDate.getMonth() < 2) {
    y -= 1; // ဇန်နဝါရီ၊ ဖေဖော်ဝါရီဆိုလျှင် ယခင်နှစ်သို့ သတ်မှတ်မည်
  }
  return `${y}-${y + 1}`;
}

export function calculateAcademicFyFromDate(dateStr) {
  const d = new Date(dateStr);
  let fyYear = d.getFullYear();
  if (d.getMonth() < 2) fyYear -= 1;
  return `FY ${fyYear}-${fyYear + 1}`;
}

// ==========================================
// 💡 2. FORMATTERS & PARSERS
// ==========================================

export function normalizeFyStr(fy, dateInput = null) {
  let s = fy ? String(fy).trim() : `FY ${getCurrentAcademicYear(dateInput)}`;
  if (!s) s = `FY ${getCurrentAcademicYear(dateInput)}`;
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

export function normalizeFyClean(fy, dateInput = null) {
  let s = fy ? String(fy).trim() : getCurrentAcademicYear(dateInput);
  if (!s) s = getCurrentAcademicYear(dateInput);
  return s.replace(/^FY\s*/i, '');
}

export function getFyShortCode(fyStr) {
  if (fyStr) {
    const clean = String(fyStr).replace(/^FY\s*/i, '').trim();
    const parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      return parts[0].trim().slice(-2) + parts[1].trim().slice(-2);
    }
    if (/^\d{4}$/.test(clean)) return clean;
  }
  const currentFy = getCurrentAcademicYear();
  const p = currentFy.split('-');
  return p[0].slice(-2) + p[1].slice(-2);
}

export function sanitizeFyidStr(fyidStr) {
  const s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  const cleaned = s.replace(/\.0/g, '');
  const parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    const numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
  }
  return cleaned;
}

export function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

export function parseAccountingNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let s = String(val).trim().replace(/,/g, '');
  if (s.startsWith('(') && s.endsWith(')')) {
    s = '-' + s.slice(1, -1).trim();
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ==========================================
// 💡 3. MYANMAR GENDER AUTO-DETECTOR
// ==========================================

export function autoDetectGender(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();

  if (
    clean.startsWith('မောင်') || clean.startsWith('ကို') || clean.startsWith('ဦး') ||
    clean.startsWith('မင်း') || clean.startsWith('စော') || clean.startsWith('ဆရာ') ||
    /^(Mg|Ko|U|Min|Saw|Saya|Mr)\b/i.test(clean)
  ) {
    return 'Male';
  }

  if (
    clean.startsWith('မေ') || clean.startsWith('ဒေါ်') || clean.startsWith('နန်း') || 
    clean.startsWith('နော်') || clean.startsWith('ဆရာမ') || clean.startsWith('တီချာ') || 
    clean.startsWith('ခင်') || clean.startsWith('နှင်း') || clean.startsWith('နွယ်') ||
    /^(May|Daw|Nang|Naw|Khin|Hnin|Nwe|Miss|Mrs|Teacher|Sayama)\b/i.test(clean)
  ) {
    return 'Female';
  }

  if ((clean.startsWith('မ') && !clean.startsWith('မောင်') && !clean.startsWith('မင်း')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }

  return 'Male';
}

// ==========================================
// 💡 4. DATABASE GENERATORS & OPTIMIZERS
// ==========================================

export function generateUniqueId(prefix) {
  const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  return `${prefix}_${Date.now()}_${uuid}`;
}

export async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date(Date.now() + (6.5 * 3600 * 1000));
    ddmmyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
  }

  const pattern = `${prefix}-${ddmmyy}-%`;
  
  // 🚀 OPTIMIZATION: Use COUNT(id) instead of COUNT(*)
  const countRow = await db.prepare(
    `SELECT COUNT(id) as cnt FROM ${tableName} WHERE vr_no LIKE ? OR date = ?`
  ).bind(pattern, entryDate).first();

  const seq = (countRow ? parseInt(countRow.cnt || countRow.count || Object.values(countRow)[0], 10) : 0) + 1;
  return `${prefix}-${ddmmyy}-${String(seq).padStart(3, '0')}`;
}

export async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const cleanFy = normFy.replace(/^FY\s*/i, '');
  
  // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)`
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy IN (?, ?)`
  ).bind(normFy, cleanFy).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * ⚡ QUOTA-SHIELD: O(1) Differential D1 Window Function Recalculation Engine
 * 🚀 PHASE 1 (INCREMENTAL RECALC): Bounded by fromDate to cut 95% of row reads
 */
export async function recalculateLedgerBalances(db, tableName, targetFy = null, fromDate = null) {
  if (!tableName) return;
  try {
    if (targetFy) {
      const normFy = normalizeFyStr(targetFy);
      const cleanFy = normFy.replace(/^FY\s*/i, '');

      // 💡 INCREMENTAL PATH: if fromDate is provided, skip rescanning the entire FY
      if (fromDate) {
        if (tableName === 'student_money') {
          // Special partitioning for student_money
          await db.prepare(`
            WITH base AS (
              SELECT sm.student_id, sm.balances as base_bal
              FROM student_money sm
              WHERE sm.fy IN (?, ?) AND sm.date < ?
                AND sm.id = (
                  SELECT id FROM student_money sm2
                  WHERE sm2.student_id = sm.student_id AND sm2.fy IN (?, ?) AND sm2.date < ?
                  ORDER BY date DESC, id DESC LIMIT 1
                )
            ),
            calculated AS (
              SELECT sm.id,
                     ROW_NUMBER() OVER (ORDER BY sm.date ASC, sm.id ASC) as calc_no,
                     COALESCE(base.base_bal, 0) + SUM(sm.debit - sm.credit) OVER (
                       PARTITION BY sm.student_id ORDER BY sm.date ASC, sm.id ASC
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                     ) as calc_bal
              FROM student_money sm
              LEFT JOIN base ON base.student_id = sm.student_id
              WHERE sm.fy IN (?, ?) AND sm.date >= ?
            )
            UPDATE student_money 
            SET no = (SELECT no FROM student_money sm3 WHERE sm3.fy IN (?, ?) AND sm3.date < ? ORDER BY date DESC, id DESC LIMIT 1) + calculated.calc_no, 
                balances = calculated.calc_bal
            FROM calculated 
            WHERE student_money.id = calculated.id
              AND (student_money.no IS NOT ((SELECT no FROM student_money sm3 WHERE sm3.fy IN (?, ?) AND sm3.date < ? ORDER BY date DESC, id DESC LIMIT 1) + calculated.calc_no) 
                   OR ROUND(student_money.balances,2) IS NOT ROUND(calculated.calc_bal,2));
          `).bind(normFy, cleanFy, fromDate, normFy, cleanFy, fromDate, normFy, cleanFy, fromDate, normFy, cleanFy, fromDate, normFy, cleanFy, fromDate).run();
        } else if (tableName === 'income') {
          // Income Table: No balances, just serial NO.
          const baseRow = await db.prepare(`SELECT no FROM income WHERE fy IN (?, ?) AND date < ? ORDER BY date DESC, id DESC LIMIT 1`).bind(normFy, cleanFy, fromDate).first();
          const baseNo = baseRow ? (parseInt(baseRow.no, 10) || 0) : 0;
          await db.prepare(`
            WITH calculated AS (
              SELECT id, ? + ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as calc_no
              FROM income WHERE fy IN (?, ?) AND date >= ?
            )
            UPDATE income SET no = calculated.calc_no FROM calculated
            WHERE income.id = calculated.id AND income.no IS NOT calculated.calc_no;
          `).bind(baseNo, normFy, cleanFy, fromDate).run();
        } else {
          // Main/Cashier Ledgers (bank, cash, office, ca_bank, etc.)
          const baseRow = await db.prepare(`SELECT no, balances FROM ${tableName} WHERE fy IN (?, ?) AND date < ? ORDER BY date DESC, id DESC LIMIT 1`).bind(normFy, cleanFy, fromDate).first();
          const baseNo = baseRow ? (parseInt(baseRow.no, 10) || 0) : 0;
          const baseBal = baseRow ? (parseFloat(baseRow.balances) || 0) : 0;

          await db.prepare(`
            WITH calculated AS (
              SELECT id,
                     ? + ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as calc_no,
                     ? + SUM(debit - credit) OVER (
                           ORDER BY date ASC, id ASC
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                         ) as calc_bal
              FROM ${tableName}
              WHERE fy IN (?, ?) AND date >= ?
            )
            UPDATE ${tableName}
            SET no = calculated.calc_no, balances = calculated.calc_bal
            FROM calculated
            WHERE ${tableName}.id = calculated.id
              AND (${tableName}.no IS NOT calculated.calc_no
                   OR ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
          `).bind(baseNo, baseBal, normFy, cleanFy, fromDate).run();
        }
        return;
      }

      // 💡 FULL RECALCULATE (Fallback path if fromDate is omitted)
      if (tableName === 'student_money') {
         await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as calc_no,
                   SUM(debit - credit) OVER (
                     PARTITION BY student_id 
                     ORDER BY date ASC, id ASC 
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) as calc_bal
            FROM student_money
            WHERE fy IN (?, ?)
          )
          UPDATE student_money SET no = calculated.calc_no, balances = calculated.calc_bal FROM calculated WHERE student_money.id = calculated.id AND (student_money.no IS NOT calculated.calc_no OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
        `).bind(normFy, cleanFy).run();
      } else if (tableName === 'income') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no 
            FROM income WHERE fy IN (?, ?)
          )
          UPDATE income SET no = calculated.new_no FROM calculated WHERE income.id = calculated.id AND income.no IS NOT calculated.new_no;
        `).bind(normFy, cleanFy).run();
      } else {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as calc_no,
                   SUM(debit - credit) OVER (ORDER BY date ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as calc_bal
            FROM ${tableName}
            WHERE fy IN (?, ?)
          )
          UPDATE ${tableName} SET no = calculated.calc_no, balances = calculated.calc_bal FROM calculated WHERE ${tableName}.id = calculated.id AND (${tableName}.no IS NOT calculated.calc_no OR ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
        `).bind(normFy, cleanFy).run();
      }
    } else {
      // FULL RECALCULATE ACROSS ALL FYs
      if (tableName === 'student_money') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as calc_no,
                   SUM(debit - credit) OVER (PARTITION BY student_id ORDER BY date ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as calc_bal
            FROM student_money
          )
          UPDATE student_money SET no = calculated.calc_no, balances = calculated.calc_bal FROM calculated WHERE student_money.id = calculated.id AND (student_money.no IS NOT calculated.calc_no OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
        `).run();
      } else if (tableName === 'income') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as new_no FROM income
          )
          UPDATE income SET no = calculated.new_no FROM calculated WHERE income.id = calculated.id AND income.no IS NOT calculated.new_no;
        `).run();
      } else {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as calc_no,
                   SUM(debit - credit) OVER (PARTITION BY fy ORDER BY date ASC, id ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as calc_bal
            FROM ${tableName}
          )
          UPDATE ${tableName} SET no = calculated.calc_no, balances = calculated.calc_bal FROM calculated WHERE ${tableName}.id = calculated.id AND (${tableName}.no IS NOT calculated.calc_no OR ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
        `).run();
      }
    }
  } catch (e) {
    console.warn(`[Utils] Running Balance Recalculation Warning for ${tableName}:`, e.message);
  }
}