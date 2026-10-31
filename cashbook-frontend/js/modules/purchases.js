// cashbook-frontend/js/modules/purchases.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";

let purchasesList = [];
let masterProducts = [];

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initPurchases() {
    bindEvents();
    await loadMasterProducts();
    await loadPurchases();
}

function bindEvents() {
    document.getElementById("btn-add-purchase")?.addEventListener("click", () => openPurchaseModal());
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", () => {
        document.getElementById("purchase-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("btn-add-pur-item")?.addEventListener("click", () => addPurchaseRow());

    const paymentSelect = document.getElementById("pur-payment-method");
    if (paymentSelect) {
        paymentSelect.addEventListener("change", (e) => {
            const bankContainer = document.getElementById("pur-bank-container");
            if (e.target.value === "bank") {
                bankContainer?.classList.remove("hidden");
            } else {
                bankContainer?.classList.add("hidden");
                const bankInput = document.getElementById("pur-bank-name");
                if (bankInput) bankInput.value = "";
            }
        });
    }
}

async function loadMasterProducts() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        masterProducts = res.data || [];
    } catch (err) {
        console.error("Master Products ရယူ၍ မရပါ:", err);
    }
}

async function loadPurchases() {
    const tbody = document.getElementById("pur-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/purchases", { branch_id: branchId });
        purchasesList = res.data || [];
        renderPurchasesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="13" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (purchasesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="13" class="p-12 text-center text-slate-400 font-bold text-base">အဝယ်စာရင်း မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    purchasesList.forEach(pur => {
        const dateStr = pur.created_at ? new Date(pur.created_at).toLocaleDateString("en-GB") : "-";
        
        let paymentBadge = "";
        if (pur.payment_method === "cash") {
            paymentBadge = `<span class="px-2.5 py-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold">လက်ငင်း</span>`;
        } else if (pur.payment_method === "bank") {
            paymentBadge = `<span class="px-2.5 py-1 bg-blue-500/15 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-bold">ဘဏ် (${escapeHtml(pur.bank_account_name || "Bank")})</span>`;
        } else {
            paymentBadge = `<span class="px-2.5 py-1 bg-rose-500/15 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-bold">အကြွေး</span>`;
        }

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-3.5 font-mono text-slate-500 dark:text-slate-400">${dateStr}</td>
            <td class="p-3.5 font-mono font-bold text-slate-800 dark:text-slate-200">${escapeHtml(pur.sku || pur.barcode || "-")}</td>
            <td class="p-3.5">
                <span class="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                    ${escapeHtml(pur.category || "-")}
                </span>
            </td>
            <td class="p-3.5">
                <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(pur.item_name || "-")}</div>
                <div class="text-xs text-slate-400">${escapeHtml(pur.pattern || "-")}</div>
            </td>
            <td class="p-3.5">
                <div>${escapeHtml(pur.color || "-")}</div>
                <div class="text-xs text-slate-400">${escapeHtml(pur.size || "Free Size")}</div>
            </td>
            <td class="p-3.5 text-center font-mono font-bold text-blue-600 dark:text-blue-400">
                ${Number(pur.quantity || 0).toLocaleString()}
            </td>
            <td class="p-3.5 text-center">${paymentBadge}</td>
            <td class="p-3.5 text-right font-mono text-slate-500">${Number(pur.unit_cost || 0).toLocaleString()}</td>
            <td class="p-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">${Number(pur.retail_price || 0).toLocaleString()}</td>
            <td class="p-3.5 text-right font-mono font-bold text-blue-600 dark:text-blue-400">${Number(pur.wholesale_price || 0).toLocaleString()}</td>
            <td class="p-3.5 font-bold text-slate-800 dark:text-slate-200">${escapeHtml(pur.supplier_name || "-")}</td>
            <td class="p-3.5 text-center">
                <span class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold uppercase">
                    ${escapeHtml(pur.status || "COMPLETED")}
                </span>
            </td>
            <td class="p-3.5 text-center">
                <div class="flex items-center justify-center gap-1.5">
                    <button type="button" data-id="${pur.purchase_id || pur.id}" title="ပြင်ဆင်မည်" class="btn-edit-pur w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-blue-600 hover:text-white rounded-lg text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                        <i class="fa-solid fa-pen-to-square text-xs"></i>
                    </button>
                    <button type="button" data-id="${pur.purchase_id || pur.id}" title="ဖျက်မည်" class="btn-delete-pur w-8 h-8 flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-rose-600 hover:text-white rounded-lg text-rose-500 hover:text-white transition cursor-pointer shadow-sm">
                        <i class="fa-solid fa-trash-can text-xs"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-edit-pur").forEach(btn => {
        btn.onclick = () => {
            const pur = purchasesList.find(p => (p.purchase_id || p.id) == btn.dataset.id);
            if (pur) openPurchaseModal(pur);
        };
    });

    tbody.querySelectorAll(".btn-delete-pur").forEach(btn => {
        btn.onclick = () => deletePurchase(btn.dataset.id);
    });
}

function generateAutoSKU(categoryName = "") {
    let prefix = "GAR";
    const cat = categoryName.toLowerCase();
    if (cat.includes("အင်္ကျီ") || cat.includes("shirt")) prefix = "SHRT";
    else if (cat.includes("ပုဆိုး") || cat.includes("pasho")) prefix = "PASHO";
    else if (cat.includes("လုံချည်") || cat.includes("lon")) prefix = "LON";

    const rand = Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${rand}`;
}

function openPurchaseModal(pur = null) {
    const modal = document.getElementById("purchase-modal");
    const editIdInput = document.getElementById("pur-edit-id");
    const title = document.getElementById("purchase-modal-title");
    
    if (pur) {
        title.textContent = "အဝယ်စာရင်း ပြင်ဆင်မည်";
        editIdInput.value = pur.purchase_id || pur.id;
        document.getElementById("pur-supplier").value = pur.supplier_name || "";
        document.getElementById("pur-payment-method").value = pur.payment_method || "cash";
        document.getElementById("pur-bank-name").value = pur.bank_account_name || "";
        if (pur.payment_method === "bank") {
            document.getElementById("pur-bank-container")?.classList.remove("hidden");
        } else {
            document.getElementById("pur-bank-container")?.classList.add("hidden");
        }
    } else {
        title.textContent = "အဝယ်စာရင်း (စတော့အဝင်) သွင်းမည်";
        editIdInput.value = "";
        document.getElementById("pur-supplier").value = "";
        document.getElementById("pur-payment-method").value = "cash";
        document.getElementById("pur-bank-name").value = "";
        document.getElementById("pur-bank-container")?.classList.add("hidden");
    }

    const tbody = document.getElementById("pur-items-container");
    if (tbody) tbody.innerHTML = "";
    
    addPurchaseRow(pur);
    updateTotalAmount();
    modal?.classList.remove("hidden");
}

function addPurchaseRow(existingData = null) {
    const tbody = document.getElementById("pur-items-container");
    if (!tbody) return;

    let productOptions = `<option value="">-- ပစ္စည်းရွေးချယ်ပါ --</option>`;
    productOptions += `<option value="NEW" class="font-bold text-emerald-600">+ ပစ္စည်းအသစ် ထည့်မည်...</option>`;
    masterProducts.forEach(p => {
        const isSel = existingData && existingData.product_id == p.id ? "selected" : "";
        productOptions += `<option value="${p.id}" ${isSel} data-cost="${p.cost_price || 0}" data-retail="${p.retail_price || 0}" data-wholesale="${p.wholesale_price || 0}">${escapeHtml(p.item_name)} (${escapeHtml(p.sku || "-")})</option>`;
    });

    const tr = document.createElement("tr");
    tr.className = "pur-item-row group border-b border-slate-200 dark:border-slate-700";
    tr.innerHTML = `
        <td class="p-2.5 align-top">
            <select class="pur-item-select w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2.5 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer">
                ${productOptions}
            </select>
            
            <!-- ပစ္စည်းအသစ်အတွက် Inline Form -->
            <div class="new-product-fields hidden mt-2 space-y-2 p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-emerald-500/30">
                <input type="text" placeholder="အမျိုးအစား (Category) ဥပမာ - အင်္ကျီ" class="new-cat w-full text-xs font-bold px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg">
                <input type="text" placeholder="ပစ္စည်းအမည် (Item Name) *" class="new-name w-full text-xs font-bold px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg">
                <div class="grid grid-cols-3 gap-1.5">
                    <input type="text" placeholder="SKU ကုတ် *" class="new-sku text-xs font-mono font-bold px-2 py-1 bg-white dark:bg-slate-900 border border-emerald-500/50 text-emerald-600 rounded-lg" title="Auto SKU သတ်မှတ်ပေးထားပါသည်">
                    <input type="text" placeholder="အရောင်" class="new-color text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg">
                    <input type="text" placeholder="ဆိုဒ်" class="new-size text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg" value="Free Size">
                </div>
            </div>
        </td>
        <td class="p-2.5 align-top">
            <input type="number" min="1" value="${existingData?.quantity || 1}" class="pur-item-qty w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="p-2.5 align-top">
            <input type="number" min="0" value="${existingData?.unit_cost || 0}" step="any" class="pur-item-cost w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-right text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="ဝယ်ဈေး">
        </td>
        <td class="p-2.5 align-top space-y-1.5">
            <div class="flex items-center gap-1">
                <input type="number" min="0" value="${existingData?.retail_price || 0}" step="any" class="pur-item-retail w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-right text-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="လက်လီဈေး *">
            </div>
            <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-slate-400 font-bold shrink-0">+ % :</span>
                <input type="number" placeholder="30" class="pur-retail-pct w-full text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-center font-mono font-bold" title="ဝယ်ဈေးပေါ် ရာခိုင်နှုန်းထည့်ပါ">
            </div>
        </td>
        <td class="p-2.5 align-top space-y-1.5">
            <div class="flex items-center gap-1">
                <input type="number" min="0" value="${existingData?.wholesale_price || 0}" step="any" class="pur-item-wholesale w-full text-xs font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-right text-blue-600 focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="လက်ကားဈေး *">
            </div>
            <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-slate-400 font-bold shrink-0">+ % :</span>
                <input type="number" placeholder="15" class="pur-wholesale-pct w-full text-[11px] px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-center font-mono font-bold" title="ဝယ်ဈေးပေါ် ရာခိုင်နှုန်းထည့်ပါ">
            </div>
        </td>
        <td class="p-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm pur-item-subtotal align-top pt-4">
            0
        </td>
        <td class="p-2.5 text-center align-top pt-3">
            <button type="button" class="btn-remove-row text-slate-400 hover:text-rose-500 transition cursor-pointer">
                <i class="fa-solid fa-circle-minus text-lg"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);

    const select = tr.querySelector(".pur-item-select");
    const newFields = tr.querySelector(".new-product-fields");
    const newCatInput = tr.querySelector(".new-cat");
    const newSkuInput = tr.querySelector(".new-sku");
    const qtyInput = tr.querySelector(".pur-item-qty");
    const costInput = tr.querySelector(".pur-item-cost");
    const retailInput = tr.querySelector(".pur-item-retail");
    const wholesaleInput = tr.querySelector(".pur-item-wholesale");
    const retailPct = tr.querySelector(".pur-retail-pct");
    const wholesalePct = tr.querySelector(".pur-wholesale-pct");
    const removeBtn = tr.querySelector(".btn-remove-row");

    // ပစ္စည်းအသစ် ရွေးချယ်မှု
    select.addEventListener("change", (e) => {
        if (e.target.value === "NEW") {
            newFields.classList.remove("hidden");
            newSkuInput.value = generateAutoSKU(newCatInput.value);
            costInput.value = 0;
            retailInput.value = 0;
            wholesaleInput.value = 0;
        } else {
            newFields.classList.add("hidden");
            const opt = e.target.options[e.target.selectedIndex];
            if (opt) {
                costInput.value = opt.getAttribute("data-cost") || 0;
                retailInput.value = opt.getAttribute("data-retail") || 0;
                wholesaleInput.value = opt.getAttribute("data-wholesale") || 0;
            }
        }
        calculateRow(tr);
    });

    newCatInput.addEventListener("input", () => {
        newSkuInput.value = generateAutoSKU(newCatInput.value);
    });

    // Live % တွက်ချက်ခြင်း (ခလုတ်နှိပ်စရာမလိုဘဲ ချက်ချင်း Auto ပြောင်းလဲခြင်း)
    const updatePricesLive = () => {
        const cost = parseFloat(costInput.value) || 0;
        const rPct = parseFloat(retailPct.value);
        const wPct = parseFloat(wholesalePct.value);

        if (!isNaN(rPct) && cost > 0) {
            retailInput.value = Math.round(cost + (cost * rPct / 100));
        }
        if (!isNaN(wPct) && cost > 0) {
            wholesaleInput.value = Math.round(cost + (cost * wPct / 100));
        }
    };

    costInput.addEventListener("input", () => {
        updatePricesLive();
        calculateRow(tr);
    });
    retailPct.addEventListener("input", updatePricesLive);
    wholesalePct.addEventListener("input", updatePricesLive);

    qtyInput.addEventListener("input", () => calculateRow(tr));

    removeBtn.addEventListener("click", () => {
        if (tbody.querySelectorAll(".pur-item-row").length > 1) {
            tr.remove();
            updateTotalAmount();
        } else {
            alert("အနည်းဆုံး ပစ္စည်းတစ်မျိုး ပါဝင်ရပါမည်။");
        }
    });

    calculateRow(tr);
}

function calculateRow(tr) {
    const qty = parseFloat(tr.querySelector(".pur-item-qty")?.value) || 0;
    const cost = parseFloat(tr.querySelector(".pur-item-cost")?.value) || 0;
    const subtotal = qty * cost;
    tr.querySelector(".pur-item-subtotal").textContent = subtotal.toLocaleString();
    updateTotalAmount();
}

function updateTotalAmount() {
    let total = 0;
    document.querySelectorAll(".pur-item-row").forEach(tr => {
        const qty = parseFloat(tr.querySelector(".pur-item-qty")?.value) || 0;
        const cost = parseFloat(tr.querySelector(".pur-item-cost")?.value) || 0;
        total += (qty * cost);
    });
    const el = document.getElementById("pur-total-amount");
    if (el) el.textContent = total.toLocaleString();
}

async function submitPurchase() {
    const supplier = document.getElementById("pur-supplier").value.trim();
    if (!supplier) return alert("ပေးသွင်းသူ (ပွဲရုံ) အမည် ထည့်ပါ။");

    const paymentMethod = document.getElementById("pur-payment-method").value;
    const bankName = document.getElementById("pur-bank-name").value.trim();
    if (paymentMethod === "bank" && !bankName) {
        return alert("ဘဏ်လွှဲဖြစ်ပါက ဘဏ်အကောင့်အမည် ထည့်ပါ။");
    }

    const editId = document.getElementById("pur-edit-id").value;
    const items = [];
    let hasError = false;
    let errMsg = "";

    document.querySelectorAll(".pur-item-row").forEach(tr => {
        const select = tr.querySelector(".pur-item-select");
        const prodVal = select.value;
        const qty = parseInt(tr.querySelector(".pur-item-qty").value, 10) || 0;
        const cost = parseFloat(tr.querySelector(".pur-item-cost").value) || 0;
        const retail = parseFloat(tr.querySelector(".pur-item-retail").value) || 0;
        const wholesale = parseFloat(tr.querySelector(".pur-item-wholesale").value) || 0;

        if (!prodVal) {
            hasError = true;
            errMsg = "ပစ္စည်းရွေးချယ်မှု ပြည့်စုံစွာ လုပ်ဆောင်ပေးပါ။";
            select.classList.add("border-rose-500");
            return;
        }

        // လက်လီ/လက်ကားဈေး မပါဘဲ စာရင်းသွင်းခွင့် မပြုခြင်း
        if (retail <= 0 || wholesale <= 0) {
            hasError = true;
            errMsg = "ပစ္စည်းတိုင်းအတွက် လက်လီဈေးနှင့် လက်ကားဈေးများကို မဖြစ်မနေ ထည့်သွင်းပေးရပါမည်။";
            tr.querySelector(".pur-item-retail").classList.add("border-rose-500");
            tr.querySelector(".pur-item-wholesale").classList.add("border-rose-500");
            return;
        }

        const itemObj = {
            quantity: qty,
            unit_cost: cost,
            retail_price: retail,
            wholesale_price: wholesale,
            subtotal: qty * cost
        };

        if (prodVal === "NEW") {
            const cat = tr.querySelector(".new-cat").value.trim() || "အထည်";
            const name = tr.querySelector(".new-name").value.trim();
            const sku = tr.querySelector(".new-sku").value.trim();
            const color = tr.querySelector(".new-color").value.trim() || null;
            const size = tr.querySelector(".new-size").value.trim() || "Free Size";

            if (!name) {
                hasError = true;
                errMsg = "ပစ္စည်းအသစ်အတွက် အမည် ဖြည့်သွင်းပေးပါ။";
                tr.querySelector(".new-name").classList.add("border-rose-500");
                return;
            }

            itemObj.is_new = true;
            itemObj.new_product = {
                category: cat,
                item_name: name,
                sku: sku || generateAutoSKU(cat),
                color: color,
                size: size,
                cost_price: cost,
                retail_price: retail,
                wholesale_price: wholesale
            };
        } else {
            itemObj.is_new = false;
            itemObj.product_id = parseInt(prodVal, 10);
        }

        items.push(itemObj);
    });

    if (hasError || items.length === 0) {
        return alert(errMsg || "ကျေးဇူးပြု၍ အချက်အလက်များ ပြည့်စုံစွာ ဖြည့်သွင်းပါ။");
    }

    const totalAmount = items.reduce((sum, it) => sum + it.subtotal, 0);
    const branchId = state.currentBranch?.id || 1;

    const payload = {
        branch_id: branchId,
        supplier_name: supplier,
        payment_method: paymentMethod,
        bank_account_name: paymentMethod === "bank" ? bankName : null,
        total_amount: totalAmount,
        items: items
    };

    const btn = document.getElementById("btn-submit-purchase");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> သိမ်းဆည်းနေသည်...`;
    }

    try {
        if (editId) {
            await api.put(`/purchases/${editId}`, payload);
            alert("အဝယ်စာရင်း ပြင်ဆင်ပြီးပါပြီ။");
        } else {
            await api.post("/purchases", payload);
            alert("အဝယ်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
        }
        document.getElementById("purchase-modal")?.classList.add("hidden");
        await loadMasterProducts();
        await loadPurchases();
    } catch (err) {
        alert("သိမ်းဆည်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `အတည်ပြု၍ စာရင်းသွင်းမည်`;
        }
    }
}

async function deletePurchase(id) {
    if (!confirm("ဤအဝယ်စာရင်းကို အမှန်တကယ် ဖျက်လိုပါသလား?\n(စတော့နှင့် ငွေစာရင်းမှလည်း အလိုအလျောက် ပြန်လည် နုတ်ယူရှင်းလင်းပါမည်)")) return;
    try {
        await api.delete(`/purchases/${id}`);
        await loadPurchases();
        alert("အဝယ်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
    } catch (err) {
        alert("ဖျက်၍မရပါ: " + err.message);
    }
}
