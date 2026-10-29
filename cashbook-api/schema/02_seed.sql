-- =============================================================================
-- SEED DATA: INITIAL CONFIGURATION ONLY (NO SENSITIVE CREDENTIALS)
-- =============================================================================

-- ၁။ ဆိုင်ခွဲ (၅) ဆိုင် စာရင်း
INSERT OR IGNORE INTO branches (id, code, name, type, phone, address) VALUES 
(1, 'MAIN', 'Main Home Shop (အိမ်ဆိုင်/စက်ရုံ)', 'main_hub', '09111111111', 'မန္တလေး'),
(2, 'SH1', 'Shop 1 (ဆိုင်ခွဲ ၁)', 'branch', '09222222222', 'မန္တလေး'),
(3, 'SH2', 'Shop 2 (ဆိုင်ခွဲ ၂)', 'branch', '09333333333', 'မန္တလေး'),
(4, 'SH3', 'Shop 3 (ဆိုင်ခွဲ ၃)', 'branch', '09444444444', 'မန္တလေး'),
(5, 'SH4', 'Shop 4 (ဆိုင်ခွဲ ၄)', 'branch', '09555555555', 'မန္တလေး');

-- ၂။ စနစ်သုံး ငွေစာရင်း ခေါင်းစဉ်များ
INSERT OR IGNORE INTO cash_categories (id, name, type, is_system) VALUES 
(1, 'အထည်ရောင်းရငွေ (POS Sales)', 'INCOME', 1),
(2, 'အကြွေးဟောင်းရငွေ (Debt Collection)', 'INCOME', 1),
(3, 'အခြားရငွေ (Other Income)', 'INCOME', 0),
(4, 'ရက်ကန်းလုပ်ခ (Weaving Wages)', 'EXPENSE', 0),
(5, 'ကုန်ကြမ်း/ချည်ဝယ်ယူစရိတ် (Raw Material Purchase)', 'EXPENSE', 0),
(6, 'ဝယ်ရောင်းအထည်ဝယ်ယူစရိတ် (Trading Goods Purchase)', 'EXPENSE', 1),
(7, 'ဆိုင်စရိတ်/စားစရိတ် (Daily Shop Expenses)', 'EXPENSE', 0),
(8, 'ဆိုင်လခ/အိမ်လခ (Shop Rent)', 'EXPENSE', 0),
(9, 'လျှပ်စစ်မီးဖိုးနှင့် အထွေထွေစရိတ် (Utilities)', 'EXPENSE', 0),
(10, 'ပင်မဆိုင်သို့ ငွေလွှဲပေးပို့ခြင်း (Cash Transfer to Main)', 'EXPENSE', 0);
