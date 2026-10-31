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
    document.getElementById("btn-add-purchase")?.addEventListener("click", openPurchaseModal);
    document.getElementById("btn-close-purchase-modal")?.addEventListener("click", () => {
        document.getElementById("purchase-modal")?.classList.add("hidden");
    });

    document.getElementById("btn-submit-purchase")?.addEventListener("click", submitPurchase);
    document.getElementById("btn-add-pur-item")?.addEventListener("click", addPurchaseRow);

    // Payment Method ပြောင်းလျှင် ဘဏ်အကောင့်ထည့်သည့် အကွက်ကို အဖွင့်/အပိတ် လုပ်မည်
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

// Master ပစ္စည်းစာရင်းကို ဆွဲယူမည် (Dropdown တွင် ရွေးချယ်နိုင်ရန်)
async function loadMasterProducts() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        masterProducts = res.data || [];
    } catch (err) {
        console.error("Master Products ရယူရာတွင် အမှားအယွင်းရှိပါသည်:", err);
    }
}

// အဝယ်မှတ်တမ်းများ ဆွဲယူမည်
async function loadPurchases() {
    const tbody = document.getElementById("pur-table-body");
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="fa-solid fa-spinner fa-spin text-emerald-500 text-2xl"></i></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        // Backend တွင် /purchases API ရေးသားထားရန် လိုအပ်သည်
        const res = await api.get("/purchases", { branch_id: branchId });
        purchasesList = res.data || [];
        renderPurchasesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-rose-500 font-bold">စာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function renderPurchasesTable() {
    const tbody = document.getElementById("pur-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (purchasesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-12 text-center text-slate-400 font-bold text-base">အဝယ်စာရင်း မှတ်တမ်း မရှိသေးပါ</td></tr>`;
        return;
    }

    purchasesList.forEach(pur => {
        const dateStr = new Date(pur.created_at).toLocaleDateString("en-GB");
        let paymentBadge = "";
        if (pur.payment_method === "cash") {
            paymentBadge = `<span class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">လက်ငင်း</span>`;
        } else if (pur.payment_method === "bank") {
            paymentBadge = `<span class="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold">ဘဏ် (${escapeHtml(pur.bank_account_name)})</span>`;
        } else {
            paymentBadge = `<span class="px-3 py-1 bg-rose-100 text-rose-700 rounded-lg text-xs font-bold">အကြွေး</span>`;
        }

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-4 font-mono text-sm text-slate-800 dark:text-slate-200">
                <div class="font-bold text-blue-600 dark:text-blue-400">${escapeHtml(pur.purchase_no)}</div>
                <div class="text-xs text-slate-500">${dateStr}</div>
            </td>
            <td class="p-4 font-bold text-slate-800 dark:text-slate-200 text-base">
                ${escapeHtml(pur.supplier_name)}
            </td>
            <td class="p-4 text-center">${paymentBadge}</td>
            <td class="p-4 text-right font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                ${Number(pur.total_amount || 0).toLocaleString()}
            </td>
            <td class="p-4 text-center">
                <span class="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold uppercase">
                    ${escapeHtml(pur.status)}
                </span>
            </td>
            <td class="p-4 text-center">
                <button type="button" data-id="${pur.id}" title="အသေးစိတ်ကြည့်မည်" class="btn-view-pur w-9 h-9 inline-flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-emerald-600 hover:text-white rounded-xl text-slate-600 dark:text-slate-300 transition cursor-pointer shadow-sm">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-view-pur").forEach(btn => {
        btn.onclick = () => {
            alert("အဝယ်ဘောင်ချာ အသေးစိတ် မျက်နှာပြင် မကြာမီ ရေးသားပါမည်။");
        };
    });
}

function openPurchaseModal() {
    const modal = document.getElementById("purchase-modal");
    
    // Reset Form Elements
    document.getElementById("pur-supplier").value = "";
    document.getElementById("pur-payment-method").value = "cash";
    document.getElementById("pur-bank-name").value = "";
    document.getElementById("pur-bank-container")?.classList.add("hidden");
    
    // Clear Rows and add a default row
    const tbody = document.getElementById("pur-items-container");
    if (tbody) tbody.innerHTML = "";
    updateTotalAmount();
    addPurchaseRow();

    modal?.classList.remove("hidden");
}

function addPurchaseRow() {
    const tbody = document.getElementById("pur-items-container");
    if (!tbody) return;

    // Master Product Options
    let productOptions = `<option value="">-- ပစ္စည်းရွေးချယ်ပါ --</option>`;
    masterProducts.forEach(p => {
        productOptions += `<option value="${p.id}" data-cost="${p.cost_price || 0}">${escapeHtml(p.item_name)} (${escapeHtml(p.sku)})</option>`;
    });

    const tr = document.createElement("tr");
    tr.className = "pur-item-row group";
    tr.innerHTML = `
        <td class="p-2">
            <select class="pur-item-select w-full text-sm font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer">
                ${productOptions}
            </select>
        </td>
        <td class="p-2">
            <input type="number" min="1" value="1" class="pur-item-qty w-full text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-center text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="p-2">
            <input type="number" min="0" value="0" step="any" class="pur-item-cost w-full text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-2 py-2 text-right text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="p-2 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 text-base pur-item-subtotal align-middle">
            0
        </td>
        <td class="p-2 text-center align-middle">
            <button type="button" class="btn-remove-row text-slate-400 hover:text-rose-500 transition cursor-pointer">
                <i class="fa-solid fa-circle-minus text-lg"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);

    // Bind Events for this new row
    const select = tr.querySelector(".pur-item-select");
    const qtyInput = tr.querySelector(".pur-item-qty");
    const costInput = tr.querySelector(".pur-item-cost");
    const removeBtn = tr.querySelector(".btn-remove-row");

    // ပစ္စည်းရွေးလိုက်လျှင် အရင်းဈေး (Cost Price) ကို Auto ဖြည့်ပေးမည်
    select.addEventListener("change", (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const cost = selectedOption.getAttribute("data-cost");
        if (cost) costInput.value = cost;
        calculateRow(tr);
    });

    qtyInput.addEventListener("input", () => calculateRow(tr));
    costInput.addEventListener("input", () => calculateRow(tr));
    
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

function calculateRow(rowElement) {
    const qty = parseFloat(rowElement.querySelector(".pur-item-qty").value) || 0;
    const cost = parseFloat(rowElement.querySelector(".pur-item-cost").value) || 0;
    const subtotal = qty * cost;
    
    rowElement.querySelector(".pur-item-subtotal").textContent = subtotal.toLocaleString();
    updateTotalAmount();
}

function updateTotalAmount() {
    let total = 0;
    document.querySelectorAll(".pur-item-row").forEach(row => {
        const qty = parseFloat(row.querySelector(".pur-item-qty").value) || 0;
        const cost = parseFloat(row.querySelector(".pur-item-cost").value) || 0;
        total += (qty * cost);
    });
    
    const totalEl = document.getElementById("pur-total-amount");
    if (totalEl) totalEl.textContent = total.toLocaleString();
}

async function submitPurchase() {
    const supplier = document.getElementById("pur-supplier").value.trim();
    if (!supplier) return alert("ပေးသွင်းသူ အမည် ထည့်ပါ။");

    const paymentMethod = document.getElementById("pur-payment-method").value;
    const bankName = document.getElementById("pur-bank-name").value.trim();
    if (paymentMethod === "bank" && !bankName) {
        return alert("ဘဏ်လွှဲဖြစ်ပါက ဘဏ်အကောင့်အမည် ထည့်ပါ။");
    }

    const items = [];
    let hasError = false;

    document.querySelectorAll(".pur-item-row").forEach(row => {
        const productId = row.querySelector(".pur-item-select").value;
        const qty = parseInt(row.querySelector(".pur-item-qty").value, 10) || 0;
        const cost = parseFloat(row.querySelector(".pur-item-cost").value) || 0;

        if (!productId) {
            hasError = true;
            row.querySelector(".pur-item-select").classList.add("border-rose-500");
        } else {
            row.querySelector(".pur-item-select").classList.remove("border-rose-500");
            items.push({
                product_id: parseInt(productId, 10),
                quantity: qty,
                unit_cost: cost,
                subtotal: qty * cost
            });
        }
    });

    if (hasError || items.length === 0) {
        return alert("ကျေးဇူးပြု၍ ဝယ်ယူမည့် ပစ္စည်းများကို မှန်ကန်စွာ ရွေးချယ်ပါ။");
    }

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
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
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> စာရင်းသွင်းနေသည်...`;
    }

    try {
        await api.post("/purchases", payload);
        document.getElementById("purchase-modal")?.classList.add("hidden");
        await loadPurchases(); // ဇယားကို ပြန် Refresh လုပ်မည်
        alert("အဝယ်စာရင်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။ Stock နှင့် Cashbook တွင်လည်း အလိုအလျောက် သက်ရောက်သွားပါမည်။");
    } catch (err) {
        alert("စာရင်းသွင်း၍မရပါ: " + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `အတည်ပြု၍ စာရင်းသွင်းမည်`;
        }
    }
}
