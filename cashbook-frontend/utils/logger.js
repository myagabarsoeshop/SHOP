/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - AUDIT TRAIL & SYSTEM LOGGER ENGINE 
 * File: logger.js (or utils/logger.js)
 * 💡 Features: Cloudflare D1 Database Native Audit Logging ('audit_logs' Table),
 *              Zero Google Sheets Dependency, Sensitive Data Masking (Password/Token),
 *              Fail-Safe Async Execution & Real-Time Console Telemetry
 * ==============================================================================
 */

/**
 * 💡 MASK SENSITIVE FIELDS (Password, Tokens, Secrets) BEFORE WRITING TO AUDIT LOG
 * Audit Log ထဲတွင် Password၊ Hash နှင့် Auth Token များ Plaintext အဖြစ် ပေါက်ကြားမှုကို ကာကွယ်ခြင်း
 */
export function sanitizeDetailsForAudit(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  // Array ဖြစ်ပါက item တစ်ခုချင်းစီကို recursive sanitize ပြုလုပ်မည်
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeDetailsForAudit(item));
  }

  const clean = { ...obj };
  const SENSITIVE_KEYS = [
    'password',
    'password_hash',
    'token',
    'authtoken',
    'authsecret',
    'secret',
    'access_token',
    'excelbase64' // Base64 file အကြီးကြီးများ Log ထဲ မဝင်စေရန်
  ];

  for (const key of Object.keys(clean)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(k => lowerKey.includes(k))) {
      clean[key] = '***';
    } else if (typeof clean[key] === 'object' && clean[key] !== null) {
      clean[key] = sanitizeDetailsForAudit(clean[key]);
    }
  }

  return clean;
}

/**
 * 💡 WRITE AUDIT TRAIL LOG TO CLOUDFLARE D1 DATABASE
 * မည်သူက မည်သည့်အချိန်တွင် မည်သည့် လုပ်ဆောင်ချက် (Action) နှင့် စာရင်း (Record) ကို 
 * လုပ်ဆောင်သွားသည်ကို D1 Database ရှိ 'audit_logs' table တွင် တိကျစွာ မှတ်တမ်းတင်ခြင်း
 * 
 * @param {object} db - Cloudflare D1 Database Binding (env.DB)
 * @param {object|string} sessionOrUser - Active User Session Object သို့မဟုတ် Username
 * @param {string} actionType - 'saveIncomeEntry', 'deleteBankCashEntry', etc.
 * @param {object|string} moduleOrPayload - စာရင်းသွင်းခဲ့သည့် Request Body Payload
 * @param {string|number|null} recordIdInput - Record ID သို့မဟုတ် Unique ID (optional)
 */
export async function writeAuditLog(db, sessionOrUser, actionType, moduleOrPayload = {}, recordIdInput = null) {
  // Database instance မရှိပါက ဆက်မလုပ်ဘဲ ကျော်မည်
  if (!db || typeof db.prepare !== 'function') {
    console.warn("[AuditLog Warning] Valid D1 Database instance is required for audit logging.");
    return;
  }

  try {
    // 💡 1. Username & Role Resolver
    let username = "System";
    let role = "User";

    if (typeof sessionOrUser === "string") {
      username = sessionOrUser;
    } else if (sessionOrUser && typeof sessionOrUser === "object") {
      username = sessionOrUser.username || sessionOrUser.name || sessionOrUser.user || "System";
      role = sessionOrUser.role || "User";
    }

    // 💡 2. Flexible Record ID & Payload Resolver
    let recordId = recordIdInput ? String(recordIdInput) : null;
    let detailsObj = moduleOrPayload;

    if (moduleOrPayload && typeof moduleOrPayload === "object") {
      if (!recordId) {
        recordId = moduleOrPayload.uniqueId ||
                   moduleOrPayload.uniqueid ||
                   moduleOrPayload.id ||
                   moduleOrPayload.studentId ||
                   moduleOrPayload.staffId ||
                   null;
      }
    }

    // 🛡️ 3. Mask Sensitive Data (Password, Token, Secrets)
    const safeDetails = sanitizeDetailsForAudit(detailsObj);
    
    let detailsJson = "";
    try {
      detailsJson = typeof safeDetails === "object" ? JSON.stringify(safeDetails) : String(safeDetails || "");
    } catch (stringifyErr) {
      detailsJson = "{}";
    }

    // 🛡️ 4. D1 Storage Length Safety Limit (Max 2000 chars per log)
    if (detailsJson.length > 2000) {
      detailsJson = detailsJson.slice(0, 2000) + '...[TRUNCATED]';
    }

    // 💡 5. Write to D1 'audit_logs' Table
    await db.prepare(`
      INSERT INTO audit_logs (username, role, action, record_id, detail, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      username,
      role,
      actionType || "UNKNOWN_ACTION",
      recordId,
      detailsJson
    ).run();

  } catch (err) {
    // Fail-Safe: Audit Logging ပျက်စီးခဲ့လျှင်ပင် မူရင်း စာရင်းသွင်းမှု လုပ်ငန်းစဉ်အား မထိခိုက်စေပါ
    console.warn("[AuditLog Fail-Safe Warning] Failed to write to D1 audit_logs:", err.message);
  }
}

/**
 * 💡 CONSOLE REQUEST LOGGER FOR CLOUDFLARE WORKERS TELEMETRY
 */
export function logRequest(action, userSession, extraInfo = {}) {
  const time = new Date().toISOString();
  const user = userSession?.username || userSession?.name || "Public/Anon";
  const role = userSession?.role || "None";
  console.log(`[REQ ${time}] Action: '${action}' | User: ${user} (${role})`, extraInfo);
}

/**
 * 💡 CONSOLE ERROR LOGGER FOR CLOUDFLARE WORKERS TELEMETRY
 */
export function logError(action, error, userSession) {
  const time = new Date().toISOString();
  const user = userSession?.username || userSession?.name || "Unknown";
  console.error(`[ERR ${time}] Action: '${action}' | User: ${user} | Message: ${error?.message || error}`, error?.stack || "");
}
