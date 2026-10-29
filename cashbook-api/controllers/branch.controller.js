// cashbook-api/controllers/branch.controller.js
import { successResponse, errorResponse } from "../utils/response.js";

/**
 * ဆိုင်ခွဲများ အားလုံး စာရင်း ရယူခြင်း (Dropdown & Admin View အတွက်)
 * GET /api/branches
 */
export async function handleGetBranches(request, env) {
    try {
        const query = `
            SELECT 
                b.id,
                b.code,
                b.name,
                b.type,
                b.phone,
                b.address,
                b.is_active,
                COUNT(u.id) AS total_staff
            FROM branches b
            LEFT JOIN users u ON b.id = u.branch_id AND u.is_active = 1
            WHERE b.is_active = 1
            GROUP BY b.id
            ORDER BY b.id ASC
        `;

        const { results } = await env.DB.prepare(query).all();
        return successResponse(results || []);
    } catch (err) {
        return errorResponse(`ဆိုင်ခွဲစာရင်းများ ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ဆိုင်ခွဲတစ်ခုချင်းစီ၏ အသေးစိတ် အချက်အလက် ရယူခြင်း
 * GET /api/branches/:id
 */
export async function handleGetBranchById(request, env, branchId) {
    try {
        const query = `
            SELECT id, code, name, type, phone, address, is_active, created_at
            FROM branches
            WHERE id = ?
        `;
        const branch = await env.DB.prepare(query).bind(branchId).first();

        if (!branch) {
            return errorResponse("ဆိုင်ခွဲ ရှာမတွေ့ပါ", 404);
        }

        return successResponse(branch);
    } catch (err) {
        return errorResponse(`ဆိုင်ခွဲ အချက်အလက် ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}

/**
 * ဆိုင်ခွဲအသစ် ထည့်သွင်းခြင်း (Admin Only)
 * POST /api/branches
 */
export async function handleCreateBranch(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.code || !body.name || !body.type) {
            return errorResponse("ဆိုင်ကုတ် (code)၊ ဆိုင်အမည် (name) နှင့် အမျိုးအစား (type) မဖြစ်မနေ ထည့်သွင်းပေးပါ", 400);
        }

        const { code, name, type, phone = "", address = "" } = body;

        // ဆိုင်ကုတ် ထပ်နေခြင်း ရှိ/မရှိ စစ်ဆေးခြင်း
        const existing = await env.DB.prepare("SELECT id FROM branches WHERE code = ?").bind(code.trim().toUpperCase()).first();
        if (existing) {
            return errorResponse(`ဆိုင်ကုတ် '${code}' သည် သုံးပြီးသား ဖြစ်နေပါသည်`, 409);
        }

        const insertQuery = `
            INSERT INTO branches (code, name, type, phone, address)
            VALUES (?, ?, ?, ?, ?)
        `;
        const result = await env.DB.prepare(insertQuery)
            .bind(code.trim().toUpperCase(), name.trim(), type, phone.trim(), address.trim())
            .run();

        return successResponse({
            id: result.meta.last_row_id,
            message: "ဆိုင်ခွဲအသစ် အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ"
        }, 201);
    } catch (err) {
        return errorResponse(`ဆိုင်ခွဲ အသစ်ဖွင့်ရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}
