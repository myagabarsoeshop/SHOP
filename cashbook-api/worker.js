/**
 * ==============================================================================
 * MYA GABAR SOE SHOP - API WORKER (CLEAN STARTER EDITION)
 * File: worker.js (Location: cashbook-api/worker.js)
 * 💡 Features: Clean Login Authentication, PBKDF2 + Base64 Salt Support, 
 *              CORS Handling, D1 Database Integration
 * ==============================================================================
 */

// ==============================================================================
// 1. CRYPTO UTILITIES (PBKDF2 Password Verification & JWT)
// ==============================================================================
function base64ToBytes(base64) {
  const binString = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binString, (m) => m.codePointAt(0));
}

function bytesToBase64(bytes) {
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
  return btoa(binString);
}

function base64UrlEncode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str) {
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) padded += "=";
  return decodeURIComponent(escape(atob(padded)));
}

async function verifyPbkdf2Password(password, storedHash, storedSalt) {
  try {
    if (!storedHash) return false;

    // နည်းလမ်း ၁ - Database ထဲတွင် Base64 Salt ရှိနေသော ပုံစံ (Shop-DB standard)
    if (storedSalt) {
      const saltBytes = base64ToBytes(storedSalt);
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const computedBase64 = bytesToBase64(new Uint8Array(derivedBits));
      return computedBase64 === storedHash;
    }

    // နည်းလမ်း ၂ - pbkdf2$100000$salt$hash ပုံစံ
    if (storedHash.startsWith("pbkdf2$")) {
      const parts = storedHash.split("$");
      const iterations = parseInt(parts[1], 10) || 100000;
      const saltHex = parts[2];
      const hashHex = parts[3];

      const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"]
      );
      const derivedBits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        keyMaterial,
        256
      );
      const computedHex = Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, "0")).join("");
      return computedHex === hashHex;
    }

    // နည်းလမ်း ၃ - Plain text တိုက်ရိုက် တူမတူ စစ်ဆေးခြင်း
    return password === storedHash;
  } catch (err) {
    console.error("Password verification error:", err);
    return false;
  }
}

async function createJwtToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const exp = Math.floor(Date.now() / 1000) + (24 * 3600); // 24 hours expiry
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp }));

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  const encodedSignature = base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

// ==============================================================================
// 2. MAIN FETCH HANDLER
// ==============================================================================
export default {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get("Origin") || "";
    
    // CORS Settings (မည်သည့် Origin မှမဆို ခေါ်ယူနိုင်အောင် လုံခြုံစွာ ခွင့်ပြုပေးခြင်း)
    const corsHeaders = {
      "Access-Control-Allow-Origin": requestOrigin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const db = env.DB;
      if (!db) {
        return new Response(JSON.stringify({ 
          success: false, 
          message: "Database Error: D1 Database (env.DB) ချိတ်ဆက်မထားပါ။ Cloudflare Settings > Bindings တွင် စစ်ဆေးပါ။" 
        }), { status: 500, headers: corsHeaders });
      }

      const authSecret = env.AUTH_SECRET || "MYA_GABAR_SOE_SHOP_SECURE_TOKEN_KEY_2026";

      let body = {};
      let action = "";

      if (request.method === "GET") {
        const url = new URL(request.url);
        action = url.searchParams.get("action") || "";
        for (const [key, value] of url.searchParams.entries()) body[key] = value;
      } else {
        try {
          body = await request.json();
          action = body.action || "";
        } catch (e) {
          body = {};
        }
      }

      // -------------------------------------------------------------
      // ACTION: checkLogin (အကောင့်စစ်ဆေးခြင်း)
      // -------------------------------------------------------------
      if (action === "checkLogin") {
        const username = String(body.username || "").trim();
        const password = String(body.password || "").trim();

        if (!username || !password) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: "Username နှင့် Password ဖြည့်သွင်းပေးပါ။" 
          }), { status: 400, headers: corsHeaders });
        }

        // Database ထဲမှ user စစ်ဆေးခြင်း
        const user = await db.prepare(
          "SELECT id, username, password_salt, password_hash, role, branch_code FROM users WHERE LOWER(username) = LOWER(?)"
        ).bind(username).first();

        if (!user) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: "အသုံးပြုသူ အမည် (Username) မှားယွင်းနေပါသည်။" 
          }), { headers: corsHeaders });
        }

        const isPasswordCorrect = await verifyPbkdf2Password(password, user.password_hash, user.password_salt);

        if (!isPasswordCorrect) {
          return new Response(JSON.stringify({ 
            success: false, 
            message: "Password မှားယွင်းနေပါသည်။" 
          }), { headers: corsHeaders });
        }

        // Login အောင်မြင်ပါက JWT Token ထုတ်ပေးခြင်း
        const token = await createJwtToken({
          id: user.id,
          username: user.username,
          role: user.role,
          branch_code: user.branch_code
        }, authSecret);

        return new Response(JSON.stringify({
          success: true,
          message: "Login အောင်မြင်ပါသည်!",
          token: token,
          user: {
            username: user.username,
            role: user.role,
            branch_code: user.branch_code
          }
        }), { headers: corsHeaders });
      }

      // Default Health Check Route
      return new Response(JSON.stringify({
        success: true,
        message: "Mya Gabar Soe Shop API is Running!",
        receivedAction: action
      }), { headers: corsHeaders });

    } catch (err) {
      console.error("Worker Execution Error:", err);
      return new Response(JSON.stringify({
        success: false,
        message: `Server Error: ${err.message}`
      }), { status: 500, headers: corsHeaders });
    }
  }
};
