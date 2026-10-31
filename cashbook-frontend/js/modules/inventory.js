// cashbook-frontend/js/modules/inventory.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { setKPI } from "../app.js";

let products = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initInventory() {
    bindEvents();
    await loadInventory();
}

function bindEvents() {
    // Export CSV ကို မည်သည့် User မဆို ဝင်ရောက်အသုံးပြုနိုင်ရန် အမြဲဖွင့်ပေးမည်
    document.getElementById("btn-export-csv")?.addEventListener("click", exportToCSV);

    if (state.isAdmin()) {
        document.getElementById("btn-add-product")?.addEventListener("click", () => openProductModal());
        document.getElementById("btn-import-csv")?.addEventListener("click", triggerImport);
    } else {
        document.getElementById("btn-add-product")?.classList.add("hidden");
        document.getElementById("btn-import-csv")?.classList.add("hidden");
        // btn-export-csv ကို hidden မလုပ်တော့ပါ (Cashier များပါ ထုတ်ယူနိုင်ပါပြီ)
    }

    document.getElementById("btn-close-product-modal")?.addEventListener("click", () => {
        document.getElementById("product-modal")?.classList.add("hidden");
    });
    document.getElementById("product-form")?.addEventListener("submit", submitProduct);
    
    // Waste Modal Events
    document.getElementById("btn-close-waste-modal")?.addEventListener("click", () => {
        document.getElementById("waste-modal")?.classList.add("hidden");
    });
    document.getElementById("waste-form")?.addEventListener("submit", submitWaste);

    document.getElementById("inv-category-filter")?.addEventListener("change", filterAndRender);
    document.getElementById("inv-search")?.addEventListener("input", filterAndRender);
}

async function loadInventory() {
    const tbody = document.getElementById("inv-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        products = res.data || [];

        populateCategoryFilter();
        updateInventoryKPIs();
        filterAndRender();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("inv-category-filter");
    if (!select) return;
    const current = select.value;
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${products.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (cats.includes(current)) select.value = current;
}

function updateInventoryKPIs() {
    const totalTypes = products.length;
    const totalPieces = products.reduce((sum, p) => sum + Number(p.current_stock || 0), 0);
    const totalCostValue = products.reduce((sum, p) => sum + (Number(p.current_stock || 0) * Number(p.cost_price || 0)), 0);
    const lowStockCount = products.filter(p => Number(p.current_stock || 0) <= Number(p.alert_quantity || 5)).length;

    setKPI(1, "Total Category", totalTypes, "fa-tags", "blue");
    setKPI(2, "Stock Balances", totalPieces, "fa-shirt", "emerald");
    setKPI(3, "Stock Value", totalCostValue, "fa-vault", "amber");
    setKPI(4, "Low Stock", lowStockCount, "fa-triangle-exclamation", "rose");
}

function filterAndRender() {
    const cat = document.getElementById("inv-category-filter")?.value || "";
    const kw = (document.getElementById("inv-search")?.value || "").trim().toLowerCase();

    const filtered = products.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    renderTable(filtered);
}

function renderTable(list) {
    const tbody = document.getElementById("inv-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-12 text-center text-slate-400 font-bold text-base">အထည်စာရင်း မတွေ့ရှိပါ</td></tr>`;
        return;
    }

    list.forEach(item => {
        const stock = Number(item.current_stock || 0);
        const isLow = stock <= Number(item.alert_quantity || 5);

        // Admin ဖြစ်မှသာ ခလုတ်များ နှိပ်ခွင့်ရှိမည်၊ မဟုတ်လျှင် Disabled ပုံစံ အရောင်မှိန်မည်
        const actionButtons = state.isAdmin() ? `
            <button type="button" data-id="${item.id}" title="အချက်အလက် ပြင်မည်" class="btn-edit-prod w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" data-id="${item.id}" title="အလေအလွင့်/ပျက်စီး စာရင်းသွင်းမည်" class="btn-waste-prod w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-amber-500 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                <i class="fa-solid fa-box-open"></i>
            </button>
            <button type="button" data-id="${item.id}" title="ဖျက်မည်" class="btn-delete-prod w-9 h-9 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        ` : `
            <button type="button" disabled title="Admin သာ ပြင်ခွင့်ရှိသည်" class="w-9 h-9 flex items-center justify-center bg-slate-100/50 dark:bg-slate-800/50 rounded-xl text-slate-400 opacity-50 cursor-not-allowed">
                <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button type="button" disabled title="Admin သာ ပြင်ခွင့်ရှိသည်" class="w-9 h-9 flex items-center justify-center bg-slate-100/50 dark:bg-slate-800/50 rounded-xl text-slate-400 opacity-50 cursor-not-allowed">
                <i class="fa-solid fa-box-open"></i>
            </button>
            <button type="button" disabled title="Admin သာ ပြင်ခွင့်ရှိသည်" class="w-9 h-9 flex items-center justify-center bg-slate-100/50 dark:bg-slate-800/50 rounded-xl text-slate-400 opacity-50 cursor-not-allowed">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-500 dark:text-slate-400">
                <div class="font-bold text-slate-800 dark:text-slate-200 text-base">${escapeHtml(item.sku || "-")}</div>
                <div>${escapeHtml(item.barcode || "")}</div>
            </td>
            <td class="p-4">
                <span class="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-bold">
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
                <span class="px-3.5 py-1.5 rounded-xl font-mono font-black text-base ${isLow ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"}">
                    ${stock.toLocaleString()}
                </span>
            </td>
            <td class="p-4 text-center">
                <div class="flex items-center justify-center gap-2">
                    ${actionButtons}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (state.isAdmin()) {
        tbody.querySelectorAll(".btn-edit-prod").forEach(btn => {
            btn.onclick = () => {
                const prod = products.find(p => p.id === Number(btn.dataset.id));
                if (prod) openProductModal(prod);
            };
        });

        tbody.querySelectorAll(".btn-waste-prod").forEach(btn => {
            btn.onclick = () => {
                const prod = products.find(p => p.id === Number(btn.dataset.id));
                if (prod) openWasteModal(prod);
            };
        });

        tbody.querySelectorAll(".btn-delete-prod").forEach(btn => {
            btn.onclick = () => {
                const id = Number(btn.dataset.id);
                deleteProduct(id);
            };
        });
    }
}

async function deleteProduct(id) {
    if (!confirm("ဤအထည်ကို စာရင်းမှ အမှန်တကယ် ဖျက်ပစ်ရန် သေချာပါသလား?")) return;
    try {
        await api.delete(`/products/${id}`);
        await loadInventory();
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

// --- Waste Modal Logic ---
function openWasteModal(prod) {
    const modal = document.getElementById("waste-modal");
    document.getElementById("waste-form")?.reset();

    safeSetValue("waste-prod-id", prod.id);
    safeSetValue("waste-unit-cost", prod.cost_price || 0);
    safeSetValue("waste-prod-name", `${prod.item_name} (${prod.sku || "-"})`);
    safeSetValue("waste-current-stock", prod.current_stock || 0);
    
    const qtyInput = document.getElementById("waste-qty");
    if (qtyInput) {
        qtyInput.max = prod.current_stock || 0;
    }

    modal?.classList.remove("hidden");
}

async function submitWaste(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-waste");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("waste-prod-id")?.value;
    const branchId = state.currentBranch?.id || 1;
    const qty = parseInt(document.getElementById("waste-qty")?.value, 10);
    const unitCost = parseFloat(document.getElementById("waste-unit-cost")?.value) || 0;
    const reason = document.getElementById("waste-reason")?.value.trim();

    const payload = {
        branch_id: branchId,
        product_id: parseInt(prodId, 10),
        quantity: qty,
        unit_cost: unitCost,
        reason: reason
    };

    try {
        await api.post("/waste", payload); 
        document.getElementById("waste-modal")?.classList.add("hidden");
        await loadInventory(); 
        alert("အလေအလွင့်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။ လက်ကျန်ထဲမှ နှုတ်ပြီးပါပြီ။");
    } catch (err) {
        alert("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- Edit Product Logic (Admin) ---
function openProductModal(prod = null) {
    const modal = document.getElementById("product-modal");
    const title = document.getElementById("product-modal-title");
    document.getElementById("product-form")?.reset();

    if (prod) {
        if (title) title.textContent = "အထည်အချက်အလက် ပြင်ဆင်မည်";
        safeSetValue("prod-id", prod.id);
        safeSetValue("prod-sku", prod.sku || "");
        safeSetValue("prod-barcode", prod.barcode || "");
        safeSetValue("prod-category", prod.category || "");
        safeSetValue("prod-name", prod.item_name || "");
        safeSetValue("prod-pattern", prod.pattern || "");
        safeSetValue("prod-color", prod.color || "");
        safeSetValue("prod-size", prod.size || "Free Size");
        safeSetValue("prod-cost", prod.cost_price || 0);
        safeSetValue("prod-retail", prod.retail_price || 0);
        safeSetValue("prod-wholesale", prod.wholesale_price || 0);
    } else {
        if (title) title.textContent = "အထည်အချက်အလက်သစ် မှတ်ပုံတင်မည်";
        safeSetValue("prod-id", "");
        safeSetValue("prod-size", "Free Size");
    }

    modal?.classList.remove("hidden");
}

async function submitProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("prod-id")?.value;
    const branchId = state.currentBranch?.id || 1;

    const payload = {
        sku: document.getElementById("prod-sku")?.value.trim() || null,
        barcode: document.getElementById("prod-barcode")?.value.trim() || null,
        category: document.getElementById("prod-category")?.value.trim(),
        itemName: document.getElementById("prod-name")?.value.trim(),
        pattern: document.getElementById("prod-pattern")?.value.trim() || null,
        color: document.getElementById("prod-color")?.value.trim() || null,
        size: document.getElementById("prod-size")?.value.trim() || "Free Size",
        costPrice: parseFloat(document.getElementById("prod-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("prod-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("prod-wholesale")?.value) || 0,
        targetBranchId: branchId,
        branchId
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
        } else {
            payload.initialStock = 0; 
            payload.quantity = 0;
            await api.post("/products", payload);
        }
        document.getElementById("product-modal")?.classList.add("hidden");
        await loadInventory();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- CSV Export Logic ---
function exportToCSV() {
    if (products.length === 0) {
        alert("ထုတ်ယူရန် စာရင်းမရှိပါ။");
        return;
    }
    const currentYear = new Date().getFullYear();
    let csvContent = "SKU,Barcode,Category,Item Name,Pattern,Color,Size,Cost Price,Retail Price,Wholesale Price,Current Stock\n";
    
    products.forEach(p => {
        const row = [
            `"${escapeHtml(p.sku || '')}"`,
            `"${escapeHtml(p.barcode || '')}"`,
            `"${escapeHtml(p.category || '')}"`,
            `"${escapeHtml(p.item_name || '')}"`,
            `"${escapeHtml(p.pattern || '')}"`,
            `"${escapeHtml(p.color || '')}"`,
            `"${escapeHtml(p.size || 'Free Size')}"`,
            p.cost_price || 0,
            p.retail_price || 0,
            p.wholesale_price || 0,
            p.current_stock || 0
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" }); 
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Stock_Balances_FY${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- CSV Import Logic ---
function triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            await processImport(text);
        };
        reader.readAsText(file);
    };
    input.click();
}

async function processImport(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) {
        alert("CSV ဖိုင်ထဲတွင် အချက်အလက် မရှိပါ။");
        return;
    }
    
    let successCount = 0;
    const branchId = state.currentBranch?.id || 1;
    
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/(^"|"$)/g, '')) || lines[i].split(',');
        if (row.length < 4) continue; 
        
        const payload = {
            sku: row[0] || null,
            barcode: row[1] || null,
            category: row[2] || "Uncategorized",
            itemName: row[3] || "Imported Item",
            pattern: row[4] || null,
            color: row[5] || null,
            size: row[6] || "Free Size",
            costPrice: parseFloat(row[7]) || 0,
            retailPrice: parseFloat(row[8]) || 0,
            wholesalePrice: parseFloat(row[9]) || 0,
            initialStock: parseInt(row[10]) || 0,
            quantity: parseInt(row[10]) || 0,
            targetBranchId: branchId,
            branchId: branchId
        };
        
        try {
            await api.post("/products", payload);
            successCount++;
        } catch (e) {
            console.error("Import error line " + i, e);
        }
    }
    alert(`အထည်အချက်အလက် အသစ် ${successCount} ခု အောင်မြင်စွာ ထည့်သွင်းပြီးပါပြီ။`);
    await loadInventory();
}
