// cashbook-api/controllers/auth.controller.js 

import { successResponse, errorResponse } from "../utils/response.js";

/**
 * ဝန်ထမ်း Login ဝင်ရောက်ခြင်း
 * POST /api/auth/login
 */
export async function handleLogin(request, env) {
    try {
        const body = await request.json().catch(() => null);
        if (!body || !body.username || !body.password) {
            return errorResponse("အသုံးပြုသူအမည် (Username) နှင့် စကားဝှက် (Password) ထည့်သွင်းပေးပါ", 400);
        }

        const { username, password } = body;

        // D1 users table နှင့် branches table ကို ချိတ်ဆက်စစ်ဆေးခြင်း
        const query = `
            SELECT 
                u.id,
                u.branch_id,
                u.username,
                u.full_name,
                u.phone,
                u.role,
                b.code AS branch_code,
                b.name AS branch_name,
                b.type AS branch_type
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.username = ? AND u.password_hash = ? AND u.is_active = 1
        `;

        const user = await env.DB.prepare(query)
            .bind(username.trim(), password)
            .first();

        if (!user) {
            return errorResponse("အသုံးပြုသူအမည် သို့မဟုတ် စကားဝှက် မှားယွင်းနေပါသည်", 401);
        }

        return successResponse({
            user: {
                id: user.id,
                username: user.username,
                fullName: user.full_name,
                phone: user.phone,
                role: user.role,
                branchId: user.branch_id,
                branchCode: user.branch_code,
                branchName: user.branch_name,
                branchType: user.branch_type
            },
            message: "Login အောင်မြင်ပါသည်"
        });

    } catch (err) {
        return errorResponse(`Login စစ်ဆေးရာတွင် ချို့ယွင်းချက်ဖြစ်ပေါ်ပါသည်: ${err.message}`, 500);
    }
}

/**
 * အသုံးပြုသူ Profile စစ်ဆေးခြင်း
 * GET /api/auth/me?userId=1
 */
export async function handleGetProfile(request, env) {
    try {
        const url = new URL(request.url);
        const userId = url.searchParams.get("userId");

        if (!userId) {
            return errorResponse("User ID လိုအပ်ပါသည်", 400);
        }

        const query = `
            SELECT 
                u.id, u.branch_id, u.username, u.full_name, u.phone, u.role,
                b.code AS branch_code, b.name AS branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            WHERE u.id = ? AND u.is_active = 1
        `;

        const user = await env.DB.prepare(query).bind(userId).first();

        if (!user) {
            return errorResponse("အသုံးပြုသူ မရှိတော့ပါ သို့မဟုတ် ပိတ်ထားပါသည်", 404);
        }

        return successResponse({ user });
    } catch (err) {
        return errorResponse(`Profile ရယူရာတွင် ချို့ယွင်းချက်: ${err.message}`, 500);
    }
}
