// cashbook-api/worker.js
import { corsHeaders, errorResponse } from "./utils/response.js";
import { handleLogin, handleGetProfile } from "./controllers/auth.controller.js";
import { handleGetBranches, handleGetBranchById, handleCreateBranch } from "./controllers/branch.controller.js";
import { handleGetProducts, handleScanProduct, handleCreateProduct, handleUpdateProduct } from "./controllers/product.controller.js";
import { 
    handleGetCategories, 
    handleGetEntries, 
    handleCreateEntry, 
    handleDeleteEntry, 
    handleCloseDay 
} from "./controllers/cashbook.controller.js";

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        try {
            // 1. Authentication Routes
            if (path === "/api/auth/login" && method === "POST") return await handleLogin(request, env);
            if (path === "/api/auth/me" && method === "GET") return await handleGetProfile(request, env);

            // 2. Branch Routes
            if (path === "/api/branches" && method === "GET") return await handleGetBranches(request, env);
            if (path === "/api/branches" && method === "POST") return await handleCreateBranch(request, env);
            if (path.startsWith("/api/branches/") && method === "GET") {
                const branchId = path.split("/")[3];
                return await handleGetBranchById(request, env, branchId);
            }

            // 3. Product & Inventory Routes
            if (path === "/api/products" && method === "GET") return await handleGetProducts(request, env);
            if (path === "/api/products" && method === "POST") return await handleCreateProduct(request, env);
            if (path === "/api/products/scan" && method === "GET") return await handleScanProduct(request, env);
            if (path.startsWith("/api/products/") && method === "PUT") {
                const productId = path.split("/")[3];
                return await handleUpdateProduct(request, env, productId);
            }

            // 4. Cashbook Routes (Phase 2)
            if (path === "/api/cashbook/categories" && method === "GET") return await handleGetCategories(request, env);
            if (path === "/api/cashbook/entries" && method === "GET") return await handleGetEntries(request, env);
            if (path === "/api/cashbook/entries" && method === "POST") return await handleCreateEntry(request, env);
            if (path.startsWith("/api/cashbook/entries/") && method === "DELETE") {
                const entryId = path.split("/")[4];
                return await handleDeleteEntry(request, env, entryId);
            }
            if (path === "/api/cashbook/close-day" && method === "POST") return await handleCloseDay(request, env);

            // Health Check
            if (path === "/api/health" || path === "/") {
                return new Response(JSON.stringify({ status: "online", version: "2.1.0" }), {
                    headers: { ...corsHeaders, "Content-Type": "application/json" }
                });
            }

            return errorResponse(`Route မတွေ့ရှိပါ: ${method} ${path}`, 404);
        } catch (err) {
            return errorResponse(`Server Internal Error: ${err.message}`, 500);
        }
    }
};
