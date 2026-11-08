// cashbook-frontend/js/modules/master_products.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js"; // Import Professional UI (Toast)
import { PaginationController } from "../core/pagination.js";
import { setKPI } from "../app.js"; // Optional: KPI update for Master

let masterProducts = [];
let currentFilteredMaster = [];

const pagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderMasterTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeCsv(val) {
    let str = String(val ?? "").trim();
    if (/^[=+@-]/.test(str)) str = "'" + str;
    return `"${str.replace(/"/g, '""')}"`;
}

export async function initMasterProducts() {
    if (!state.isAdmin()) {
        ui.toast.error("ဤစာမျက်နှာကို Admin သာလျှင် အသုံးပြုခွင့်ရှိပါသည်။");
        return;
    }
    bindEvents();
    await loadMasterProducts();
}

function bindEvents() {
    // Toolbar: Filter & Search
    document.getElementById("master-search")?.addEventListener("input", filterAndRenderMaster);
    document.getElementById("master-category-filter")?.addEventListener("change", filterAndRenderMaster);

    // Export & Import
    document.getElementById("btn-export-master-csv")?.addEventListener("click", exportMasterProductsToCSV);
    document.getElementById("btn-import-master-csv")?.addEventListener("click", triggerImportMaster);

    // Refresh Button
    const refreshBtn = document.getElementById("btn-refresh-master");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
            const icon = refreshBtn.querySelector("i");
            icon?.classList.add("fa-spin");
            await loadMasterProducts();
            setTimeout(() => icon?.classList.remove("fa-spin"), 500);
            ui.toast.info("ဗဟိုစာရင်းများ အသစ်ပြန်လည်ဆွဲယူပြီးပါပြီ");
        });
    }

    // Modal Events
    document.getElementById("btn-add-master-product")?.addEventListener("click", () => openMasterModal(null));
    document.getElementById("btn-close-master-modal")?.addEventListener("click", () => {
        document.getElementById("master-product-modal")?.classList.add("hidden");
    });
    document.getElementById("master-product-form")?.addEventListener("submit", submitMasterProduct);
}

async function loadMasterProducts() {
    const tbody = document.getElementById("master-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-16 text-center text-slate-400"><i class="fa-solid fa-boxes-packing fa-spin text-2xl mb-3 text-blue-500"></i><div class="font-bold text-xs">ဗဟိုကုန်ပစ္စည်းစာရင်း ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        // Fetch all products (master logic handles sum of stocks across branches if needed, or just pulls main products table)
        const res = await api.get("/products");
        masterProducts = res.data || [];
        currentFilteredMaster = [...masterProducts];
        
        populateCategoryFilter();
        pagination.reset();
        renderMasterTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-rose-500 font-bold text-xs">ဗဟိုစာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function populateCategoryFilter() {
    const select = document.getElementById("master-category-filter");
    if (!select) return;
    const currentVal = select.value;
    const cats = [...new Set(masterProducts.map(p => p.category).filter(Boolean))];
    
    select.innerHTML = `<option value="">All Categories</option>`;
    cats.forEach(c => {
        select.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
    });
    if (cats.includes(currentVal)) select.value = currentVal;
}

function filterAndRenderMaster() {
    const kw = (document.getElementById("master-search")?.value || "").trim().toLowerCase();
    const cat = document.getElementById("master-category-filter")?.value || "";

    currentFilteredMaster = masterProducts.filter(p => {
        if (cat && p.category !== cat) return false;
        if (!kw) return true;
        const hay = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    pagination.reset();
    renderMasterTable();
}

/**
 * Master Table Rendering (11 Columns - Flat Design, Added TOTAL QTY)
 */
function renderMasterTable() {
    const tbody = document.getElementById("master-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (currentFilteredMaster.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="11" class="p-16 text-center text-slate-400 text-xs font-bold">
                    <i class="fa-solid fa-boxes-packing text-3xl mb-3 opacity-30"></i>
                    <div>ဗဟိုကုန်ပစ္စည်းစာရင်း မတွေ့ရှိပါ</div>
                </td>
            </tr>
        `;
        pagination.renderControls("master-products-pagination");
        return;
    }

    const pageItems = pagination.getPageItems(currentFilteredMaster);
    const startIdx = (pagination.currentPage - 1) * pagination.pageSize;

    pageItems.forEach((item, idx) => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-12 whitespace-nowrap"; // Flat row design

        // Default 'current_stock' represents main branch stock if not explicitly queried as total across all branches
        const stock = Number(item.current_stock || 0);
        const unit = item.size || "ထည်";

        tr.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(item.barcode || item.sku || "-")}">${escapeHtml(item.barcode || item.sku || "-")}</td>
            
            <!-- 3. CATEGORY -->
            <td class="py-2 px-4 text-left text-base font-semibold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(item.category || "-")}">${escapeHtml(item.category || "-")}</td>
            
            <!-- 4. ITEM NAME -->
            <td class="py-2 px-4 text-left text-base font-bold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${escapeHtml(item.item_name || "-")}">${escapeHtml(item.item_name || "-")}</td>
            
            <!-- 5. SIZE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${escapeHtml(unit)}</td>
            
            <!-- 6. COLOR -->
            <td class="py-2 px-3 text-left text-base font-medium text-slate-600 dark:text-slate-400 w-24 truncate" title="${escapeHtml(item.color || "-")}">${escapeHtml(item.color || "-")}</td>
            
            <!-- 7. TOTAL QTY -->
            <td class="py-2 px-4 text-center w-28">
                <span class="px-2 py-1 rounded-lg font-mono font-black text-sm bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    ${stock.toLocaleString()}
                </span>
            </td>

            <!-- 8. PURCHASE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-slate-700 dark:text-slate-300 w-28">${Number(item.cost_price || 0).toLocaleString()}</td>
            
            <!-- 9. WHOLESALE -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-blue-600 dark:text-blue-400 w-28">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            
            <!-- 10. RETAIL -->
            <td class="py-2 px-4 text-right font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 w-28">${Number(item.retail_price || 0).toLocaleString()}</td>
            
            <!-- 11. ACTION -->
            <td class="py-2 px-3 text-center sticky right-0 bg-white dark:bg-[#151e32] z-10 shadow-[-4px_0_8px_rgba(0,0,0,0.06)] w-20">
                <button type="button" data-id="${item.id}" title="Edit Master Info" class="btn-edit-master w-7 h-7 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                    <i class="fa-solid fa-pen-to-square text-xs"></i>
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

    pagination.renderControls("master-products-pagination");
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function openMasterModal(prod = null) {
    const modal = document.getElementById("master-product-modal");
    const title = document.getElementById("master-modal-title");
    const btnText = document.getElementById("master-modal-btn-text");
    document.getElementById("master-product-form")?.reset();

    if (prod) {
        if (title) title.textContent = "ဗဟိုကုန်ပစ္စည်း အချက်အလက်နှင့် ဈေးနှုန်း ပြင်ဆင်မည်";
        if (btnText) btnText.textContent = "ပြင်ဆင်ချက် သိမ်းဆည်းမည်";
        safeSetValue("master-prod-id", prod.id);
        safeSetValue("master-prod-sku", prod.sku || "");
        safeSetValue("master-prod-barcode", prod.barcode || "");
        safeSetValue("master-prod-category", prod.category || "");
        safeSetValue("master-prod-name", prod.item_name || "");
        safeSetValue("master-prod-pattern", prod.pattern || "");
        safeSetValue("master-prod-color", prod.color || "");
        safeSetValue("master-prod-size", prod.size || "ထည်");
        safeSetValue("master-prod-cost", prod.cost_price || 0);
        safeSetValue("master-prod-retail", prod.retail_price || 0);
        safeSetValue("master-prod-wholesale", prod.wholesale_price || 0);
    } else {
        if (title) title.textContent = "ဗဟိုကုန်ပစ္စည်းအမည်သစ် မှတ်ပုံတင်မည်";
        if (btnText) btnText.textContent = "ဗဟိုစာရင်းသို့ သိမ်းဆည်းမည်";
        safeSetValue("master-prod-id", "");
        safeSetValue("master-prod-size", "ထည်");
    }

    modal?.classList.remove("hidden");
    document.getElementById("master-prod-sku")?.focus();
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
        size: document.getElementById("master-prod-size")?.value.trim() || "ထည်",
        costPrice: parseFloat(document.getElementById("master-prod-cost")?.value) || 0,
        retailPrice: parseFloat(document.getElementById("master-prod-retail")?.value) || 0,
        wholesalePrice: parseFloat(document.getElementById("master-prod-wholesale")?.value) || 0
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
            ui.toast.success("အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။ ဆိုင်ခွဲအားလုံးတွင် သက်ရောက်မည်ဖြစ်ပါသည်။");
        } else {
            payload.initialStock = 0; 
            payload.quantity = 0;
            payload.targetBranchId = 1;
            payload.branchId = 1;
            await api.post("/products", payload);
            ui.toast.success("ဗဟိုအထည်အသစ် မှတ်ပုံတင်ပြီးပါပြီ။");
        }
        document.getElementById("master-product-modal")?.classList.add("hidden");
        await loadMasterProducts();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// --- CSV Export & Import Logic ---
function exportMasterProductsToCSV() {
    const dataToExport = currentFilteredMaster.length > 0 ? currentFilteredMaster : masterProducts;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်း မရှိပါ။");
    }

    const currentYear = new Date().getFullYear();
    let csvContent = "NO,BARCODE,CATEGORY,ITEM NAME,SIZE,COLOR,PATTERN,TOTAL QTY,PURCHASE,WHOLESALE,RETAIL\n";

    dataToExport.forEach((p, idx) => {
        const no = idx + 1;
        const row = [
            no,
            escapeCsv(p.barcode || p.sku),
            escapeCsv(p.category),
            escapeCsv(p.item_name),
            escapeCsv(p.size || 'ထည်'),
            escapeCsv(p.color),
            escapeCsv(p.pattern),
            p.current_stock || 0,
            p.cost_price || 0,
            p.wholesale_price || 0,
            p.retail_price || 0
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Master_Products_List_${currentYear}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function triggerImportMaster() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv';
    input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            await processMasterImport(text);
        };
        reader.readAsText(file);
    };
    input.click();
}

async function processMasterImport(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== '');
    if (lines.length <= 1) {
        return ui.toast.warning("CSV ဖိုင်ထဲတွင် အချက်အလက် မရှိပါ။");
    }
    
    let successCount = 0;
    
    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(s => s.replace(/(^"|"$)/g, '')) || lines[i].split(',');
        if (row.length < 4) continue; 
        
        // Expected Format: NO, BARCODE/SKU, CATEGORY, ITEM NAME, SIZE, COLOR, PATTERN, QTY, PURCHASE, WHOLESALE, RETAIL
        const payload = {
            sku: row[1] || null,
            barcode: row[1] || null,
            category: row[2] || "အထည်",
            itemName: row[3] || "Imported Item",
            size: row[4] || "ထည်",
            color: row[5] || null,
            pattern: row[6] || null,
            initialStock: parseInt(row[7], 10) || 0,
            quantity: parseInt(row[7], 10) || 0,
            costPrice: parseFloat(row[8]) || 0,
            wholesalePrice: parseFloat(row[9]) || 0,
            retailPrice: parseFloat(row[10]) || 0,
            targetBranchId: 1,
            branchId: 1
        };
        
        try {
            await api.post("/products", payload);
            successCount++;
        } catch (e) {
            console.error("Import error line " + i, e);
        }
    }
    ui.toast.success(`ပစ္စည်းအသစ် ${successCount} မျိုး အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။`);
    await loadMasterProducts();
}
