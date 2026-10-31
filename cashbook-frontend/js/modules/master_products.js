// cashbook-frontend/js/modules/master_products.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let masterProducts = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initMasterProducts() {
    if (!state.isAdmin()) {
        alert("ဤစာမျက်နှာကို Admin သာလျှင် အသုံးပြုခွင့်ရှိပါသည်။");
        return;
    }
    bindEvents();
    await loadMasterProducts();
}

function bindEvents() {
    document.getElementById("btn-add-master-product")?.addEventListener("click", () => openMasterModal(null));
    document.getElementById("btn-close-master-modal")?.addEventListener("click", () => {
        document.getElementById("master-product-modal")?.classList.add("hidden");
    });
    document.getElementById("master-product-form")?.addEventListener("submit", submitMasterProduct);
    document.getElementById("master-search")?.addEventListener("input", filterAndRenderMaster);
}

async function loadMasterProducts() {
    const tbody = document.getElementById("master-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-blue-500 text-2xl"></i></td></tr>`;
    }

    try {
        // Master Products များဖြစ်သဖြင့် Branch ရွေးချယ်မှု မလိုဘဲ ပစ္စည်းအချက်အလက်သက်သက်သာ ရယူမည်
        const res = await api.get("/products");
        masterProducts = res.data || [];
        filterAndRenderMaster();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-rose-500 font-bold">ဗဟိုစာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderMaster() {
    const kw = (document.getElementById("master-search")?.value || "").trim().toLowerCase();

    const filtered = masterProducts.filter(p => {
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderMasterTable(filtered);
}

function renderMasterTable(list) {
    const tbody = document.getElementById("master-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-12 text-center text-slate-400 font-bold text-base">ဗဟိုကုန်ပစ္စည်းစာရင်း မတွေ့ရှိပါ</td></tr>`;
        return;
    }

    list.forEach(item => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(item.sku || "-")}</div>
                <div>${escapeHtml(item.barcode || "")}</div>
            </td>
            <td class="p-4">
                <span class="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 text-sm font-bold">
                    ${escapeHtml(item.category)}
                </span>
            </td>
            <td class="p-4">
                <div class="font-bold text-slate-900 dark:text-white text-base">${escapeHtml(item.item_name)}</div>
                <div class="text-sm text-slate-400">${escapeHtml(item.pattern || "-")}</div>
            </td>
            <td class="p-4 text-sm">
                <div>${escapeHtml(item.color || "-")}</div>
                <div class="text-slate-400">${escapeHtml(item.size || "Free Size")}</div>
            </td>
            <td class="p-4 text-right font-mono text-base text-slate-500">${Number(item.cost_price || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">${Number(item.retail_price || 0).toLocaleString()}</td>
            <td class="p-4 text-right font-mono font-bold text-base text-blue-600 dark:text-blue-400">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            <td class="p-4 text-center">
                <button type="button" data-id="${item.id}" title="ဈေးနှုန်းနှင့် အချက်အလက် ပြင်မည်" class="btn-edit-master w-9 h-9 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-edit-master").forEach(btn => {
        btn.onclick = () => {
            const prod = masterProducts.find(p => p.id === Number(btn.dataset.id));
            if (prod) openMasterModal(prod);
        };
    });
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function openMasterModal(prod = null) {
    const modal = document.getElementById("master-product-modal");
    const title = document.getElementById("master-modal-title");
    document.getElementById("master-product-form")?.reset();

    if (prod) {
        if (title) title.textContent = "ဗဟိုကုန်ပစ္စည်း အချက်အလက်နှင့် ဈေးနှုန်း ပြင်ဆင်မည်";
        safeSetValue("master-prod-id", prod.id);
        safeSetValue("master-prod-sku", prod.sku || "");
        safeSetValue("master-prod-barcode", prod.barcode || "");
        safeSetValue("master-prod-category", prod.category || "");
        safeSetValue("master-prod-name", prod.item_name || "");
        safeSetValue("master-prod-pattern", prod.pattern || "");
        safeSetValue("master-prod-color", prod.color || "");
        safeSetValue("master-prod-size", prod.size || "Free Size");
        safeSetValue("master-prod-cost", prod.cost_price || 0);
        safeSetValue("master-prod-retail", prod.retail_price || 0);
        safeSetValue("master-prod-wholesale", prod.wholesale_price || 0);
    } else {
        if (title) title.textContent = "ဗဟိုကုန်ပစ္စည်းအမည်သစ် မှတ်ပုံတင်မည်";
        safeSetValue("master-prod-id", "");
        safeSetValue("master-prod-size", "Free Size");
    }

    modal?.classList.remove("hidden");
}

async function submitMasterProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-master-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("master-prod-id")?.value;

    const payload = {
        sku: document.getElementById("master-prod-sku")?.value.trim() || null,
        barcode: document.getElementById("master-prod-barcode")?.value.trim() || null,
        category: document.getElementById("master-prod-category")?.value.trim(),
        itemName: document.getElementById("master-prod-name")?.value.trim(),
        pattern: document.getElementById("master-prod-pattern")?.value.trim() || null,
        color: document.getElementById("master-prod-color")?.value.trim() || null,
        size: document.getElementById("master-prod-size")?.value.trim() || "Free Size",
        costPrice: parseFloat(document.getElementById("master-prod-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("master-prod-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("master-prod-wholesale")?.value) || 0
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
        } else {
            // အသစ်သွင်းလျှင် Stock အစကို 0 ဟု သတ်မှတ်မည်။ အရေအတွက်ကို Purchase မှ သွင်းရမည်။
            payload.initialStock = 0; 
            payload.quantity = 0;
            // Admin အနေဖြင့် Branch 1 တွင် အမည်စာရင်း စတင်မှတ်ပုံတင်မည်
            payload.targetBranchId = 1;
            payload.branchId = 1;
            await api.post("/products", payload);
        }
        document.getElementById("master-product-modal")?.classList.add("hidden");
        await loadMasterProducts();
        alert("ဗဟိုကုန်ပစ္စည်းစာရင်းနှင့် ဈေးနှုန်းများ အောင်မြင်စွာ Update ဖြစ်သွားပါပြီ။ ဆိုင်ခွဲအားလုံးတွင် သက်ရောက်မည်ဖြစ်ပါသည်။");
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}
