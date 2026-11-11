// cashbook-frontend/js/modules/master_products.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { ui } from "../core/ui.js";
import { PaginationController } from "../core/pagination.js";
import { setKPI, getLocalTodayDate } from "../app.js";

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

/**
 * မြန်မာဂဏန်း (၀-၉) နှင့် ကော်မာများကို ဖယ်ရှားပြီး Number ပြောင်းပေးသည့် Helper
 */
function parseAnyNumber(val, isInteger = true) {
    if (!val && val !== 0) return 0;
    const myanmarDigits = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];
    let cleanStr = String(val).replace(/,/g, "").trim();
    myanmarDigits.forEach((d, idx) => {
        cleanStr = cleanStr.replaceAll(d, String(idx));
    });
    const num = parseFloat(cleanStr);
    if (isNaN(num)) return 0;
    return isInteger ? Math.round(num) : Math.round(num * 1000) / 1000;
}

/**
 * CSV စာကြောင်းတစ်ကြောင်းကို ကွက်လပ်အလွတ် (Empty Column) များ မပျောက်စေဘဲ အတိအကျ ခွဲထုတ်ပေးသည့် Parser
 */
function parseCsvLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === "," && !inQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += ch;
        }
    }
    result.push(current.trim());
    return result;
}

export async function initMasterProducts() {
    if (!state.isAdmin()) {
        ui.toast.error("ဤစာမျက်နှာကို Admin သာလျှင် အသုံးပြုခွင့်ရှိပါသည်။");
        return;
    }
    ensureMasterStockFields();
    bindEvents();
    await loadMasterProducts();
}

/**
 * master_products.html ရှိ #master-product-form တွင် စာရင်းဖွင့်လက်ကျန် (#master-prod-stock) နှင့် Alert Qty အကွက် ထည့်ပေးခြင်း
 */
function ensureMasterStockFields() {
    const form = document.getElementById("master-product-form");
    if (!form || document.getElementById("master-prod-stock")) return;

    const submitContainer = form.querySelector("button[type='submit']")?.parentElement;
    if (submitContainer) {
        const stockDiv = document.createElement("div");
        stockDiv.className = "grid grid-cols-2 gap-3 pt-1";
        stockDiv.innerHTML = `
            <div>
                <label id="lbl-master-prod-stock" class="block text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">
                    စာရင်းဖွင့် လက်ကျန်အရေအတွက်
                </label>
                <input type="number" id="master-prod-stock" min="0" step="any" value="0" placeholder="0"
                    class="w-full text-base font-mono font-black bg-emerald-50/50 dark:bg-slate-950 border border-emerald-400 dark:border-emerald-700/80 rounded-xl px-3.5 py-2 text-emerald-700 dark:text-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-500">
            </div>
            <div>
                <label class="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    စတော့နည်း သတိပေးချက် (Alert Qty)
                </label>
                <input type="number" id="master-prod-alert-qty" min="0" step="any" value="5" placeholder="5"
                    class="w-full text-base font-mono font-black bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500">
            </div>
        `;
        form.insertBefore(stockDiv, submitContainer);
    }
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
            setTimeout(() => icon?.classList.remove("fa-spin"), 400);
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
        // branch_id = ALL ဖြင့် ဆိုင်ခွဲအားလုံးရှိ စုစုပေါင်း လက်ကျန်ပေါင်းလဒ်ကို ဆွဲယူမည်
        const res = await api.get("/products", { branch_id: "ALL" });
        masterProducts = res.data || [];
        currentFilteredMaster = [...masterProducts];

        populateCategoryFilter();
        updateMasterKPIs();
        filterAndRenderMaster();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-rose-500 font-bold text-xs">ဗဟိုစာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function updateMasterKPIs() {
    const totalItems = masterProducts.length;
    const uniqueCats = new Set(masterProducts.map(p => p.category).filter(Boolean)).size;
    const totalAllStock = masterProducts.reduce((sum, p) => sum + Number(p.current_stock || p.quantity || 0), 0);
    const totalValuation = masterProducts.reduce((sum, p) => {
        return sum + Math.round(Number(p.current_stock || p.quantity || 0) * Number(p.cost_price || 0));
    }, 0);

    setKPI(1, "Master Items", totalItems, "fa-boxes-packing", "blue");
    setKPI(2, "Categories", uniqueCats, "fa-layer-group", "purple");
    setKPI(3, "All-Branch Stock", totalAllStock, "fa-cubes", "emerald");
    setKPI(4, "Total Valuation", totalValuation, "fa-vault", "amber");
}

function populateCategoryFilter() {
    const select = document.getElementById("master-category-filter");
    if (!select) return;
    const currentVal = select.value;
    const cats = [...new Set(masterProducts.map(p => p.category).filter(Boolean))];
    
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${masterProducts.length})</option>`;
    cats.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
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
 * Master Table Rendering (11 Columns - Pro Typography & Edit/Delete Actions)
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
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/60 transition h-11 whitespace-nowrap";

        const stock = Number(item.current_stock || item.quantity || 0);
        const unit = item.size || "ထည်";

        tr.innerHTML = `
            <!-- 1. NO -->
            <td class="py-2 px-3 text-center font-mono text-xs text-slate-400 w-12">${startIdx + idx + 1}</td>
            
            <!-- 2. BARCODE -->
            <td class="py-2 px-3 text-left font-mono text-xs font-semibold text-slate-600 dark:text-slate-400 w-28 truncate" title="${escapeHtml(item.barcode || item.sku || "-")}">${escapeHtml(item.barcode || item.sku || "-")}</td>
            
            <!-- 3. CATEGORY -->
            <td class="py-2 px-4 text-left text-xs font-bold text-emerald-600 dark:text-emerald-400 w-32 truncate" title="${escapeHtml(item.category || "-")}">${escapeHtml(item.category || "-")}</td>
            
            <!-- 4. ITEM NAME -->
            <td class="py-2 px-4 text-left text-xs font-extrabold text-slate-900 dark:text-slate-100 min-w-[180px] truncate" title="${escapeHtml(item.item_name || "-")}">${escapeHtml(item.item_name || "-")}</td>
            
            <!-- 5. UNIT -->
            <td class="py-2 px-3 text-left font-mono text-xs font-bold text-slate-600 dark:text-slate-400 w-20">${escapeHtml(unit)}</td>
            
            <!-- 6. COLOR -->
            <td class="py-2 px-3 text-left text-xs font-semibold text-slate-600 dark:text-slate-400 w-24 truncate" title="${escapeHtml(item.color || "-")}">${escapeHtml(item.color || "-")}</td>
            
            <!-- 7. TOTAL QTY -->
            <td class="py-2 px-4 text-center font-mono font-black text-sm text-blue-600 dark:text-blue-400 w-28">
                ${stock.toLocaleString()}
            </td>

            <!-- 8. PURCHASE -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300 w-28">${Number(item.cost_price || 0).toLocaleString()}</td>
            
            <!-- 9. WHOLESALE -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-blue-600 dark:text-blue-400 w-28">${Number(item.wholesale_price || 0).toLocaleString()}</td>
            
            <!-- 10. RETAIL -->
            <td class="py-2 px-4 text-right font-mono text-sm font-bold text-emerald-600 dark:text-emerald-400 w-28">${Number(item.retail_price || 0).toLocaleString()}</td>
            
            <!-- 11. ACTION (Sticky Right) -->
            <td class="py-2 px-3 text-center sticky right-0 z-10 w-24">
                <div class="flex items-center justify-center gap-1.5">
                    <button type="button" data-id="${item.id}" title="ပြင်ဆင်မည်" class="btn-edit-master w-7 h-7 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 dark:hover:bg-blue-600 text-blue-600 hover:text-white dark:text-blue-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button type="button" data-id="${item.id}" title="စာရင်းမှ ဖျက်မည်" class="btn-delete-master w-7 h-7 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 dark:hover:bg-rose-600 text-rose-500 hover:text-white dark:text-rose-400 dark:hover:text-white rounded-lg border border-slate-200 dark:border-slate-700/80 transition cursor-pointer shadow-sm active:scale-95">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
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

    tbody.querySelectorAll(".btn-delete-master").forEach(btn => {
        btn.onclick = () => {
            deleteMasterProduct(Number(btn.dataset.id));
        };
    });

    pagination.renderControls("master-products-pagination");
}

function safeSetValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function openMasterModal(prod = null) {
    ensureMasterStockFields();
    const modal = document.getElementById("master-product-modal");
    const title = document.getElementById("master-modal-title");
    const btnText = document.getElementById("master-modal-btn-text");
    const stockInput = document.getElementById("master-prod-stock");
    const stockLabel = document.getElementById("lbl-master-prod-stock");
    document.getElementById("master-product-form")?.reset();

    const rawBranchId = state.currentBranch?.id;
    const isAllBranches = !rawBranchId || String(rawBranchId) === "ALL";
    const branchName = isAllBranches ? "Main Home Shop" : (state.currentBranch?.name || "Main Home Shop");

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
        safeSetValue("master-prod-alert-qty", prod.alert_quantity ?? 5);
        safeSetValue("master-prod-stock", prod.current_stock ?? 0);

        if (stockInput) {
            // Product Master table displays All-Branch sum, so disable direct stock overwrite on Edit to prevent merging all branches into one
            stockInput.disabled = true;
            stockInput.classList.add("opacity-50", "cursor-not-allowed");
            if (stockLabel) stockLabel.textContent = "စုစုပေါင်း လက်ကျန် (ဆိုင်ခွဲအားလုံး)";
        }
    } else {
        if (title) title.textContent = "ဗဟိုကုန်ပစ္စည်းအမည်သစ်နှင့် စာရင်းဖွင့်လက်ကျန် သွင်းမည်";
        if (btnText) btnText.textContent = "ဗဟိုစာရင်းသို့ သိမ်းဆည်းမည်";
        safeSetValue("master-prod-id", "");
        safeSetValue("master-prod-size", "ထည်");
        safeSetValue("master-prod-cost", 0);
        safeSetValue("master-prod-retail", 0);
        safeSetValue("master-prod-wholesale", 0);
        safeSetValue("master-prod-alert-qty", 5);
        safeSetValue("master-prod-stock", 0);

        if (stockInput) {
            stockInput.disabled = false;
            stockInput.classList.remove("opacity-50", "cursor-not-allowed");
            if (stockLabel) stockLabel.textContent = `စာရင်းဖွင့် လက်ကျန်အရေအတွက် (${branchName})`;
        }
    }

    modal?.classList.remove("hidden");
    document.getElementById("master-prod-name")?.focus();
}

async function submitMasterProduct(e) {
    e.preventDefault();
    const btn = document.getElementById("btn-submit-master-product");
    if (btn) btn.disabled = true;

    const prodId = document.getElementById("master-prod-id")?.value;
    const rawBranchId = state.currentBranch?.id;
    const targetBranchId = (!rawBranchId || String(rawBranchId) === "ALL") ? 1 : Number(rawBranchId);
    const stockQty = parseAnyNumber(document.getElementById("master-prod-stock")?.value, false);
    const alertQty = parseAnyNumber(document.getElementById("master-prod-alert-qty")?.value, false);

    const payload = {
        sku: document.getElementById("master-prod-sku")?.value.trim() || null,
        barcode: document.getElementById("master-prod-barcode")?.value.trim() || null,
        category: document.getElementById("master-prod-category")?.value.trim(),
        itemName: document.getElementById("master-prod-name")?.value.trim(),
        pattern: document.getElementById("master-prod-pattern")?.value.trim() || null,
        color: document.getElementById("master-prod-color")?.value.trim() || null,
        size: document.getElementById("master-prod-size")?.value.trim() || "ထည်",
        costPrice: parseAnyNumber(document.getElementById("master-prod-cost")?.value, true),
        retailPrice: parseAnyNumber(document.getElementById("master-prod-retail")?.value, true),
        wholesalePrice: parseAnyNumber(document.getElementById("master-prod-wholesale")?.value, true),
        alertQuantity: alertQty
    };

    try {
        if (prodId) {
            await api.put(`/products/${prodId}`, payload);
            ui.toast.success("အချက်အလက် ပြင်ဆင်ပြီးပါပြီ။ ဆိုင်ခွဲအားလုံးတွင် သက်ရောက်မည်ဖြစ်ပါသည်။");
        } else {
            payload.initialStock = stockQty;
            payload.quantity = stockQty;
            payload.targetBranchId = targetBranchId;
            payload.branchId = targetBranchId;
            await api.post("/products", payload);
            ui.toast.success("ဗဟိုအထည်အသစ်နှင့် စာရင်းဖွင့်လက်ကျန် မှတ်ပုံတင်ပြီးပါပြီ။");
        }
        document.getElementById("master-product-modal")?.classList.add("hidden");
        await loadMasterProducts();
    } catch (err) {
        ui.toast.error("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function deleteMasterProduct(id) {
    const confirmed = await ui.confirm("ဤပစ္စည်းကို ဗဟိုကုန်ပစ္စည်းစာရင်းမှ အမှန်တကယ် ပယ်ဖျက်လိုပါသလား?", "error");
    if (!confirmed) return;

    try {
        await api.delete(`/products/${id}`);
        ui.toast.success("ဗဟိုစာရင်းမှ ပယ်ဖျက်ပြီးပါပြီ။");
        await loadMasterProducts();
    } catch (err) {
        ui.toast.error("ဖျက်၍မရပါ: " + err.message);
    }
}

// --- CSV Export & Import Logic ---
function exportMasterProductsToCSV() {
    const dataToExport = currentFilteredMaster.length > 0 ? currentFilteredMaster : masterProducts;
    if (dataToExport.length === 0) {
        return ui.toast.warning("ထုတ်ယူရန် စာရင်း မရှိပါ။");
    }

    let csvContent = "NO,BARCODE,CATEGORY,ITEM NAME,UNIT,COLOR,PATTERN,TOTAL QTY,PURCHASE,WHOLESALE,RETAIL\n";

    dataToExport.forEach((p, idx) => {
        const no = idx + 1;
        const row = [
            no,
            escapeCsv(p.barcode || p.sku),
            escapeCsv(p.category),
            escapeCsv(p.item_name),
            escapeCsv(p.size || "ထည်"),
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
    link.download = `Master_Products_List_${getLocalTodayDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

function triggerImportMaster() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
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
    const lines = String(csvText || "").split(/\r?\n/).filter(line => line.trim() !== "");
    if (lines.length <= 1) {
        return ui.toast.warning("CSV ဖိုင်ထဲတွင် အချက်အလက် မရှိပါ။");
    }

    const rawBranchId = state.currentBranch?.id;
    const targetBranchId = (!rawBranchId || String(rawBranchId) === "ALL") ? 1 : Number(rawBranchId);

    const headerCols = parseCsvLine(lines[0]).map(h => h.toUpperCase());
    const isStockBalancesFormat = headerCols[0] === "SKU" && headerCols[1] === "BARCODE";

    const bulkItems = [];
    for (let i = 1; i < lines.length; i++) {
        const row = parseCsvLine(lines[i]);
        if (row.length < 4) continue;

        if (isStockBalancesFormat) {
            // Format: SKU, Barcode, Category, Item Name, Pattern, Color, Unit/Size, Cost Price, Retail Price, Wholesale Price, Current Stock
            const itemName = row[3] || "";
            if (!itemName) continue;
            bulkItems.push({
                sku: row[0] || null,
                barcode: row[1] || null,
                category: row[2] || "အထည်",
                itemName,
                pattern: row[4] || null,
                color: row[5] || null,
                size: row[6] || "ထည်",
                costPrice: parseAnyNumber(row[7], true),
                retailPrice: parseAnyNumber(row[8], true),
                wholesalePrice: parseAnyNumber(row[9] || row[8], true),
                quantity: row[10] !== undefined ? parseAnyNumber(row[10], false) : 0
            });
        } else {
            // Format: NO, BARCODE/SKU, CATEGORY, ITEM NAME, UNIT/SIZE, COLOR, PATTERN, TOTAL QTY, PURCHASE, WHOLESALE, RETAIL
            const itemName = row[3] || "";
            if (!itemName) continue;
            bulkItems.push({
                sku: row[1] || null,
                barcode: row[1] || null,
                category: row[2] || "အထည်",
                itemName,
                size: row[4] || "ထည်",
                color: row[5] || null,
                pattern: row[6] || null,
                quantity: row[7] !== undefined ? parseAnyNumber(row[7], false) : 0,
                costPrice: parseAnyNumber(row[8], true),
                wholesalePrice: parseAnyNumber(row[9], true),
                retailPrice: parseAnyNumber(row[10] || row[9], true)
            });
        }
    }

    if (bulkItems.length === 0) {
        return ui.toast.warning("သွင်းယူနိုင်သော ပစ္စည်းအချက်အလက် မတွေ့ပါ။");
    }

    try {
        ui.toast.info(`ပစ္စည်း (${bulkItems.length}) မျိုး ဗဟိုစာရင်းသို့ သွင်းယူနေပါသည်...`);
        const res = await api.post("/products/bulk", {
            branchId: targetBranchId,
            items: bulkItems
        });
        const payload = res?.data || res;
        const msg = payload?.message || `ပစ္စည်းအသစ် (${payload?.count ?? bulkItems.length}) မျိုး အောင်မြင်စွာ မှတ်ပုံတင်ပြီးပါပြီ။`;
        ui.toast.success(msg);
        await loadMasterProducts();
    } catch (err) {
        ui.toast.error("CSV သွင်းယူမှု မအောင်မြင်ပါ: " + err.message);
    }
}
