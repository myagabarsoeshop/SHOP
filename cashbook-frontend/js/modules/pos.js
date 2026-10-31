// cashbook-frontend/js/modules/pos.js
import { api } from "../core/api.js";
import { state } from "../core/state.js";
import { refreshGlobalKPIs, setKPI } from "../app.js";
import { PaginationController } from "../core/pagination.js";

let allProducts = [];
let cart = [];
let currentSaleType = "retail";
let selectedPaymentMethod = "cash";
let allCustomers = [];

// ယနေ့အရောင်းစာရင်းအတွက် စာရင်း (၁၅) ကြောင်းစီ ပြသမည့် Pagination Controller
let todaySalesList = [];
let currentFilteredTodaySales = [];
const todaySalesPagination = new PaginationController({
    pageSize: 15,
    onPageChange: () => renderTodaySalesTable()
});

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function initPOS() {
    bindEvents();
    await loadProducts();
    await loadCustomers();
    renderCart();
    await updatePOSKPIs();
}

async function loadProducts() {
    const grid = document.getElementById("pos-product-grid");
    const loading = document.getElementById("pos-loading");
    const empty = document.getElementById("pos-empty");

    loading?.classList.remove("hidden");
    empty?.classList.add("hidden");
    if (grid) grid.innerHTML = "";

    try {
        const branchId = state.currentBranch?.id || 1;
        const res = await api.get("/products", { branch_id: branchId });
        allProducts = res.data || [];
        populateCategoryDropdown(allProducts);
        filterAndRenderProducts();
    } catch (err) {
        console.error("Failed to load products:", err);
    } finally {
        loading?.classList.add("hidden");
    }
}

async function loadCustomers() {
    try {
        const res = await api.get("/customers");
        allCustomers = res.data || [];
        
        const customerSelects = [
            document.getElementById("pos-customer-select"),
            document.getElementById("modal-customer-select")
        ].filter(Boolean);

        customerSelects.forEach(select => {
            const currentVal = select.value;
            select.innerHTML = `
                <option value="">-- ဖောက်သည် ရွေးချယ်ပါ --</option>
                <option value="NEW" class="font-bold text-emerald-600 dark:text-emerald-400">+ ဖောက်သည်အသစ် ထည့်မည်...</option>
            `;
            allCustomers.forEach(c => {
                const debt = Number(c.current_debt || 0);
                const debtStr = debt > 0 ? ` [အကြွေးကျန်: ${debt.toLocaleString()} Ks]` : '';
                select.innerHTML += `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone ? `(${escapeHtml(c.phone)})` : ''}${debtStr}</option>`;
            });
            if (currentVal) select.value = currentVal;
        });
    } catch (err) {
        console.error("Failed to load customers:", err);
    }
}

function populateCategoryDropdown(products) {
    const select = document.getElementById("pos-category-select");
    if (!select) return;
    const currentVal = select.value;
    const categories = [...new Set(products.map(p => p.category).filter(Boolean))];
    select.innerHTML = `<option value="">အမျိုးအစား အားလုံး (${products.length})</option>`;
    categories.forEach(cat => {
        select.innerHTML += `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`;
    });
    select.value = currentVal;
}

function filterAndRenderProducts() {
    const category = document.getElementById("pos-category-select")?.value || "";
    const rawSearch = (document.getElementById("pos-search-input")?.value || "").trim().toLowerCase();
    const keywords = rawSearch.split(/\s+/).filter(Boolean);

    const filtered = allProducts.filter(p => {
        if (category && p.category !== category) return false;
        if (keywords.length === 0) return true;
        const haystack = `${p.sku || ""} ${p.barcode || ""} ${p.category || ""} ${p.item_name || ""} ${p.pattern || ""} ${p.color || ""} ${p.size || ""}`.toLowerCase();
        return keywords.every(kw => haystack.includes(kw));
    });

    renderProductsGrid(filtered);
}

function renderProductsGrid(products) {
    const grid = document.getElementById("pos-product-grid");
    const empty = document.getElementById("pos-empty");
    if (!grid) return;

    grid.innerHTML = "";
    if (products.length === 0) {
        empty?.classList.remove("hidden");
        return;
    }
    empty?.classList.add("hidden");

    products.forEach(p => {
        const price = currentSaleType === "retail" ? p.retail_price : p.wholesale_price;
        const stock = p.current_stock || 0;
        const isOutOfStock = stock <= 0;
        const itemCode = p.sku || p.barcode || 'N/A';

        const card = document.createElement("div");
        card.className = `bg-slate-50 dark:bg-slate-900/90 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 active:scale-95 transition-all cursor-pointer flex flex-col justify-between ${isOutOfStock ? 'opacity-45 pointer-events-none' : ''}`;
        
        card.innerHTML = `
            <div>
                <div class="flex items-center justify-between gap-2 mb-2">
                    <span class="text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        ${escapeHtml(p.category)} <strong class="${stock < 5 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}">(${stock})</strong>
                    </span>
                    <span class="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">Code: ${escapeHtml(itemCode)}</span>
                </div>
                <div class="text-base font-extrabold text-slate-900 dark:text-white leading-snug">${escapeHtml(p.item_name)}</div>
                <div class="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">${escapeHtml(p.pattern || '')} • ${escapeHtml(p.color || '')}</div>
                <div class="text-xs text-slate-400 mt-0.5">ဆိုက်: ${escapeHtml(p.size || 'Free')}</div>
            </div>
            <div class="mt-4 pt-3 border-t border-slate-200/70 dark:border-slate-800 flex items-center justify-between">
                <span class="text-lg font-black text-emerald-600 dark:text-emerald-400 font-mono">${Number(price || 0).toLocaleString()}</span>
                <div class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
                    <i class="fa-solid fa-plus text-xs"></i>
                </div>
            </div>
        `;

        card.addEventListener("click", () => addToCart(p));
        grid.appendChild(card);
    });
}

function addToCart(product) {
    const existing = cart.find(item => item.product.id === product.id);
    const availableStock = product.current_stock || 0;

    if (existing) {
        if (existing.quantity >= availableStock) {
            alert(`လက်ကျန်မလောက်ပါ။ (${availableStock} ထည်သာ ကျန်ပါသည်)`);
            return;
        }
        existing.quantity += 1;
    } else {
        if (availableStock <= 0) return;
        const price = currentSaleType === "retail" ? product.retail_price : product.wholesale_price;
        cart.push({ product, quantity: 1, unitPrice: price, costPrice: product.cost_price });
    }
    renderCart();
    updatePOSKPIs();
}

function renderCart() {
    const container = document.getElementById("pos-cart-items");
    const subtotalEl = document.getElementById("pos-subtotal");
    const finalTotalEl = document.getElementById("pos-final-total");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const discountInput = document.getElementById("pos-discount");
    const discountDisplay = document.getElementById("pos-discount-display");

    if (!container) return;
    container.innerHTML = "";

    if (cart.length === 0) {
        container.innerHTML = `
            <div class="flex flex-col items-center justify-center h-56 text-slate-400 dark:text-slate-500">
                <i class="fa-solid fa-cart-shopping text-4xl mb-3 opacity-40"></i>
                <span class="text-sm font-bold">ခြင်းတောင်းထဲတွင် ပစ္စည်းမရှိသေးပါ</span>
            </div>
        `;
        if (subtotalEl) subtotalEl.textContent = "0";
        if (finalTotalEl) finalTotalEl.textContent = "0";
        if (checkoutBtn) checkoutBtn.disabled = true;
        updatePOSKPIs();
        return;
    }

    let subtotal = 0;
    cart.forEach((item, index) => {
        const lineTotal = item.quantity * item.unitPrice;
        subtotal += lineTotal;
        const stockLimit = item.product.current_stock || 0;

        const row = document.createElement("div");
        row.className = "py-3.5 flex items-center justify-between gap-3";
        row.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="text-sm font-bold text-slate-900 dark:text-white truncate">${escapeHtml(item.product.item_name)}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 font-mono">${Number(item.unitPrice).toLocaleString()}</div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button data-idx="${index}" class="btn-qty-minus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold cursor-pointer">-</button>
                <span class="w-7 text-center text-sm font-black font-mono text-slate-900 dark:text-white">${item.quantity}</span>
                <button data-idx="${index}" data-max="${stockLimit}" class="btn-qty-plus w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-bold cursor-pointer">+</button>
            </div>
            <div class="text-right shrink-0 w-24">
                <div class="text-sm font-black text-slate-900 dark:text-white font-mono">${Number(lineTotal).toLocaleString()}</div>
                <button data-idx="${index}" class="btn-remove-item text-xs text-rose-500 hover:text-rose-400 font-bold mt-0.5 cursor-pointer">ဖယ်မည်</button>
            </div>
        `;
        container.appendChild(row);
    });

    const discount = parseFloat(discountInput?.value) || 0;
    const finalTotal = Math.max(0, subtotal - discount);

    if (subtotalEl) subtotalEl.textContent = subtotal.toLocaleString();
    if (discountDisplay) discountDisplay.textContent = `-${discount.toLocaleString()}`;
    if (finalTotalEl) finalTotalEl.textContent = finalTotal.toLocaleString();
    if (checkoutBtn) checkoutBtn.disabled = false;

    container.querySelectorAll(".btn-qty-plus").forEach(btn => {
        btn.onclick = () => { 
            const idx = btn.dataset.idx;
            const max = parseInt(btn.dataset.max, 10);
            if (cart[idx].quantity >= max) {
                alert(`လက်ကျန်မလောက်ပါ။ (${max} ထည်သာ ကျန်ပါသည်)`);
                return;
            }
            cart[idx].quantity += 1; 
            renderCart(); 
            updatePOSKPIs(); 
        };
    });
    container.querySelectorAll(".btn-qty-minus").forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            if (cart[idx].quantity > 1) cart[idx].quantity -= 1;
            else cart.splice(idx, 1);
            renderCart();
            updatePOSKPIs();
        };
    });
    container.querySelectorAll(".btn-remove-item").forEach(btn => {
        btn.onclick = () => { cart.splice(btn.dataset.idx, 1); renderCart(); updatePOSKPIs(); };
    });

    updatePOSKPIs();
}

function bindEvents() {
    const searchInput = document.getElementById("pos-search-input");
    const categorySelect = document.getElementById("pos-category-select");
    const retailBtn = document.getElementById("btn-type-retail");
    const wholesaleBtn = document.getElementById("btn-type-wholesale");
    const discountInput = document.getElementById("pos-discount");
    const checkoutBtn = document.getElementById("btn-pos-checkout");
    const modal = document.getElementById("checkout-modal");
    const closeModalBtn = document.getElementById("btn-close-modal");
    const confirmSaleBtn = document.getElementById("btn-confirm-sale");

    categorySelect?.addEventListener("change", filterAndRenderProducts);
    searchInput?.addEventListener("input", () => filterAndRenderProducts());

    retailBtn?.addEventListener("click", () => {
        currentSaleType = "retail";
        retailBtn.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
        wholesaleBtn.className = "px-3.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-white transition cursor-pointer";
        updatePricesForSaleType();
    });

    wholesaleBtn?.addEventListener("click", () => {
        currentSaleType = "wholesale";
        wholesaleBtn.className = "px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white shadow-sm transition cursor-pointer";
        retailBtn.className = "px-3.5 py-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-white transition cursor-pointer";
        updatePricesForSaleType();
    });

    discountInput?.addEventListener("input", renderCart);
    checkoutBtn?.addEventListener("click", openCheckoutModal);
    closeModalBtn?.addEventListener("click", () => modal?.classList.add("hidden"));

    // Payment Methods Selection (Cash / Bank / Credit)
    document.querySelectorAll(".method-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".method-btn").forEach(b => {
                b.className = "method-btn p-3 rounded-xl border-2 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 text-sm font-bold flex flex-col items-center gap-1.5 cursor-pointer";
            });
            btn.className = "method-btn active p-3 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-sm font-bold flex flex-col items-center gap-1.5 cursor-pointer";
            selectedPaymentMethod = btn.dataset.method;
            
            const bankGroup = document.getElementById("bank-input-group");
            if (selectedPaymentMethod === "bank") bankGroup?.classList.remove("hidden");
            else bankGroup?.classList.add("hidden");

            const paidInput = document.getElementById("modal-paid-amount");
            const dueAmount = getFinalTotal();

            if (paidInput) {
                paidInput.disabled = false;
                if (selectedPaymentMethod === "credit") {
                    paidInput.value = 0;
                    paidInput.placeholder = "လက်ခံရရှိငွေ (ဥပမာ- စရန်ငွေ သို့မဟုတ် 0)";
                } else {
                    paidInput.value = dueAmount;
                    paidInput.placeholder = "ကျသင့်ငွေ အပြည့် သို့မဟုတ် လက်ခံငွေ";
                }
            }

            calculateChange();
        });
    });

    // Customer Selection Change (Modal & Sidebar Sync)
    const handleCustomerChange = (e) => {
        const val = e.target.value;
        const newBox = document.getElementById("modal-new-customer-box");
        if (val === "NEW") {
            newBox?.classList.remove("hidden");
            document.getElementById("modal-new-cust-name")?.focus();
        } else {
            newBox?.classList.add("hidden");
        }

        const sideSelect = document.getElementById("pos-customer-select");
        const modalSelect = document.getElementById("modal-customer-select");
        if (sideSelect && sideSelect !== e.target) sideSelect.value = val;
        if (modalSelect && modalSelect !== e.target) modalSelect.value = val;
    };

    document.getElementById("pos-customer-select")?.addEventListener("change", handleCustomerChange);
    document.getElementById("modal-customer-select")?.addEventListener("change", handleCustomerChange);

    document.getElementById("modal-paid-amount")?.addEventListener("input", calculateChange);
    confirmSaleBtn?.addEventListener("click", submitSale);

    document.getElementById("btn-print-receipt")?.addEventListener("click", () => window.print());
    document.getElementById("btn-close-receipt")?.addEventListener("click", () => {
        document.getElementById("receipt-modal")?.classList.add("hidden");
    });

    // --- Today Sales Modal Events ---
    document.getElementById("btn-open-today-sales")?.addEventListener("click", openTodaySalesModal);
    document.getElementById("btn-close-today-sales-modal")?.addEventListener("click", () => {
        document.getElementById("today-sales-modal")?.classList.add("hidden");
    });
    document.getElementById("today-sales-search")?.addEventListener("input", filterAndRenderTodaySales);
    document.getElementById("btn-export-today-sales-csv")?.addEventListener("click", exportTodaySalesToCSV);
}

function updatePricesForSaleType() {
    cart.forEach(item => {
        item.unitPrice = currentSaleType === "retail" ? item.product.retail_price : item.product.wholesale_price;
    });
    renderCart();
    filterAndRenderProducts();
}

function getFinalTotal() {
    let subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
    let discount = parseFloat(document.getElementById("pos-discount")?.value) || 0;
    return Math.max(0, subtotal - discount);
}

function openCheckoutModal() {
    const modal = document.getElementById("checkout-modal");
    const dueEl = document.getElementById("modal-due-amount");
    const paidInput = document.getElementById("modal-paid-amount");
    const finalTotal = getFinalTotal();
    
    document.querySelector('.method-btn[data-method="cash"]')?.click();
    
    if (dueEl) dueEl.textContent = finalTotal.toLocaleString();
    if (paidInput) {
        paidInput.disabled = false;
        paidInput.value = finalTotal;
    }
    
    const sideCust = document.getElementById("pos-customer-select")?.value || "";
    const modalCust = document.getElementById("modal-customer-select");
    if (modalCust) {
        modalCust.value = sideCust;
        const newBox = document.getElementById("modal-new-customer-box");
        if (sideCust === "NEW") newBox?.classList.remove("hidden");
        else newBox?.classList.add("hidden");
    }

    calculateChange();
    modal?.classList.remove("hidden");
}

function calculateChange() {
    const finalTotal = getFinalTotal();
    const paidInput = document.getElementById("modal-paid-amount");
    const paid = parseFloat(paidInput?.value) || 0;
    const changeBox = document.getElementById("modal-debt-change-box");
    const changeText = document.getElementById("modal-change-text");

    if (!changeBox || !changeText) return;

    if (paid >= finalTotal) {
        const change = paid - finalTotal;
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
        changeText.textContent = `ပြန်အမ်းငွေ (Change): ${change.toLocaleString()} Ks`;
    } else {
        const remainingDebt = finalTotal - paid;
        changeBox.className = "p-3.5 rounded-xl text-sm flex justify-between font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400";
        changeText.textContent = `အကြွေးကျန် (Debt): ${remainingDebt.toLocaleString()} Ks`;
    }
}

async function updatePOSKPIs() {
    try {
        const branchId = state.currentBranch?.id || 1;
        const today = new Date().toISOString().split("T")[0];
        const res = await api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today });
        const s = res.data?.summary || { cash: { in: 0 }, bank: { in: 0 } };

        const cashSale = s.cash.in || 0;
        const bankSale = s.bank.in || 0;
        const totalSale = cashSale + bankSale;
        const totalItemsQty = cart.reduce((acc, i) => acc + i.quantity, 0);

        setKPI(1, "Today Sale (Cash)", cashSale, "fa-money-bill-wave");
        setKPI(2, "Today Sale (Bank)", bankSale, "fa-building-columns");
        setKPI(3, "Total Today Sale", totalSale, "fa-cash-register");
        setKPI(4, "Total Sale Items", totalItemsQty, "fa-shirt");
    } catch (err) {
        console.error("POS KPI update error:", err);
    }
}

async function submitSale() {
    const finalTotal = getFinalTotal();
    const paidInput = document.getElementById("modal-paid-amount");
    const paidAmount = parseFloat(paidInput?.value) || 0;
    const remainingDebt = Math.max(0, finalTotal - paidAmount);

    let customerSelectVal = document.getElementById("modal-customer-select")?.value || 
                            document.getElementById("pos-customer-select")?.value || "";
    let customerId = null;

    if (customerSelectVal === "NEW") {
        const newName = document.getElementById("modal-new-cust-name")?.value.trim();
        const newPhone = document.getElementById("modal-new-cust-phone")?.value.trim() || null;
        const newShop = document.getElementById("modal-new-cust-shop")?.value.trim() || null;

        if (!newName) {
            alert("ဖောက်သည်အသစ်အတွက် အမည် ထည့်သွင်းပေးပါ");
            document.getElementById("modal-new-cust-name")?.focus();
            return;
        }

        try {
            const custRes = await api.post("/customers", {
                name: newName,
                phone: newPhone,
                shopName: newShop,
                customerType: currentSaleType,
                initialDebt: 0
            });
            customerId = custRes.data?.id;
            await loadCustomers();
        } catch (e) {
            alert("ဖောက်သည်အသစ် သိမ်းဆည်း၍မရပါ: " + e.message);
            return;
        }
    } else if (customerSelectVal) {
        customerId = parseInt(customerSelectVal, 10);
    }

    if (remainingDebt > 0 && !customerId) {
        alert("အကြွေးကျန်ငွေ ရှိနေပါသဖြင့် ကျေးဇူးပြု၍ ဖောက်သည် (Customer) ရွေးချယ်ပေးပါ (သို့မဟုတ် အသစ်ထည့်ပါ)။");
        document.getElementById("modal-customer-select")?.focus();
        return;
    }

    const bankName = document.getElementById("modal-bank-name")?.value.trim();
    if (selectedPaymentMethod === "bank" && paidAmount > 0 && !bankName) {
        alert("ဘဏ်လွှဲဖြစ်ပါက ကျေးဇူးပြု၍ ဘဏ်အမည် ထည့်သွင်းပေးပါ။");
        return;
    }

    const btn = document.getElementById("btn-confirm-sale");
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-1"></i> <span>သိမ်းဆည်းနေပါသည်...</span>`;

    try {
        const subtotal = cart.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
        const discountAmount = parseFloat(document.getElementById("pos-discount")?.value) || 0;

        const actualPaid = Math.min(paidAmount, finalTotal);
        const pCash = selectedPaymentMethod === "cash" ? actualPaid : 0;
        const pBank = selectedPaymentMethod === "bank" ? actualPaid : 0;

        const payload = {
            branchId: state.currentBranch?.id || 1,
            customerId: customerId,
            saleType: currentSaleType,
            items: cart.map(i => ({
                productId: i.product.id, 
                quantity: i.quantity,
                unitPrice: i.unitPrice, 
                costPrice: i.costPrice
            })),
            discountAmount, 
            paidAmount: actualPaid,
            paymentMethod: selectedPaymentMethod,
            cashAmount: pCash,
            bankAmount: pBank,
            bankAccountName: selectedPaymentMethod === "bank" ? bankName : null,
            createdBy: state.user?.id || 1
        };

        const res = await api.post("/pos/sales", payload);
        if (res.success) {
            document.getElementById("checkout-modal")?.classList.add("hidden");
            
            showReceiptModal(res.data.invoiceNo, cart, subtotal, discountAmount, finalTotal, actualPaid);

            cart = [];
            document.getElementById("pos-discount").value = 0;
            if (document.getElementById("pos-customer-select")) document.getElementById("pos-customer-select").value = "";
            if (document.getElementById("modal-customer-select")) document.getElementById("modal-customer-select").value = "";
            document.getElementById("modal-new-customer-box")?.classList.add("hidden");
            
            renderCart();
            await loadProducts();
            await loadCustomers();
            await updatePOSKPIs();
            await refreshGlobalKPIs();
        }
    } catch (err) {
        alert(`အရောင်းမှတ်တမ်း မအောင်မြင်ပါ: ${err.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-check mr-1"></i> <span>အရောင်း အတည်ပြုပြီး ဘောင်ချာထုတ်မည်</span>`;
    }
}

function showReceiptModal(invoiceNo, items, subtotal, discount, finalTotal, paid) {
    document.getElementById("rcp-branch").textContent = state.currentBranch?.name || "Main Home Shop";
    document.getElementById("rcp-inv").textContent = invoiceNo;
    document.getElementById("rcp-date").textContent = new Date().toLocaleString("en-GB", { hour12: true });
    
    let methodText = "လက်ငင်း (Cash)";
    if (selectedPaymentMethod === "bank") methodText = "ဘဏ်လွှဲ (Bank)";
    if (selectedPaymentMethod === "credit" || paid < finalTotal) {
        methodText = paid > 0 ? `အကြွေး + စရန် (${paid.toLocaleString()})` : "အကြွေး (Credit)";
    }
    document.getElementById("rcp-method").textContent = methodText;

    const tbody = document.getElementById("rcp-items");
    if (tbody) {
        tbody.innerHTML = "";
        items.forEach(item => {
            const name = item.product?.item_name || item.item_name || "Item";
            tbody.innerHTML += `
                <tr class="border-b border-dashed border-gray-300">
                    <td class="py-2 text-[13px] font-semibold">${escapeHtml(name)}</td>
                    <td class="py-2 text-[13px] text-center font-mono">${item.quantity}</td>
                    <td class="py-2 text-[13px] text-right font-mono">${(item.quantity * item.unitPrice).toLocaleString()}</td>
                </tr>
            `;
        });
    }

    document.getElementById("rcp-subtotal").textContent = subtotal.toLocaleString();
    document.getElementById("rcp-discount").textContent = `-${discount.toLocaleString()}`;
    document.getElementById("rcp-final").textContent = finalTotal.toLocaleString();
    document.getElementById("rcp-paid").textContent = paid.toLocaleString();
    
    const change = paid - finalTotal;
    const changeEl = document.getElementById("rcp-change");
    if (changeEl) {
        changeEl.textContent = change >= 0 ? change.toLocaleString() : `(အကြွေးကျန်) ${Math.abs(change).toLocaleString()}`;
    }

    document.getElementById("receipt-modal")?.classList.remove("hidden");
}

// ==========================================
// --- Today Sales Detailed Modal Logic ---
// ==========================================

async function openTodaySalesModal() {
    const modal = document.getElementById("today-sales-modal");
    const tbody = document.getElementById("today-sales-table-body");
    modal?.classList.remove("hidden");

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-slate-400 font-bold"><i class="fa-solid fa-spinner fa-spin text-blue-500 text-2xl mb-2"></i><div>ယနေ့အရောင်းစာရင်းများ ဆွဲယူနေပါသည်...</div></td></tr>`;
    }

    try {
        const branchId = state.currentBranch?.id || 1;
        const today = new Date().toISOString().split("T")[0];
        
        // POS အရောင်းစာရင်းနှင့် သက်ဆိုင်ရာ Invoices ဆွဲယူခြင်း
        const res = await api.get("/pos/sales", { branch_id: branchId, date: today }).catch(() => api.get("/cashbook/entries", { branch_id: branchId, start_date: today, end_date: today }));
        
        todaySalesList = res.data?.items || res.data || [];
        currentFilteredTodaySales = [...todaySalesList];

        todaySalesPagination.reset();
        renderTodaySalesTable();
    } catch (err) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-rose-500 font-bold">အရောင်းစာရင်း ရယူ၍မရပါ (${escapeHtml(err.message)})</td></tr>`;
        }
    }
}

function filterAndRenderTodaySales() {
    const kw = (document.getElementById("today-sales-search")?.value || "").trim().toLowerCase();

    currentFilteredTodaySales = todaySalesList.filter(s => {
        if (!kw) return true;
        const hay = `${s.invoice_no || ""} ${s.customer_name || ""} ${s.item_name || ""} ${s.category || ""} ${s.payment_method || ""} ${s.notes || ""}`.toLowerCase();
        return hay.includes(kw);
    });

    todaySalesPagination.reset();
    renderTodaySalesTable();
}

function renderTodaySalesTable() {
    const tbody = document.getElementById("today-sales-table-body");
    const countEl = document.getElementById("today-sales-invoice-count");
    const totalQtyEl = document.getElementById("today-sales-total-qty");
    const totalAmountEl = document.getElementById("today-sales-total-amount");

    if (!tbody) return;
    tbody.innerHTML = "";

    const uniqueInvoices = new Set(currentFilteredTodaySales.map(s => s.invoice_no || s.id)).size;
    const totalQty = currentFilteredTodaySales.reduce((acc, s) => acc + Number(s.quantity || 1), 0);
    const totalAmt = currentFilteredTodaySales.reduce((acc, s) => acc + Number(s.subtotal || s.total_amount || 0), 0);

    if (countEl) countEl.textContent = uniqueInvoices.toLocaleString();
    if (totalQtyEl) totalQtyEl.textContent = totalQty.toLocaleString();
    if (totalAmountEl) totalAmountEl.textContent = `${totalAmt.toLocaleString()} Ks`;

    if (currentFilteredTodaySales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="p-12 text-center text-slate-400 font-bold text-sm">ယနေ့ အရောင်းစာရင်း မရှိသေးပါ</td></tr>`;
        todaySalesPagination.renderControls("today-sales-pagination");
        return;
    }

    const pageItems = todaySalesPagination.getPageItems(currentFilteredTodaySales);
    const startIdx = (todaySalesPagination.currentPage - 1) * todaySalesPagination.pageSize;

    pageItems.forEach((s, idx) => {
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-GB", { hour: '2-digit', minute: '2-digit', hour12: true }) : "-";
        const qty = Number(s.quantity || 1);
        const price = Number(s.unit_price || s.price || 0);
        const amount = Number(s.subtotal || s.total_amount || (qty * price));
        const method = String(s.payment_method || "cash").toLowerCase();
        const unit = s.size || "ထည်";

        let methodBadge = "";
        if (method === "bank") {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px] font-bold border border-blue-500/20">ဘဏ် (${escapeHtml(s.bank_account_name || "KPay")})</span>`;
        } else if (method === "credit") {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-bold border border-rose-500/20">အကြွေး</span>`;
        } else {
            methodBadge = `<span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold border border-emerald-500/20">ငွေသား</span>`;
        }

        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50 dark:hover:bg-slate-900/50 transition";
        tr.innerHTML = `
            <td class="p-3.5 text-center text-slate-400 font-mono">${startIdx + idx + 1}</td>
            <td class="p-3.5 font-mono text-slate-600 dark:text-slate-300">
                <div class="font-bold text-blue-600 dark:text-blue-400">${escapeHtml(s.invoice_no || `INV-${s.id}`)}</div>
                <div class="text-[11px] text-slate-400">${timeStr}</div>
            </td>
            <td class="p-3.5">
                <div class="font-bold text-slate-800 dark:text-slate-200">${escapeHtml(s.customer_name || "Walk-in")}</div>
                <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-bold uppercase">${escapeHtml(s.sale_type || "Retail")}</span>
            </td>
            <td class="p-3.5">
                <span class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    ${escapeHtml(s.category || "-")}
                </span>
            </td>
            <td class="p-3.5">
                <div class="font-bold text-slate-900 dark:text-white">${escapeHtml(s.item_name || "-")}</div>
                <div class="text-[11px] text-slate-400">${escapeHtml(s.color || "")} ${s.pattern ? `• ${escapeHtml(s.pattern)}` : ''}</div>
            </td>
            <td class="p-3.5 text-center font-mono font-bold text-blue-600 dark:text-blue-400">
                ${qty.toLocaleString()} <span class="text-[11px] font-sans font-normal text-slate-400">${escapeHtml(unit)}</span>
            </td>
            <td class="p-3.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300">${price.toLocaleString()}</td>
            <td class="p-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400">${amount.toLocaleString()}</td>
            <td class="p-3.5 text-center">${methodBadge}</td>
            <td class="p-3.5 text-xs text-slate-500 dark:text-slate-400 max-w-[150px] truncate" title="${escapeHtml(s.notes || s.remark || '')}">
                ${escapeHtml(s.notes || s.remark || "-")}
            </td>
            <td class="p-3.5 text-center">
                <button type="button" data-inv="${escapeHtml(s.invoice_no || `INV-${s.id}`)}" class="btn-reprint-sale px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold border border-slate-300 dark:border-slate-700 transition cursor-pointer flex items-center gap-1 mx-auto shadow-sm" title="ဘောင်ချာ ပြန်ထုတ်မည်">
                    <i class="fa-solid fa-print text-blue-500"></i>
                    <span>Print</span>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".btn-reprint-sale").forEach(btn => {
        btn.onclick = () => {
            const invNo = btn.dataset.inv;
            const items = todaySalesList.filter(s => (s.invoice_no || `INV-${s.id}`) === invNo);
            if (items.length > 0) {
                const sub = items.reduce((acc, it) => acc + Number(it.subtotal || (it.quantity * it.unit_price) || 0), 0);
                const disc = Number(items[0].discount_amount || 0);
                const fin = Math.max(0, sub - disc);
                const paid = Number(items[0].paid_amount || fin);
                showReceiptModal(invNo, items, sub, disc, fin, paid);
            }
        };
    });

    todaySalesPagination.renderControls("today-sales-pagination");
}

function exportTodaySalesToCSV() {
    const dataToExport = currentFilteredTodaySales.length > 0 ? currentFilteredTodaySales : todaySalesList;
    if (dataToExport.length === 0) {
        return alert("ထုတ်ယူရန် အရောင်းစာရင်း မရှိသေးပါ။");
    }

    const todayStr = new Date().toISOString().split("T")[0];
    let csv = "Invoice No,Time,Customer Name,Sale Type,Category,Item Name,Quantity,Unit Price,Amount,Payment Method,Remark\n";

    dataToExport.forEach(s => {
        const timeStr = s.created_at ? new Date(s.created_at).toLocaleTimeString("en-GB") : "-";
        const qty = Number(s.quantity || 1);
        const price = Number(s.unit_price || s.price || 0);
        const amount = Number(s.subtotal || s.total_amount || (qty * price));

        const row = [
            `"${escapeHtml(s.invoice_no || `INV-${s.id}`)}"`,
            `"${timeStr}"`,
            `"${escapeHtml(s.customer_name || 'Walk-in')}"`,
            `"${escapeHtml(s.sale_type || 'Retail')}"`,
            `"${escapeHtml(s.category || '-')}"`,
            `"${escapeHtml(s.item_name || '-')}"`,
            qty,
            price,
            amount,
            `"${escapeHtml(s.payment_method || 'Cash')}"`,
            `"${escapeHtml(s.notes || s.remark || '-')}"`
        ];
        csv += row.join(",") + "\n";
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Today_Sales_${todayStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
