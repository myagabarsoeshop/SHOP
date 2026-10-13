/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CLOUDFLARE WORKER MAIN ROUTER (D1 MODULAR EDITION)
 * File: worker.js (Location: cashbook-api/worker.js)
 * 💡 Features: 🛡️ Strict Domain-Specific RBAC Matrix (Zero Privilege Escalation),
 *              ⚡ QUOTA-SHIELD: O(1) Differential Global Recalculator Engine,
 *              🎯 Floating Point Safe Comparison (ROUND to 2 Decimals),
 *              Fail-Closed WebCrypto JWT & PBKDF2 Password Security (100k Iterations),
 *              Server-Side Brute-Force Lockout Defense,
 *              🛡️ Standalone Zero-Dependency D1 Audit Logger (No Missing Module Error),
 *              🎯 Phase 3: Added Scheduled Cron Trigger for Auto Audit Logs Cleanup
 *              🚀 PHASE 1 (INCREMENTAL RECALC): Integrated Base Row calculation
 * ==============================================================================
 */

import * as StudentHandlers from './handlers-student.js';
import * as PayrollStaffHandlers from './handlers-payroll-staff.js';
import * as UniformHandlers from './handlers-uniform.js';
import * as OfficeKitHandlers from './handlers-office-kit.js';
import * as BankCashHandlers from './handlers-bank-cash.js';
import * as IncomeHandlers from './handlers-income.js';
import * as PromotionHandlers from './handlers-promotion.js';
import * as CashierHandlers from './handlers-cashier.js';
import * as ReportHandlers from './handlers-reports.js';
import * as StudentMoneyHandlers from './handlers-money.js';
import * as SettingsHandlers from './handlers-settings.js';
import * as DashboardHandlers from './handlers-dashboard.js';
import { validateLedgerInput } from './validation.js';

// ==============================================================================
// 💡 1. DOMAIN-SPECIFIC SERVER-SIDE RBAC PERMISSION MATRIX
// ==============================================================================
const ROLE_PERMS = {
  Owner: { ledger_read: true, ledger_write: true, cashier_read: true, cashier_write: true, student_read: true, student_write: true, staff_read: true, staff_write: true, uniform_read: true, uniform_write: true, promo_read: true, promo_write: true, report_read: true, settings_write: true, grade_matrix: true, backup_dispatch: true },
  Admin: { ledger_read: true, ledger_write: true, cashier_read: true, cashier_write: true, student_read: true, student_write: true, staff_read: true, staff_write: true, uniform_read: true, uniform_write: true, promo_read: true, promo_write: true, report_read: true, settings_write: true, grade_matrix: true, backup_dispatch: true },
  Finance: { ledger_read: true, ledger_write: true, cashier_read: true, cashier_write: true, student_read: true, student_write: true, staff_read: true, staff_write: true, uniform_read: true, uniform_write: true, promo_read: true, promo_write: true, report_read: true, settings_write: false, grade_matrix: false, backup_dispatch: true },
  Accountant: { ledger_read: true, ledger_write: true, cashier_read: true, cashier_write: true, student_read: true, student_write: true, staff_read: true, staff_write: true, uniform_read: true, uniform_write: true, promo_read: true, promo_write: true, report_read: true, settings_write: false, grade_matrix: false, backup_dispatch: true },
  HR: { ledger_read: false, ledger_write: false, cashier_read: false, cashier_write: false, student_read: false, student_write: false, staff_read: true, staff_write: true, uniform_read: false, uniform_write: false, promo_read: false, promo_write: false, report_read: true, settings_write: false, grade_matrix: true, backup_dispatch: false },
  "HR Staff": { ledger_read: false, ledger_write: false, cashier_read: false, cashier_write: false, student_read: false, student_write: false, staff_read: true, staff_write: true, uniform_read: false, uniform_write: false, promo_read: false, promo_write: false, report_read: true, settings_write: false, grade_matrix: true, backup_dispatch: false },
  Cashier: { ledger_read: false, ledger_write: false, cashier_read: true, cashier_write: true, student_read: true, student_write: false, staff_read: false, staff_write: false, uniform_read: true, uniform_write: false, promo_read: true, promo_write: false, report_read: false, settings_write: false, grade_matrix: false, backup_dispatch: false },
  "Main Cashier": { ledger_read: false, ledger_write: false, cashier_read: true, cashier_write: true, student_read: true, student_write: false, staff_read: false, staff_write: false, uniform_read: true, uniform_write: false, promo_read: true, promo_write: false, report_read: false, settings_write: false, grade_matrix: false, backup_dispatch: false },
  Staff: { ledger_read: false, ledger_write: false, cashier_read: false, cashier_write: false, student_read: true, student_write: false, staff_read: false, staff_write: false, uniform_read: true, uniform_write: false, promo_read: true, promo_write: false, report_read: false, settings_write: false, grade_matrix: false, backup_dispatch: false },
  Viewer: { ledger_read: true, ledger_write: false, cashier_read: true, cashier_write: false, student_read: true, student_write: false, staff_read: true, staff_write: false, uniform_read: true, uniform_write: false, promo_read: true, promo_write: false, report_read: true, settings_write: false, grade_matrix: false, backup_dispatch: false }
};

function can(session, perm) {
  const role = session?.role || "Viewer";
  const perms = ROLE_PERMS[role] || ROLE_PERMS.Viewer;
  return Boolean(perms[perm]);
}

function forbidden(corsHeaders, message = "ဒီလုပ်ဆောင်ချက်အတွက် ခွင့်ပြုချက် (Permission) မရှိပါ။") {
  return new Response(JSON.stringify({ success: false, message }), { status: 403, headers: corsHeaders });
}

// ==============================================================================
// 💡 2. STANDALONE SAFE AUDIT LOGGER
// ==============================================================================
function sanitizeDetailsForAudit(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => sanitizeDetailsForAudit(item));
  const clean = { ...obj };
  const SENSITIVE_KEYS = ['password', 'password_hash', 'token', 'authtoken', 'authsecret', 'secret', 'excelbase64'];
  for (const key of Object.keys(clean)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) clean[key] = '***';
    else if (typeof clean[key] === 'object' && clean[key] !== null) clean[key] = sanitizeDetailsForAudit(clean[key]);
  }
  return clean;
}

async function writeAuditLog(db, sessionOrUser, actionType, moduleOrPayload = {}, recordIdInput = null) {
  if (!db || typeof db.prepare !== 'function') return;
  try {
    let username = "System", role = "User";
    if (typeof sessionOrUser === "string") username = sessionOrUser;
    else if (sessionOrUser && typeof sessionOrUser === "object") {
      username = sessionOrUser.username || sessionOrUser.name || "System";
      role = sessionOrUser.role || "User";
    }

    let recordId = recordIdInput ? String(recordIdInput) : null;
    if (!recordId && moduleOrPayload && typeof moduleOrPayload === "object") {
      recordId = moduleOrPayload.uniqueId || moduleOrPayload.uniqueid || moduleOrPayload.id || null;
    }

    const safeDetails = sanitizeDetailsForAudit(moduleOrPayload);
    let detailsJson = "";
    try { 
      detailsJson = typeof safeDetails === "object" ? JSON.stringify(safeDetails) : String(safeDetails || ""); 
    } catch (e) { 
      detailsJson = "{}"; 
    }
    if (detailsJson.length > 2000) detailsJson = detailsJson.slice(0, 2000) + '...[TRUNCATED]';

    await db.prepare(`
      INSERT INTO audit_logs (username, role, action, record_id, detail, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(username, role, actionType || "UNKNOWN_ACTION", recordId, detailsJson).run();
  } catch (err) {
    console.warn("[AuditLog Fail-Safe Warning]:", err.message);
  }
}

// ==============================================================================
// 💡 3. CRYPTOGRAPHIC JWT & PBKDF2 PASSWORD ENGINE (Dynamic JWT EXPIRY Support)
// ==============================================================================
function base64UrlEncode(bytesOrStr) {
  const bytes = typeof bytesOrStr === "string" ? new TextEncoder().encode(bytesOrStr) : bytesOrStr;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlDecodeToString(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
  return atob(padded);
}
function base64UrlDecodeToBytes(str) {
  const binary = base64UrlDecodeToString(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createJwtToken(payload, secret, env) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const expiryHours = env && env.JWT_EXPIRY_HOURS ? parseInt(env.JWT_EXPIRY_HOURS, 10) : 8;
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + (expiryHours * 3600) }));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJwtToken(token, secret) {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const key = await hmacKey(secret);
    const signatureBytes = base64UrlDecodeToBytes(encodedSignature);
    const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
    if (!isValid) return null;
    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) { return null; }
}

const PBKDF2_ITERATIONS = 100000;
function bytesToHex(bytes) { return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join(""); }
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}
async function hashPassword(password, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derivedBits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`;
}
function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, needsRehash: false };
  if (stored.startsWith("pbkdf2$")) {
    const [, iterStr, saltHex, hashHex] = stored.split("$");
    const iterations = parseInt(iterStr, 10);
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
    const derivedBits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: iterations || PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
    const computedHex = bytesToHex(new Uint8Array(derivedBits));
    return { ok: timingSafeEqualStr(computedHex, hashHex), needsRehash: false };
  }
  const ok = timingSafeEqualStr(String(stored), String(password));
  return { ok, needsRehash: ok };
}

// ==============================================================================
// 💡 4. BRUTE-FORCE LOCKOUT PROTECTION
// ==============================================================================
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

async function checkLoginLockout(db, username) {
  try {
    const row = await db.prepare("SELECT fail_count, locked_until FROM login_attempts WHERE username = ?").bind(username).first();
    if (!row || !row.locked_until) return { locked: false };
    const lockedUntilMs = Date.parse(row.locked_until.replace(' ', 'T') + "Z");
    const nowMs = Date.now();
    if (!isNaN(lockedUntilMs) && lockedUntilMs > nowMs) {
      return { locked: true, remainingMinutes: Math.ceil((lockedUntilMs - nowMs) / 60000) };
    }
    return { locked: false };
  } catch (e) { return { locked: false }; }
}
async function recordLoginFailure(db, username) {
  try {
    const existing = await db.prepare("SELECT fail_count FROM login_attempts WHERE username = ?").bind(username).first();
    const newFailCount = (existing ? existing.fail_count : 0) + 1;
    const shouldLock = newFailCount >= MAX_LOGIN_ATTEMPTS;
    const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString().replace('T', ' ').substring(0, 19) : null;
    await db.prepare(`
      INSERT INTO login_attempts (username, fail_count, locked_until, last_attempt_at) VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(username) DO UPDATE SET fail_count = excluded.fail_count, locked_until = excluded.locked_until, last_attempt_at = datetime('now')
    `).bind(username, newFailCount, lockedUntil).run();
    return shouldLock;
  } catch (e) { return false; }
}
async function resetLoginAttempts(db, username) {
  try { await db.prepare("DELETE FROM login_attempts WHERE username = ?").bind(username).run(); } catch (e) {}
}

// ==============================================================================
// 💡 5. SAFE GLOBAL RECALCULATOR ENGINE (⚡ QUOTA-SHIELD PROTECTED)
// ==============================================================================
async function executeAutoRecalculateAll(db, body = {}) {
  const rawBook = body.bookName || body.tableName || body.book || "";
  const targetFy = body.fy ? String(body.fy).trim().replace(/^FY\s*/i, "") : null;
  // Fallback to full recalculation if fromDate isn't supplied from UI
  const fromDate = body.fromDate ? String(body.fromDate).trim() : null; 
  const isExplicitAll = Boolean(body.confirmAll === true || body.all === true || body.action === 'recalculateAllBalances');

  const tableMap = {
    "bank": "bank", "main bank book": "bank", "cash": "cash", "main cash book": "cash",
    "office": "office", "office exp book": "office", "kitchen": "kitchen", "kitchen exp book": "kitchen",
    "payroll": "payroll", "hr payroll exp book": "payroll", "student_money": "student_money", "student money ledger": "student_money",
    "income": "income", "main income book": "income", "ca_bank": "ca_bank", "cabank": "ca_bank",
    "ca_cash": "ca_cash", "cacash": "ca_cash", "ca_office": "ca_office", "caoffice": "ca_office",
    "ca_kitchen": "ca_kitchen", "cakitchen": "ca_kitchen", "ca_payroll": "ca_payroll", "capayroll": "ca_payroll"
  };

  let targetTables = [];

  if (rawBook && tableMap[rawBook.toLowerCase().trim()]) {
    targetTables = [tableMap[rawBook.toLowerCase().trim()]];
  } else if (isExplicitAll) {
    targetTables = ["bank", "cash", "office", "kitchen", "payroll", "student_money", "income", "ca_bank", "ca_cash", "ca_office", "ca_kitchen", "ca_payroll"];
  } else {
    return { success: false, message: "Target table name is required for recalculation." };
  }

  const updatedTables = [];
  for (const tbl of targetTables) {
    try {
      if (tbl === 'student_money') {
        if (targetFy) {
          if (fromDate) {
            // 🚀 INCREMENTAL RECALC WITH BASE ROW
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
                         PARTITION BY sm.student_id 
                         ORDER BY sm.date ASC, sm.id ASC 
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
                AND (student_money.no IS NOT ((SELECT no FROM student_money sm3 WHERE sm3.fy IN (?, ?) AND sm3.date < ? ORDER BY date DESC, id DESC LIMIT 1) + calculated.calc_no) OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
            `).bind(targetFy, `FY ${targetFy}`, fromDate, targetFy, `FY ${targetFy}`, fromDate, targetFy, `FY ${targetFy}`, fromDate, targetFy, `FY ${targetFy}`, fromDate, targetFy, `FY ${targetFy}`, fromDate).run();
          } else {
            // FULL RECALC
            await db.prepare(`
              WITH calculated AS (
                SELECT id, 
                       ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no,
                       SUM(debit - credit) OVER (
                         PARTITION BY student_id 
                         ORDER BY date ASC, id ASC 
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       ) as calc_bal
                FROM student_money
                WHERE fy IN (?, ?)
              )
              UPDATE student_money 
              SET no = calculated.new_no, balances = calculated.calc_bal 
              FROM calculated 
              WHERE student_money.id = calculated.id
                AND (student_money.no IS NOT calculated.new_no OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
            `).bind(targetFy, `FY ${targetFy}`).run();
          }
        } else {
          await db.prepare(`
            WITH calculated AS (
              SELECT id, 
                     ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as new_no,
                     SUM(debit - credit) OVER (
                       PARTITION BY student_id 
                       ORDER BY date ASC, id ASC 
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                     ) as calc_bal
              FROM student_money
            )
            UPDATE student_money 
            SET no = calculated.new_no, balances = calculated.calc_bal 
            FROM calculated 
            WHERE student_money.id = calculated.id
              AND (student_money.no IS NOT calculated.new_no OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
          `).run();
        }
      } else if (tbl === 'income') {
        if (targetFy) {
          if (fromDate) {
            const baseRow = await db.prepare(`SELECT no FROM income WHERE fy IN (?, ?) AND date < ? ORDER BY date DESC, id DESC LIMIT 1`).bind(targetFy, `FY ${targetFy}`, fromDate).first();
            const baseNo = baseRow ? (parseInt(baseRow.no, 10) || 0) : 0;
            await db.prepare(`
              WITH calculated AS (
                SELECT id, ? + ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no 
                FROM income
                WHERE fy IN (?, ?) AND date >= ?
              )
              UPDATE income SET no = calculated.new_no FROM calculated 
              WHERE income.id = calculated.id AND income.no IS NOT calculated.new_no;
            `).bind(baseNo, targetFy, `FY ${targetFy}`, fromDate).run();
          } else {
            await db.prepare(`
              WITH calculated AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no 
                FROM income
                WHERE fy IN (?, ?)
              )
              UPDATE income SET no = calculated.new_no FROM calculated 
              WHERE income.id = calculated.id AND income.no IS NOT calculated.new_no;
            `).bind(targetFy, `FY ${targetFy}`).run();
          }
        } else {
          await db.prepare(`
            WITH calculated AS (
              SELECT id, ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as new_no 
              FROM income
            )
            UPDATE income SET no = calculated.new_no FROM calculated 
            WHERE income.id = calculated.id AND income.no IS NOT calculated.new_no;
          `).run();
        }
      } else {
        // bank, cash, office, etc
        if (targetFy) {
          if (fromDate) {
            // 🚀 INCREMENTAL RECALC
            const baseRow = await db.prepare(`SELECT no, balances FROM ${tbl} WHERE fy IN (?, ?) AND date < ? ORDER BY date DESC, id DESC LIMIT 1`).bind(targetFy, `FY ${targetFy}`, fromDate).first();
            const baseNo = baseRow ? (parseInt(baseRow.no, 10) || 0) : 0;
            const baseBal = baseRow ? (parseFloat(baseRow.balances) || 0) : 0;
            
            await db.prepare(`
              WITH calculated AS (
                SELECT id, 
                       ? + ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no,
                       ? + SUM(debit - credit) OVER (
                         ORDER BY date ASC, id ASC 
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       ) as calc_bal
                FROM ${tbl}
                WHERE fy IN (?, ?) AND date >= ?
              )
              UPDATE ${tbl} 
              SET no = calculated.new_no, balances = calculated.calc_bal 
              FROM calculated 
              WHERE ${tbl}.id = calculated.id
                AND (${tbl}.no IS NOT calculated.new_no OR ROUND(${tbl}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
            `).bind(baseNo, baseBal, targetFy, `FY ${targetFy}`, fromDate).run();
          } else {
            // FULL RECALC
            await db.prepare(`
              WITH calculated AS (
                SELECT id, 
                       ROW_NUMBER() OVER (ORDER BY date ASC, id ASC) as new_no,
                       SUM(debit - credit) OVER (
                         ORDER BY date ASC, id ASC 
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       ) as calc_bal
                FROM ${tbl}
                WHERE fy IN (?, ?)
              )
              UPDATE ${tbl} 
              SET no = calculated.new_no, balances = calculated.calc_bal 
              FROM calculated 
              WHERE ${tbl}.id = calculated.id
                AND (${tbl}.no IS NOT calculated.new_no OR ROUND(${tbl}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
            `).bind(targetFy, `FY ${targetFy}`).run();
          }
        } else {
          await db.prepare(`
            WITH calculated AS (
              SELECT id, 
                     ROW_NUMBER() OVER (PARTITION BY fy ORDER BY date ASC, id ASC) as new_no,
                     SUM(debit - credit) OVER (
                       PARTITION BY fy 
                       ORDER BY date ASC, id ASC 
                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                     ) as calc_bal
              FROM ${tbl}
            )
            UPDATE ${tbl} 
            SET no = calculated.new_no, balances = calculated.calc_bal 
            FROM calculated 
            WHERE ${tbl}.id = calculated.id
              AND (${tbl}.no IS NOT calculated.new_no OR ROUND(${tbl}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2));
          `).run();
        }
      }
      updatedTables.push(tbl);
    } catch (e) {
      console.warn(`Recalculation warning on table ${tbl}:`, e.message);
    }
  }
  return { success: true, message: `စာရင်းအုပ် (${updatedTables.length}) ခု၏ Balances ကို လုံခြုံစွာ ညှိယူပြီးပါပြီ။`, updatedTables };
}

// ==============================================================================
// 💡 6. MAIN FETCH ROUTER (CLOUDFLARE WORKER EXPORT)
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedList = String(env.ALLOWED_ORIGIN || "*").split(",").map(s => s.trim()).filter(Boolean);
    const isAllowed = allowedList.includes("*") || allowedList.includes(requestOrigin);
    const resolvedOrigin = isAllowed ? (requestOrigin || allowedList[0] || "*") : allowedList[0];

    const corsHeaders = {
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, token, authToken, role",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      const db = env.DB || env.school_db;
      if (!db) return new Response(JSON.stringify({ success: false, message: "Database Binding Error: D1 Database (env.DB) မတွေ့ရှိပါ။" }), { status: 500, headers: corsHeaders });

      const authSecret = env.AUTH_SECRET;
      if (!authSecret) return new Response(JSON.stringify({ success: false, message: "Server Configuration Error: AUTH_SECRET မသတ်မှတ်ရသေးပါ။ Cloudflare Worker Variables တွင် ထည့်သွင်းပေးပါ။" }), { status: 500, headers: corsHeaders });

      let body = {};
      let action = "";

      if (request.method === "GET") {
        const url = new URL(request.url);
        action = url.searchParams.get("action") || "";
        for (const [key, value] of url.searchParams.entries()) body[key] = value;
      } else {
        try {
          body = await request.json();
          if (typeof body.action === 'object' && body.action !== null) {
            const innerAction = body.action.action || "";
            body = { ...body.action, ...body, action: innerAction };
          }
          action = typeof body.action === 'string' ? body.action : "";
        } catch (e) { body = {}; }
      }

      if (request.method !== "GET" && typeof validateLedgerInput === 'function') {
        const validation = validateLedgerInput(body);
        if (!validation.success) return new Response(JSON.stringify(validation), { status: 400, headers: corsHeaders });
      }

      const PUBLIC_ACTIONS = ["checkLogin"];
      let userSession = null;

      if (!PUBLIC_ACTIONS.includes(action)) {
        const authHeader = request.headers.get("Authorization") || "";
        const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";
        const tokenToVerify = tokenFromHeader || body.token || body.authToken || "";
        userSession = await verifyJwtToken(tokenToVerify, authSecret);
        if (!userSession) return new Response(JSON.stringify({ success: false, message: "Session သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည် Login ဝင်ရောက်ပါ။" }), { status: 401, headers: corsHeaders });
      }

      let result = null;

      switch (action) {
        case 'checkLogin': {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();
          const lockoutStatus = await checkLoginLockout(db, username.toLowerCase());
          if (lockoutStatus.locked) {
            await writeAuditLog(db, username, 'loginBlocked', body, `Locked out, ${lockoutStatus.remainingMinutes} min remaining`);
            return new Response(JSON.stringify({ success: false, message: `ကြိုးစားမှု အကြိမ်များစွာ မှားယွင်းသဖြင့် ${lockoutStatus.remainingMinutes} မိနစ်အကြာတွင် ပြန်လည် ကြိုးစားပါ။` }), { status: 429, headers: corsHeaders });
          }
          // 🚀 OPTIMIZATION: Avoid SELECT *, fetch exact columns for memory efficiency
          const user = await db.prepare("SELECT username, password_hash, role, name FROM users WHERE LOWER(username) = LOWER(?)").bind(username).first();
          if (user) {
            const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
            if (ok) {
              if (needsRehash) {
                try {
                  const newHash = await hashPassword(password);
                  await db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").bind(newHash, user.username).run();
                } catch (e) {}
              }
              await resetLoginAttempts(db, user.username.toLowerCase());
              await writeAuditLog(db, user, 'loginSuccess', { username: user.username, role: user.role });
              const token = await createJwtToken({ username: user.username, role: user.role, name: user.name || user.username }, authSecret, env);
              return new Response(JSON.stringify({ success: true, token: token, user: { username: user.username, role: user.role, name: user.name || user.username } }), { headers: corsHeaders });
            }
          }
          const gotLocked = await recordLoginFailure(db, username.toLowerCase());
          await writeAuditLog(db, username, 'loginFailed', { username }, gotLocked ? 'Account Locked' : 'Invalid Credentials');
          return new Response(JSON.stringify({ success: false, message: "Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။" }), { headers: corsHeaders });
        }

        case 'getDashboardData':
          result = await DashboardHandlers.getDashboardData(db, body); break;

        case 'getBankCashData':
          if (!can(userSession, 'ledger_read')) return forbidden(corsHeaders);
          result = await BankCashHandlers.getBankCashData(db, body); break;
        case 'saveBankCashEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Main Bank/Cash Book တွင် စာရင်းသွင်းခွင့် မရှိပါ။");
          result = await BankCashHandlers.saveBankCashEntry(db, userSession, body); break;
        case 'updateBankCashEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Main Bank/Cash Book တွင် စာရင်းပြင်ဆင်ခွင့် မရှိပါ။");
          result = await BankCashHandlers.updateBankCashEntry(db, userSession, body); break;
        case 'deleteBankCashEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Main Bank/Cash Book မှ စာရင်းဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await BankCashHandlers.deleteBankCashEntry(db, userSession, body); break;

        case 'getIncomeData':
          if (!can(userSession, 'ledger_read') && !can(userSession, 'cashier_read')) return forbidden(corsHeaders);
          result = await IncomeHandlers.getIncomeData(db, body); break;
        case 'saveIncomeEntry':
          if (!can(userSession, 'ledger_write') && !can(userSession, 'cashier_write')) return forbidden(corsHeaders);
          result = await IncomeHandlers.saveIncomeEntry(db, userSession, body); break;
        case 'updateIncomeEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Income Book တွင် စာရင်းပြင်ဆင်ခွင့် မရှိပါ။");
          result = await IncomeHandlers.updateIncomeEntry(db, userSession, body); break;
        case 'deleteIncomeEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Income Book မှ စာရင်းဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await IncomeHandlers.deleteIncomeEntry(db, userSession, body); break;

        case 'getExpenseData':
          if (!can(userSession, 'ledger_read') && !can(userSession, 'staff_read')) return forbidden(corsHeaders);
          result = await OfficeKitHandlers.getExpenseData(db, body); break;
        case 'saveExpenseEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Expense Book တွင် စာရင်းသွင်းခွင့် မရှိပါ။");
          result = await OfficeKitHandlers.saveExpenseEntry(db, userSession, body); break;
        case 'updateExpenseEntry':
        case 'updatePayrollEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Expense Book တွင် စာရင်းပြင်ဆင်ခွင့် မရှိပါ။");
          result = await OfficeKitHandlers.updateExpenseEntry(db, userSession, body); break;
        case 'deleteExpenseEntry':
        case 'deletePayrollEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders, "Expense Book မှ စာရင်းဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await OfficeKitHandlers.deleteExpenseEntry(db, userSession, body); break;

        case 'getCashierData':
          if (!can(userSession, 'cashier_read')) return forbidden(corsHeaders);
          result = await CashierHandlers.getCashierData(db, body); break;
        case 'getTodayIncomeForCashier':
          if (!can(userSession, 'cashier_read')) return forbidden(corsHeaders);
          result = await CashierHandlers.getTodayIncomeForCashier(db, body); break;
        case 'saveCashierEntry':
          if (!can(userSession, 'cashier_write')) return forbidden(corsHeaders, "Cashier စာအုပ်တွင် စာရင်းသွင်းခွင့် မရှိပါ။");
          result = await CashierHandlers.saveCashierEntry(db, userSession, body); break;
        case 'updateCashierEntry':
          if (!can(userSession, 'cashier_write')) return forbidden(corsHeaders, "Cashier စာအုပ်တွင် စာရင်းပြင်ဆင်ခွင့် မရှိပါ။");
          result = await CashierHandlers.updateCashierEntry(db, userSession, body); break;
        case 'deleteCashierEntry':
        case 'deleteLedgerEntry':
          if (!can(userSession, 'cashier_write')) return forbidden(corsHeaders, "Cashier စာအုပ်မှ စာရင်းဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await CashierHandlers.deleteCashierEntry(db, userSession, body); break;

        case 'getStudentMoneyData':
        case 'getStudentMoneySummary':
          if (!can(userSession, 'ledger_read') && !can(userSession, 'student_read')) return forbidden(corsHeaders);
          if (action === 'getStudentMoneySummary') result = await StudentMoneyHandlers.getStudentMoneySummary(db, body);
          else result = await StudentMoneyHandlers.getStudentMoneyData(db, body);
          break;
        case 'saveStudentMoneyEntry':
          if (!can(userSession, 'ledger_write') && !can(userSession, 'cashier_write')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.saveStudentMoneyEntry(db, userSession, body); break;
        case 'updateStudentMoneyEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.updateStudentMoneyEntry(db, userSession, body); break;
        case 'deleteStudentMoneyEntry':
          if (!can(userSession, 'ledger_write')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.deleteStudentMoneyEntry(db, userSession, body); break;

        case 'getStudentData':
        case 'lookupStudentById':
          if (!can(userSession, 'student_read')) return forbidden(corsHeaders);
          result = action === 'lookupStudentById'
            ? await StudentHandlers.lookupStudentById(db, body)
            : await StudentHandlers.getStudentData(db, body);
          break;
        case 'saveStudentEntry':
          if (!can(userSession, 'student_write')) return forbidden(corsHeaders, "ကျောင်းသားစာရင်း သွင်းယူခွင့် မရှိပါ။");
          result = await StudentHandlers.saveStudentEntry(db, userSession, body); break;
        case 'updateStudentEntry':
          if (!can(userSession, 'student_write')) return forbidden(corsHeaders, "ကျောင်းသားစာရင်း ပြင်ဆင်ခွင့် မရှိပါ။");
          result = await StudentHandlers.updateStudentEntry(db, userSession, body); break;
        case 'deleteStudentEntry':
          if (!can(userSession, 'student_write')) return forbidden(corsHeaders, "ကျောင်းသားစာရင်း ဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await StudentHandlers.deleteStudentEntry(db, userSession, body); break;

        case 'getStaffData':
          if (!can(userSession, 'staff_read')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.getStaffData(db, body, userSession); break;
        case 'saveStaffEntry':
          if (!can(userSession, 'staff_write')) return forbidden(corsHeaders, "ဝန်ထမ်းစာရင်း သွင်းယူခွင့် မရှိပါ။");
          result = await PayrollStaffHandlers.saveStaffEntry(db, userSession, body); break;
        case 'updateStaffEntry':
          if (!can(userSession, 'staff_write')) return forbidden(corsHeaders, "ဝန်ထမ်းစာရင်း ပြင်ဆင်ခွင့် မရှိပါ။");
          result = await PayrollStaffHandlers.updateStaffEntry(db, userSession, body); break;
        case 'deleteStaffEntry':
          if (!can(userSession, 'staff_write')) return forbidden(corsHeaders, "ဝန်ထမ်းစာရင်း ဖျက်သိမ်းခွင့် မရှိပါ။");
          result = await PayrollStaffHandlers.deleteStaffEntry(db, userSession, body); break;
        case 'saveHrPayrollForm':
          if (!can(userSession, 'staff_write') && !can(userSession, 'ledger_write')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.saveHrPayrollForm(db, userSession, body); break;
        case 'getPayrollSettings':
          if (!can(userSession, 'staff_read') && !can(userSession, 'grade_matrix')) return forbidden(corsHeaders, "Salary Grade Matrix ကြည့်ရှုခွင့် မရှိပါ။");
          result = await PayrollStaffHandlers.getPayrollSettings(db, body); break;
        case "updatePayrollSettings":
          if (!can(userSession, "grade_matrix")) return forbidden(corsHeaders, "Salary Grade Matrix ပြင်ဆင်ခွင့် မရှိပါ။");
          result = await PayrollStaffHandlers.updatePayrollSettings(db, userSession, body); break;

        case 'getUniformData':
          if (!can(userSession, 'uniform_read')) return forbidden(corsHeaders);
          result = await UniformHandlers.getUniformData(db, body); break;
        case 'saveUniformEntry':
          if (!can(userSession, 'uniform_write')) return forbidden(corsHeaders);
          result = await UniformHandlers.saveUniformEntry(db, userSession, body); break;
        case 'updateUniformEntry':
          if (!can(userSession, 'uniform_write')) return forbidden(corsHeaders);
          result = await UniformHandlers.updateUniformEntry(db, userSession, body); break;
        case 'deleteUniformEntry':
          if (!can(userSession, 'uniform_write')) return forbidden(corsHeaders);
          result = await UniformHandlers.deleteUniformEntry(db, userSession, body); break;

        case 'getPromotionData':
          if (!can(userSession, 'promo_read')) return forbidden(corsHeaders);
          result = await PromotionHandlers.getPromotionData(db, body); break;
        case 'savePromotionEntry':
          if (!can(userSession, 'promo_write')) return forbidden(corsHeaders);
          result = await PromotionHandlers.savePromotionEntry(db, userSession, body); break;
        case 'updatePromotionEntry':
          if (!can(userSession, 'promo_write')) return forbidden(corsHeaders);
          result = await PromotionHandlers.updatePromotionEntry(db, userSession, body); break;
        case 'deletePromotionEntry':
          if (!can(userSession, 'promo_write')) return forbidden(corsHeaders);
          result = await PromotionHandlers.deletePromotionEntry(db, userSession, body); break;

        case 'getFinancialReportData':
        case 'getIncomeDetailReportData':
        case 'getMonthlyIncomeReportData':
        case 'getStudentReportDetails':
        case 'getFundReportData':
          if (!can(userSession, 'report_read')) return forbidden(corsHeaders);
          if (action === 'getFinancialReportData') result = await ReportHandlers.getFinancialReportData(db, body);
          else if (action === 'getIncomeDetailReportData') result = await ReportHandlers.getIncomeDetailReportData(db, body);
          else if (action === 'getMonthlyIncomeReportData') result = await ReportHandlers.getMonthlyIncomeReportData(db, body);
          else if (action === 'getStudentReportDetails') result = await ReportHandlers.getStudentReportDetails(db, body);
          else if (action === 'getFundReportData') result = await ReportHandlers.getFundReportData(db, body);
          break;

        case 'getSettingsData':
          result = await SettingsHandlers.getSettingsData(db, body); break;
        case 'exportBookDataByFy':
        case 'exportGroupDataByFy':
          if (!can(userSession, 'backup_dispatch')) return forbidden(corsHeaders);
          result = await SettingsHandlers.exportGroupDataByFy(db, body, userSession); break;
        case 'sendEmailBackupByFy':
        case 'sendGroupEmailBackupByFy':
          if (!can(userSession, 'backup_dispatch')) return forbidden(corsHeaders);
          result = await SettingsHandlers.sendGroupEmailBackupByFy(db, userSession, body, env); break;

        case 'recalculateAllBalances':
        case 'recalculateLedgerBalances':
          if (!can(userSession, 'settings_write') && !can(userSession, 'ledger_write')) return forbidden(corsHeaders);
          result = await executeAutoRecalculateAll(db, body); break;

        default:
          return new Response(JSON.stringify({ success: false, message: `Action '${action}' မဟုတ်ပါ သို့မဟုတ် မပံ့ပိုးသေးပါ။` }), { headers: corsHeaders });
      }

      // 🛡️ D1 AUDIT LOGGING
      const isMutatingAction = /^(save|update|delete|export|send|recalculate)/i.test(action);
      if (isMutatingAction && result && result.success !== false && userSession) {
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(writeAuditLog(db, userSession, action, body, body.uniqueId || body.uniqueid || body.id || null));
        } else {
          await writeAuditLog(db, userSession, action, body, body.uniqueId || body.uniqueid || body.id || null);
        }
      }

      return new Response(JSON.stringify(result || { success: true }), { headers: corsHeaders });

    } catch (err) {
      console.error("Worker Execution Catch:", err);
      const errorMessage = (env.ENVIRONMENT === "development" || env.ENVIRONMENT === "dev")
        ? `Server Error: ${err.message}` 
        : "Server အတွင်း အမှားအယွင်း ဖြစ်ပေါ်နေပါသည်။";
        
      return new Response(JSON.stringify({
        success: false,
        message: errorMessage
      }), { status: 500, headers: corsHeaders });
    }
  },

  // 🛡️ Scheduled Cron Trigger for Auto Audit Logs Cleanup
  async scheduled(event, env, ctx) {
    try {
      const db = env.DB || env.school_db;
      if (!db) return;

      // ၆ လ (ရက် ၁80) ထက် ဟောင်းသော Log များကို ဖျက်ပစ်မည်
      await db.prepare(`DELETE FROM audit_logs WHERE datetime(created_at) < datetime('now', '-180 days')`).run();
      console.log("[CRON] Old audit logs cleaned up successfully.");
    } catch (err) {
      console.error("[CRON] Audit log cleanup failed:", err.message);
    }
  }
};