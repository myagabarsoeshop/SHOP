// cashbook-api/utils/response.js 

export const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Branch-Id",
    "Access-Control-Max-Age": "86400",
};

/**
 * အောင်မြင်သော Response ပြန်ပေးရန် Helper
 */
export function successResponse(data, status = 200) {
    return new Response(
        JSON.stringify({
            success: true,
            data: data
        }),
        {
            status,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json;charset=UTF-8"
            }
        }
    );
}

/**
 * Error Response ပြန်ပေးရန် Helper
 */
export function errorResponse(message, status = 400) {
    return new Response(
        JSON.stringify({
            success: false,
            error: message
        }),
        {
            status,
            headers: {
                ...corsHeaders,
                "Content-Type": "application/json;charset=UTF-8"
            }
        }
    );
}
