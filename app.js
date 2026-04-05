/**
 * DB-driven frontend controller for School Uniform & Stationery Billing.
 * Products are loaded from uniform_prices via backend API.
 */

// Dynamic API Base URL - supports both development and production
const getAPIBase = () => {
    // If we're in development (localhost), use localhost:5000
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return `${window.location.protocol}//${window.location.hostname}:5000`;
    }
    // In production, use the Render backend
    return 'https://shree-tshirt-7.onrender.com';
};

const API_BASE = getAPIBase();
const STORAGE_USER_KEY = 'sut_user';
const STORAGE_SCHOOL_KEY = 'sut_school_id';
const STORAGE_ACTIVE_TAB_KEY = 'sut_active_tab';
const STORAGE_ACTIVE_BILLING_STUDENT_KEY = 'sut_active_billing_student_id';
const FETCH_CACHE_TTL_MS = 10000;

const state = {
    user: null,
    activeSchool: null,
    activeBillingStudent: null,
    schools: [],
    students: [],
    invoices: [],
    posItems: [],
    cart: {},
    cartTotal: 0,
    billingPriceByItemId: {},
    billingSizeByItemId: {},
    activeUploadedFileId: null,
    selectedStudentIds: new Set(),
    stocks: [],
    paymentMode: 'cash',
    lastStudentsFetchedAt: 0,
    lastInvoicesFetchedAt: 0,
    studentsCurrentPage: 1,
};

let isInvoiceSubmitting = false;
let pendingStudentFocusId = null;
const STUDENTS_PER_PAGE = 50;

const ITEM_ICON_BY_DB_FIELD = {
    shirt: 'ph-t-shirt',
    shirts: 'ph-t-shirt',
    pant: 'ph-pants',
    skirt: 'ph-dress',
    pina: 'ph-dress',
    t_shirt: 'ph-t-shirt',
    track_pant: 'ph-pants',
    blazer: 'ph-coat-hanger',
    sports_uniform: 'ph-t-shirt',
    belt: 'ph-arrows-in-line-horizontal',
    house_shoes: 'ph-sneaker',
    school_shoes: 'ph-boot',
    socks_house: 'ph-footprints',
    tie: 'img/tie-icon.svg',
    hair_band: 'ph-bandaids',
    school_bag: 'ph-backpack',
    pt_suit: 'ph-t-shirt',
    hair_band: 'ph-bandaids',
    hair_belt: 'ph-bandaids',
    pt_socks: 'ph-footprints',
};

// Item name to image mapping
const ITEM_IMAGE_MAP = {
    'girl shirt': 'img/girl_shirt.png',
    'boy shirt': 'img/boy_shirt.png',
    'pina': 'img/pina.png',
    'tie': 'img/Tie.png',
    'belt': 'img/Belt.png',
    'socks': 'img/socks.png',
    'pt suit': 'img/pt_suit.png',
    'pant': 'img/Pant.png',
    'pt_suit': 'img/pt_suit.png',
    'hair band': 'img/hair band.png',
    'rubber band': 'img/hair band.png',
    'hair belt': 'img/hair belt.png',
    'pt socks': 'img/socks.png',
};

// Preferred display order for POS item grid
const PREFERRED_ITEM_ORDER = [
    'boy shirt',
    'girl shirt',
    'pina',
    'pant',
    'belt',
    'tie',
    'socks',
    'pt suit',
    'hair band',
    'hair belt',
    'pt socks',
];

function getPosItemSortIndex(item) {
    const name = String(item?.name || '').toLowerCase().trim();
    for (let i = 0; i < PREFERRED_ITEM_ORDER.length; i++) {
        const keyword = PREFERRED_ITEM_ORDER[i];
        if (name.includes(keyword) || keyword.includes(name)) return i;
    }
    return PREFERRED_ITEM_ORDER.length;
}

function sortPosItems(items) {
    return [...items].sort((a, b) => getPosItemSortIndex(a) - getPosItemSortIndex(b));
}

// Cache removed - all data now fetched from database only

function normalizeItemKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getGenderToken(rawValue) {
    const raw = String(rawValue || '').trim().toLowerCase();
    if (raw === 'male' || raw === 'boy' || raw === 'boys') return 'boys';
    if (raw === 'female' || raw === 'girl' || raw === 'girls') return 'girls';
    return '';
}

function isBoyShirtItem(item) {
    return normalizeItemKey(item?.name || '') === 'boyshirt';
}

function isGirlShirtItem(item) {
    return normalizeItemKey(item?.name || '') === 'girlshirt';
}

function isPinaItem(item) {
    return normalizeItemKey(item?.name || '') === 'pina';
}

function isHairBandItem(item) {
    return normalizeItemKey(item?.name || '') === 'hairband';
}

function isHairBeltItem(item) {
    return normalizeItemKey(item?.name || '') === 'hairbelt';
}

function shouldShowItemForGender(item, genderToken) {
    if (!item) return false;
    if (!genderToken) return true;
    if (isBoyShirtItem(item)) return genderToken === 'boys';
    if (isGirlShirtItem(item)) return genderToken === 'girls';
    if (isPinaItem(item)) return genderToken === 'girls';
    if (isHairBandItem(item)) return genderToken === 'girls';
    if (isHairBeltItem(item)) return genderToken === 'girls';
    return true;
}

function pickGenderSpecificShirtItem(items, genderToken) {
    if (!Array.isArray(items) || !items.length) return null;
    if (genderToken === 'boys') return items.find(isBoyShirtItem) || null;
    if (genderToken === 'girls') return items.find(isGirlShirtItem) || null;
    return items.find(i => normalizeItemKey(i?.name || '') === 'shirt') || null;
}

function genId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    const text = document.getElementById('toast-message');
    if (!toast || !text) return;


    function togglePasswordVisibility(inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input || !btn) return;

        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = `ph ${isHidden ? 'ph-eye-slash' : 'ph-eye'}`;
        }
        btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    }
    text.textContent = msg;
    toast.style.background = type === 'error' ? 'var(--danger)' : 'var(--bg-card)';
    toast.classList.remove('hidden');
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.classList.add('hidden'), 300);
    }, 2500);
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function setPaymentMode(mode) {
    if (mode !== 'cash' && mode !== 'online') {
        return; // Invalid mode
    }
    state.paymentMode = mode;

    // Update button active states
    const buttons = document.querySelectorAll('.payment-mode-btn');
    buttons.forEach(btn => {
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function showView(viewId) {
    document.querySelectorAll('.view, #app-shell').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');
}

function showRegisterModal() {
    openModal('register-modal');
}

function updateTopbarUserInfo() {
    const nameEl = document.querySelector('.user-name');
    const roleEl = document.getElementById('active-user-role');
    if (nameEl) {
        nameEl.textContent = state.user?.username || state.user?.name || 'User';
    }
    if (roleEl) {
        roleEl.textContent = state.user?.role === 'admin' ? 'Admin' : 'Worker';
    }
}

function persistUserSession() {
    try {
        if (state.user) localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(state.user));
    } catch (e) {
        console.warn('Unable to persist user session', e);
    }
}

function persistActiveSchoolSession() {
    try {
        const schoolId = state.activeSchool?.id ? String(state.activeSchool.id) : '';
        if (schoolId) localStorage.setItem(STORAGE_SCHOOL_KEY, schoolId);
    } catch (e) {
        console.warn('Unable to persist school session', e);
    }
}

function persistActiveTabSession(tabName) {
    try {
        if (tabName) localStorage.setItem(STORAGE_ACTIVE_TAB_KEY, String(tabName));
    } catch (e) {
        console.warn('Unable to persist active tab', e);
    }
}

function persistActiveBillingStudentSession(studentId) {
    try {
        if (studentId) {
            localStorage.setItem(STORAGE_ACTIVE_BILLING_STUDENT_KEY, String(studentId));
            return;
        }
        localStorage.removeItem(STORAGE_ACTIVE_BILLING_STUDENT_KEY);
    } catch (e) {
        console.warn('Unable to persist billing student', e);
    }
}

function clearPersistedSession() {
    try {
        localStorage.removeItem(STORAGE_USER_KEY);
        localStorage.removeItem(STORAGE_SCHOOL_KEY);
        localStorage.removeItem(STORAGE_ACTIVE_TAB_KEY);
        localStorage.removeItem(STORAGE_ACTIVE_BILLING_STUDENT_KEY);
    } catch (e) {
        console.warn('Unable to clear persisted session', e);
    }
}

function debounce(fn, delay = 160) {
    let timer = null;
    return (...args) => {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delay);
    };
}

function restoreSessionIfAvailable() {
    let user = null;
    let schoolId = '';
    let activeTab = 'dashboard';
    let activeBillingStudentId = '';

    try {
        const rawUser = localStorage.getItem(STORAGE_USER_KEY);
        user = rawUser ? JSON.parse(rawUser) : null;
        schoolId = String(localStorage.getItem(STORAGE_SCHOOL_KEY) || '');
        activeTab = String(localStorage.getItem(STORAGE_ACTIVE_TAB_KEY) || 'dashboard');
        activeBillingStudentId = String(localStorage.getItem(STORAGE_ACTIVE_BILLING_STUDENT_KEY) || '');
    } catch (e) {
        user = null;
        schoolId = '';
        activeTab = 'dashboard';
        activeBillingStudentId = '';
    }

    if (!user) return;

    state.user = user;
    fetchSchools().then(() => {
        if (schoolId) {
            state.activeSchool = state.schools.find(s => String(s.id) === schoolId) || null;
        }

        if (state.activeSchool) {
            document.getElementById('active-school-name').textContent = state.activeSchool.name;
            updateTopbarUserInfo();

            // Show all sections/actions for both admin and worker.
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

            showView('app-shell');
            loadUniformCatalog().finally(() => {
                Promise.all([fetchStudents({ force: true }), fetchInvoices({ force: true })])
                    .finally(() => {
                        const allowedTabs = new Set(['dashboard', 'students-list', 'parents', 'billing', 'billing-pos', 'invoices', 'stocks']);
                        const resolvedTab = allowedTabs.has(activeTab) ? activeTab : 'dashboard';

                        if (resolvedTab === 'billing-pos') {
                            state.activeBillingStudent = state.students.find(s => String(s.id || '') === activeBillingStudentId) || null;
                            if (!state.activeBillingStudent) {
                                persistActiveTabSession('billing');
                                switchNav('billing');
                                return;
                            }
                        }

                        switchNav(resolvedTab);
                    });
            });
            return;
        }

        showView('view-school-select');
    }).catch(() => {
        clearPersistedSession();
        state.user = null;
        showView('view-login');
    });
}

// Removed: localStorage cache functions - now loading fresh data from database only
function getUploadedFilesForActiveSchool() {
    // Returns empty - files no longer cached locally
    return [];
}

function getDbFieldForPosItem(item) {
    return item?.dbField || null;
}

function normalizeCatalogItem(item, index) {
    const dbField = item?.db_field || item?.dbField || '';
    const priceMap = (item?.price_map && typeof item.price_map === 'object') ? item.price_map : {};
    const standardPriceMap = (item?.standard_price_map && typeof item.standard_price_map === 'object') ? item.standard_price_map : {};
    const parsedDefault = Number(item?.default_price);
    const itemName = String(item?.item_name || item?.name || '').trim();

    let iconClass = ITEM_ICON_BY_DB_FIELD[dbField] || 'ph-package';

    // Girl Shirt gets dress icon
    if (itemName.toLowerCase().includes('girl') && dbField === 'shirt') {
        iconClass = 'ph-dress';
    }
    // Pina gets skirt icon
    if (itemName.toLowerCase().includes('pina')) {
        iconClass = 'ph-skirt';
    }
    // PT Suit gets hoodie icon
    if (itemName.toLowerCase().includes('pt suit')) {
        iconClass = 'ph-hoodie';
    }

    return {
        id: index + 1,
        name: itemName,
        dbField,
        img: iconClass,
        sizes: Array.isArray(item?.sizes) ? item.sizes.filter(Boolean) : [],
        priceMap,
        standardPriceMap,
        defaultPrice: Number.isFinite(parsedDefault) ? parsedDefault : 0,
    };
}

function renderProductIconMarkup(item) {
    const itemName = String(item?.name || '').trim().toLowerCase();

    // First priority: Check ITEM_IMAGE_MAP for exact name match
    const mappedImage = ITEM_IMAGE_MAP[itemName];
    if (mappedImage) {
        return `<img class="product-image-icon" src="${mappedImage}" alt="${String(item?.name || 'Product')} icon">`;
    }

    // Second priority: Check if item has an img field
    const iconValue = String(item?.img || '').trim();
    const lower = iconValue.toLowerCase();
    const isImage = lower.endsWith('.svg') || lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp');
    if (isImage) {
        return `<img class="product-image-icon" src="${iconValue}" alt="${String(item?.name || 'Product')} icon">`;
    }

    // Fallback to icon
    return `<i class="ph ${iconValue || 'ph-package'}"></i>`;
}

function parseUniformCellValue(rawValue) {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
        return { qty: 0, size: '' };
    }

    const text = String(rawValue).trim();
    const token = text.toLowerCase();
    if (token === '-' || token === '--' || token === 'na' || token === 'n/a' || token === 'none') {
        return { qty: 0, size: '' };
    }

    const numberValue = Number(text);
    if (!Number.isNaN(numberValue)) {
        if (numberValue <= 0) return { qty: 0, size: '' };
        if (numberValue <= 10) return { qty: Math.round(numberValue), size: '' };
        return { qty: 1, size: text };
    }

    return { qty: 1, size: text };
}

function getBillingUnitPrice(itemId) {
    const parsed = Number(state.billingPriceByItemId[itemId]);
    return Number.isFinite(parsed) ? parsed : 0;
}

function getBillingStudentUnitPrice(item, size) {
    if (!item) return 0;

    const selectedSize = String(size || '').trim();
    const stdToken = String(state.activeBillingStudent?.std || '').trim();
    const genderRaw = String(state.activeBillingStudent?.gender || '').trim().toLowerCase();
    const genderToken = (genderRaw === 'male' || genderRaw === 'boy' || genderRaw === 'boys')
        ? 'boys'
        : ((genderRaw === 'female' || genderRaw === 'girl' || genderRaw === 'girls') ? 'girls' : '');

    const pickPrice = (entry) => {
        if (!entry || typeof entry !== 'object') return 0;
        const ordered = [
            genderToken ? entry[genderToken] : null,
            entry.default,
            entry.boys,
            entry.girls,
        ];
        for (const candidate of ordered) {
            const parsed = Number(candidate);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 0;
    };

    const stdMap = stdToken ? (item.standardPriceMap?.[stdToken] || null) : null;
    if (stdMap) {
        if (selectedSize && stdMap[selectedSize]) {
            const exact = pickPrice(stdMap[selectedSize]);
            if (exact > 0) return exact;
        }

        for (const sizeKey of Object.keys(stdMap)) {
            const fallbackInStd = pickPrice(stdMap[sizeKey]);
            if (fallbackInStd > 0) return fallbackInStd;
        }
    }

    if (selectedSize && item.priceMap?.[selectedSize]) {
        const bySize = pickPrice(item.priceMap[selectedSize]);
        if (bySize > 0) return bySize;
    }

    return Number.isFinite(item.defaultPrice) ? item.defaultPrice : 0;
}

// REMOVED: buildInvoiceQuantitiesPayload - no longer needed (database-only approach)

function loadUniformCatalog() {
    if (!state.activeSchool?.id) return Promise.resolve();

    return fetch(`${API_BASE}/uniform-catalog/${state.activeSchool.id}`)
        .then(res => res.json())
        .then(data => {
            const items = Array.isArray(data?.items) ? data.items : [];
            state.posItems = items.map((item, index) => normalizeCatalogItem(item, index)).filter(item => item.name);
            if (!state.posItems.length) {
                showToast('No products found in uniform_prices for selected school.', 'error');
            }
        })
        .catch(err => {
            console.error('loadUniformCatalog error', err);
            state.posItems = [];
            showToast('Failed to load products from database', 'error');
        });
}

function fetchSchools() {
    return fetch(`${API_BASE}/schools`)
        .then(res => res.json())
        .then(data => {
            const rows = Array.isArray(data?.data) ? data.data : [];
            state.schools = rows
                .map((row, idx) => {
                    const id = row?.id ? String(row.id) : '';
                    const schoolName = String(
                        row?.school_name || row?.name || row?.school || row?.schoolName || ''
                    ).trim();

                    return {
                        id,
                        name: schoolName || `School ${idx + 1}`,
                        address: row?.address || '',
                        contact_person: row?.contact_person || '',
                        contact_person_number: row?.contact_person_number || '',
                        academic_year: row?.academic_year || '',
                    };
                })
                .filter(s => s.id);
            populateSchoolDropdown();
        })
        .catch(err => {
            console.error('fetchSchools error', err);
            showToast('Failed to load schools', 'error');
        });
}

function populateSchoolDropdown() {
    const select = document.getElementById('school-dropdown');
    if (!select) return;
    select.innerHTML = '';

    if (!state.schools.length) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No schools found. Add a school first.';
        placeholder.selected = true;
        select.appendChild(placeholder);
        return;
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select a school';
    placeholder.selected = true;
    placeholder.disabled = true;
    select.appendChild(placeholder);

    state.schools.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name || s.id;
        select.appendChild(opt);
    });
}

function fetchStudents(options = {}) {
    const force = Boolean(options.force);
    if (!state.activeSchool?.id) return Promise.resolve();

    if (!force && state.students.length && (Date.now() - state.lastStudentsFetchedAt) < FETCH_CACHE_TTL_MS) {
        renderStudentsTable(document.getElementById('search-student')?.value || '');
        renderParentsTable();
        return Promise.resolve();
    }

    return fetch(`${API_BASE}/students/school/${state.activeSchool.id}`)
        .then(res => res.json())
        .then(data => {
            const rows = Array.isArray(data) ? data : [];
            state.students = rows.map((student, idx) => ({
                id: student.id,
                sNo: student.sr_no || String(idx + 1),
                std: student.std || '',
                name: student.student_name || '',
                phone: student.mobile_no || '',
                parent: student.parent_name || '',
                gender: student.gender || '',
                house: student.house || '',
                school_id: student.school_id,
                uniform_data: student,
            }));
            state.lastStudentsFetchedAt = Date.now();

            renderStudentsTable(document.getElementById('search-student')?.value || '');
            renderParentsTable();
        })
        .catch(err => {
            console.error('fetchStudents error', err);
            showToast('Failed to load students', 'error');
        });
}

function fetchInvoices(options = {}) {
    const force = Boolean(options.force);
    if (!state.activeSchool?.id) {
        state.invoices = [];
        renderInvoicesTable();
        return Promise.resolve();
    }

    if (!force && state.invoices.length && (Date.now() - state.lastInvoicesFetchedAt) < FETCH_CACHE_TTL_MS) {
        renderInvoicesTable();
        renderBillingStudentsTable(document.getElementById('search-billing-student')?.value || '');
        return Promise.resolve();
    }

    return fetch(`${API_BASE}/invoices/school/${state.activeSchool.id}`)
        .then(res => res.json())
        .then(data => {
            state.invoices = Array.isArray(data?.data) ? data.data : [];
            state.lastInvoicesFetchedAt = Date.now();
            renderInvoicesTable();
            renderBillingStudentsTable(document.getElementById('search-billing-student')?.value || '');
        })
        .catch(err => {
            console.error('fetchInvoices error', err);
            state.invoices = [];
            renderInvoicesTable();
            renderBillingStudentsTable(document.getElementById('search-billing-student')?.value || '');
        });
}

function switchNav(target) {
    persistActiveTabSession(target);
    document.querySelectorAll('.subview').forEach(el => el.classList.add('hidden'));
    const current = document.getElementById(`subview-${target}`);
    if (current) current.classList.remove('hidden');

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        if (el.getAttribute('data-target') === target) el.classList.add('active');
        else el.classList.remove('active');
    });

    if (target === 'students-list') renderStudentsTable(document.getElementById('search-student')?.value || '');
    if (target === 'parents') renderParentsTable();
    if (target === 'invoices') fetchInvoices();
    if (target === 'stocks') loadStocks();
    if (target === 'billing') {
        Promise.all([fetchStudents(), fetchInvoices()])
            .finally(() => renderBillingStudentsTable(document.getElementById('search-billing-student')?.value || ''));
    }
    if (target === 'billing-pos') {
        if (!state.activeBillingStudent) {
            showToast('Select a student first from Students list.', 'error');
            switchNav('students-list');
            return;
        }
        setupBillingView();
    }
}

function continueWorkerToDashboard() {
    // For workers: automatically select first available school and proceed to dashboard
    if (!state.schools || state.schools.length === 0) {
        showToast('No schools available. Please contact administrator.', 'error');
        return;
    }

    // Auto-select the first school for workers
    state.activeSchool = state.schools[0];
    persistActiveSchoolSession();

    document.getElementById('active-school-name').textContent = state.activeSchool.name;
    updateTopbarUserInfo();

    // Show all sections/actions for both admin and worker.
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

    showView('app-shell');
    persistActiveTabSession('dashboard');
    switchNav('dashboard');

    loadUniformCatalog().finally(() => {
        fetchStudents({ force: true });
        fetchInvoices({ force: true });
    });
}

function continueToDashboard() {
    const schoolId = document.getElementById('school-dropdown')?.value;
    if (!schoolId) {
        showToast('Please select a school first.', 'error');
        return;
    }

    state.activeSchool = state.schools.find(s => s.id === schoolId) || null;
    if (!state.activeSchool) return;
    persistActiveSchoolSession();

    document.getElementById('active-school-name').textContent = state.activeSchool.name;
    updateTopbarUserInfo();

    // Show all sections/actions for both admin and worker.
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

    showView('app-shell');
    persistActiveTabSession('dashboard');
    switchNav('dashboard');

    loadUniformCatalog().finally(() => {
        fetchStudents({ force: true });
        fetchInvoices({ force: true });
    });
}

function logout() {
    state.user = null;
    state.activeSchool = null;
    state.activeBillingStudent = null;
    state.cart = {};
    state.paymentMode = 'cash';
    persistActiveBillingStudentSession('');
    clearPersistedSession();
    showView('view-login');
}

function getStudentsInWorkOrder() {
    return [...state.students].sort((a, b) => {
        const aNo = Number.parseInt(String(a?.sNo || ''), 10);
        const bNo = Number.parseInt(String(b?.sNo || ''), 10);

        if (!Number.isNaN(aNo) && !Number.isNaN(bNo) && aNo !== bNo) {
            return aNo - bNo;
        }

        return String(a?.name || '').localeCompare(String(b?.name || ''));
    });
}

function renderStudentsTable(filterText = '', resetPage = false) {
    const tbody = document.querySelector('#students-table tbody');
    const tableWrapper = document.getElementById('students-table')?.parentElement;
    const empty = document.getElementById('empty-students');
    const paginationControls = document.getElementById('students-pagination');
    if (!tbody) return;

    if (resetPage) {
        state.studentsCurrentPage = 1;
    }

    const lower = String(filterText || '').toLowerCase();
    const filtered = state.students.filter(s =>
        s.name.toLowerCase().includes(lower) ||
        s.std.toLowerCase().includes(lower) ||
        String(s.house || '').toLowerCase().includes(lower)
    );

    tbody.innerHTML = '';

    if (!filtered.length) {
        if (empty) empty.classList.remove('hidden');
        if (tableWrapper) tableWrapper.classList.add('hidden');
        if (paginationControls) paginationControls.style.display = 'none';
        return;
    }

    if (empty) empty.classList.add('hidden');
    if (tableWrapper) tableWrapper.classList.remove('hidden');
    if (paginationControls) paginationControls.style.display = 'flex';

    const totalPages = Math.ceil(filtered.length / STUDENTS_PER_PAGE) || 1;
    if (state.studentsCurrentPage > totalPages) state.studentsCurrentPage = totalPages;
    if (state.studentsCurrentPage < 1) state.studentsCurrentPage = 1;

    const startIndex = (state.studentsCurrentPage - 1) * STUDENTS_PER_PAGE;
    const endIndex = Math.min(startIndex + STUDENTS_PER_PAGE, filtered.length);
    const paginated = filtered.slice(startIndex, endIndex);

    const pageInfo = document.getElementById('students-page-info');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (pageInfo) pageInfo.textContent = `Page ${state.studentsCurrentPage} of ${totalPages}`;
    if (btnPrev) btnPrev.disabled = state.studentsCurrentPage === 1;
    if (btnNext) btnNext.disabled = state.studentsCurrentPage === totalPages;

    paginated.forEach(s => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-student-id', String(s.id || ''));
        tr.innerHTML = `
            <td><input type="checkbox" onchange="toggleStudentSelection('${s.id}', this.checked)"></td>
            <td>#${s.sNo}</td>
            <td><span class="badge badge-outline">${s.std}</span></td>
            <td class="font-medium">${s.name}</td>
            <td>${s.gender || '-'}</td>
            <td>${s.house || '-'}</td>
            <td>${s.phone}</td>
            <td class="text-right">
                <div class="dropdown" id="dropdown-${s.id}">
                    <button class="dropdown-toggle" onclick="toggleDropdown('${s.id}')"><i class="ph ph-dots-three"></i></button>
                    <div class="dropdown-menu">
                        <button class="dropdown-item admin-only" onclick="editStudent('${s.id}')"><i class="ph ph-pencil-simple" style="margin-right: .5rem;"></i> Edit</button>
                        <button class="dropdown-item" onclick="startBillingForStudent('${s.id}')"><i class="ph ph-receipt" style="margin-right: .5rem;"></i> Create Invoice</button>
                    </div>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Show all row actions for both admin and worker.
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));

    if (pendingStudentFocusId) {
        const row = Array.from(tbody.querySelectorAll('tr')).find((tr) =>
            String(tr.getAttribute('data-student-id') || '') === String(pendingStudentFocusId)
        );

        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.style.transition = 'background-color 0.25s ease';
            row.style.backgroundColor = 'rgba(45, 212, 191, 0.2)';
            window.setTimeout(() => {
                row.style.backgroundColor = '';
            }, 1800);
        }

        pendingStudentFocusId = null;
    }
}

function changeStudentsPage(delta) {
    state.studentsCurrentPage += delta;
    renderStudentsTable(document.getElementById('search-student')?.value || '', false);
}

function renderParentsTable() {
    const tbody = document.querySelector('#parents-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    state.students.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-medium">${s.name}</td>
            <td>${s.parent || '-'}</td>
            <td>${s.phone || '-'}</td>
            <td>${s.address || '-'}</td>
            <td class="text-right"><button class="btn btn-icon-small"><i class="ph ph-pencil-simple"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
}

function getLatestInvoiceByStudentId(studentId) {
    const id = String(studentId || '');
    const related = state.invoices.filter(inv => String(inv.student_id || '') === id);
    if (!related.length) return null;

    related.sort((a, b) => {
        const aTime = Date.parse(a.created_at || '') || 0;
        const bTime = Date.parse(b.created_at || '') || 0;
        return bTime - aTime;
    });

    return related[0];
}

function getLatestPaidInvoiceByStudentId(studentId) {
    const id = String(studentId || '');
    const related = state.invoices.filter(inv =>
        String(inv.student_id || '') === id && String(inv.status || '').toLowerCase() === 'paid'
    );
    if (!related.length) return null;

    related.sort((a, b) => {
        const aTime = Date.parse(a.created_at || '') || 0;
        const bTime = Date.parse(b.created_at || '') || 0;
        return bTime - aTime;
    });

    return related[0];
}

function renderBillingStudentsTable(filterText = '') {
    const tbody = document.querySelector('#billing-invoices-table tbody');
    const table = document.getElementById('billing-invoices-table');
    const tableWrapper = table?.parentElement;
    const empty = document.getElementById('empty-billing-students');
    if (!tbody) return;

    const lower = String(filterText || '').toLowerCase();
    const filtered = state.invoices.filter(inv => {
        const invoiceId = String(inv.id || '').toLowerCase();
        const fallbackId = String(inv.id || 'NA').split('-')[0].toUpperCase();
        let invoiceNumber = String(inv.invoice_number || `INV-${fallbackId}`).toUpperCase();
        if (invoiceNumber.length > 20 && invoiceNumber.includes('-')) invoiceNumber = 'INV-' + invoiceNumber.split('-')[1];
        invoiceNumber = invoiceNumber.toLowerCase();
        const studentName = String(inv.student_name || '').toLowerCase();
        const status = String(inv.status || '').toLowerCase();
        const paymentMode = String(inv.payment_mode || '').toLowerCase();
        const createdAt = String(inv.created_at || '').toLowerCase();
        return (
            invoiceId.includes(lower) ||
            invoiceNumber.includes(lower) ||
            studentName.includes(lower) ||
            paymentMode.includes(lower) ||
            status.includes(lower) ||
            createdAt.includes(lower)
        );
    });

    filtered.sort((a, b) => {
        const aTime = Date.parse(a.created_at || '') || 0;
        const bTime = Date.parse(b.created_at || '') || 0;
        return bTime - aTime;
    });

    tbody.innerHTML = '';

    if (!filtered.length) {
        if (empty) empty.classList.remove('hidden');
        if (table) table.classList.add('hidden');
        return;
    }

    if (empty) empty.classList.add('hidden');
    if (table) table.classList.remove('hidden');
    if (tableWrapper) tableWrapper.classList.remove('hidden');

    filtered.forEach(inv => {
        const amount = Number(inv.total ?? inv.amount ?? 0);
        const status = inv.status || 'Pending';
        const paymentMode = (inv.payment_mode || 'cash').toUpperCase();
        const statusCls = status === 'Paid' ? 'badge-success' : (status === 'Draft' ? 'badge-outline' : 'badge-warning');

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.title = 'Click to view invoice';
        tr.onclick = () => openGeneratedInvoice(String(inv.id || ''));
        tr.innerHTML = `
            <td class="font-medium">${(() => {
                let num = String(inv.invoice_number || `INV-${String(inv.id || 'NA').split('-')[0].toUpperCase()}`);
                if (num.length > 20 && num.includes('-')) num = 'INV-' + num.split('-')[1].toUpperCase();
                return num;
            })()}</td>
            <td>${inv.student_name || '-'}</td>
            <td><span class="badge badge-secondary">${paymentMode}</span></td>
            <td class="font-bold text-primary">₹${amount.toFixed(2)}</td>
            <td><span class="badge ${statusCls}">${status}</span></td>
            <td class="text-right">
                <button class="btn btn-icon-small btn-outline" style="color:var(--danger);" onclick="handleReturnInvoiceClick(event, '${inv.id}')" title="Return Items"><i class="ph ph-arrow-u-up-left"></i> Return</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleReturnInvoiceClick(e, invoiceId) {
    if (e) e.stopPropagation();
    openReturnModal(invoiceId);
}

window.openReturnModal = function (invoiceId) {
    if (!invoiceId) return;

    fetch(`${API_BASE}/invoices/${invoiceId}/details`)
        .then(res => res.json())
        .then(data => {
            const items = Array.isArray(data?.items) ? data.items : [];
            const tbody = document.querySelector('#return-items-table tbody');
            tbody.innerHTML = '';

            if (items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No items available to return</td></tr>';
            } else {
                items.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${formatProductColumnLabel(item.item_name || item.dress)}${item.size && item.size !== '-' ? ` (${item.size})` : ''}</td>
                        <td class="font-medium">${item.quantity}</td>
                        <td>₹${Number(item.unit_price || 0).toFixed(2)}</td>
                        <td class="text-right">
                            <button class="btn btn-icon-small btn-outline" style="color:var(--danger); border-color:var(--danger)" onclick="confirmReturnItem('${invoiceId}', '${item.id}')" title="Return this item"><i class="ph ph-arrow-u-up-left"></i> Return</button>
                        </td>
                    `;
                    tbody.appendChild(tr);
                });
            }
            openModal('return-items-modal');
        })
        .catch(err => {
            console.error('Failed to load invoice items:', err);
            showToast('Failed to load items for return', 'error');
        });
}

window.confirmReturnItem = function (invoiceId, itemId) {
    if (!confirm('Are you sure you want to return this item? Inventory will be updated and the invoice total will be modified.')) return;

    fetch(`${API_BASE}/invoices/${invoiceId}/return-item/${itemId}`, {
        method: 'POST'
    })
        .then(res => res.json().then(data => ({ status: res.status, data })))
        .then(result => {
            if (result.status >= 200 && result.status < 300) {
                showToast(result.data.message || 'Item returned successfully');

                // Auto reload visual state
                fetchInvoices({ force: true });

                if (result.data.deleted) {
                    // If entire invoice deleted, close the modal
                    closeModal('return-items-modal');
                } else {
                    // Re-open modal to refresh item list
                    openReturnModal(invoiceId);
                }
            } else {
                showToast(result.data.message || 'Failed to return item', 'error');
            }
        })
        .catch(err => {
            console.error('Return item error:', err);
            showToast('Connection error while returning item', 'error');
        });
}

function openGeneratedInvoice(invoiceId) {
    if (!invoiceId) return;
    fetch(`${API_BASE}/invoices/${invoiceId}/details`)
        .then(res => res.json())
        .then(data => {
            const invoice = data?.invoice || null;
            const items = Array.isArray(data?.items) ? data.items : [];
            const student = data?.student || null;
            const schoolName = data?.school_name || state.activeSchool?.name || '-';
            if (!invoice) {
                showToast('Invoice details not found', 'error');
                return;
            }
            renderPaperBillFromSavedInvoice(invoice, items, student, schoolName);
        })
        .catch(err => {
            console.error('openGeneratedInvoice error', err);
            showToast('Failed to load invoice details', 'error');
        });
}

function renderPaperBillFromSavedInvoice(invoice, items, student, schoolName) {
    const fallbackId = String(invoice?.id || 'NA').split('-')[0].toUpperCase();
    let invoiceLabel = String(invoice?.invoice_number || `INV-${fallbackId}`);
    if (invoiceLabel.length > 20 && invoiceLabel.includes('-')) {
        invoiceLabel = 'INV-' + invoiceLabel.split('-')[1].toUpperCase();
    }
    const invoiceDate = invoice?.created_at ? new Date(invoice.created_at) : new Date();

    document.getElementById('pb-invoice-id').textContent = invoiceLabel;
    document.getElementById('pb-date').textContent = invoiceDate.toLocaleDateString('en-IN');
    document.getElementById('pb-time').textContent = invoiceDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('pb-student-name').textContent = student?.student_name || student?.name || '-';
    document.getElementById('pb-student-std').textContent = student?.std || '-';
    document.getElementById('pb-student-roll').textContent = student?.sr_no || '-';
    document.getElementById('pb-school-name').textContent = schoolName;
    document.getElementById('pb-phone').textContent = student?.mobile_no || student?.phone || '-';
    document.getElementById('pb-barcode-label').textContent = invoiceLabel;

    const tbody = document.getElementById('pb-items-body');
    tbody.innerHTML = '';

    let subtotal = 0;
    items.forEach((line, index) => {
        const qty = Number(line?.quantity || 0);
        const unitPrice = Number(line?.unit_price || 0);
        const lineTotal = qty * unitPrice;
        subtotal += lineTotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center">${index + 1}</td>
            <td>${line?.item_name || line?.dress || '-'}</td>
            <td style="text-align:center">${qty}</td>
            <td style="text-align:right">₹${unitPrice.toFixed(2)}</td>
            <td style="text-align:right">₹${lineTotal.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    const grandTotal = Number(invoice?.total ?? subtotal ?? 0);
    document.getElementById('pb-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
    document.getElementById('pb-total').textContent = `₹${grandTotal.toFixed(2)}`;
    document.getElementById('pb-amount-words').textContent = `Rupees ${Math.round(grandTotal)} Only`;

    const status = String(invoice?.status || 'Draft');
    const stamp = document.getElementById('pb-status-stamp');
    stamp.textContent = status.toUpperCase();
    stamp.className = 'paper-bill-status-stamp' + (status.toLowerCase() === 'paid' ? ' paid' : '');

    // Payment mode and UTR
    const paymentMode = String(invoice?.payment_mode || 'cash');
    const utrNo = String(invoice?.utr_no || '').trim();
    const pmEl = document.getElementById('pb-payment-mode');
    const utrRow = document.getElementById('pb-utr-row');
    const utrEl = document.getElementById('pb-utr-no');
    if (pmEl) pmEl.textContent = paymentMode.charAt(0).toUpperCase() + paymentMode.slice(1);
    if (utrRow && utrEl) {
        if (paymentMode.toLowerCase() === 'online' && utrNo) {
            utrEl.textContent = utrNo;
            utrRow.classList.remove('hidden');
        } else {
            utrRow.classList.add('hidden');
        }
    }

    openModal('bill-draft-modal');
}

function exportTotalSaleXls() {
    if (typeof XLSX === 'undefined') {
        showToast('XLS export library not loaded.', 'error');
        return;
    }

    const paidInvoices = state.invoices.filter(inv =>
        String(inv?.status || '').toLowerCase() === 'paid'
    );

    if (!paidInvoices.length) {
        showToast('No paid invoices found to export.', 'error');
        return;
    }

    const schoolName = String(state.activeSchool?.name || 'School').replace(/[^a-z0-9]+/gi, '_');
    const dateText = new Date().toISOString().slice(0, 10);

    const cashInvoices = paidInvoices.filter(inv => String(inv?.payment_mode || 'cash').toLowerCase() !== 'online');
    const onlineInvoices = paidInvoices.filter(inv => String(inv?.payment_mode || '').toLowerCase() === 'online');

    let filesExported = 0;

    // --- Cash Excel ---
    if (cashInvoices.length) {
        const rows = [['Invoice ID', 'Student Name', 'Total Amount', 'Status', 'Payment Mode']];
        let grandTotal = 0;

        cashInvoices.forEach(inv => {
            const amount = Number(inv.total ?? inv.amount ?? 0) || 0;
            grandTotal += amount;
            let invLabel = String(inv.invoice_number || `INV-${inv.id || 'NA'}`);
            if (invLabel.length > 20 && invLabel.includes('-')) invLabel = 'INV-' + invLabel.split('-')[1].toUpperCase();
            rows.push([
                invLabel,
                String(inv.student_name || '-'),
                Number(amount.toFixed(2)),
                String(inv.status || 'Paid'),
                'Cash',
            ]);
        });

        rows.push([]);
        rows.push(['TOTAL', '', Number(grandTotal.toFixed(2)), '', '']);

        const sheet = XLSX.utils.aoa_to_sheet(rows);
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, 'Cash Sales');
        XLSX.writeFile(book, `${schoolName}_cash_sale_${dateText}.xlsx`);
        filesExported++;
    }

    // --- Online Excel ---
    if (onlineInvoices.length) {
        const rows = [['Invoice ID', 'Student Name', 'Total Amount', 'Status', 'Payment Mode', 'UTR No.']];
        let grandTotal = 0;

        onlineInvoices.forEach(inv => {
            const amount = Number(inv.total ?? inv.amount ?? 0) || 0;
            grandTotal += amount;
            let invLabel = String(inv.invoice_number || `INV-${inv.id || 'NA'}`);
            if (invLabel.length > 20 && invLabel.includes('-')) invLabel = 'INV-' + invLabel.split('-')[1].toUpperCase();
            rows.push([
                invLabel,
                String(inv.student_name || '-'),
                Number(amount.toFixed(2)),
                String(inv.status || 'Paid'),
                'Online',
                String(inv.utr_no || '-'),
            ]);
        });

        rows.push([]);
        rows.push(['TOTAL', '', Number(grandTotal.toFixed(2)), '', '', '']);

        const sheet = XLSX.utils.aoa_to_sheet(rows);
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, sheet, 'Online Sales');
        XLSX.writeFile(book, `${schoolName}_online_sale_${dateText}.xlsx`);
        filesExported++;
    }

    if (filesExported === 0) {
        showToast('No invoices to export.', 'error');
    } else {
        showToast(`${filesExported} file${filesExported > 1 ? 's' : ''} exported successfully.`);
    }
}


function formatProductColumnLabel(token) {
    const raw = String(token || '').trim();
    if (!raw) return 'Item';
    return raw
        .split('_')
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function exportTotalSoldItemsXls() {
    if (typeof XLSX === 'undefined') {
        showToast('XLS export library not loaded.', 'error');
        return;
    }

    if (!state.activeSchool?.id) {
        showToast('Select a school first.', 'error');
        return;
    }

    const url = `${API_BASE}/stocks/total-sold-report?school_id=${encodeURIComponent(state.activeSchool.id)}`;
    fetch(url)
        .then(async (res) => {
            let data = {};
            try {
                data = await res.json();
            } catch (e) {
                data = {};
            }
            return { status: res.status, data };
        })
        .then(({ status, data }) => {
            if (status < 200 || status >= 300 || !data?.success) {
                showToast(data?.message || 'Failed to export total sold items', 'error');
                return;
            }

            const columns = Array.isArray(data.columns) ? data.columns : [];
            const rowsData = Array.isArray(data.rows) ? data.rows : [];

            if (!columns.length) {
                showToast('No products found in stock table for this school.', 'error');
                return;
            }

            const rows = [
                ['Standard', ...columns.map(formatProductColumnLabel), 'Total']
            ];

            for (let std = 1; std <= 10; std += 1) {
                const rowObj = rowsData.find(r => String(r?.standard || '') === String(std)) || {};
                const productValues = columns.map(col => Number(rowObj[col] || 0));
                const total = Number(rowObj.total || productValues.reduce((sum, value) => sum + value, 0));
                rows.push([`Standard ${std}`, ...productValues, total]);
            }

            const sheet = XLSX.utils.aoa_to_sheet(rows);
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, 'Total Sold Items');

            const schoolName = String(state.activeSchool?.name || 'School').replace(/[^a-z0-9]+/gi, '_');
            const dateText = new Date().toISOString().slice(0, 10);
            const fileName = `${schoolName}_total_sold_items_${dateText}.xlsx`;

            XLSX.writeFile(book, fileName);
            showToast('Total sold items XLS exported successfully.');
        })
        .catch((err) => {
            console.error('exportTotalSoldItemsXls error', err);
            showToast('Connection error while exporting total sold items', 'error');
        });
}

function exportTotalRemainingStocksXls() {
    if (typeof XLSX === 'undefined') {
        showToast('XLS export library not loaded.', 'error');
        return;
    }

    if (!state.activeSchool?.id) {
        showToast('Select a school first.', 'error');
        return;
    }

    const url = `${API_BASE}/stocks/total-remaining-report?school_id=${encodeURIComponent(state.activeSchool.id)}`;
    fetch(url)
        .then(async (res) => {
            let data = {};
            try {
                data = await res.json();
            } catch (e) {
                data = {};
            }
            return { status: res.status, data };
        })
        .then(({ status, data }) => {
            if (status < 200 || status >= 300 || !data?.success) {
                showToast(data?.message || 'Failed to export total remaining stocks', 'error');
                return;
            }

            const rowsData = Array.isArray(data.rows) ? data.rows : [];

            if (!rowsData.length) {
                showToast('No stock records found for this school.', 'error');
                return;
            }

            const rows = [
                ['Standard', 'Items', 'Gender', 'Stocks']
            ];

            rowsData.forEach((row) => {
                rows.push([
                    String(row.standard || ''),
                    String(row.item || ''),
                    String(row.gender || ''),
                    Number(row.stock || 0)
                ]);
            });

            const sheet = XLSX.utils.aoa_to_sheet(rows);
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, 'Total Remaining Stocks');

            const schoolName = String(state.activeSchool?.name || 'School').replace(/[^a-z0-9]+/gi, '_');
            const dateText = new Date().toISOString().slice(0, 10);
            const fileName = `${schoolName}_total_remaining_stocks_${dateText}.xlsx`;

            XLSX.writeFile(book, fileName);
            showToast('Total remaining stocks XLS exported successfully.');
        })
        .catch((err) => {
            console.error('exportTotalRemainingStocksXls error', err);
            showToast('Connection error while exporting total remaining stocks', 'error');
        });
}

function renderInvoicesTable() {
    const tbody = document.querySelector('#invoices-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const draftInvoices = state.invoices.filter(inv =>
        String(inv?.status || '').toLowerCase() === 'draft'
    );

    draftInvoices.forEach(inv => {
        const amount = Number(inv.total ?? inv.amount ?? 0);
        const status = inv.status || 'Pending';
        const paymentMode = (inv.payment_mode || 'cash').toUpperCase();
        const statusCls = status === 'Paid' ? 'badge-success' : (status === 'Draft' ? 'badge-outline' : 'badge-warning');
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-medium">#INV-${inv.id || 'NA'}</td>
            <td>${inv.student_name || '-'}</td>
            <td><span class="badge badge-secondary">${paymentMode}</span></td>
            <td class="font-bold text-primary">₹${amount.toFixed(2)}</td>
            <td><span class="badge ${statusCls}">${status}</span></td>
            <td class="text-right">-</td>
        `;
        tbody.appendChild(tr);
    });

    if (!draftInvoices.length) {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td colspan="6" class="text-center text-muted">No draft bills found.</td>';
        tbody.appendChild(tr);
    }
}

let studentCart = {};

function renderStudentPOSItems(filterText = '') {
    const grid = document.getElementById('modal-pos-items-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.posItems.length) {
        grid.innerHTML = '<div class="empty-cart text-center text-muted p-4"><p>No products configured in uniform_prices.</p></div>';
        return;
    }

    const lower = String(filterText || '').toLowerCase();
    const genderToken = getStudentGenderToken();
    const filtered = state.posItems
        .filter(item => item.name.toLowerCase().includes(lower))
        .filter(item => shouldShowItemForGender(item, genderToken));

    sortPosItems(filtered).forEach(item => {
        const entry = studentCart[item.id] || { qty: 0, size: '' };
        const sizes = item.sizes?.length ? item.sizes : ['XS', 'S', 'M', 'L', 'XL'];
        const options = sizes.map(s => `<option value="${s}">${s}</option>`).join('');

        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image">${renderProductIconMarkup(item)}</div>
            <div class="product-info">
                <div class="product-title">${item.name}</div>
                <div class="size-select-container mt-2">
                    <select class="size-select" onchange="updateStudentItemSize(${item.id}, this.value)">
                        <option value="">Size</option>
                        ${options}
                    </select>
                </div>
                <div class="qty-controls mt-2">
                    <button class="qty-btn" onclick="updateStudentItemQty(${item.id}, -1)"><i class="ph ph-minus"></i></button>
                    <span class="qty-display">${entry.qty || 0}</span>
                    <button class="qty-btn" onclick="updateStudentItemQty(${item.id}, 1)"><i class="ph ph-plus"></i></button>
                </div>
            </div>
        `;

        grid.appendChild(card);
        const select = card.querySelector('.size-select');
        if (select && entry.size) select.value = entry.size;
    });
}

function updateStudentItemQty(itemId, change) {
    const current = studentCart[itemId] || { qty: 0, size: '' };
    const nextQty = current.qty + change;
    if (nextQty <= 0) delete studentCart[itemId];
    else studentCart[itemId] = { qty: nextQty, size: current.size };

    renderStudentPOSItems(document.getElementById('search-items-student')?.value || '');
    updateStudentCartUI();
}

function updateStudentItemSize(itemId, size) {
    const current = studentCart[itemId] || { qty: 0, size: '' };
    studentCart[itemId] = { qty: current.qty, size };
    updateStudentCartUI();
}

function getStudentGenderToken() {
    return getGenderToken(document.getElementById('add-student-gender')?.value || '');
}

function getSelectedStudentStandard() {
    const raw = String(document.getElementById('add-student-class')?.value || '').trim();
    if (!raw) return '';
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return '';
    return String(Math.trunc(parsed));
}

function getStudentItemUnitPrice(item, size) {
    if (!item) return 0;

    const selectedSize = String(size || '').trim();
    const genderToken = getStudentGenderToken();
    const standardToken = getSelectedStudentStandard();
    const stdMap = standardToken ? (item.standardPriceMap?.[standardToken] || null) : null;

    const pickPrice = (entry) => {
        if (!entry) return 0;
        const orderedCandidates = [
            genderToken ? entry[genderToken] : null,
            entry.default,
            entry.boys,
            entry.girls,
        ];
        for (const candidate of orderedCandidates) {
            const parsed = Number(candidate);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
        return 0;
    };

    // Highest priority: exact standard + exact size.
    if (stdMap && selectedSize && stdMap[selectedSize]) {
        const exactStandardPrice = pickPrice(stdMap[selectedSize]);
        if (exactStandardPrice > 0) return exactStandardPrice;
    }

    // Fallback in same standard: any priced size for item.
    if (stdMap) {
        for (const key of Object.keys(stdMap)) {
            const sameStandardPrice = pickPrice(stdMap[key]);
            if (sameStandardPrice > 0) return sameStandardPrice;
        }
    }

    // Legacy fallback: size-based catalog mapping without standard.
    const sizeEntry = selectedSize ? (item.priceMap?.[selectedSize] || null) : null;

    if (sizeEntry) {
        const fallbackBySizePrice = pickPrice(sizeEntry);
        if (fallbackBySizePrice > 0) return fallbackBySizePrice;
    }

    return Number.isFinite(item.defaultPrice) ? item.defaultPrice : 0;
}

function updateStudentCartUI() {
    const list = document.getElementById('modal-cart-items-list');
    const subtotalEl = document.getElementById('modal-bill-subtotal');
    const totalEl = document.getElementById('modal-bill-total');
    if (!list) return;
    list.innerHTML = '';

    const keys = Object.keys(studentCart);
    if (!keys.length) {
        list.innerHTML = '<div class="empty-cart text-center text-muted p-4"><i class="ph ph-shopping-cart" style="font-size: 2rem;"></i><p>No items selected yet.</p></div>';
        if (subtotalEl) subtotalEl.textContent = '0.00';
        if (totalEl) totalEl.textContent = '0.00';
        return;
    }

    let subtotal = 0;

    keys.forEach(k => {
        const itemId = Number(k);
        const item = state.posItems.find(i => i.id === itemId);
        if (!item) return;
        const entry = studentCart[itemId];
        const qty = Number(entry?.qty) || 0;
        if (qty <= 0) return;

        const unitPrice = getStudentItemUnitPrice(item, entry.size);
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;

        const div = document.createElement('div');
        div.className = 'cart-item';
        div.innerHTML = `
            <div class="cart-item-info">
                <div class="cart-item-title">${item.name}${entry.size ? ` (${entry.size})` : ''}</div>
                <div class="cart-item-meta">Qty: ${qty}${unitPrice > 0 ? ` x ₹${unitPrice.toFixed(2)}` : ''}</div>
            </div>
            <div class="cart-item-price">₹${lineTotal.toFixed(2)}</div>
        `;
        list.appendChild(div);
    });

    if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
    if (totalEl) totalEl.textContent = subtotal.toFixed(2);
}

function buildUniformItemsFromStudentCart() {
    const rows = [];
    Object.keys(studentCart).forEach(k => {
        const itemId = Number(k);
        const item = state.posItems.find(i => i.id === itemId);
        if (!item) return;
        const entry = studentCart[itemId];
        if (!entry?.qty) return;

        rows.push({
            item_name: item.name,
            quantity: Number(entry.qty) || 0,
            size: entry.size || null,
        });
    });
    return rows;
}

function buildUniformFieldsFromStudentCart() {
    const fields = {};
    Object.keys(studentCart).forEach(k => {
        const itemId = Number(k);
        const item = state.posItems.find(i => i.id === itemId);
        if (!item) return;
        const entry = studentCart[itemId];
        const dbField = getDbFieldForPosItem(item);
        if (!dbField || !entry?.qty) return;
        fields[dbField] = entry.size ? String(entry.size) : Number(entry.qty);
    });
    return fields;
}

function openAddStudentModal() {
    const form = document.getElementById('add-student-form');
    if (form) form.reset();

    studentCart = {};
    renderStudentPOSItems('');
    updateStudentCartUI();
    openModal('add-student-modal');
}

function handleAddStudent(e) {
    e.preventDefault();
    if (!state.activeSchool?.id) return;

    const uniformItems = buildUniformItemsFromStudentCart();
    const uniformFields = buildUniformFieldsFromStudentCart();

    const payload = {
        school_id: state.activeSchool.id,
        student_name: document.getElementById('add-student-name')?.value?.trim() || '',
        std: document.getElementById('add-student-class')?.value?.trim() || '',
        gender: document.getElementById('add-student-gender')?.value?.trim() || '',
        house: document.getElementById('add-student-house')?.value?.trim() || '',
        parent_name: document.getElementById('add-student-parent')?.value?.trim() || '',
        mobile_no: document.getElementById('add-student-parent-phone')?.value?.trim() || '',
        uniform_items: uniformItems,
        ...uniformFields,
    };

    fetch(`${API_BASE}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            if (data.message?.includes('successfully')) {
                closeModal('add-student-modal');
                showToast('Student added successfully');
                fetchStudents();
            } else {
                showToast(data.message || 'Failed to add student', 'error');
            }
        })
        .catch(err => {
            console.error('handleAddStudent error', err);
            showToast('Connection error while adding student', 'error');
        });
}

let currentEditStudentId = null;

function editStudent(id) {
    const s = state.students.find(st => st.id === id);
    if (!s) return;

    currentEditStudentId = id;
    document.getElementById('edit-student-name').value = s.name || '';
    document.getElementById('edit-student-class').value = s.std || '';
    document.getElementById('edit-student-gender').value = s.gender || '';
    document.getElementById('edit-student-parent').value = s.parent || '';
    document.getElementById('edit-student-parent-phone').value = s.phone || '';

    closeDropdown(id);
    openModal('edit-student-modal');
}

function handleEditStudent(e) {
    e.preventDefault();
    if (!currentEditStudentId) return;

    const payload = {
        student_name: document.getElementById('edit-student-name')?.value?.trim() || '',
        std: document.getElementById('edit-student-class')?.value?.trim() || '',
        gender: document.getElementById('edit-student-gender')?.value?.trim() || '',
        parent_name: document.getElementById('edit-student-parent')?.value?.trim() || '',
        mobile_no: document.getElementById('edit-student-parent-phone')?.value?.trim() || '',
    };

    fetch(`${API_BASE}/students/${currentEditStudentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            if (data.message?.includes('successfully')) {
                closeModal('edit-student-modal');
                showToast('Student updated successfully');
                currentEditStudentId = null;
                fetchStudents();
            } else {
                showToast(data.message || 'Failed to update student', 'error');
            }
        })
        .catch(err => {
            console.error('handleEditStudent error', err);
            showToast('Connection error while updating student', 'error');
        });
}

function openAddParentModal() {
    console.log('openAddParentModal called');
    const form = document.getElementById('add-parent-form');
    if (form) form.reset();

    // Populate student dropdown
    const select = document.getElementById('add-parent-student');
    console.log('select element:', select);
    console.log('state.students:', state.students);

    if (select) {
        select.innerHTML = '<option value="">Select Student</option>';
        if (state.students && state.students.length > 0) {
            state.students.forEach(s => {
                const option = document.createElement('option');
                option.value = s.id;
                option.textContent = `${s.name || 'N/A'} (Std ${s.std || 'N/A'})`;
                select.appendChild(option);
            });
        } else {
            const option = document.createElement('option');
            option.disabled = true;
            option.textContent = 'No students available';
            select.appendChild(option);
        }
    }

    console.log('Opening modal');
    openModal('add-parent-modal');
}

function handleAddParent(e) {
    e.preventDefault();
    console.log('handleAddParent called');

    const studentId = document.getElementById('add-parent-student')?.value?.trim();
    const parentName = document.getElementById('add-parent-name')?.value?.trim();
    const parentPhone = document.getElementById('add-parent-phone')?.value?.trim();

    console.log('Form data:', { studentId, parentName, parentPhone });

    if (!studentId) {
        console.log('No student selected');
        showToast('Please select a student', 'error');
        return;
    }

    const payload = {
        parent_name: parentName || '',
        mobile_no: parentPhone || '',
    };

    console.log('Sending payload:', payload);

    fetch(`${API_BASE}/students/${studentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            console.log('Response:', data);
            if (data.message?.includes('successfully')) {
                closeModal('add-parent-modal');
                showToast('Parent details added successfully');
                fetchStudents();
            } else {
                showToast(data.message || 'Failed to add parent details', 'error');
            }
        })
        .catch(err => {
            console.error('handleAddParent error', err);
            showToast('Connection error while adding parent details', 'error');
        });
}

function setupBillingView() {
    const s = state.activeBillingStudent;
    if (!s) return;

    document.getElementById('bill-student-name').textContent = s.name || '-';
    document.getElementById('bill-student-std').textContent = `Std ${s.std || '-'}`;
    document.getElementById('bill-parent-name').textContent = s.parent || '-';
    document.getElementById('bill-student-phone').textContent = s.phone || '-';
    document.getElementById('bill-student-house').textContent = s.house || '-';

    document.getElementById('search-items').value = '';
    renderPOSItems('');
    updateCartUI();
}

function startBillingForStudent(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;

    state.activeBillingStudent = student;
    persistActiveBillingStudentSession(student.id);
    // CLEAR all caches - fetch fresh data from database
    state.billingPriceByItemId = {};
    state.billingSizeByItemId = {};
    state.cart = {};
    state.paymentMode = 'cash'; // Reset payment mode to default

    // Reset button states
    const buttons = document.querySelectorAll('.payment-mode-btn');
    buttons.forEach(btn => {
        if (btn.dataset.mode === 'cash') {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Fetch fresh invoice data from database (no local cache used)
    fetch(`${API_BASE}/create-invoice/${studentId}`)
        .then(res => res.json())
        .then(data => {
            const items = Array.isArray(data?.items) ? data.items : [];
            const serverCart = {};
            const studentGenderToken = getGenderToken(student.gender);

            items.forEach(line => {
                const key = normalizeItemKey(line.dress || '');
                let item = state.posItems.find(p => normalizeItemKey(p.name) === key);
                if (!item && key === 'shirt') {
                    item = pickGenderSpecificShirtItem(state.posItems, studentGenderToken);
                }
                if (!item) return;

                const qty = Number(line.quantity) || 0;
                if (qty > 0) serverCart[item.id] = qty;
                if (line.size && line.size !== '-') state.billingSizeByItemId[item.id] = String(line.size);
                state.billingPriceByItemId[item.id] = Number(line.unit_price) || 0;
            });

            // Use fresh database data only
            state.cart = serverCart;

            renderPOSItems(document.getElementById('search-items')?.value || '');
            updateCartUI();
        })
        .catch(err => {
            console.error('Failed to load invoice from database:', err);
            showToast('Failed to load billing data', 'error');
        });

    switchNav('billing-pos');
}

function renderPOSItems(filterText = '') {
    const grid = document.getElementById('pos-items-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.posItems.length) {
        grid.innerHTML = '<div class="empty-cart text-center text-muted p-4"><p>No products configured in uniform_prices.</p></div>';
        return;
    }

    const lower = String(filterText || '').toLowerCase();
    const billingGenderToken = getGenderToken(state.activeBillingStudent?.gender || '');
    const filtered = state.posItems
        .filter(item => item.name.toLowerCase().includes(lower))
        .filter(item => shouldShowItemForGender(item, billingGenderToken));

    sortPosItems(filtered).forEach(item => {
        const qty = state.cart[item.id] || 0;
        const unitPrice = getBillingUnitPrice(item.id);
        const card = document.createElement('div');
        card.className = 'product-card';
        card.innerHTML = `
            <div class="product-image">${renderProductIconMarkup(item)}</div>
            <div class="product-info">
                <div class="product-title">${item.name}</div>
                <div class="product-price">${unitPrice > 0 ? `₹${unitPrice}` : 'Price from DB'}</div>
                <div class="qty-controls mt-2">
                    <button class="qty-btn" onclick="updateItemQty(${item.id}, -1)"><i class="ph ph-minus"></i></button>
                    <span class="qty-display">${qty}</span>
                    <button class="qty-btn" onclick="updateItemQty(${item.id}, 1)"><i class="ph ph-plus"></i></button>
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function updateItemQty(itemId, change) {
    const current = Number(state.cart[itemId] || 0);
    const next = current + change;
    if (next <= 0) {
        delete state.cart[itemId];
        delete state.billingPriceByItemId[itemId];
    } else {
        state.cart[itemId] = next;
        // Set the price when item is first added to cart.
        // Prefer student-specific database mapping over generic default averages.
        if (!state.billingPriceByItemId[itemId]) {
            const item = state.posItems.find(i => i.id === itemId);
            if (item) {
                const selectedSize = state.billingSizeByItemId[itemId] || '';
                const resolved = getBillingStudentUnitPrice(item, selectedSize);
                if (resolved > 0) {
                    state.billingPriceByItemId[itemId] = resolved;
                }
            }
        }
    }

    renderPOSItems(document.getElementById('search-items')?.value || '');
    updateCartUI();
}

function updateCartUI() {
    const list = document.getElementById('cart-items-list');
    if (!list) return;
    list.innerHTML = '';

    let subtotal = 0;
    const keys = Object.keys(state.cart);

    if (!keys.length) {
        list.innerHTML = '<div class="empty-cart text-center text-muted p-4"><i class="ph ph-shopping-cart" style="font-size: 2rem;"></i><p>No items selected yet.</p></div>';
    } else {
        keys.forEach(k => {
            const itemId = Number(k);
            const item = state.posItems.find(i => i.id === itemId);
            if (!item) return;

            const qty = Number(state.cart[itemId] || 0);
            const unitPrice = getBillingUnitPrice(itemId);
            const lineTotal = unitPrice * qty;
            subtotal += lineTotal;
            const size = state.billingSizeByItemId[itemId];

            const div = document.createElement('div');
            div.className = 'cart-item';
            div.innerHTML = `
                <div class="cart-item-info">
                    <div class="cart-item-title">${item.name}${size ? ` (${size})` : ''}</div>
                    <div class="cart-item-meta">₹${unitPrice.toFixed(2)} × ${qty}</div>
                </div>
                <div class="cart-item-price">₹${lineTotal.toFixed(2)}</div>
            `;
            list.appendChild(div);
        });
    }

    state.cartTotal = subtotal;
    const sub = document.getElementById('bill-subtotal');
    const total = document.getElementById('bill-total');
    if (sub) sub.textContent = subtotal.toFixed(2);
    if (total) total.textContent = subtotal.toFixed(2);
}

function persistInvoice(status, paymentMode, utrNo) {
    if (!state.activeBillingStudent?.id) {
        return Promise.resolve({ ok: false, message: 'No active student selected.' });
    }

    const invoiceItems = Object.keys(state.cart).map((k) => {
        const itemId = Number(k);
        const item = state.posItems.find(p => p.id === itemId);
        const quantity = Number(state.cart[itemId] || 0);
        const unitPrice = getBillingUnitPrice(itemId);
        const size = state.billingSizeByItemId[itemId] || null;

        if (!item || quantity <= 0) return null;
        return {
            item_name: item.name,
            quantity,
            size,
            unit_price: unitPrice,
        };
    }).filter(Boolean);

    const payload = {
        student_id: state.activeBillingStudent.id,
        school_id: state.activeSchool?.id || null,
        status,
        payment_mode: state.paymentMode || 'cash',
        items: invoiceItems,
        payment_mode: (paymentMode || 'cash').toLowerCase(),
        utr_no: utrNo || null,
    };

    return fetch(`${API_BASE}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json().then(data => ({ statusCode: res.status, data })))
        .then(({ statusCode, data }) => {
            if (statusCode >= 200 && statusCode < 300) {
                const inserted = Array.isArray(data?.data) && data.data.length ? data.data[0] : null;
                if (inserted) {
                    const exists = state.invoices.some(inv => String(inv.id || '') === String(inserted.id || ''));
                    if (!exists) state.invoices.unshift(inserted);
                }

                const lines = Array.isArray(data?.invoice?.items) ? data.invoice.items : [];
                lines.forEach(line => {
                    const key = normalizeItemKey(line.dress || '');
                    const item = state.posItems.find(p => normalizeItemKey(p.name) === key);
                    if (!item) return;
                    state.billingPriceByItemId[item.id] = Number(line.unit_price) || 0;
                    if (line.size && line.size !== '-') state.billingSizeByItemId[item.id] = String(line.size);
                });

                return { ok: true, invoiceId: inserted?.id || genId(), invoiceNumber: inserted?.invoice_number };
            }

            return { ok: false, message: data?.message || 'Failed to store invoice.' };
        })
        .catch(err => {
            console.error('persistInvoice error', err);
            return { ok: false, message: 'Connection error while storing invoice.' };
        });
}

function toggleUtrField() {
    const mode = document.getElementById('payment-mode-select')?.value;
    const utrField = document.getElementById('utr-field');
    if (!utrField) return;
    if (mode === 'Online') {
        utrField.classList.remove('hidden');
    } else {
        utrField.classList.add('hidden');
        const input = document.getElementById('utr-number-input');
        if (input) input.value = '';
    }
}

function saveAsDraft() {
    if (!Object.keys(state.cart).length) {
        showToast('Cannot save empty draft.', 'error');
        return;
    }
    persistInvoice('Draft').then(result => {
        if (!result.ok) {
            showToast(result.message || 'Failed to save draft', 'error');
            return;
        }
        showToast('Invoice saved as draft.');
        showPaperBill(String(result.invoiceId), 'Draft', null, null, result.invoiceNumber);
    });
}

function generateInvoice() {
    if (!Object.keys(state.cart).length) {
        showToast('Cannot generate empty bill.', 'error');
        return;
    }
    if (isInvoiceSubmitting) {
        showToast('Invoice generation already in progress.', 'error');
        return;
    }

    isInvoiceSubmitting = true;
    const btn = document.getElementById('btn-generate-invoice');
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
    }

    const paymentMode = document.getElementById('payment-mode-select')?.value || 'Cash';
    const utrNo = document.getElementById('utr-number-input')?.value?.trim() || '';

    persistInvoice('Paid', paymentMode, utrNo).then(result => {
        if (!result.ok) {
            showToast(result.message || 'Failed to generate invoice', 'error');
            isInvoiceSubmitting = false;
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = '1';
            }
            return;
        }
        showToast('Invoice generated successfully.');
        showPaperBill(String(result.invoiceId), 'Paid', paymentMode, utrNo, result.invoiceNumber);
        fetchInvoices({ force: true });
        loadStocks();
        isInvoiceSubmitting = false;
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    });
}

function showPaperBill(invoiceId, status, paymentMode, utrNo, invoiceNumber) {
    const s = state.activeBillingStudent;
    if (!s) return;

    const now = new Date();

    // Resolve the display label
    let displayLabel = String(invoiceNumber || '');
    if (!displayLabel) {
        displayLabel = `INV-${String(invoiceId || 'NA').split('-')[0].toUpperCase()}`;
    }

    document.getElementById('pb-invoice-id').textContent = displayLabel;
    document.getElementById('pb-date').textContent = now.toLocaleDateString('en-IN');
    document.getElementById('pb-time').textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    document.getElementById('pb-student-name').textContent = s.name || '-';
    document.getElementById('pb-student-std').textContent = s.std || '-';
    document.getElementById('pb-student-roll').textContent = s.sNo || '-';
    document.getElementById('pb-school-name').textContent = state.activeSchool?.name || '-';
    document.getElementById('pb-phone').textContent = s.phone || '-';
    document.getElementById('pb-payment-mode').textContent = (state.paymentMode || 'cash').toUpperCase();
    document.getElementById('pb-barcode-label').textContent = displayLabel;

    const tbody = document.getElementById('pb-items-body');
    tbody.innerHTML = '';

    let subtotal = 0;
    let idx = 1;
    Object.keys(state.cart).forEach(k => {
        const itemId = Number(k);
        const item = state.posItems.find(i => i.id === itemId);
        if (!item) return;

        const qty = Number(state.cart[itemId] || 0);
        const unitPrice = getBillingUnitPrice(itemId);
        const lineTotal = unitPrice * qty;
        subtotal += lineTotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center">${idx}</td>
            <td>${item.name}</td>
            <td style="text-align:center">${qty}</td>
            <td style="text-align:right">₹${unitPrice.toFixed(2)}</td>
            <td style="text-align:right">₹${lineTotal.toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
        idx += 1;
    });

    const grand = subtotal;

    document.getElementById('pb-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
    document.getElementById('pb-total').textContent = `₹${grand.toFixed(2)}`;
    document.getElementById('pb-amount-words').textContent = `Rupees ${Math.round(grand)} Only`;

    const stamp = document.getElementById('pb-status-stamp');
    stamp.textContent = status.toUpperCase();
    stamp.className = 'paper-bill-status-stamp' + (status === 'Paid' ? ' paid' : '');

    // Payment mode and UTR
    const resolvedMode = String(paymentMode || 'cash');
    const resolvedUtr = String(utrNo || '').trim();
    const pmEl = document.getElementById('pb-payment-mode');
    const utrRow = document.getElementById('pb-utr-row');
    const utrEl = document.getElementById('pb-utr-no');
    if (pmEl) pmEl.textContent = resolvedMode.charAt(0).toUpperCase() + resolvedMode.slice(1);
    if (utrRow && utrEl) {
        if (resolvedMode.toLowerCase() === 'online' && resolvedUtr) {
            utrEl.textContent = resolvedUtr;
            utrRow.classList.remove('hidden');
        } else {
            utrRow.classList.add('hidden');
        }
    }

    openModal('bill-draft-modal');
}

let originalDocumentTitle = document.title;

function getCurrentPaperBillInvoiceNumber() {
    const invoiceEl = document.getElementById('pb-invoice-id');
    const raw = String(invoiceEl?.textContent || '').trim();
    return raw || 'Invoice';
}

function closeBillModal() {
    closeModal('bill-draft-modal');

    const orderedStudents = getStudentsInWorkOrder();
    const currentStudentId = String(state.activeBillingStudent?.id || '');
    const currentIndex = orderedStudents.findIndex((s) => String(s.id || '') === currentStudentId);
    const nextStudent = currentIndex >= 0 && currentIndex < (orderedStudents.length - 1)
        ? orderedStudents[currentIndex + 1]
        : null;

    if (nextStudent?.id) {
        state.activeBillingStudent = nextStudent;
        state.paymentMode = 'cash'; // Reset payment mode
        persistActiveBillingStudentSession(nextStudent.id);
        pendingStudentFocusId = String(nextStudent.id);

        // Reset button states
        const buttons = document.querySelectorAll('.payment-mode-btn');
        buttons.forEach(btn => {
            if (btn.dataset.mode === 'cash') {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    } else if (currentStudentId) {
        persistActiveBillingStudentSession(currentStudentId);
        pendingStudentFocusId = currentStudentId;
    }

    const searchInput = document.getElementById('search-student');
    if (searchInput) searchInput.value = '';

    switchNav('students-list');
}

function printPaperBill() {
    const invoiceNumber = getCurrentPaperBillInvoiceNumber();
    document.title = invoiceNumber;
    window.print();
}

window.addEventListener('afterprint', () => {
    document.title = originalDocumentTitle;
});

function handleLogin(e) {
    e.preventDefault();

    const payload = {
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
        role: document.getElementById('login-role').value,
    };

    fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            console.log('[login] response received:', data);
            if (data.message === 'Login successful') {
                state.user = {
                    id: data.user?.id,
                    username: data.user?.name || data.user?.username || data.user?.email || 'User',
                    email: data.user?.email,
                    role: data.user?.role,
                };
                persistUserSession();
                showToast('Logged in successfully');

                // Check if user is a worker - skip school selection and go directly to dashboard
                if (data.user?.role === 'worker') {
                    // For workers: fetch schools and proceed directly to dashboard
                    fetchSchools()
                        .then(() => {
                            console.log('[login] Worker login - skipping school selection, going to dashboard');
                            continueWorkerToDashboard();
                        })
                        .catch(err => {
                            console.error('[login] error fetching schools for worker:', err);
                            showToast('Failed to load schools', 'error');
                        });
                } else {
                    // For admins: show school selection view
                    fetchSchools()
                        .then(() => {
                            console.log('[login] Admin login - showing school selection');
                            showView('view-school-select');
                        })
                        .catch(err => {
                            console.error('[login] error fetching schools:', err);
                            // Still show school selection even if fetch fails (could use cached data)
                            showView('view-school-select');
                        });
                }
            } else {
                console.log('[login] login failed with message:', data.message);
                showToast(data.message || 'Login failed', 'error');
            }
        })
        .catch(err => {
            console.error('[login] network or parse error:', err);
            showToast('Connection error while logging in', 'error');
        });
}

function handleRegister(e) {
    e.preventDefault();

    const payload = {
        name: document.getElementById('register-name').value,
        email: document.getElementById('register-email').value,
        password: document.getElementById('register-password').value,
        role: document.getElementById('register-role').value,
    };

    fetch(`${API_BASE}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then(res => res.json())
        .then(data => {
            if (data.message?.includes('successfully')) {
                showToast('Registration successful');
                closeModal('register-modal');
                document.getElementById('register-form').reset();
            } else {
                showToast(data.message || 'Registration failed', 'error');
            }
        })
        .catch(err => {
            console.error('handleRegister error', err);
            showToast('Connection error while registering', 'error');
        });
}

function handleAddSchool(e) {
    e.preventDefault();

    const file = document.getElementById('school-excel-file')?.files?.[0];
    if (!file) {
        showToast('Upload the school pricing file before adding school.', 'error');
        return;
    }

    const lowerName = String(file.name || '').toLowerCase();
    if (!(lowerName.endsWith('.xls') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.csv'))) {
        showToast('Invalid file type. Please upload .xls, .xlsx, or .csv', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('school_name', document.getElementById('add-school-name').value);
    formData.append('address', document.getElementById('add-school-address').value);
    formData.append('contact_person', document.getElementById('add-school-contact-person').value);
    formData.append('contact_person_number', document.getElementById('add-school-phone').value);
    formData.append('academic_year', document.getElementById('add-school-year').value || '2024-2025');
    formData.append('file', file);

    fetch(`${API_BASE}/schools`, { method: 'POST', body: formData })
        .then(async res => ({ status: res.status, data: await res.json() }))
        .then(({ status, data }) => {
            if (data.message?.includes('successfully')) {
                showToast('School added successfully');
                closeModal('add-school-modal');
                document.getElementById('add-school-form').reset();
                const fileInfo = document.getElementById('school-file-info');
                if (fileInfo) fileInfo.classList.add('hidden');
                fetchSchools();
            } else {
                const prefix = status >= 400 ? 'Upload failed: ' : '';
                showToast(prefix + (data.message || 'Failed to add school'), 'error');
            }
        })
        .catch(err => {
            console.error('handleAddSchool error', err);
            showToast('Connection error while adding school', 'error');
        });
}

function mockImportStudents() {
    const file = document.getElementById('bulk-student-file')?.files?.[0];
    if (!file || !state.activeSchool?.id) {
        showToast('Select a file and school first.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('school_id', state.activeSchool.id);

    fetch(`${API_BASE}/students/bulk`, { method: 'POST', body: formData })
        .then(async res => {
            let data = {};
            try {
                data = await res.json();
            } catch (e) {
                data = {};
            }
            return { status: res.status, data };
        })
        .then(({ status, data }) => {
            if (status >= 200 && status < 300 && data.message?.includes('successfully')) {
                showToast(data.message || 'Students imported successfully');
                fetchStudents();
                switchNav('students-list');
                return;
            }

            const prefix = status >= 400 ? 'Import failed: ' : '';
            showToast(prefix + (data.message || 'Failed to import students'), 'error');
        })
        .catch(err => {
            console.error('mockImportStudents error', err);
            showToast('Connection error while importing students', 'error');
        });
}

function toggleDropdown(studentId) {
    document.querySelectorAll('.dropdown').forEach(el => {
        if (el.id !== `dropdown-${studentId}`) el.classList.remove('show');
    });

    const el = document.getElementById(`dropdown-${studentId}`);
    if (el) el.classList.toggle('show');
}

function closeDropdown(studentId) {
    const el = document.getElementById(`dropdown-${studentId}`);
    if (el) el.classList.remove('show');
}

function toggleStudentSelection(id, checked) {
    if (!id) return;
    if (checked) state.selectedStudentIds.add(String(id));
    else state.selectedStudentIds.delete(String(id));
}

function toggleSelectAllStudents(checked) {
    const boxes = document.querySelectorAll('#students-table tbody input[type="checkbox"]');
    boxes.forEach(cb => {
        cb.checked = checked;
        const onchange = cb.getAttribute('onchange') || '';
        const match = onchange.match(/'([^']+)'/);
        if (!match?.[1]) return;
        if (checked) state.selectedStudentIds.add(match[1]);
        else state.selectedStudentIds.delete(match[1]);
    });
}

function deleteSelectedStudents() {
    const ids = Array.from(state.selectedStudentIds);
    if (!ids.length) {
        showToast('Select at least one student to delete.', 'error');
        return;
    }

    fetch(`${API_BASE}/students/bulk-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
    })
        .then(res => res.json())
        .then(data => {
            if (data.message?.includes('successfully')) {
                state.selectedStudentIds.clear();
                showToast(data.message);
                fetchStudents();
            } else {
                showToast(data.message || 'Failed to delete students', 'error');
            }
        })
        .catch(err => {
            console.error('deleteSelectedStudents error', err);
            showToast('Connection error while deleting students', 'error');
        });
}

document.addEventListener('click', (event) => {
    if (!event.target.closest('.dropdown')) {
        document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('show'));
    }
});

function clearAllFrontendCache() {
    // Clear all localStorage data
    localStorage.clear();

    // Clear all sessionStorage data
    sessionStorage.clear();

    // Clear IndexedDB if available
    if (window.indexedDB) {
        try {
            const dbs = window.indexedDB.databases();
            if (dbs && typeof dbs.then === 'function') {
                dbs.then(list => {
                    list.forEach(db => {
                        try {
                            window.indexedDB.deleteDatabase(db.name);
                        } catch (e) {
                            console.warn(`Could not delete IndexedDB: ${db.name}`, e);
                        }
                    });
                }).catch(err => console.warn('Could not list IndexedDB databases', err));
            }
        } catch (e) {
            console.warn('IndexedDB not available', e);
        }
    }

    // Clear all cookies
    document.cookie.split(';').forEach(cookie => {
        const eqPos = cookie.indexOf('=');
        const name = eqPos > -1 ? cookie.substr(0, eqPos).trim() : cookie.trim();
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    });

    // Clear all state data
    state.user = null;
    state.activeSchool = null;
    state.activeBillingStudent = null;
    state.schools = [];
    state.students = [];
    state.invoices = [];
    state.posItems = [];
    state.cart = {};
    state.cartTotal = 0;
    state.billingPriceByItemId = {};
    state.billingSizeByItemId = {};
    state.activeUploadedFileId = null;
    state.selectedStudentIds = new Set();

    // Clear any global variables with cached data
    if (typeof studentCart !== 'undefined') {
        studentCart = {};
    }
    if (typeof uploadedStudentFilesBySchool !== 'undefined') {
        uploadedStudentFilesBySchool = {};
    }

    console.log('All frontend caches have been cleared.');
}

// Expose cache clearing function globally for manual use
window.clearCache = clearAllFrontendCache;

function initApp() {
    // Restore previous session so refresh does not force login again.
    restoreSessionIfAvailable();


    document.getElementById('login-form')?.addEventListener('submit', handleLogin);
    document.getElementById('register-form')?.addEventListener('submit', handleRegister);
    document.getElementById('add-school-form')?.addEventListener('submit', handleAddSchool);
    document.getElementById('add-student-form')?.addEventListener('submit', handleAddStudent);
    document.getElementById('edit-student-form')?.addEventListener('submit', handleEditStudent);
    document.getElementById('add-parent-form')?.addEventListener('submit', handleAddParent);

    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            const target = el.getAttribute('data-target');
            if (target) switchNav(target);
        });
    });

    document.getElementById('search-student')?.addEventListener('input', debounce((e) => renderStudentsTable(e.target.value || '', true)));
    document.getElementById('search-billing-student')?.addEventListener('input', debounce((e) => renderBillingStudentsTable(e.target.value || '')));
    document.getElementById('search-items')?.addEventListener('input', debounce((e) => renderPOSItems(e.target.value || '')));
    document.getElementById('search-items-student')?.addEventListener('input', debounce((e) => renderStudentPOSItems(e.target.value || '')));

    const loginPasswordToggle = document.getElementById('login-password-toggle');
    loginPasswordToggle?.addEventListener('click', () => {
        const inputId = loginPasswordToggle.getAttribute('data-target-input') || 'login-password';
        togglePasswordVisibility(inputId, loginPasswordToggle);
    });

    document.getElementById('school-excel-file')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        const info = document.getElementById('school-file-info');
        const name = document.getElementById('school-file-name');
        if (!file || !info || !name) return;
        name.textContent = file.name;
        info.classList.remove('hidden');
    });

    document.getElementById('bulk-student-file')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        const disp = document.getElementById('bulk-file-display');
        const name = document.getElementById('bulk-file-name');
        if (!file || !disp || !name) return;
        name.textContent = file.name;
        disp.classList.remove('hidden');
    });

    document.getElementById('stock-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        const disp = document.getElementById('stock-file-display');
        const name = document.getElementById('stock-file-name');
        if (!file || !disp || !name) return;
        name.textContent = file.name;
        disp.classList.remove('hidden');
    });
}

// ==================== STOCKS MANAGEMENT ====================

function uploadStocks() {
    const file = document.getElementById('stock-file-input')?.files?.[0];
    if (!file || !state.activeSchool?.id) {
        showToast('Select a file and ensure school is selected first.', 'error');
        return;
    }

    const btn = document.getElementById('btn-upload-stocks');
    if (btn) btn.disabled = true;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('school_id', state.activeSchool.id);

    fetch(`${API_BASE}/stocks/upload`, { method: 'POST', body: formData })
        .then(async res => {
            let data = {};
            try {
                data = await res.json();
            } catch (e) {
                data = {};
            }
            return { status: res.status, data };
        })
        .then(({ status, data }) => {
            if (btn) btn.disabled = false;

            if (status >= 200 && status < 300 && data.success) {
                showToast(data.message || `Successfully uploaded ${data.count || 0} stock records`);
                // Clear file input
                document.getElementById('stock-file-input').value = '';
                document.getElementById('stock-file-display').classList.add('hidden');
                // Reload stocks table
                loadStocks();
                return;
            }

            const prefix = status >= 400 ? 'Upload failed: ' : '';
            showToast(prefix + (data.error || data.message || 'Failed to upload stocks'), 'error');
        })
        .catch(err => {
            if (btn) btn.disabled = false;
            console.error('uploadStocks error', err);
            showToast('Connection error while uploading stocks', 'error');
        });
}

function loadStocks() {
    if (!state.activeSchool?.id) {
        return;
    }

    fetch(`${API_BASE}/stocks?school_id=${encodeURIComponent(state.activeSchool.id)}`)
        .then(res => res.json())
        .then(data => {
            if (data.success && Array.isArray(data.stocks)) {
                // Store stocks in state for later use
                state.stocks = data.stocks || [];
                renderStocksTable();
            } else {
                state.stocks = [];
                renderStocksTable();
            }
        })
        .catch(err => {
            console.error('loadStocks error', err);
            state.stocks = [];
            renderStocksTable();
        });
}

function renderStocksTable() {
    const table = document.getElementById('stocks-table')?.querySelector('tbody');
    const emptyMsg = document.getElementById('empty-stocks');

    if (!table || !emptyMsg) return;

    table.innerHTML = '';

    if (!state.stocks || state.stocks.length === 0) {
        emptyMsg.classList.remove('hidden');
        return;
    }

    emptyMsg.classList.add('hidden');

    // Group by standard + item + gender to keep gender visible in the summary.
    const grouped = new Map();
    (state.stocks || []).forEach((stock) => {
        const standard = String(stock.standard ?? '-').trim() || '-';
        const item = String(stock.item ?? '-').trim() || '-';
        const gender = String(stock.gender ?? '-').trim() || '-';
        const key = `${standard}__${item}__${gender}`;
        const qty = Number(stock.stock ?? 0) || 0;

        if (!grouped.has(key)) {
            grouped.set(key, { standard, item, gender, stock: 0 });
        }

        grouped.get(key).stock += qty;
    });

    const rows = Array.from(grouped.values())
        .sort((a, b) => {
            const stdA = parseInt(a.standard, 10);
            const stdB = parseInt(b.standard, 10);
            if (!Number.isNaN(stdA) && !Number.isNaN(stdB) && stdA !== stdB) return stdA - stdB;
            const itemCmp = a.item.localeCompare(b.item);
            if (itemCmp !== 0) return itemCmp;
            return a.gender.localeCompare(b.gender);
        });

    rows.forEach((stock) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${stock.standard || '-'}</td>
            <td>${stock.item || '-'}</td>
            <td>${stock.gender || '-'}</td>
            <td>
                <span class="badge ${stock.stock > 10 ? 'badge-success' : stock.stock > 0 ? 'badge-warning' : 'badge-danger'}">
                    ${stock.stock ?? 0}
                </span>
            </td>
        `;
        table.appendChild(row);
    });
}

document.addEventListener('DOMContentLoaded', initApp);

