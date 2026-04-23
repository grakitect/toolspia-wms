const views = [
  "dashboard",
  "master",
  "products",
  "stock",
  "inbound",
  "inbound-plan",
  "inbound-plan-2",
  "outbound",
  "adjust",
  "history",
  "alert"
];
const LAST_VIEW_KEY = "wms:lastView";
const PRODUCT_HIDDEN_COLS_KEY = "wms:productHiddenCols";
const TABLE_FILTER_MEMORY = {};
let productListPageIndex = 0;
const state = {
  products: [],
  stock: [],
  warehouses: [],
  productOptions: {
    status: [],
    deliveryVendors: [],
    orderDept: [],
    orderManagers: [],
    supplyType: [],
    warehouseGroup: [],
    itemType: [],
    categories: []
  },
  partners: { inbound: [], outbound: [], purchase: [] },
  managers: []
};

function qs(sel) {
  return document.querySelector(sel);
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function formatYmd(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 8) return raw;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** YYYY/MM/DD 또는 YYYYMMDD 등 날짜 표시용 */
function formatYmdLoose(v) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return formatYmd(v);
}

function normalizeDateTimeDigits(v) {
  return String(v || "")
    .trim()
    .replace(/[^\d]/g, "");
}

/** 브라우저 로컬 날짜 기준 YYYY-MM-DD (date input·API 신규 확인 기간용) */
function localDateYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeSlipNoText(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  const compact = s.replace(/\s+/g, "");
  const m = compact.match(/^(\d{2}|\d{4})\/?(\d{2})\/?(\d{2})-(\d+)$/);
  if (m) {
    const yy = m[1].length === 4 ? m[1].slice(2) : m[1];
    return `${yy}/${m[2]}/${m[3]}-${String(Number(m[4]))}`;
  }
  return compact;
}

function toTagList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x || "").trim()).filter(Boolean);
  return String(v || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function renderTagChips(v, cls = "tag tag-orange") {
  const list = toTagList(v);
  if (!list.length) return "<span class='muted'>-</span>";
  return list.map((x) => `<span class="${cls}">${esc(x)}</span>`).join("");
}

function preventEnterSubmit(formEl) {
  if (!formEl) return;
  formEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
}

function applyExcelLikeFilter(tableSelector, afterApply) {
  const table = qs(tableSelector);
  if (!table || !table.tHead || !table.tBodies || !table.tBodies[0]) return;
  const headRow = table.tHead.rows[0];
  if (!headRow) return;
  const tbody = table.tBodies[0];
  const rows = Array.from(tbody.rows || []);
  const originalRows = [...rows];
  const colCount = headRow.cells.length;
  if (!rows.length || !colCount) return;

  const colValues = Array.from({ length: colCount }, () => new Set());
  rows.forEach((row) => {
    for (let i = 0; i < colCount; i += 1) {
      colValues[i].add(String(row.cells[i] ? row.cells[i].textContent : "").trim());
    }
  });

  const memory = TABLE_FILTER_MEMORY[tableSelector];
  const filterState = colValues.map((set, idx) => {
    const allValues = Array.from(set);
    let selected = new Set(allValues);
    const saved = memory && Array.isArray(memory.filters) ? memory.filters[idx] : null;
    if (saved && Array.isArray(saved.selected)) {
      const kept = saved.selected.filter((v) => allValues.includes(v));
      selected = new Set(kept.length ? kept : allValues);
    }
    return { allValues, selected };
  });
  const sortState = memory?.sort ? { col: Number(memory.sort.col), dir: String(memory.sort.dir || "") } : { col: -1, dir: "" };
  if (!Number.isInteger(sortState.col) || sortState.col < 0 || sortState.col >= colCount) sortState.col = -1;
  if (!["asc", "desc", ""].includes(sortState.dir)) sortState.dir = "";
  let openedMenu = null;

  function cellValue(row, col) {
    return String(row.cells[col] ? row.cells[col].textContent : "").trim();
  }

  function compareValue(a, b, dir) {
    const na = Number(String(a).replace(/,/g, ""));
    const nb = Number(String(b).replace(/,/g, ""));
    let cmp = 0;
    if (Number.isFinite(na) && Number.isFinite(nb) && String(a) !== "" && String(b) !== "") {
      cmp = na - nb;
    } else {
      cmp = String(a).localeCompare(String(b), "ko", { numeric: true });
    }
    return dir === "asc" ? cmp : -cmp;
  }

  function apply() {
    rows.forEach((row) => {
      let visible = true;
      for (let i = 0; i < colCount; i += 1) {
        const val = cellValue(row, i);
        const st = filterState[i];
        if (st.selected.size !== st.allValues.length && !st.selected.has(val)) {
          visible = false;
          break;
        }
      }
      row.dataset.wmsExcelVisible = visible ? "1" : "0";
      row.style.display = visible ? "" : "none";
    });

    if (sortState.col >= 0 && (sortState.dir === "asc" || sortState.dir === "desc")) {
      const sorted = [...rows].sort((r1, r2) =>
        compareValue(cellValue(r1, sortState.col), cellValue(r2, sortState.col), sortState.dir)
      );
      sorted.forEach((r) => tbody.appendChild(r));
    } else {
      originalRows.forEach((r) => tbody.appendChild(r));
    }
    TABLE_FILTER_MEMORY[tableSelector] = {
      filters: filterState.map((st) => ({ selected: Array.from(st.selected) })),
      sort: { col: sortState.col, dir: sortState.dir }
    };
    if (typeof afterApply === "function") afterApply();
  }

  function closeMenu() {
    if (openedMenu) {
      openedMenu.remove();
      openedMenu = null;
    }
  }

  Array.from(headRow.cells).forEach((th, colIdx) => {
    // Keep checkbox header cell intact (e.g., product select-all column).
    if (th.querySelector('input[type="checkbox"]')) return;

    const baseLabel = th.getAttribute("data-base-label") || String(th.textContent || "").trim();
    th.setAttribute("data-base-label", baseLabel);
    th.innerHTML = "";
    th.classList.add("excel-th");

    const label = document.createElement("span");
    label.className = "excel-th-label";
    label.textContent = baseLabel;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "excel-th-trigger";
    trigger.textContent = "▼";
    trigger.title = "필터";

    trigger.onclick = (e) => {
      e.stopPropagation();
      closeMenu();

      const menu = document.createElement("div");
      menu.className = "excel-menu";
      menu.onclick = (evt) => evt.stopPropagation();

      const sortAsc = document.createElement("button");
      sortAsc.type = "button";
      sortAsc.className = "excel-menu-btn";
      sortAsc.textContent = "오름차순";
      sortAsc.onclick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        sortState.col = colIdx;
        sortState.dir = "asc";
        apply();
        closeMenu();
      };

      const sortDesc = document.createElement("button");
      sortDesc.type = "button";
      sortDesc.className = "excel-menu-btn";
      sortDesc.textContent = "내림차순";
      sortDesc.onclick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        sortState.col = colIdx;
        sortState.dir = "desc";
        apply();
        closeMenu();
      };

      const resetSort = document.createElement("button");
      resetSort.type = "button";
      resetSort.className = "excel-menu-btn";
      resetSort.textContent = "정렬해제";
      resetSort.onclick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        sortState.col = -1;
        sortState.dir = "";
        apply();
        closeMenu();
      };

      const valueWrap = document.createElement("div");
      valueWrap.className = "excel-menu-values";
      const st = filterState[colIdx];
      const values = [...st.allValues].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
      const valueCheckboxes = [];

      const allItem = document.createElement("label");
      allItem.className = "excel-menu-item excel-menu-item-all";
      const allCb = document.createElement("input");
      allCb.type = "checkbox";
      allCb.checked = st.selected.size === st.allValues.length;
      allCb.indeterminate = st.selected.size > 0 && st.selected.size < st.allValues.length;
      const allTxt = document.createElement("span");
      allTxt.textContent = "전체 선택";
      allItem.appendChild(allCb);
      allItem.appendChild(allTxt);
      valueWrap.appendChild(allItem);

      const divider = document.createElement("div");
      divider.className = "excel-menu-divider";
      valueWrap.appendChild(divider);

      function refreshAllCheckboxState() {
        allCb.checked = st.selected.size === st.allValues.length;
        allCb.indeterminate = st.selected.size > 0 && st.selected.size < st.allValues.length;
      }

      values.forEach((v) => {
        const item = document.createElement("label");
        item.className = "excel-menu-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = st.selected.has(v);
        cb.onclick = (evt) => evt.stopPropagation();
        cb.onchange = () => {
          if (cb.checked) st.selected.add(v);
          else st.selected.delete(v);
          refreshAllCheckboxState();
          apply();
        };
        const txt = document.createElement("span");
        txt.textContent = v === "" ? "(빈값)" : v;
        item.appendChild(cb);
        item.appendChild(txt);
        valueWrap.appendChild(item);
        valueCheckboxes.push({ value: v, cb });
      });

      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "excel-menu-btn";
      clearBtn.textContent = "값필터해제";
      clearBtn.onclick = (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        st.selected = new Set(st.allValues);
        valueCheckboxes.forEach((x) => {
          x.cb.checked = true;
        });
        refreshAllCheckboxState();
        apply();
        closeMenu();
      };

      allCb.onclick = (evt) => evt.stopPropagation();
      allCb.onchange = () => {
        if (allCb.checked) {
          st.selected = new Set(st.allValues);
          valueCheckboxes.forEach((x) => {
            x.cb.checked = true;
          });
        } else {
          st.selected = new Set();
          valueCheckboxes.forEach((x) => {
            x.cb.checked = false;
          });
        }
        refreshAllCheckboxState();
        apply();
      };

      menu.appendChild(sortAsc);
      menu.appendChild(sortDesc);
      menu.appendChild(resetSort);
      menu.appendChild(clearBtn);
      menu.appendChild(valueWrap);

      document.body.appendChild(menu);
      const rect = trigger.getBoundingClientRect();
      menu.style.left = "0px";
      menu.style.top = "0px";
      const margin = 8;
      const menuW = menu.offsetWidth || 220;
      const menuH = menu.offsetHeight || 260;
      const maxLeft = window.innerWidth - menuW - margin;
      const maxTop = window.innerHeight - menuH - margin;
      const left = Math.min(Math.max(margin, rect.left), Math.max(margin, maxLeft));
      const top = Math.min(Math.max(margin, rect.bottom + 6), Math.max(margin, maxTop));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      openedMenu = menu;
    };

    th.appendChild(label);
    th.appendChild(trigger);
  });

  if (!table.dataset.filterOutsideBound) {
    document.addEventListener("click", () => {
      closeMenu();
    });
    table.dataset.filterOutsideBound = "1";
  }

  apply();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "요청 실패");
  return data;
}

function switchView(name) {
  if (!views.includes(name)) return;
  if (name !== "products") delete TABLE_FILTER_MEMORY["#products-table"];
  for (const v of views) qs(`#view-${v}`).classList.add("hidden");
  qs(`#view-${name}`).classList.remove("hidden");
  document.querySelectorAll(".sidebar button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === name);
  });
  try {
    localStorage.setItem(LAST_VIEW_KEY, name);
  } catch (_) {
    // ignore storage errors
  }
}

function parseSheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/** 첫 시트를 2차원 배열로 (발주서현황 업로드용) */
function parseSheetAsMatrix(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        resolve({ matrix, sourceFileName: file.name || "upload.xlsx" });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function applyProductHiddenColumnStyles() {
  let hidden = [];
  try {
    hidden = JSON.parse(localStorage.getItem(PRODUCT_HIDDEN_COLS_KEY) || "[]");
  } catch (_) {}
  const id = "wms-product-col-hide-style";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  if (!Array.isArray(hidden) || !hidden.length) {
    el.textContent = "";
    return;
  }
  el.textContent = hidden
    .map(
      (n) =>
        `#products-table thead th:nth-child(${n}), #products-table tbody td:nth-child(${n}) { display: none !important; }`
    )
    .join("\n");
}

async function uploadProductBulkFromFile(file) {
  const rows2 = await parseSheet(file);
  const normalized = normalizeProductRows(rows2);
  if (!normalized.length) {
    throw new Error("업로드 가능한 상품행이 없습니다. 헤더명(품목코드(이카운트), 품목명(이카운트))과 데이터 유무를 확인하세요.");
  }
  await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ rows: normalized }) });
  await refreshCommon();
  return normalized.length;
}

async function uploadProductUpdateFromFile(file) {
  const rows2 = await parseSheet(file);
  const normalized = normalizeProductRows(rows2);
  if (!normalized.length) throw new Error("업데이엄트 가능한 상품행이 없습니다.");
  await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ rows: normalized }) });
  await refreshCommon();
  return normalized.length;
}

function setupDropZone(zoneId, fileInputId, onFilePicked) {
  const zone = qs(`#${zoneId}`);
  const fileInput = qs(`#${fileInputId}`);
  if (!zone || !fileInput) return;
  zone.onclick = () => fileInput.click();
  zone.ondragover = (e) => {
    e.preventDefault();
    zone.classList.add("drop-over");
  };
  zone.ondragleave = () => zone.classList.remove("drop-over");
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove("drop-over");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    try {
      fileInput.files = e.dataTransfer.files;
    } catch (_) {
      /* some browsers */
    }
    if (typeof onFilePicked === "function") onFilePicked(f);
  };
}

function downloadGuide(type) {
  const guides = {
    product: [
      {
        "품목코드(이카운트)": "EC-1001",
        "바코드(SKU)": "8800000000012",
        "바코드(중포)": "8800000000012-M",
        "바코드(카톤)": "L-8800000000012",
        "품목명(이카운트)": "샘플상품",
        "상태": "판매중",
        "판매처": "브랜드디자인, 김윤환",
        "판매처관리코드": "VD-001",
        "판매처 품목명": "샘플 납품품목명",
        "규격": "500ml",
        "구매처": "테스트구매처",
        "수급형태": "무역(수입)",
        "발주부서": "유통사업부",
        "발주담당자": "담당자A, 담당자B",
        "구매처 품목코드": "PV-001",
        "구매처 품목명": "구매처 샘플명",
        "창고그룹(이카운트)": "기본창고",
        "사용창고": "툴스피아, 다이소",
        "구분": "[상품]",
        "카테고리": "보통, 시즌"
      }
    ],
    IN: [{ "상품코드": "P-001", "수량": 10, "창고": "툴스피아", "입고처": "입고처A", "담당자": "admin", "메모": "초도 입고" }],
    OUT: [{ "상품코드": "P-001", "수량": 3, "창고": "툴스피아", "출고처": "출고처A", "담당자": "admin", "메모": "샘플 출고" }]
  };
  const ws = XLSX.utils.json_to_sheet(guides[type] || []);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "guide");
  XLSX.writeFile(wb, `${type}-upload-guide.xlsx`);
}

function getByKeys(row, keys) {
  const entries = Object.entries(row || {});
  const normalizeKey = (v) => String(v || "").replace(/[\s()[\]{}_\-./\\]/g, "").toLowerCase();
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    const nk = normalizeKey(k);
    const hit = entries.find(([rk, rv]) => normalizeKey(rk) === nk && rv !== undefined && rv !== null && rv !== "");
    if (hit) return hit[1];
  }
  return undefined;
}

function normalizeProductRows(rows) {
  return rows
    .map((r) => {
      const ecountCode = getByKeys(r, ["품목코드(이카운트)", "품목코드", "ecountCode", "ECOUNT_CODE", "상품코드", "code", "Code"]);
      const ecountName = getByKeys(r, ["품목명(이카운트)", "품목명", "상품명", "name", "Name"]);
      return {
        code: String(ecountCode || "").trim(),
        name: String(ecountName || "").trim(),
        ecountCode: String(ecountCode || "").trim(),
        ecountName: String(ecountName || "").trim(),
        barcode: String(getByKeys(r, ["바코드(SKU)", "바코드", "barcode"]) || "").trim(),
        middleBarcode: String(
          getByKeys(r, ["바코드(중포)", "중포바코드", "중포 바코드", "중포", "middleBarcode", "middle_barcode"]) || ""
        ).trim(),
        logisticsBarcode: String(getByKeys(r, ["바코드(카톤)", "물류바코드", "logisticsBarcode"]) || "").trim(),
        status: String(getByKeys(r, ["상태", "status"]) || "판매중").trim(),
        deliveryVendors: toTagList(getByKeys(r, ["판매처", "deliveryVendors", "salesVendor"])),
        deliveryVendorCode: String(getByKeys(r, ["판매처관리코드", "deliveryVendorCode"]) || "").trim(),
        deliveryItemName: String(getByKeys(r, ["판매처 품목명", "deliveryItemName"]) || "").trim(),
        spec: String(getByKeys(r, ["규격", "spec"]) || "").trim(),
        purchaseVendor: String(getByKeys(r, ["구매처", "purchaseVendor"]) || "").trim(),
        supplyType: String(getByKeys(r, ["수급형태", "supplyType"]) || "").trim(),
        orderDept: String(getByKeys(r, ["발주부서", "orderDept"]) || "").trim(),
        orderManagers: toTagList(getByKeys(r, ["발주담당자", "orderManagers"])),
        purchaseItemCode: String(getByKeys(r, ["구매처 품목코드", "purchaseItemCode"]) || "").trim(),
        purchaseItemName: String(getByKeys(r, ["구매처 품목명", "purchaseItemName"]) || "").trim(),
        warehouseGroup: String(getByKeys(r, ["창고그룹(이카운트)", "창고그룹", "warehouseGroup"]) || "").trim(),
        usedWarehouses: toTagList(getByKeys(r, ["사용창고", "usedWarehouses"])),
        itemType: String(getByKeys(r, ["구분", "itemType"]) || "").trim(),
        categories: toTagList(getByKeys(r, ["카테고리", "categories", "category"])),
        unit: String(getByKeys(r, ["단위", "unit"]) || "EA").trim(),
        safetyStock: Number(getByKeys(r, ["안전재고", "safetyStock"]) || 0),
        optimalStock: Number(getByKeys(r, ["적정재고", "optimalStock"]) || 0)
      };
    })
    .filter((p) => p.ecountCode && p.ecountName);
}

function normalizeMovementRows(rows, type) {
  const partnerKeys = type === "IN" ? ["입고처", "partner"] : ["출고처", "partner"];
  const qtyKeys = ["수량", "qty", "Qty"];
  return rows.map((r) => {
    const productCode = getByKeys(r, ["상품코드", "productCode", "품목코드(이카운트)"]);
    return {
      productCode: String(productCode || "").trim(),
      qty: Number(getByKeys(r, qtyKeys) || 0),
      warehouse: String(getByKeys(r, ["창고", "warehouse"]) || "").trim(),
      partner: String(getByKeys(r, partnerKeys) || "").trim(),
      user: String(getByKeys(r, ["담당자", "user"]) || "").trim(),
      memo: String(getByKeys(r, ["메모", "memo"]) || "").trim()
    };
  }).filter((x) => x.productCode && x.qty !== 0 && x.partner && x.user && x.warehouse);
}

async function refreshCommon() {
  const [productsRes, stockRes, partnersRes, managersRes, warehousesRes, optionRes] = await Promise.all([
    api("/api/products"),
    api("/api/stock"),
    api("/api/partners"),
    api("/api/managers"),
    api("/api/warehouses"),
    api("/api/product-options")
  ]);
  state.products = productsRes.items;
  state.stock = stockRes.items;
  state.partners = partnersRes.items || { inbound: [], outbound: [], purchase: [] };
  state.managers = managersRes.items || [];
  state.warehouses = warehousesRes.items || [];
  state.productOptions = optionRes.items || state.productOptions;
}

async function renderDashboard() {
  const d = await api("/api/dashboard");
  qs("#view-dashboard").innerHTML = `
    <div class="card"><h2>대시보드</h2><p class="muted">기본 지표(향후 업그레이드 예정)</p></div>
    <div class="grid3">
      <div class="card"><h3>총 상품수</h3><strong>${d.totalProducts}</strong></div>
      <div class="card"><h3>안전재고 이하</h3><strong>${d.lowStock}</strong></div>
      <div class="card"><h3>오늘 입출고 건수</h3><strong>${d.todayMoves}</strong></div>
    </div>
  `;
}

function renderMaster() {
  const productOptions = state.products.map((p) => `<option value="${esc(p.code)}">${esc(p.code)} - ${esc(p.name)}</option>`).join("");
  const listTags = (arr) => arr.map((v) => `<span class="tag">${esc(v)}</span>`).join("") || "<span class='muted'>없음</span>";
  const partnerChip = (type, name) => `
    <span class="tag-wrap">
      <span class="tag">${esc(name)}</span>
      <button type="button" class="cancel-btn del-small partner-del" data-type="${type}" data-name="${encodeURIComponent(name)}">삭제</button>
    </span>
  `;
  const managerChip = (name) => `
    <span class="tag-wrap">
      <span class="tag">${esc(name)}</span>
      <button type="button" class="cancel-btn del-small manager-del" data-name="${encodeURIComponent(name)}">삭제</button>
    </span>
  `;
  const partnerRows = [
    ...state.partners.purchase.map((v) => ({ type: "purchase", label: "구매처", name: v })),
    ...state.partners.outbound.map((v) => ({ type: "outbound", label: "판매처", name: v }))
  ];
  const managerRows = state.managers.map((v) => ({ name: v }));

  qs("#view-master").innerHTML = `
    <div class="card"><h2>기본 정보</h2><p class="muted">거래처/담당자 등록</p></div>
    <div class="grid3">
      <div class="card">
        <h3>거래처 마스터 등록</h3>
        <form id="partner-master-form">
          <div><label>구분</label>
            <select name="type" required>
              <option value="purchase">구매처</option>
              <option value="outbound">판매처</option>
            </select>
          </div>
          <div><label>거래처명</label><input name="name" required /></div>
          <div><button class="primary" type="submit">등록</button></div>
        </form>
        <table class="mini-table">
          <thead><tr><th>구분</th><th>거래처</th><th>삭제</th></tr></thead>
          <tbody>
            ${partnerRows.length
              ? partnerRows
                  .map(
                    (r) =>
                      `<tr>
                        <td>${esc(r.label)}</td>
                        <td>${esc(r.name)}</td>
                        <td>
                          <button type="button" class="cancel-btn del-small partner-del" data-type="${r.type}" data-name="${encodeURIComponent(r.name)}">삭제</button>
                        </td>
                      </tr>`
                  )
                  .join("")
              : `<tr><td colspan="3"><span class="muted">없음</span></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>담당자 등록</h3>
        <form id="manager-form">
          <div><label>담당자명</label><input name="name" required /></div>
          <div><button class="primary" type="submit">등록</button></div>
        </form>
        <table class="mini-table">
          <thead><tr><th>담당자</th><th>삭제</th></tr></thead>
          <tbody>
            ${managerRows.length
              ? managerRows
                  .map(
                    (r) =>
                      `<tr>
                        <td>${esc(r.name)}</td>
                        <td><button type="button" class="cancel-btn del-small manager-del" data-name="${encodeURIComponent(r.name)}">삭제</button></td>
                      </tr>`
                  )
                  .join("")
              : `<tr><td colspan="2"><span class="muted">없음</span></td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>창고 등록</h3>
        <form id="warehouse-form">
          <div><label>창고명</label><input name="name" required /></div>
          <div><button class="primary" type="submit">등록</button></div>
        </form>
        <table class="mini-table" id="warehouse-table">
          <thead><tr><th>창고명</th><th>수정</th><th>삭제</th></tr></thead>
          <tbody>
            ${(state.warehouses || []).length
              ? state.warehouses
                  .map(
                    (w) =>
                      `<tr>
                        <td>${esc(w)}</td>
                        <td><button type="button" class="primary del-small warehouse-rename" data-name="${encodeURIComponent(w)}">수정</button></td>
                        <td>${
                          w === "툴스피아"
                            ? `<span class="muted">기본창고</span>`
                            : `<button type="button" class="cancel-btn del-small warehouse-del" data-name="${encodeURIComponent(w)}">삭제</button>`
                        }</td>
                      </tr>`
                  )
                  .join("")
              : `<tr><td colspan="3"><span class="muted">없음</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  preventEnterSubmit(qs("#partner-master-form"));
  preventEnterSubmit(qs("#manager-form"));
  preventEnterSubmit(qs("#warehouse-form"));

  qs("#partner-master-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await api("/api/partners", { method: "POST", body: JSON.stringify(data) });
    await refreshCommon();
    renderMaster();
    renderProducts();
    renderInbound();
    renderOutbound();
    alert("거래처 등록 완료");
  };
  qs("#manager-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await api("/api/managers", { method: "POST", body: JSON.stringify(data) });
    await refreshCommon();
    renderMaster();
    renderInbound();
    renderOutbound();
    renderAdjust();
    alert("담당자 등록 완료");
  };
  qs("#warehouse-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    await api("/api/warehouses", { method: "POST", body: JSON.stringify(data) });
    await refreshCommon();
    renderMaster();
    renderStock();
    renderInbound();
    renderOutbound();
    renderAdjust();
    alert("창고 등록 완료");
  };
  // 안전/적정재고는 기본상품정보 화면에서 수정합니다.

  document.querySelectorAll(".partner-del").forEach((btn) => {
    btn.onclick = async () => {
      const type = btn.dataset.type;
      const name = decodeURIComponent(btn.dataset.name || "");
      if (!type || !name) return;
      if (!confirm(`거래처를 삭제할까요? (${name})`)) return;
      try {
        await api("/api/partners", { method: "DELETE", body: JSON.stringify({ type, name }) });
        await refreshCommon();
        renderMaster();
        renderProducts();
        renderInbound();
        renderOutbound();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  document.querySelectorAll(".manager-del").forEach((btn) => {
    btn.onclick = async () => {
      const name = decodeURIComponent(btn.dataset.name || "");
      if (!name) return;
      if (!confirm(`담당자를 삭제할까요? (${name})`)) return;
      try {
        await api("/api/managers", { method: "DELETE", body: JSON.stringify({ name }) });
        await refreshCommon();
        renderMaster();
        renderInbound();
        renderOutbound();
        renderAdjust();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  const miniTables = document.querySelectorAll(".mini-table");
  if (miniTables[0]) miniTables[0].id = "partner-table";
  if (miniTables[1]) miniTables[1].id = "manager-table";
  if (miniTables[2]) miniTables[2].id = "warehouse-table";
  applyExcelLikeFilter("#partner-table");
  applyExcelLikeFilter("#manager-table");
  applyExcelLikeFilter("#warehouse-table");

  document.querySelectorAll(".warehouse-del").forEach((btn) => {
    btn.onclick = async () => {
      const name = decodeURIComponent(btn.dataset.name || "");
      if (!name) return;
      const first = confirm(`창고를 삭제하시겠습니까? (${name})`);
      if (!first) return;
      const approver = prompt("담당자명을 입력하세요. (삭제 권한: 박유정)");
      if (!approver) return;
      const approverName = String(approver).trim();
      if (!approverName) return;
      const second = confirm(`정말 삭제할까요? 이 작업은 되돌릴 수 없습니다. (${name})`);
      if (!second) return;
      try {
        await api("/api/warehouses", {
          method: "DELETE",
          body: JSON.stringify({ name, approver: approverName })
        });
        await refreshCommon();
        renderMaster();
        renderStock();
        renderInbound();
        renderOutbound();
        renderAdjust();
      } catch (err) {
        alert(err.message);
      }
    };
  });

  document.querySelectorAll(".warehouse-rename").forEach((btn) => {
    btn.onclick = async () => {
      const oldName = decodeURIComponent(btn.dataset.name || "");
      if (!oldName) return;
      const newName = prompt(`변경할 창고명을 입력하세요.`, oldName);
      if (!newName) return;
      const cleaned = newName.trim();
      if (!cleaned || cleaned === oldName) return;
      try {
        await api("/api/warehouses", {
          method: "PUT",
          body: JSON.stringify({ oldName, newName: cleaned })
        });
        await refreshCommon();
        renderMaster();
        renderStock();
        renderInbound();
        renderOutbound();
        renderAdjust();
      } catch (err) {
        alert(err.message);
      }
    };
  });
}

function renderProducts() {
  productListPageIndex = 0;
  const opts = state.productOptions || {};
  const datalist = (id, arr) => `<datalist id="${id}">${(arr || []).map((v) => `<option value="${esc(v)}"></option>`).join("")}</datalist>`;
  const selectItems = (arr) => (arr || []).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const selectOptions = (arr, current) =>
    (arr || [])
      .map((v) => `<option value="${esc(v)}" ${String(current || "") === String(v || "") ? "selected" : ""}>${esc(v)}</option>`)
      .join("");
  const optionMeta = [
    { key: "status", label: "상태" },
    { key: "deliveryVendors", label: "판매처" },
    { key: "orderDept", label: "발주부서" },
    { key: "orderManagers", label: "발주담당자" },
    { key: "supplyType", label: "수급형태" },
    { key: "warehouseGroup", label: "창고그룹(이카운트)" },
    { key: "itemType", label: "구분" },
    { key: "categories", label: "카테고리" }
  ];
  const rows = state.products
    .map((p) => {
      const searchText = `${p.ecountCode || p.code || ""} ${p.code || ""} ${p.ecountName || p.name || ""}`.toLowerCase();
      return `<tr data-search="${esc(searchText)}">
      <td><input type="checkbox" class="product-row-check" data-code="${esc(p.code)}" /></td>
      <td>${esc(p.ecountCode || p.code)}</td>
      <td>${esc(p.barcode)}</td>
      <td>${esc(p.middleBarcode || "")}</td>
      <td>${esc(p.logisticsBarcode)}</td>
      <td>${esc(p.ecountName || p.name)}</td>
      <td>${esc(p.status || "")}</td>
      <td>${renderTagChips(p.deliveryVendors)}</td>
      <td>${esc(p.deliveryVendorCode || "")}</td>
      <td>${esc(p.deliveryItemName || "")}</td>
      <td>${esc(p.spec || "")}</td>
      <td>${esc(p.purchaseVendor || "")}</td>
      <td>${esc(p.supplyType || "")}</td>
      <td>${esc(p.orderDept || "")}</td>
      <td>${renderTagChips(p.orderManagers)}</td>
      <td>${esc(p.purchaseItemCode || "")}</td>
      <td>${esc(p.purchaseItemName || "")}</td>
      <td>${esc(p.warehouseGroup || "")}</td>
      <td>${renderTagChips(p.usedWarehouses)}</td>
      <td>${esc(p.itemType || "")}</td>
      <td>${renderTagChips(p.categories)}</td>
    </tr>`;
    })
    .join("");

  qs("#view-products").innerHTML = `
    <div id="products-list-view" class="products-bh">
      <div class="card products-bh-card">
        <div class="products-bh-toolbar">
          <h2 class="products-bh-title">기본상품정보</h2>
          <div class="products-bh-actions">
            <button id="open-product-popup" class="bh-btn bh-btn-primary products-bh-main-btn" type="button">+ 상품 추가</button>
            <div class="bh-dropdown">
              <button type="button" class="bh-btn bh-btn-outline bh-excel-btn products-bh-main-btn" id="excel-import-toggle" aria-expanded="false">
                <span class="bh-mini-xls">XLS</span>
                엑셀 가져오기
                <span class="bh-caret">▾</span>
              </button>
              <div class="bh-dropdown-menu hidden" id="excel-import-menu">
                <button type="button" class="bh-menu-item" id="menu-product-guide">가이드 다운로드</button>
                <button type="button" class="bh-menu-item" id="menu-bulk-new">신규 상품 일괄 등록</button>
                <button type="button" class="bh-menu-item" id="menu-bulk-update">특정상품 정보 업데이트</button>
              </div>
            </div>
            <button type="button" class="bh-btn bh-btn-outline products-bh-main-btn" id="product-column-settings">컬럼 설정</button>
            <button type="button" class="bh-btn bh-btn-outline products-bh-main-btn" id="product-export-all">엑셀 내보내기</button>
          </div>
        </div>
        <div class="products-bh-search-row">
          <div class="products-bh-search-wrap">
            <span class="bh-search-icon" aria-hidden="true">🔍</span>
            <input type="text" id="product-search-q" class="products-bh-search" placeholder="이카운트 / 상품코드 / 품목명 검색" autocomplete="off" />
            <button type="button" class="bh-search-go" id="product-search-btn">조회</button>
          </div>
          <span class="products-bh-search-actions">
            <button type="button" id="product-edit-selected" class="bh-btn bh-btn-sm">선택 수정</button>
            <button type="button" id="product-delete-selected" class="bh-btn bh-btn-sm bh-btn-danger-outline">선택 삭제</button>
          </span>
        </div>
        <p id="product-search-result" class="muted products-bh-result">상품을 검색하세요.</p>
        <input type="file" id="product-file" accept=".xlsx,.xls,.csv" class="hidden-file" />
        <input type="file" id="product-update-file" accept=".xlsx,.xls,.csv" class="hidden-file" />
        <div class="products-bh-table-outer">
          <div class="table-scroll-x products-bh-y-scroll">
            <table id="products-table">
              <thead><tr><th><input id="product-check-all" type="checkbox" /></th><th>품목코드(이카운트)</th><th>바코드(SKU)</th><th>바코드(중포)</th><th>바코드(카톤)</th><th>품목명(이카운트)</th><th>상태</th><th>판매처</th><th>판매처관리코드</th><th>판매처 품목명</th><th>규격</th><th>구매처</th><th>수급형태</th><th>발주부서</th><th>발주담당자</th><th>구매처 품목코드</th><th>구매처 품목명</th><th>창고그룹(이카운트)</th><th>사용창고</th><th>구분</th><th>카테고리</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div class="products-bh-pagination">
          <label>보기
            <select id="product-page-size">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="200">200</option>
              <option value="99999">전체</option>
            </select>
          </label>
          <span id="product-page-info">0 - 0 / 0</span>
          <button type="button" id="product-page-prev" class="bh-btn bh-btn-sm" title="이전">‹</button>
          <button type="button" id="product-page-next" class="bh-btn bh-btn-sm" title="다음">›</button>
        </div>
      </div>
    </div>

    <div id="product-modal-overlay" class="modal-overlay hidden">
      <div class="modal modal-product-full">
        <div class="modal-header product-modal-header-row">
          <h3 id="product-modal-title">개별상품등록</h3>
          <div class="product-modal-header-actions">
            <button type="button" id="product-form-reset" class="bh-btn bh-btn-sm bh-btn-outline">초기화</button>
            <button id="product-modal-close" class="bh-btn bh-btn-sm bh-btn-outline" type="button">닫기</button>
          </div>
        </div>
        <form id="product-popup-form" class="modal-form">
          <div><label>품목코드(이카운트)</label><input name="ecountCode" required /></div>
          <div><label>바코드(SKU)</label><input name="barcode" /></div>
          <div><label>바코드(중포)</label><input name="middleBarcode" /></div>
          <div><label>바코드(카톤)</label><input name="logisticsBarcode" /></div>
          <div><label>품목명(이카운트)</label><input name="ecountName" required /></div>
          <div><label>상태</label><select name="status">${selectOptions(opts.status, "판매중")}</select></div>
          <div class="multi-select-field">
            <label>판매처</label>
            <div class="row product-search-row multi-select-row">
              <select id="select-deliveryVendors"><option value="">옵션 선택</option>${selectItems(opts.deliveryVendors)}</select>
              <button type="button" id="add-deliveryVendors">추가</button>
            </div>
            <input type="hidden" name="deliveryVendors" />
          </div>
          <div id="preview-deliveryVendors" class="tagline multi-tags"></div>
          <div><label>판매처관리코드</label><input name="deliveryVendorCode" /></div>
          <div><label>판매처 품목명</label><input name="deliveryItemName" /></div>
          <div><label>규격</label><input name="spec" /></div>
          <div><label>구매처</label><input name="purchaseVendor" /></div>
          <div><label>수급형태</label><select name="supplyType"><option value=""></option>${selectOptions(opts.supplyType, "")}</select></div>
          <div><label>발주부서</label><select name="orderDept"><option value=""></option>${selectOptions(opts.orderDept, "")}</select></div>
          <div class="multi-select-field">
            <label>발주담당자</label>
            <div class="row product-search-row multi-select-row">
              <select id="select-orderManagers"><option value="">옵션 선택</option>${selectItems(opts.orderManagers)}</select>
              <button type="button" id="add-orderManagers">추가</button>
            </div>
            <input type="hidden" name="orderManagers" />
          </div>
          <div id="preview-orderManagers" class="tagline multi-tags"></div>
          <div><label>구매처 품목코드</label><input name="purchaseItemCode" /></div>
          <div><label>구매처 품목명</label><input name="purchaseItemName" /></div>
          <div><label>창고그룹(이카운트)</label><select name="warehouseGroup"><option value=""></option>${selectOptions(opts.warehouseGroup, "")}</select></div>
          <div class="multi-select-field">
            <label>사용창고</label>
            <div class="row product-search-row multi-select-row">
              <select id="select-usedWarehouses"><option value="">옵션 선택</option>${selectItems(state.warehouses || [])}</select>
              <button type="button" id="add-usedWarehouses">추가</button>
            </div>
            <input type="hidden" name="usedWarehouses" />
          </div>
          <div id="preview-usedWarehouses" class="tagline multi-tags"></div>
          <div><label>구분</label><select name="itemType"><option value=""></option>${selectOptions(opts.itemType, "")}</select></div>
          <div class="multi-select-field">
            <label>카테고리</label>
            <div class="row product-search-row multi-select-row">
              <select id="select-categories"><option value="">옵션 선택</option>${selectItems(opts.categories)}</select>
              <button type="button" id="add-categories">추가</button>
            </div>
            <input type="hidden" name="categories" />
          </div>
          <div id="preview-categories" class="tagline multi-tags"></div>
          <div><label>안전재고(선택)</label><input name="safetyStock" type="number" value="0" /></div>
          <div><label>적정재고(선택)</label><input name="optimalStock" type="number" value="0" /></div>
          <div><button class="primary" type="submit">입력 완료</button></div>
        </form>
      </div>
    </div>

    <div id="option-modal-overlay" class="modal-overlay hidden">
      <div class="modal">
        <div class="modal-header">
          <h3>옵션등록</h3>
          <button id="option-modal-close" class="cancel-btn del-small" type="button">닫기</button>
        </div>
        <form id="option-modal-form" class="modal-form">
          ${optionMeta
            .map(
              (m) => `
            <div><label>${m.label}</label><input name="${m.key}" value="${esc((opts[m.key] || []).join(", "))}" placeholder="${m.label} 옵션을 쉼표로 입력" /></div>
            <div class="tagline">${renderTagChips(opts[m.key], "tag tag-orange")}</div>
          `
            )
            .join("")}
          <div><button class="primary" type="submit">옵션 저장</button></div>
        </form>
      </div>
    </div>

    <div id="product-columns-overlay" class="modal-overlay hidden">
      <div class="modal" style="width: min(420px, calc(100vw - 24px));">
        <div class="modal-header">
          <h3>컬럼 설정</h3>
          <button type="button" id="product-columns-close" class="cancel-btn del-small">닫기</button>
        </div>
        <p class="muted" style="margin: 0 0 8px; font-size: 12px;">체크 해제 시 해당 열을 숨깁니다. (체크박스는 항상 표시)</p>
        <div id="product-columns-body" class="column-settings-list"></div>
        <button type="button" class="primary" id="product-columns-save" style="width: auto;">적용</button>
      </div>
    </div>

    ${datalist("opt-status", opts.status)}
    ${datalist("opt-deliveryVendors", opts.deliveryVendors)}
    ${datalist("opt-orderDept", opts.orderDept)}
    ${datalist("opt-orderManagers", opts.orderManagers)}
    ${datalist("opt-supplyType", opts.supplyType)}
    ${datalist("opt-warehouseGroup", opts.warehouseGroup)}
    ${datalist("opt-itemType", opts.itemType)}
    ${datalist("opt-categories", opts.categories)}

    <div id="stock-edit-modal-overlay" class="modal-overlay hidden">
      <div class="modal">
        <div class="modal-header">
          <h3>안전 / 적정재고 변경</h3>
          <button id="stock-edit-modal-close" class="cancel-btn" type="button">닫기</button>
        </div>
        <form id="stock-edit-form" class="modal-form">
          <div style="grid-column: span 2;"><label>상품코드</label><input id="stock-edit-code" name="code" required readonly /></div>
          <div style="grid-column: span 2;"><label>상품명</label><input id="stock-edit-name" name="name" required readonly /></div>
          <div style="grid-column: span 2;"><label>안전재고</label><input id="stock-edit-safety" name="safetyStock" type="number" required /></div>
          <div style="grid-column: span 2;"><label>적정재고</label><input id="stock-edit-optimal" name="optimalStock" type="number" required /></div>
          <div style="grid-column: span 6; margin-top:6px;"><button class="primary" type="submit">저장</button></div>
        </form>
      </div>
    </div>
  `;

  const modalOverlay = qs("#product-modal-overlay");
  const openBtn = qs("#open-product-popup");
  const closeBtn = qs("#product-modal-close");
  const productModalTitle = qs("#product-modal-title");
  const optionOverlay = qs("#option-modal-overlay");
  const optionOpenBtn = qs("#open-option-popup");
  const optionCloseBtn = qs("#option-modal-close");
  let editingCode = "";
  if (openBtn && modalOverlay) {
    openBtn.onclick = () => {
      editingCode = "";
      qs("#product-popup-form")?.reset();
      if (productModalTitle) productModalTitle.textContent = "개별상품등록";
      multiControllers.deliveryVendors?.setValues([]);
      multiControllers.orderManagers?.setValues([]);
      multiControllers.categories?.setValues([]);
      multiControllers.usedWarehouses?.setValues([]);
      modalOverlay.classList.remove("hidden");
    };
  }
  if (closeBtn && modalOverlay) closeBtn.onclick = () => modalOverlay.classList.add("hidden");
  if (modalOverlay) {
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.add("hidden");
    };
  }
  if (optionOpenBtn && optionOverlay) optionOpenBtn.onclick = () => optionOverlay.classList.remove("hidden");
  if (optionCloseBtn && optionOverlay) optionCloseBtn.onclick = () => optionOverlay.classList.add("hidden");
  if (optionOverlay) {
    optionOverlay.onclick = (e) => {
      if (e.target === optionOverlay) optionOverlay.classList.add("hidden");
    };
  }

  // 안전/적정재고 변경 모달
  const stockOverlay = qs("#stock-edit-modal-overlay");
  const stockCloseBtn = qs("#stock-edit-modal-close");
  const stockForm = qs("#stock-edit-form");
  const stockEditCode = qs("#stock-edit-code");
  const stockEditName = qs("#stock-edit-name");
  const stockEditSafety = qs("#stock-edit-safety");
  const stockEditOptimal = qs("#stock-edit-optimal");

  function openStockModal(p) {
    if (!stockOverlay) return;
    if (!p) return;
    stockEditCode.value = p.code;
    stockEditName.value = p.name;
    stockEditSafety.value = p.safetyStock ?? 0;
    stockEditOptimal.value = p.optimalStock ?? 0;
    stockOverlay.classList.remove("hidden");
  }
  function closeStockModal() {
    if (!stockOverlay) return;
    stockOverlay.classList.add("hidden");
  }

  if (stockCloseBtn && stockOverlay) stockCloseBtn.onclick = closeStockModal;
  if (stockOverlay) {
    stockOverlay.onclick = (e) => {
      if (e.target === stockOverlay) closeStockModal();
    };
  }

  if (stockForm) preventEnterSubmit(stockForm);
  if (stockForm) {
    stockForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const code = stockEditCode.value;
        const name = stockEditName.value;
        const safetyStock = Number(stockEditSafety.value);
        const optimalStock = Number(stockEditOptimal.value);
        const current = state.products.find((p) => p.code === code);
        if (!current) throw new Error("상품을 찾을 수 없습니다.");
        await api("/api/products", {
          method: "POST",
          body: JSON.stringify({ ...current, safetyStock, optimalStock, name })
        });
        await refreshCommon();
        renderProducts();
        renderStock();
        renderMaster();
        await renderDashboard();
        closeStockModal();
        alert("안전/적정재고 저장 완료");
      } catch (err) {
        alert(err.message);
      }
    };
  }

  // 상품 조회 + 페이지네이션
  const searchInput = qs("#product-search-q");
  const searchBtn = qs("#product-search-btn");
  const resultEl = qs("#product-search-result");
  const pageSizeEl = qs("#product-page-size");
  const pageInfoEl = qs("#product-page-info");
  const pagePrev = qs("#product-page-prev");
  const pageNext = qs("#product-page-next");

  const applyProductListFilters = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const allRows = Array.from(document.querySelectorAll("#products-table tbody tr"));
    const matched = allRows.filter(
      (tr) =>
        tr.dataset.wmsExcelVisible !== "0" && (!q || String(tr.dataset.search || "").includes(q))
    );
    const size = Math.min(99999, Math.max(1, parseInt(pageSizeEl?.value || "100", 10) || 100));
    const total = matched.length;
    const pages = Math.max(1, Math.ceil(total / size));
    if (productListPageIndex >= pages) productListPageIndex = pages - 1;
    if (productListPageIndex < 0) productListPageIndex = 0;
    const page = productListPageIndex;
    const start = page * size;
    let mi = 0;
    allRows.forEach((tr) => {
      if (tr.dataset.wmsExcelVisible === "0") {
        tr.style.display = "none";
        return;
      }
      const isMatch = !q || String(tr.dataset.search || "").includes(q);
      if (!isMatch) {
        tr.style.display = "none";
        return;
      }
      const vis = mi >= start && mi < start + size;
      tr.style.display = vis ? "" : "none";
      mi += 1;
    });
    if (pageInfoEl) {
      if (total === 0) pageInfoEl.textContent = "0 - 0 / 0";
      else pageInfoEl.textContent = `${start + 1} - ${Math.min(total, start + size)} / ${total}`;
    }
    if (resultEl) resultEl.textContent = q ? `\uac80\uc0c9 \uacb0\uacfc: ${total}\uac74` : `\uc804\uccb4 ${allRows.length}\uac74`;
  };

  if (searchBtn && searchInput && resultEl) {
    preventEnterSubmit(qs(".products-bh-search-wrap"));
    searchBtn.onclick = () => {
      productListPageIndex = 0;
      applyProductListFilters();
    };
    searchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        productListPageIndex = 0;
        applyProductListFilters();
      }
    };
    pageSizeEl?.addEventListener("change", () => {
      productListPageIndex = 0;
      applyProductListFilters();
    });
    pagePrev?.addEventListener("click", () => {
      productListPageIndex = Math.max(0, productListPageIndex - 1);
      applyProductListFilters();
    });
    pageNext?.addEventListener("click", () => {
      const q2 = (searchInput?.value || "").trim().toLowerCase();
      const allRows2 = Array.from(document.querySelectorAll("#products-table tbody tr"));
      const total2 = allRows2.filter(
        (tr) =>
          tr.dataset.wmsExcelVisible !== "0" && (!q2 || String(tr.dataset.search || "").includes(q2))
      ).length;
      const size2 = Math.min(99999, Math.max(1, parseInt(pageSizeEl?.value || "100", 10) || 100));
      const pages2 = Math.max(1, Math.ceil(total2 / size2));
      productListPageIndex = Math.min(pages2 - 1, productListPageIndex + 1);
      applyProductListFilters();
    });
    applyProductListFilters();
  }

  if (!window.__wmsProductUiInit) {
    window.__wmsProductUiInit = true;
    document.addEventListener("click", () => {
      qs("#excel-import-menu")?.classList.add("hidden");
      qs("#more-menu")?.classList.add("hidden");
    });
  }
  qs("#excel-import-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = qs("#excel-import-menu");
    const wasHidden = m?.classList.contains("hidden");
    qs("#excel-import-menu")?.classList.add("hidden");
    qs("#more-menu")?.classList.add("hidden");
    if (wasHidden) m?.classList.remove("hidden");
  });
  qs("#more-menu-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const m = qs("#more-menu");
    const wasHidden = m?.classList.contains("hidden");
    qs("#excel-import-menu")?.classList.add("hidden");
    qs("#more-menu")?.classList.add("hidden");
    if (wasHidden) m?.classList.remove("hidden");
  });
  qs("#excel-import-menu")?.addEventListener("click", (e) => e.stopPropagation());
  qs("#more-menu")?.addEventListener("click", (e) => e.stopPropagation());
  qs("#menu-product-guide")?.addEventListener("click", () => {
    downloadGuide("product");
    qs("#excel-import-menu")?.classList.add("hidden");
  });
  qs("#menu-bulk-new")?.addEventListener("click", () => {
    qs("#product-file")?.click();
    qs("#excel-import-menu")?.classList.add("hidden");
  });
  qs("#menu-bulk-update")?.addEventListener("click", () => {
    qs("#product-update-file")?.click();
    qs("#excel-import-menu")?.classList.add("hidden");
  });

  const colOverlay = qs("#product-columns-overlay");
  qs("#product-column-settings")?.addEventListener("click", () => {
    const body = qs("#product-columns-body");
    if (!body || !colOverlay) return;
    const heads = Array.from(document.querySelectorAll("#products-table thead th"));
    let hidden = [];
    try {
      hidden = JSON.parse(localStorage.getItem(PRODUCT_HIDDEN_COLS_KEY) || "[]");
    } catch (_) {
      hidden = [];
    }
    body.innerHTML = heads
      .map((th, i) => {
        const nth = i + 1;
        if (nth === 1) return "";
        const lab = th.textContent.trim() || `\uc5f4 ${nth}`;
        const checked = !hidden.includes(nth);
        return `<label><input type="checkbox" data-nth="${nth}" ${checked ? "checked" : ""} /> ${esc(lab)}</label>`;
      })
      .join("");
    colOverlay.classList.remove("hidden");
  });
  qs("#product-columns-close")?.addEventListener("click", () => colOverlay?.classList.add("hidden"));
  if (colOverlay) {
    colOverlay.addEventListener("click", (e) => {
      if (e.target === colOverlay) colOverlay.classList.add("hidden");
    });
  }
  qs("#product-columns-save")?.addEventListener("click", () => {
    const body = qs("#product-columns-body");
    const hidden = [];
    body?.querySelectorAll('input[type="checkbox"]').forEach((inp) => {
      const nth = parseInt(inp.dataset.nth || "0", 10);
      if (!nth || nth === 1) return;
      if (!inp.checked) hidden.push(nth);
    });
    try {
      localStorage.setItem(PRODUCT_HIDDEN_COLS_KEY, JSON.stringify(hidden));
    } catch (_) {
      /* ignore */
    }
    applyProductHiddenColumnStyles();
    colOverlay?.classList.add("hidden");
  });

  preventEnterSubmit(qs("#product-popup-form"));
  const productForm = qs("#product-popup-form");
  const multiControllers = {};
  const setupMultiSelect = (field, selectId, addId, previewId) => {
    const hidden = productForm?.querySelector(`[name="${field}"]`);
    const selectEl = qs(`#${selectId}`);
    const addBtn = qs(`#${addId}`);
    const previewEl = qs(`#${previewId}`);
    if (!hidden || !selectEl || !addBtn || !previewEl) return { setValues: () => {} };
    let selected = [];
    const draw = () => {
      hidden.value = selected.join(", ");
      previewEl.innerHTML = selected.length
        ? selected
            .map(
              (v) =>
                `<span class="tag tag-orange tag-removable">${esc(v)} <button type="button" class="chip-remove" data-value="${encodeURIComponent(v)}">x</button></span>`
            )
            .join("")
        : "<span class='muted'>선택한 항목 없음</span>";
    };
    const addValue = (v) => {
      const value = String(v || "").trim();
      if (!value) return;
      if (!selected.includes(value)) selected.push(value);
      draw();
    };
    addBtn.onclick = () => {
      addValue(selectEl.value);
      selectEl.value = "";
    };
    previewEl.onclick = (e) => {
      const btn = e.target.closest(".chip-remove");
      if (!btn) return;
      const value = decodeURIComponent(btn.dataset.value || "");
      selected = selected.filter((x) => x !== value);
      draw();
    };
    draw();
    return {
      setValues(values) {
        selected = toTagList(values);
        draw();
      }
    };
  };
  multiControllers.deliveryVendors = setupMultiSelect("deliveryVendors", "select-deliveryVendors", "add-deliveryVendors", "preview-deliveryVendors");
  multiControllers.orderManagers = setupMultiSelect("orderManagers", "select-orderManagers", "add-orderManagers", "preview-orderManagers");
  multiControllers.categories = setupMultiSelect("categories", "select-categories", "add-categories", "preview-categories");
  multiControllers.usedWarehouses = setupMultiSelect("usedWarehouses", "select-usedWarehouses", "add-usedWarehouses", "preview-usedWarehouses");

  qs("#product-form-reset")?.addEventListener("click", () => {
    editingCode = "";
    qs("#product-popup-form")?.reset();
    if (productModalTitle) productModalTitle.textContent = "개별상품등록";
    multiControllers.deliveryVendors?.setValues([]);
    multiControllers.orderManagers?.setValues([]);
    multiControllers.categories?.setValues([]);
    multiControllers.usedWarehouses?.setValues([]);
  });

  const optionForm = qs("#option-modal-form");
  if (optionForm) {
    optionForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const fd = new FormData(optionForm);
        for (const m of optionMeta) {
          const values = toTagList(fd.get(m.key));
          await api("/api/product-options", { method: "POST", body: JSON.stringify({ field: m.key, values, replace: true }) });
        }
        await refreshCommon();
        renderProducts();
        if (optionOverlay) optionOverlay.classList.add("hidden");
        alert("옵션 저장 완료");
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const getSelectedCodes = () =>
    Array.from(document.querySelectorAll(".product-row-check:checked")).map((el) => String(el.dataset.code || ""));
  const checkAllEl = qs("#product-check-all");
  if (checkAllEl) {
    checkAllEl.onchange = () => {
      document.querySelectorAll(".product-row-check").forEach((el) => {
        el.checked = checkAllEl.checked;
      });
    };
  }

  const editSelectedBtn = qs("#product-edit-selected");
  if (editSelectedBtn) {
    editSelectedBtn.onclick = () => {
      const codes = getSelectedCodes();
      if (codes.length !== 1) return alert("수정은 1개만 선택하세요.");
      const p = state.products.find((x) => String(x.code) === String(codes[0]));
      if (!p || !productForm || !modalOverlay) return;
      editingCode = String(p.code || "");
      if (productModalTitle) productModalTitle.textContent = "상품등록정보 수정";
      const setVal = (name, val) => {
        const el = productForm.querySelector(`[name="${name}"]`);
        if (el) el.value = val ?? "";
      };
      setVal("ecountCode", p.ecountCode || p.code);
      setVal("barcode", p.barcode);
      setVal("middleBarcode", p.middleBarcode);
      setVal("logisticsBarcode", p.logisticsBarcode);
      setVal("ecountName", p.ecountName || p.name);
      setVal("status", p.status);
      multiControllers.deliveryVendors?.setValues(p.deliveryVendors);
      setVal("deliveryVendorCode", p.deliveryVendorCode);
      setVal("deliveryItemName", p.deliveryItemName);
      setVal("spec", p.spec);
      setVal("purchaseVendor", p.purchaseVendor);
      setVal("supplyType", p.supplyType);
      setVal("orderDept", p.orderDept);
      multiControllers.orderManagers?.setValues(p.orderManagers);
      setVal("purchaseItemCode", p.purchaseItemCode);
      setVal("purchaseItemName", p.purchaseItemName);
      setVal("warehouseGroup", p.warehouseGroup);
      multiControllers.usedWarehouses?.setValues(p.usedWarehouses);
      setVal("itemType", p.itemType);
      multiControllers.categories?.setValues(p.categories);
      setVal("safetyStock", p.safetyStock ?? 0);
      setVal("optimalStock", p.optimalStock ?? 0);
      modalOverlay.classList.remove("hidden");
    };
  }

  const deleteSelectedBtn = qs("#product-delete-selected");
  if (deleteSelectedBtn) {
    deleteSelectedBtn.onclick = async () => {
      const codes = getSelectedCodes();
      if (!codes.length) return alert("삭제할 상품을 선택하세요.");
      if (!confirm(`선택한 ${codes.length}개 상품을 삭제할까요?`)) return;
      try {
        await api("/api/products", { method: "DELETE", body: JSON.stringify({ codes }) });
        await refreshCommon();
        renderProducts();
        renderStock();
        renderMaster();
        await renderDashboard();
        alert("선택 상품 삭제 완료");
      } catch (err) {
        alert(err.message);
      }
    };
  }

  qs("#product-popup-form").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.ecountCode = String(data.ecountCode || "").trim();
    data.ecountName = String(data.ecountName || "").trim();
    data.status = toTagList(data.status)[0] || "판매중";
    data.supplyType = toTagList(data.supplyType)[0] || "";
    data.orderDept = toTagList(data.orderDept)[0] || "";
    data.warehouseGroup = toTagList(data.warehouseGroup)[0] || "";
    data.itemType = toTagList(data.itemType)[0] || "";
    data.code = editingCode || data.ecountCode;
    data.name = data.ecountName;
    data.deliveryVendors = toTagList(data.deliveryVendors);
    data.orderManagers = toTagList(data.orderManagers);
    data.categories = toTagList(data.categories);
    data.usedWarehouses = toTagList(data.usedWarehouses);
    await api("/api/products", { method: "POST", body: JSON.stringify(data) });
    await refreshCommon();
    editingCode = "";
    if (modalOverlay) modalOverlay.classList.add("hidden");
    renderProducts();
    renderStock();
    renderMaster();
    await renderDashboard();
    alert("저장되었습니다.");
  };

  const productFileInput = qs("#product-file");
  const productUpdateInput = qs("#product-update-file");

  const afterBulkProductImport = async (label) => {
    renderProducts();
    renderStock();
    renderMaster();
    await renderDashboard();
    alert(label);
  };

  productFileInput?.addEventListener("change", async () => {
    const file = productFileInput.files[0];
    if (!file) return;
    try {
      const n = await uploadProductBulkFromFile(file);
      productFileInput.value = "";
      await afterBulkProductImport(`엑셀 업로드 완료 (${n}건)`);
    } catch (e2) {
      alert(e2.message);
      productFileInput.value = "";
    }
  });

  productUpdateInput?.addEventListener("change", async () => {
    const file = productUpdateInput.files[0];
    if (!file) return;
    try {
      const n = await uploadProductUpdateFromFile(file);
      productUpdateInput.value = "";
      await afterBulkProductImport(`상품정보 업데이엄트 완료 (${n}건)`);
    } catch (err) {
      alert(err.message);
      productUpdateInput.value = "";
    }
  });

  qs("#product-export-all").onclick = async () => {
    try {
      const latest = await api("/api/products");
      const items = Array.isArray(latest.items) ? latest.items : [];
      if (!items.length) {
        alert("다운로드할 상품정보가 없습니다.");
        return;
      }
      const rowsForExport = items.map((p) => ({
        "품목코드(이카운트)": p.ecountCode || p.code || "",
        "바코드(SKU)": p.barcode || "",
        "바코드(중포)": p.middleBarcode || "",
        "바코드(카톤)": p.logisticsBarcode || "",
        "품목명(이카운트)": p.ecountName || p.name || "",
        "상태": p.status || "",
        "판매처": toTagList(p.deliveryVendors).join(", "),
        "판매처관리코드": p.deliveryVendorCode || "",
        "판매처 품목명": p.deliveryItemName || "",
        "규격": p.spec || "",
        "구매처": p.purchaseVendor || "",
        "수급형태": p.supplyType || "",
        "발주부서": p.orderDept || "",
        "발주담당자": toTagList(p.orderManagers).join(", "),
        "구매처 품목코드": p.purchaseItemCode || "",
        "구매처 품목명": p.purchaseItemName || "",
        "창고그룹(이카운트)": p.warehouseGroup || "",
        "사용창고": toTagList(p.usedWarehouses).join(", "),
        "구분": p.itemType || "",
        "카테고리": toTagList(p.categories).join(", ")
      }));
      const ws = XLSX.utils.json_to_sheet(rowsForExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "products");
      XLSX.writeFile(wb, `products-all-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (err) {
      alert(err.message || "전체 다운로드 실패");
    }
  };
  applyProductHiddenColumnStyles();
  applyExcelLikeFilter("#products-table", applyProductListFilters);
}

function renderStock() {
  const draw = () => {
    const q = (qs("#stock-q")?.value || "").trim().toLowerCase();
    const status = (qs("#stock-status")?.value || "ALL").trim();
    const warehouse = (qs("#stock-warehouse")?.value || "ALL").trim();
    const warehouseOptions = [`<option value="ALL">창고 전체</option>`, ...(state.warehouses || []).map((w) => `<option value="${esc(w)}">${esc(w)}</option>`)].join("");

    const filtered = state.stock.filter((s) => {
      if (warehouse !== "ALL" && String(s.warehouse || "") !== warehouse) return false;
      if (q) {
        const hay = `${s.code} ${s.name} ${s.ecountCode || ""} ${s.barcode || ""} ${s.warehouse || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (status === "LOW") return Number(s.stock) <= Number(s.safetyStock || 0);
      if (status === "OK") return Number(s.stock) > Number(s.safetyStock || 0);
      if (status === "OVER") return Number(s.stock) > Number(s.optimalStock || 0);
      return true;
    });

    const lowCellClass = "low-stock-cell";
    const lowStatusClass = "low-status";
    const rows = filtered
      .map((s) => {
        const safety = Number(s.safetyStock || 0);
        const low = Number(s.stock) <= safety;
        const optimal = Number(s.optimalStock || 0);
        const ratio = optimal > 0 ? `${((Number(s.stock || 0) / optimal) * 100).toFixed(1)}%` : "-";
        return `<tr data-code="${esc(s.code)}">
          <td>${esc(s.warehouse || "")}</td>
          <td>${esc(s.code)}</td>
          <td>${esc(s.name)}</td>
          <td>${esc(s.ecountCode || "")}</td>
          <td>${esc(s.barcode || "")}</td>
          <td>${esc(s.logisticsBarcode || "")}</td>
          <td>${esc(s.spec || "")}</td>
          <td>${esc(s.salesVendor || "")}</td>
          <td>${esc(s.purchaseVendor || "")}</td>
          <td>${esc(s.category || "")}</td>
          <td>${esc(s.unit || "")}</td>
          <td>${esc(s.safetyStock || 0)}</td>
          <td>${esc(s.optimalStock || 0)}</td>
          <td>${ratio}</td>
          <td>${esc(s.note || "")}</td>
          <td class="${low ? lowCellClass : ""}">${esc(s.stock)}</td>
          <td class="${low ? lowStatusClass : ""}">${low ? "<strong>재고부족</strong>" : "정상"}</td>
        </tr>`;
      })
      .join("");

    qs("#view-stock").innerHTML = `
      <div class="card"><h2>재고현황</h2></div>
      <div class="card">
        <div class="row stock-filter-row">
          <input id="stock-q" class="stock-q" placeholder="상품코드/상품명 검색" />
          <button id="stock-search-btn" class="primary" type="button">조회</button>
          <select id="stock-warehouse">${warehouseOptions}</select>
          <select id="stock-status">
            <option value="ALL">전체</option>
            <option value="LOW">안전재고이하</option>
            <option value="OK">정상</option>
            <option value="OVER">적정재고 초과</option>
          </select>
          <div class="muted" style="align-self:end;">표시: ${filtered.length}건</div>
        </div>
      </div>
      <div class="card">
        <table id="stock-table" class="draggable-table">
          <thead>
            <tr>
              <th draggable="true">창고</th>
              <th draggable="true">상품코드</th>
              <th draggable="true">상품명</th>
              <th draggable="true">품목코드</th>
              <th draggable="true">바코드</th>
              <th draggable="true">물류바코드</th>
              <th draggable="true">규격</th>
              <th draggable="true">판매처</th>
              <th draggable="true">구매처</th>
              <th draggable="true">카테고리</th>
              <th draggable="true">단위</th>
              <th draggable="true">안전재고</th>
              <th draggable="true">적정재고</th>
              <th draggable="true">적정대비%</th>
              <th draggable="true">비고</th>
              <th draggable="true">현재고</th>
              <th draggable="true">상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    applyExcelLikeFilter("#stock-table");
    enableColumnDrag("#stock-table");
  };

  // first render
  qs("#view-stock").innerHTML = `
    <div class="card"><h2>재고현황</h2></div>
    <div class="card">
      <div class="row stock-filter-row">
        <input id="stock-q" class="stock-q" placeholder="상품코드/상품명 검색" />
        <button id="stock-search-btn" class="primary" type="button">조회</button>
        <select id="stock-warehouse"><option value="ALL">창고 전체</option></select>
        <select id="stock-status">
          <option value="ALL">전체</option>
          <option value="LOW">안전재고이하</option>
          <option value="OK">정상</option>
          <option value="OVER">적정재고 초과</option>
        </select>
        <div class="muted" style="align-self:end;">표시: 0건</div>
      </div>
    </div>
    <div class="card"><div class="muted">로딩 중...</div></div>
  `;

  // bind filter events after draw creates inputs
  // eslint-disable-next-line no-use-before-define
  const initialDraw = () => draw();
  initialDraw();
  const qEl = qs("#stock-q");
  const searchBtnEl = qs("#stock-search-btn");
  const wEl = qs("#stock-warehouse");
  const stEl = qs("#stock-status");
  if (qEl) {
    qEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        draw();
      }
    };
  }
  if (searchBtnEl) searchBtnEl.onclick = () => draw();
  if (wEl) wEl.onchange = () => draw();
  if (stEl) stEl.onchange = () => draw();
}

function enableColumnDrag(tableSelector) {
  const table = document.querySelector(tableSelector);
  if (!table) return;
  const headRow = table.tHead && table.tHead.rows && table.tHead.rows[0] ? table.tHead.rows[0] : null;
  if (!headRow) return;

  const ths = Array.from(headRow.children);
  if (!ths.length) return;

  let dragIndex = null;

  ths.forEach((th, idx) => {
    th.classList.add("draggable-th");
    th.ondragstart = (e) => {
      dragIndex = idx;
      e.dataTransfer.effectAllowed = "move";
    };
    th.ondragover = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    };
    th.ondrop = (e) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === idx) return;

      // Swap all header rows (title row + excel filter row)
      const headRows = Array.from(table.tHead.rows || []);
      for (const hr of headRows) {
        const a = hr.children[dragIndex];
        const b = hr.children[idx];
        if (!a || !b) continue;
        const tmp = a.innerHTML;
        a.innerHTML = b.innerHTML;
        b.innerHTML = tmp;
      }

      // Swap body cells content
      const tbodyRows = Array.from(table.tBodies[0]?.rows || []);
      for (const r of tbodyRows) {
        const ca = r.children[dragIndex];
        const cb = r.children[idx];
        if (!ca || !cb) continue;
        const tmp2 = ca.innerHTML;
        ca.innerHTML = cb.innerHTML;
        cb.innerHTML = tmp2;
      }

      dragIndex = null;
      applyExcelLikeFilter(tableSelector);
    };
  });
}

function movementFormHtml(type, title, hint, partnerType, partnerLabel) {
  const productOptions = state.products.map((p) => `<option value="${esc(p.code)}">${esc(p.code)} - ${esc(p.name)}</option>`).join("");
  const partnerOptions = (state.partners[partnerType] || []).map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const managerOptions = state.managers.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const warehouseOptions = (state.warehouses || []).map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
  return `
    <div class="card">
      <h2>${title}</h2>
      <form id="${type}-form">
        <div><label>상품 검색(코드)</label><input name="productCode" list="${type}-product-list" required /></div>
        <datalist id="${type}-product-list">${productOptions}</datalist>
        <div><label>수량</label><input name="qty" type="number" required /></div>
        <div><label>창고</label><input name="warehouse" list="${type}-warehouse-list" required /></div>
        <datalist id="${type}-warehouse-list">${warehouseOptions}</datalist>
        <div><label>${partnerLabel}</label><input name="partner" list="${type}-partner-list" required /></div>
        <datalist id="${type}-partner-list">${partnerOptions}</datalist>
        <div><label>담당자</label><input name="user" list="${type}-manager-list" required /></div>
        <datalist id="${type}-manager-list">${managerOptions}</datalist>
        <div><label>메모</label><input name="memo" /></div>
        <div><button id="${type}-submit" class="primary" type="button">등록</button></div>
      </form>
      <p class="muted">${hint}</p>
    </div>
    <div class="card movement-upload-card">
      <h3>엑셀 업로드</h3>
      <div class="row">
        <button id="${type}-guide" type="button">가이드 다운로드</button>
        <button id="${type}-upload" class="primary" type="button">업로드</button>
      </div>
      <div id="${type}-dropzone" class="dropzone">파일을 여기로 드래그하거나 클릭해서 선택하세요</div>
      <input type="file" id="${type}-file" accept=".xlsx,.xls,.csv" class="hidden-file" />
      <p class="muted">컬럼명: 상품코드, 수량, 창고, ${partnerLabel}, 담당자, 메모</p>
    </div>
    <div class="card">
      <h3>최근 등록 내역</h3>
      <div id="recent-${type}" class="muted">최근 내역을 불러오는 중...</div>
    </div>
  `;
}

function movementPayload(type) {
  const form = qs(`#${type}-form`);
  return { ...Object.fromEntries(new FormData(form)), type };
}

function bindMovement(type) {
  const form = qs(`#${type}-form`);
  preventEnterSubmit(form);
  qs(`#${type}-submit`).onclick = async () => {
    try {
      await api("/api/movements", { method: "POST", body: JSON.stringify(movementPayload(type)) });
      await afterMovementDone();
      alert("등록되었습니다.");
    } catch (err) {
      alert(err.message);
    }
  };

  setupDropZone(`${type}-dropzone`, `${type}-file`);
  qs(`#${type}-guide`).onclick = () => downloadGuide(type);
  qs(`#${type}-upload`).onclick = async () => {
    const file = qs(`#${type}-file`).files[0];
    if (!file) return alert("파일을 선택하세요.");
    try {
      const rows = await parseSheet(file);
      const normalized = normalizeMovementRows(rows, type).map((r) => ({ ...r, type }));
      await api("/api/movements/bulk", { method: "POST", body: JSON.stringify({ rows: normalized }) });
      await afterMovementDone();
      alert("업로드 완료");
    } catch (e) {
      alert(e.message);
    }
  };
}

function renderInbound() {
  qs("#view-inbound").innerHTML = movementFormHtml("IN", "입고", "등록 버튼 클릭시에만 등록됩니다.", "inbound", "입고처");
  bindMovement("IN");
  renderRecentMovements("IN");
}

async function renderInboundPlan() {
  const wrap = qs("#view-inbound-plan");
  if (!wrap) return;
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30).toISOString().slice(0, 10);
  const to = today.toISOString().slice(0, 10);
  wrap.innerHTML = `
    <div class="card">
      <h2>입고예정목록 1</h2>
      <p class="muted">이카운트 OAPI로 발주 데이터를 읽기 전용 조회합니다.</p>
      <div class="row" style="grid-template-columns: 180px 180px 100px 1fr;">
        <input id="inbound-plan-from" type="date" value="${from}" />
        <input id="inbound-plan-to" type="date" value="${to}" />
        <button id="inbound-plan-search" class="primary" type="button">조회</button>
        <div id="inbound-plan-status" class="muted" style="align-self:center;">대기 중</div>
      </div>
    </div>
    <div class="card">
      <div id="inbound-plan-table-wrap" class="muted">조회 버튼을 눌러주세요.</div>
    </div>
    <div id="inbound-plan-detail-overlay" class="modal-overlay hidden">
      <div class="modal" style="width: min(760px, calc(100vw - 24px));">
        <div class="modal-header">
          <h3 id="inbound-plan-detail-title">전표 상세</h3>
          <button type="button" id="inbound-plan-detail-close" class="cancel-btn del-small">닫기</button>
        </div>
        <div id="inbound-plan-detail-body" style="max-height: 65vh; overflow: auto;"></div>
      </div>
    </div>
  `;

  let inboundPlanQuerySeq = 0;
  let inboundPlanItems = [];
  const detailOverlay = qs("#inbound-plan-detail-overlay");
  const detailBody = qs("#inbound-plan-detail-body");
  const detailTitle = qs("#inbound-plan-detail-title");
  const closeDetail = () => detailOverlay?.classList.add("hidden");
  qs("#inbound-plan-detail-close")?.addEventListener("click", closeDetail);
  detailOverlay?.addEventListener("click", (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  const renderDetail = async (item) => {
    if (!item || !detailBody) return;
    const slipNo = String(item.poNo || "");
    if (!slipNo) return;
    const fromDate = String(qs("#inbound-plan-from")?.value || "");
    const toDate = String(qs("#inbound-plan-to")?.value || "");
    if (detailTitle) detailTitle.textContent = `전표 상세 - ${slipNo || "-"}`;
    detailBody.innerHTML = `<p class="muted">전표 상세를 조회 중입니다...</p>`;
    detailOverlay?.classList.remove("hidden");

    let lines = [];
    let head = item;
    let detailRes = null;
    let fetchErrorHtml = "";
    const fallbackLines = inboundPlanItems.filter((x) => String(x.poNo || "") === slipNo);
    const detailTimeoutMs = 120000;
    try {
      const q = `slipNo=${encodeURIComponent(slipNo)}&from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), detailTimeoutMs);
      try {
        detailRes = await api(`/api/inbound-plans/detail?${q}`, { signal: ac.signal });
      } finally {
        clearTimeout(t);
      }
      lines = Array.isArray(detailRes.items) ? detailRes.items : [];
      head = detailRes.item || lines[0] || item;
    } catch (err) {
      // ECOUNT can rate-limit repeated requests(412). Fall back to current list rows.
      lines = fallbackLines;
      head = lines[0] || item;
      const aborted = err && (err.name === "AbortError" || /aborted/i.test(String(err.message || "")));
      const errMsg = esc(
        aborted
          ? `응답 시간 초과(${Math.round(detailTimeoutMs / 1000)}초). 서버·이카운트 부하를 줄이고 다시 시도하세요.`
          : err.message || "오류"
      );
      fetchErrorHtml = `<p class="muted" style="margin-bottom:8px;">상세 API 재조회 실패로 현재 목록 데이터로 표시합니다. (${errMsg})</p>`;
    }
    if (detailTitle) detailTitle.textContent = `전표 상세 - ${slipNo || "-"}`;

    const qtyText = (v) => {
      const n = Number(String(v ?? "").replace(/,/g, ""));
      return Number.isFinite(n) ? n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : String(v || "");
    };
    const lineRows = lines
      .map(
        (r, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${esc(r.itemCode || "")}</td>
          <td>${esc(r.barcode || "")}</td>
          <td>${esc(r.itemName || "")}</td>
          <td>${esc(r.spec || "")}</td>
          <td>${esc(qtyText(r.boxQty || ""))}</td>
          <td>${esc(qtyText(r.qty || ""))}</td>
          <td>${esc(r.remark || "")}</td>
          <td>${esc(r.note || "")}</td>
        </tr>`
      )
      .join("");

    const dbg = detailRes?.debug;
    const summaryLine =
      lines.length === 1 &&
      /외\s*\d+건/.test(String(lines[0]?.itemName || "")) &&
      !String(lines[0]?.itemCode || "").trim();
    const summaryHint = summaryLine
      ? `<p class="muted" style="margin-bottom:10px;font-size:13px;">품목명이 「…외 N건」 형태면 이카운트 발주 목록만 반영된 요약입니다. 품목별 행·코드는 구매/입고 라인 API 연동 또는 <code style="font-size:12px;">ECOUNT_INBOUND_LINE_API_PATHS</code> 설정 후 재조회가 필요합니다.</p>`
      : "";

    let debugHtml = "";
    if (dbg && typeof dbg === "object") {
      const ep = Array.isArray(dbg.endpointErrors) ? dbg.endpointErrors : [];
      const epHtml = ep.length
        ? `<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;">${ep.map((e) => `<li>${esc(String(e))}</li>`).join("")}</ul>`
        : "";
      debugHtml = `
        <details style="margin-top:14px;" class="muted">
          <summary style="cursor:pointer;font-size:13px;">이카운트 상세 조회 디버그 (usedEndpoint / endpointErrors)</summary>
          <div style="margin-top:8px;font-size:12px;line-height:1.45;">
            <div><strong>usedEndpoint</strong>: ${esc(String(dbg.usedEndpoint ?? "(없음)"))}</div>
            <div><strong>lineSource</strong>: ${esc(String(dbg.lineSource ?? ""))}</div>
            <div><strong>nestedLineCount</strong>: ${esc(String(dbg.nestedLineCount ?? ""))}</div>
            ${
              dbg.endpointErrorAttempts != null
                ? `<div><strong>endpointErrorAttempts</strong>: ${esc(String(dbg.endpointErrorAttempts))} (압축 전 시도 횟수)</div>`
                : ""
            }
            ${
              dbg.skipBuiltinLineApis != null
                ? `<div><strong>skipBuiltinLineApis</strong>: ${esc(String(dbg.skipBuiltinLineApis))} — ${
                    dbg.skipBuiltinLineApis
                      ? "내장 후보 API 자동 호출 안 함(기본). 켜려면 .env에 ECOUNT_SKIP_BUILTIN_LINE_APIS=0 후 서버 재시작."
                      : "내장 후보 API 자동 호출 중(.env ECOUNT_SKIP_BUILTIN_LINE_APIS=0). 끄려면 해당 줄을 제거 후 재시작."
                  }</div>`
                : ""
            }
            ${dbg.hint ? `<div style="margin-top:6px;"><strong>hint</strong>: ${esc(String(dbg.hint))}</div>` : ""}
            ${ep.length ? `<div style="margin-top:6px;"><strong>endpointErrors</strong>:</div>${epHtml}` : `<div style="margin-top:6px;">endpointErrors: 없음</div>`}
          </div>
        </details>
      `;
    }

    detailBody.innerHTML = `${fetchErrorHtml}${summaryHint}
      <div class="row" style="grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div><strong>전표번호</strong><div>${esc(slipNo || "-")}</div></div>
        <div><strong>일자</strong><div>${esc(formatYmd(head.poDate || ""))}</div></div>
        <div><strong>거래처</strong><div>${esc(head.vendor || "")}</div></div>
        <div><strong>담당자</strong><div>${esc(head.manager || "")}</div></div>
        <div><strong>입고창고</strong><div>${esc(head.whName || "")}</div></div>
        <div><strong>통화</strong><div>${esc(head.currency || "내자")}</div></div>
        <div><strong>납기일자</strong><div>${esc(formatYmd(head.dueDate || ""))}</div></div>
        <div><strong>상태</strong><div>${esc(head.status || "")}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>순번</th>
            <th>품목코드</th>
            <th>바코드</th>
            <th>품목명</th>
            <th>규격</th>
            <th>수량(BOX)</th>
            <th>수량</th>
            <th>적요</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>${lineRows || `<tr><td colspan="9" class="muted">품목 라인 정보가 없습니다.</td></tr>`}</tbody>
      </table>
    ${debugHtml}`;
    detailOverlay?.classList.remove("hidden");
  };

  const draw = async () => {
    const currentSeq = ++inboundPlanQuerySeq;
    const fromEl = qs("#inbound-plan-from");
    const toEl = qs("#inbound-plan-to");
    const statusEl = qs("#inbound-plan-status");
    const tableWrap = qs("#inbound-plan-table-wrap");
    const searchBtn = qs("#inbound-plan-search");
    const fromDate = fromEl?.value || "";
    const toDate = toEl?.value || "";
    try {
      if (searchBtn) searchBtn.disabled = true;
      if (statusEl) statusEl.textContent = "조회 중...";
      const qsPart = `from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
      const res = await api(`/api/inbound-plans?${qsPart}`);
      // Ignore stale responses from earlier requests.
      if (currentSeq !== inboundPlanQuerySeq) return;
      const items = Array.isArray(res.items) ? res.items : [];
      inboundPlanItems = items;
      if (statusEl) {
        const extra = res?.debug?.countRaw ? ` (원본 ${res.debug.countRaw})` : "";
        statusEl.textContent = `총 ${items.length}건${extra}`;
      }
      if (!items.length) {
        const code = res?.debug?.code ? ` / code: ${esc(res.debug.code)}` : "";
        const msg = res?.debug?.message ? ` / msg: ${esc(res.debug.message)}` : "";
        const keys = res?.debug?.topKeys?.length ? ` / keys: ${esc(res.debug.topKeys.join(", "))}` : "";
        const dkeys = res?.debug?.dataKeys?.length ? ` / dataKeys: ${esc(res.debug.dataKeys.join(", "))}` : "";
        const dtype = res?.debug?.dataType ? ` / dataType: ${esc(res.debug.dataType)}` : "";
        const adj = res?.debug?.adjustedDateRange
          ? ` / adjustedRange: ${esc(res.debug.adjustedDateRange.from)}~${esc(res.debug.adjustedDateRange.to)}`
          : "";
        const preview = res?.debug?.dataPreview ? `<br /><small class="muted">dataPreview: ${esc(res.debug.dataPreview)}</small>` : "";
        const errPreview = res?.debug?.errorPreview ? `<br /><small class="muted">error: ${esc(res.debug.errorPreview)}</small>` : "";
        const errsPreview = res?.debug?.errorsPreview ? `<br /><small class="muted">errors: ${esc(res.debug.errorsPreview)}</small>` : "";
        tableWrap.innerHTML = `<span class="muted">조회 결과가 없습니다.${code}${msg}${keys}${dkeys}${dtype}${adj}</span>${preview}${errPreview}${errsPreview}`;
        return;
      }
      const rows = items
        .map(
          (x, idx) => {
            const qtyNum = Number(String(x.qty ?? "").replace(/,/g, ""));
            const qtyText = Number.isFinite(qtyNum) ? qtyNum.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : String(x.qty || "");
            return `<tr>
            <td>${idx + 1}</td>
            <td><button type="button" class="bh-link-btn inbound-plan-open-detail" data-idx="${idx}">${esc(x.poNo || "")}</button></td>
            <td>${esc(formatYmd(x.poDate || ""))}</td>
            <td>${esc(x.vendor || "")}</td>
            <td>${esc(x.manager || "")}</td>
            <td>${esc(x.itemName || "")}</td>
            <td>${esc(qtyText)}</td>
            <td>${esc(formatYmd(x.dueDate || ""))}</td>
            <td>${esc(x.whName || "")}</td>
            <td>${esc(x.status || "")}</td>
          </tr>`;
          }
        )
        .join("");
      tableWrap.innerHTML = `
        <table id="inbound-plan-table">
          <thead>
            <tr>
              <th>순번</th>
              <th>발주번호</th>
              <th>발주일자</th>
              <th>거래처</th>
              <th>담당자</th>
              <th>품목명</th>
              <th>발주수량</th>
              <th>납기일(입고예정일)</th>
              <th>창고</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
      delete TABLE_FILTER_MEMORY["#inbound-plan-table"];
      applyExcelLikeFilter("#inbound-plan-table");
      tableWrap.querySelectorAll(".inbound-plan-open-detail").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const idx = Number(btn.getAttribute("data-idx"));
          if (!Number.isInteger(idx) || idx < 0) return;
          await renderDetail(inboundPlanItems[idx]);
        });
      });
    } catch (err) {
      if (currentSeq !== inboundPlanQuerySeq) return;
      if (statusEl) statusEl.textContent = "조회 실패";
      tableWrap.innerHTML = `<span class="muted">${esc(err.message || "조회 실패")}</span>`;
    } finally {
      if (currentSeq === inboundPlanQuerySeq && searchBtn) searchBtn.disabled = false;
    }
  };

  qs("#inbound-plan-search").onclick = () => draw();
}

async function renderInboundPlan2() {
  const wrap = qs("#view-inbound-plan-2");
  if (!wrap) return;
  const today = new Date();
  const defaultApiTo = localDateYmd(today);
  const defaultApiFrom = localDateYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30));
  let apiFrom = defaultApiFrom;
  let apiTo = defaultApiTo;
  try {
    const sF = localStorage.getItem("inbound-plan-2-api-from");
    const sT = localStorage.getItem("inbound-plan-2-api-to");
    if (sF && /^\d{4}-\d{2}-\d{2}$/.test(sF)) apiFrom = sF;
    if (sT && /^\d{4}-\d{2}-\d{2}$/.test(sT)) apiTo = sT;
  } catch (_) {
    /* ignore */
  }
  wrap.innerHTML = `
    <div class="card">
      <h2>입고예정목록 2 <span id="inbound-plan-2-new-badge"></span></h2>
      <p class="muted">이카운트 ERP에서 「발주서현황」을 엑셀 저장한 파일(.xlsx)을 올리면 품목 라인까지 목록·전표 상세로 볼 수 있습니다. 이미 저장된 <strong>발주번호(일자-No.)</strong>와 같은 전표는 덮어쓰지 않고 건너뛰며, <strong>신규 발주만</strong> 추가됩니다.</p>
      <div class="row" style="grid-template-columns: 1fr auto auto auto auto; gap: 10px; align-items: center;">
        <input type="file" id="inbound-plan-2-file" accept=".xlsx,.xls" />
        <button type="button" id="inbound-plan-2-upload" class="primary">업로드·반영</button>
        <button type="button" id="inbound-plan-2-refresh" class="cancel-btn">목록 새로고침</button>
        <button type="button" id="inbound-plan-2-check-new" class="cancel-btn">API 신규 확인</button>
        <button type="button" id="inbound-plan-2-delete-selected" class="cancel-btn">선택 삭제</button>
      </div>
      <div class="row" style="display: grid; grid-template-columns: auto 170px auto 170px 1fr; align-items: center; gap: 8px; margin-top: 10px;">
        <span class="muted" style="white-space: nowrap;">신규 확인(API) 조회 기간</span>
        <input type="date" id="inbound-plan-2-api-from" value="${esc(apiFrom)}" style="width:170px;" />
        <span class="muted">~</span>
        <input type="date" id="inbound-plan-2-api-to" value="${esc(apiTo)}" style="width:170px;" />
        <span class="muted" style="font-size: 12px; white-space: nowrap;">이카운트 발주서 조회 구간(BASE_DATE) · <strong>입고예정목록 1</strong>과 별도입니다.</span>
      </div>
      <div id="inbound-plan-2-meta" class="muted" style="margin-top:8px;"></div>
      <div id="inbound-plan-2-api-status" class="muted" style="margin-top:4px;"></div>
    </div>
    <div class="card">
      <div id="inbound-plan-2-table-wrap" class="muted">파일을 업로드하거나 새로고침 하세요.</div>
    </div>
    <div id="inbound-plan-2-detail-overlay" class="modal-overlay hidden">
      <div class="modal" style="width: min(920px, calc(100vw - 24px));">
        <div class="modal-header">
          <h3 id="inbound-plan-2-detail-title">전표 상세 (업로드)</h3>
          <button type="button" id="inbound-plan-2-detail-close" class="cancel-btn del-small">닫기</button>
        </div>
        <div id="inbound-plan-2-detail-body" style="max-height: 65vh; overflow: auto;"></div>
      </div>
    </div>
  `;

  let inboundPlan2Items = [];
  let selectedSlipKeys = new Set();
  const detailOverlay = qs("#inbound-plan-2-detail-overlay");
  const detailBody = qs("#inbound-plan-2-detail-body");
  const detailTitle = qs("#inbound-plan-2-detail-title");
  const metaEl = qs("#inbound-plan-2-meta");
  const tableWrap = qs("#inbound-plan-2-table-wrap");
  const apiStatusEl = qs("#inbound-plan-2-api-status");
  const newBadgeEl = qs("#inbound-plan-2-new-badge");

  const closeDetail = () => detailOverlay?.classList.add("hidden");
  qs("#inbound-plan-2-detail-close")?.addEventListener("click", closeDetail);
  detailOverlay?.addEventListener("click", (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  const qtyText = (v) => {
    const n = Number(String(v ?? "").replace(/,/g, ""));
    return Number.isFinite(n) ? n.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : String(v || "");
  };

  const renderDetail = async (listRow) => {
    if (!listRow || !detailBody) return;
    const slipNo = String(listRow.poNo || "");
    if (!slipNo) return;
    if (detailTitle) detailTitle.textContent = `전표 상세 - ${slipNo}`;
    detailBody.innerHTML = `<p class="muted">불러오는 중…</p>`;
    detailOverlay?.classList.remove("hidden");
    let lines = [];
    let head = listRow;
    try {
      const res = await api(`/api/inbound-plan-upload/detail?slipNo=${encodeURIComponent(slipNo)}`);
      lines = Array.isArray(res.items) ? res.items : [];
      head = res.item || lines[0] || listRow;
    } catch (err) {
      detailBody.innerHTML = `<p class="muted">${esc(err.message || "오류")}</p>`;
      return;
    }
    const lineRows = lines
      .map(
        (r, idx) => `<tr>
          <td>${idx + 1}</td>
          <td>${esc(r.itemCode || "")}</td>
          <td>${esc(r.barcode || "")}</td>
          <td>${esc(r.itemName || "")}</td>
          <td>${esc(r.spec || "")}</td>
          <td>${esc(qtyText(r.boxQty || ""))}</td>
          <td>${esc(qtyText(r.qty || ""))}</td>
          <td>${esc(qtyText(r.unitPrice ?? ""))}</td>
          <td>${esc(qtyText(r.supplyAmount ?? ""))}</td>
          <td>${esc(r.vendorCode || "")}</td>
          <td>${esc(r.remark || "")}</td>
          <td>${esc(r.note || "")}</td>
        </tr>`
      )
      .join("");
    detailBody.innerHTML = `
      <p class="muted" style="margin-bottom:10px;">업로드 파일 기준 데이터입니다.</p>
      <div class="row" style="grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 8px; margin-bottom: 12px;">
        <div><strong>전표번호</strong><div>${esc(slipNo || "-")}</div></div>
        <div><strong>일자</strong><div>${esc(formatYmdLoose(head.poDate || ""))}</div></div>
        <div><strong>거래처</strong><div>${esc(head.vendor || "")}</div></div>
        <div><strong>거래처코드</strong><div>${esc(head.vendorCode || "")}</div></div>
        <div><strong>담당자</strong><div>${esc(head.manager || "")}</div></div>
        <div><strong>입고창고</strong><div>${esc(head.whName || "")}</div></div>
        <div><strong>납기일자</strong><div>${esc(formatYmdLoose(head.dueDate || ""))}</div></div>
        <div><strong>최종수정일자</strong><div>${esc(head.lastModifiedAt || "")}</div></div>
        <div><strong>품목 행 수</strong><div>${lines.length}</div></div>
      </div>
      <table>
        <thead>
          <tr>
            <th>순번</th>
            <th>품목코드</th>
            <th>바코드</th>
            <th>품목명</th>
            <th>규격</th>
            <th>수량(BOX)</th>
            <th>수량</th>
            <th>단가</th>
            <th>공급가액</th>
            <th>거래처코드</th>
            <th>적요</th>
            <th>비고</th>
          </tr>
        </thead>
        <tbody>${lineRows || `<tr><td colspan="12" class="muted">품목 라인이 없습니다.</td></tr>`}</tbody>
      </table>
    `;
  };

  const drawTable = () => {
    if (!tableWrap) return;
    if (!inboundPlan2Items.length) {
      tableWrap.innerHTML = `<span class="muted">표시할 전표가 없습니다. 엑셀을 업로드하세요.</span>`;
      return;
    }
    const rows = inboundPlan2Items
      .map(
        (x, idx) => {
          const qtyNum = Number(String(x.qty ?? "").replace(/,/g, ""));
          const qtyDisp = Number.isFinite(qtyNum) ? qtyNum.toLocaleString("ko-KR", { maximumFractionDigits: 0 }) : String(x.qty || "");
          return `<tr>
            <td><input type="checkbox" class="inbound-plan-2-row-check" data-slip="${esc(x.poNo || "")}" ${
              selectedSlipKeys.has(normalizeSlipNoText(x.poNo)) ? "checked" : ""
            } /></td>
            <td>${idx + 1}</td>
            <td><button type="button" class="bh-link-btn inbound-plan-2-open-detail" data-idx="${idx}">${esc(x.poNo || "")}</button></td>
            <td>${esc(formatYmdLoose(x.poDate || ""))}</td>
            <td>${esc(x.vendor || "")}</td>
            <td>${esc(x.manager || "")}</td>
            <td>${esc(x.itemName || "")}</td>
            <td>${esc(qtyDisp)}</td>
            <td>${esc(formatYmdLoose(x.dueDate || ""))}</td>
            <td>${esc(x.whName || "")}</td>
            <td>${esc(x.lastModifiedAt || "")}</td>
            <td>${esc(String(x.lineCount || ""))}</td>
          </tr>`;
        }
      )
      .join("");
    tableWrap.innerHTML = `
      <table id="inbound-plan-2-table">
        <thead>
          <tr>
            <th><input type="checkbox" id="inbound-plan-2-check-all" /></th>
            <th>순번</th>
            <th>발주번호</th>
            <th>발주일자</th>
            <th>거래처</th>
            <th>담당자</th>
            <th>품목요약</th>
            <th>수량합계</th>
            <th>납기일</th>
            <th>창고</th>
            <th>최종수정일자</th>
            <th>품목행수</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
    const checkAll = qs("#inbound-plan-2-check-all");
    const rowChecks = Array.from(tableWrap.querySelectorAll(".inbound-plan-2-row-check"));
    if (checkAll) {
      const allChecked = rowChecks.length > 0 && rowChecks.every((el) => el.checked);
      checkAll.checked = allChecked;
      checkAll.addEventListener("change", () => {
        selectedSlipKeys = new Set();
        rowChecks.forEach((el) => {
          el.checked = checkAll.checked;
          if (checkAll.checked) selectedSlipKeys.add(normalizeSlipNoText(el.getAttribute("data-slip")));
        });
      });
    }
    rowChecks.forEach((el) => {
      el.addEventListener("change", () => {
        const k = normalizeSlipNoText(el.getAttribute("data-slip"));
        if (!k) return;
        if (el.checked) selectedSlipKeys.add(k);
        else selectedSlipKeys.delete(k);
        if (checkAll) checkAll.checked = rowChecks.length > 0 && rowChecks.every((x) => x.checked);
      });
    });
    delete TABLE_FILTER_MEMORY["#inbound-plan-2-table"];
    applyExcelLikeFilter("#inbound-plan-2-table");
    tableWrap.querySelectorAll(".inbound-plan-2-open-detail").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-idx"));
        if (!Number.isInteger(idx) || idx < 0) return;
        await renderDetail(inboundPlan2Items[idx]);
      });
    });
  };

  const loadList = async () => {
    try {
      const res = await api("/api/inbound-plan-upload");
      inboundPlan2Items = Array.isArray(res.items) ? res.items : [];
      selectedSlipKeys = new Set(
        Array.from(selectedSlipKeys).filter((k) => inboundPlan2Items.some((x) => normalizeSlipNoText(x.poNo) === k))
      );
      if (metaEl) {
        const fn = res.sourceFileName ? esc(res.sourceFileName) : "-";
        const at = res.uploadedAt ? esc(res.uploadedAt.slice(0, 19).replace("T", " ")) : "-";
        metaEl.innerHTML = `저장된 파일: <strong>${fn}</strong> · 반영 시각: ${at} · 품목 행 <strong>${Number(res.lineCount || 0)}</strong> · 전표 <strong>${inboundPlan2Items.length}</strong>`;
      }
      drawTable();
    } catch (e) {
      if (metaEl) metaEl.textContent = "";
      tableWrap.innerHTML = `<span class="muted">${esc(e.message || "목록 조회 실패")}</span>`;
    }
  };

  const checkApiNewSlips = async () => {
    const fromEl = qs("#inbound-plan-2-api-from");
    const toEl = qs("#inbound-plan-2-api-to");
    let from = String(fromEl?.value || "").trim();
    let to = String(toEl?.value || "").trim();
    if (!from || !to) {
      alert("신규 확인(API) 조회 기간의 시작일·종료일을 모두 선택하세요.");
      return;
    }
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
      if (fromEl) fromEl.value = from;
      if (toEl) toEl.value = to;
    }
    try {
      localStorage.setItem("inbound-plan-2-api-from", from);
      localStorage.setItem("inbound-plan-2-api-to", to);
    } catch (_) {
      /* ignore */
    }

    if (apiStatusEl) apiStatusEl.textContent = `이카운트 발주 API 조회 중… (${from} ~ ${to})`;
    if (newBadgeEl) newBadgeEl.innerHTML = "";
    try {
      const res = await api(`/api/inbound-plans?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const apiItems = Array.isArray(res.items) ? res.items : [];
      const adj = res.debug && res.debug.adjustedDateRange;
      const adjNote =
        adj && adj.from && adj.to
          ? ` · 서버 적용 구간 ${formatYmd(adj.from)} ~ ${formatYmd(adj.to)}(최대 30일로 자동 축소됨)`
          : "";
      const uploadedMap = new Map();
      inboundPlan2Items.forEach((x) => {
        const k = normalizeSlipNoText(x.poNo);
        if (!k) return;
        uploadedMap.set(k, {
          poNo: x.poNo || "",
          lastModifiedKey: normalizeDateTimeDigits(x.lastModifiedAt),
          lastModifiedAt: String(x.lastModifiedAt || "")
        });
      });
      const newItems = [];
      const modifiedItems = [];
      apiItems.forEach((x) => {
        const k = normalizeSlipNoText(x.poNo);
        if (!k) return;
        const apiLastModifiedKey = normalizeDateTimeDigits(x.lastModifiedAt);
        const uploaded = uploadedMap.get(k);
        if (!uploaded) {
          newItems.push(x);
          return;
        }
        if (uploaded.lastModifiedKey && apiLastModifiedKey && apiLastModifiedKey > uploaded.lastModifiedKey) {
          modifiedItems.push({
            poNo: x.poNo || uploaded.poNo || "",
            apiLastModifiedAt: x.lastModifiedAt || "",
            uploadedLastModifiedAt: uploaded.lastModifiedAt || ""
          });
        }
      });
      if (newItems.length || modifiedItems.length) {
        const newSample = newItems
          .slice(0, 5)
          .map((x) => x.poNo)
          .filter(Boolean)
          .join(", ");
        const modifiedSample = modifiedItems
          .slice(0, 5)
          .map((x) => x.poNo)
          .filter(Boolean)
          .join(", ");
        const parts = [];
        if (newItems.length) {
          parts.push(
            `<strong style="color:#b42318;">신규 발주서 ${newItems.length}건</strong> (입고예정목록 2 업로드 목록에 없음)${
              newSample ? ` · 예: ${esc(newSample)}${newItems.length > 5 ? " …" : ""}` : ""
            }`
          );
        }
        if (modifiedItems.length) {
          parts.push(
            `<strong style="color:#1d4ed8;">수정 발주서 ${modifiedItems.length}건</strong> (동일 발주번호, API 최종수정일자 최신)${
              modifiedSample ? ` · 예: ${esc(modifiedSample)}${modifiedItems.length > 5 ? " …" : ""}` : ""
            }`
          );
        }
        if (apiStatusEl) {
          apiStatusEl.innerHTML = `${parts.join(" · ")}<span class="muted" style="font-weight:normal;font-size:12px;"> · 조회 ${esc(
            from
          )} ~ ${esc(to)}</span>${esc(adjNote)}`;
        }
        if (newBadgeEl) {
          const badges = [];
          if (newItems.length) {
            badges.push(
              '<span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background:#fee4e2; color:#b42318; font-size:12px; vertical-align:middle;">신규 ' +
                newItems.length +
                "건</span>"
            );
          }
          if (modifiedItems.length) {
            badges.push(
              '<span style="display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; background:#dbeafe; color:#1d4ed8; font-size:12px; vertical-align:middle;">수정 ' +
                modifiedItems.length +
                "건</span>"
            );
          }
          newBadgeEl.innerHTML = badges.join("");
        }
      } else if (apiStatusEl) {
        apiStatusEl.innerHTML = `API 기준 신규/수정 발주서 없음 (업로드 목록이 해당 구간을 반영한 상태).<span class="muted" style="font-weight:normal;font-size:12px;"> · 조회 ${esc(
          from
        )} ~ ${esc(to)}</span>${esc(adjNote)}`;
      }
    } catch (e) {
      if (apiStatusEl) apiStatusEl.textContent = `API 신규 확인 실패: ${e.message || "오류"}`;
    }
  };

  qs("#inbound-plan-2-refresh")?.addEventListener("click", () => loadList());
  qs("#inbound-plan-2-check-new")?.addEventListener("click", () => checkApiNewSlips());
  qs("#inbound-plan-2-delete-selected")?.addEventListener("click", async () => {
    const selected = inboundPlan2Items.filter((x) => selectedSlipKeys.has(normalizeSlipNoText(x.poNo)));
    if (!selected.length) {
      alert("삭제할 전표를 먼저 체크하세요.");
      return;
    }
    const ok = confirm(`선택한 전표 ${selected.length}건을 삭제할까요?\n(전표별 품목 행 전체가 삭제됩니다.)`);
    if (!ok) return;
    try {
      const res = await api("/api/inbound-plan-upload/delete", {
        method: "POST",
        body: JSON.stringify({ slipNos: selected.map((x) => x.poNo) })
      });
      inboundPlan2Items = Array.isArray(res.items) ? res.items : [];
      selectedSlipKeys = new Set();
      if (metaEl) {
        const fn = res.sourceFileName ? esc(res.sourceFileName) : "-";
        const at = res.uploadedAt ? esc(res.uploadedAt.slice(0, 19).replace("T", " ")) : "-";
        metaEl.innerHTML = `저장된 파일: <strong>${fn}</strong> · 반영 시각: ${at} · 누적 품목 행 <strong>${Number(
          res.lineCount || 0
        )}</strong> · 누적 전표 <strong>${res.slipCount ?? inboundPlan2Items.length}</strong>`;
      }
      drawTable();
      await checkApiNewSlips();
      if (!Number(res.deletedLineCount || 0)) {
        alert("삭제된 항목이 없습니다. 체크한 발주번호 형식이 저장 데이터와 다른지 확인해 주세요.");
      } else {
        alert(`삭제 완료: 전표 ${res.deletedSlipCount ?? selected.length}건, 품목 행 ${res.deletedLineCount ?? 0}줄`);
      }
    } catch (e) {
      alert(e.message || "선택 삭제 실패");
    }
  });
  qs("#inbound-plan-2-upload")?.addEventListener("click", async () => {
    const input = qs("#inbound-plan-2-file");
    const file = input?.files?.[0];
    if (!file) {
      alert("엑셀 파일을 선택하세요.");
      return;
    }
    try {
      const { matrix, sourceFileName } = await parseSheetAsMatrix(file);
      const res = await api("/api/inbound-plan-upload", {
        method: "POST",
        body: JSON.stringify({ matrix, sourceFileName })
      });
      inboundPlan2Items = Array.isArray(res.items) ? res.items : [];
      if (metaEl) {
        const fn = esc(res.sourceFileName || sourceFileName);
        const at = res.uploadedAt ? esc(res.uploadedAt.slice(0, 19).replace("T", " ")) : "";
        const skip =
          res.skippedLineCount > 0
            ? ` · 이번 업로드에서 생략(기존 발주와 동일) 품목 행 <strong>${res.skippedLineCount}</strong> · 해당 전표 수 <strong>${res.skippedExistingSlipCount ?? 0}</strong>`
            : "";
        const add =
          res.addedLineCount != null
            ? ` · 이번에 추가된 품목 행 <strong>${res.addedLineCount}</strong> · 신규 전표 <strong>${res.newSlipCount ?? 0}</strong>`
            : "";
        metaEl.innerHTML = `저장된 파일: <strong>${fn}</strong> · 반영 시각: ${at} · 누적 품목 행 <strong>${Number(res.lineCount || 0)}</strong> · 누적 전표 <strong>${res.slipCount ?? inboundPlan2Items.length}</strong>${add}${skip}`;
      }
      drawTable();
      const skipMsg =
        res.skippedLineCount > 0
          ? `\n건너뜀: 동일 발주번호 ${res.skippedExistingSlipCount ?? 0}건(품목 행 ${res.skippedLineCount}줄). 기존 데이터 유지.`
          : "";
      const addMsg =
        res.addedLineCount != null
          ? `\n추가: 신규 전표 ${res.newSlipCount ?? 0}건, 품목 행 ${res.addedLineCount}줄.`
          : "";
      alert(
        `반영 완료.\n누적 전표 ${res.slipCount ?? inboundPlan2Items.length}건, 누적 품목 행 ${res.lineCount ?? 0}건.${addMsg}${skipMsg}`
      );
      await checkApiNewSlips();
    } catch (e) {
      alert(e.message || "업로드 실패");
    }
  });

  await loadList();
  await checkApiNewSlips();
}

function renderOutbound() {
  qs("#view-outbound").innerHTML = movementFormHtml("OUT", "출고", "등록 버튼 클릭시에만 등록됩니다.", "outbound", "출고처");
  bindMovement("OUT");
  renderRecentMovements("OUT");
}

async function renderRecentMovements(type) {
  const box = qs(`#recent-${type}`);
  if (!box) return;
  box.innerHTML = "최근 내역을 불러오는 중...";

  const partnerLabel = type === "IN" ? "입고처" : "출고처";
  try {
    const res = await api(`/api/recent?type=${type}&limit=8`);
    const items = res.items || [];
    if (!items.length) {
      box.innerHTML = `<span class="muted">등록 내역이 없습니다.</span>`;
      return;
    }

    const rows = items
      .map((x) => {
        const value = type === "IN" ? x.partner : x.partner;
        return `<tr>
          <td>${x.id}</td>
          <td>${esc(x.productCode)}</td>
          <td>${esc(x.ecountCode || "")}</td>
          <td>${esc(x.productName || "")}</td>
          <td>${x.qty}</td>
          <td>${esc(x.warehouse || "")}</td>
          <td>${esc(value || "")}</td>
          <td>${esc(x.user)}</td>
          <td>${esc(x.memo || "")}</td>
          <td>${x.createdAt}</td>
          <td>
            <button type="button" class="cancel-btn del-small recent-cancel-btn" data-id="${x.id}" data-user="${esc(x.user)}">취소</button>
          </td>
        </tr>`;
      })
      .join("");

    box.innerHTML = `
      <table id="recent-${type}-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>상품코드</th>
            <th>품목코드</th>
            <th>상품명</th>
            <th>수량</th>
            <th>창고</th>
            <th>${partnerLabel}</th>
            <th>담당</th>
            <th>메모</th>
            <th>일시</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    box.querySelectorAll(".recent-cancel-btn").forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.dataset.id);
        const manager = String(btn.dataset.user || "").trim();
        if (!manager) return alert("등록자 정보가 없어 취소할 수 없습니다.");
        try {
          await api("/api/movements/cancel", {
            method: "POST",
            body: JSON.stringify({ id, user: manager })
          });
          await afterMovementDone();
        } catch (err) {
          alert(err.message);
        }
      };
    });

    applyExcelLikeFilter(`#recent-${type}-table`);
  } catch (e) {
    box.innerHTML = `<span class="muted">최근 내역을 불러오지 못했습니다.</span>`;
  }
}

function renderAdjust() {
  const productOptions = state.products.map((p) => `<option value="${esc(p.code)}">${esc(p.code)} - ${esc(p.name)}</option>`).join("");
  const managerOptions = state.managers.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const warehouseOptions = (state.warehouses || []).map((w) => `<option value="${esc(w)}">${esc(w)}</option>`).join("");
  qs("#view-adjust").innerHTML = `
    <div class="card">
      <h2>재고 조정 / 이동</h2>
      <form id="ADJUST-form">
        <div><label>상품 검색(코드)</label><input name="productCode" required /></div>
        <div><label>창고</label><input name="warehouse" list="ADJUST-warehouse-list" required /></div>
        <datalist id="ADJUST-warehouse-list">${warehouseOptions}</datalist>
        <div><label>조정수량(+/-)</label><input name="qty" type="number" required /></div>
        <div><label>담당자</label><input name="user" list="ADJUST-manager-list" required /></div>
        <datalist id="ADJUST-manager-list">${managerOptions}</datalist>
        <div><label>메모</label><input name="memo" placeholder="파손/오차 등" /></div>
        <div><button id="ADJUST-submit" class="primary" type="button">조정 등록</button></div>
      </form>
    </div>
    <div class="card">
      <h3>창고 간 이동</h3>
      <form id="TRANSFER-form">
        <div><label>상품 검색(코드)</label><input name="productCode" required /></div>
        <div><label>출발창고</label><input name="warehouse" list="TRANSFER-from-list" required /></div>
        <datalist id="TRANSFER-from-list">${warehouseOptions}</datalist>
        <div><label>도착창고</label><input name="toWarehouse" list="TRANSFER-to-list" required /></div>
        <datalist id="TRANSFER-to-list">${warehouseOptions}</datalist>
        <div><label>이동수량</label><input name="qty" type="number" required /></div>
        <div><label>담당자</label><input name="user" list="TRANSFER-manager-list" required /></div>
        <datalist id="TRANSFER-manager-list">${managerOptions}</datalist>
        <div><label>메모</label><input name="memo" placeholder="창고 이동" /></div>
        <div><button id="TRANSFER-submit" class="primary" type="button">이동 등록</button></div>
      </form>
    </div>
  `;
  const form = qs("#ADJUST-form");
  preventEnterSubmit(form);
  qs("#ADJUST-submit").onclick = async () => {
    try {
      const data = Object.fromEntries(new FormData(form));
      await api("/api/movements", { method: "POST", body: JSON.stringify({ ...data, type: "ADJUST" }) });
      await afterMovementDone();
      alert("조정 등록 완료");
    } catch (err) {
      alert(err.message);
    }
  };
  const tForm = qs("#TRANSFER-form");
  preventEnterSubmit(tForm);
  qs("#TRANSFER-submit").onclick = async () => {
    try {
      const data = Object.fromEntries(new FormData(tForm));
      await api("/api/movements", { method: "POST", body: JSON.stringify({ ...data, type: "TRANSFER" }) });
      await afterMovementDone();
      alert("이동 등록 완료");
    } catch (err) {
      alert(err.message);
    }
  };
}

function typeBadge(type, cancelled) {
  if (cancelled) return `<span class="badge gray">취소됨</span>`;
  if (type === "IN") return `<span class="badge green">입고</span>`;
  if (type === "OUT") return `<span class="badge red">출고</span>`;
  if (type === "ADJUST") return `<span class="badge blue">재고조정</span>`;
  if (type === "TRANSFER") return `<span class="badge blue">이동</span>`;
  if (type === "CANCEL") return `<span class="badge gray">취소반영</span>`;
  return `<span class="badge gray">${esc(type)}</span>`;
}

async function renderHistory() {
  const wrap = qs("#view-history");
  const managerOptions = state.managers.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  wrap.innerHTML = `
    <div class="card">
      <h2>입출고이력</h2>
      <div class="row history-row">
        <input id="history-q" class="history-q" placeholder="상품코드 검색" />
        <select id="history-type-filter">
          <option value="ALL">구분 전체</option>
          <option value="IN">입고</option>
          <option value="OUT">출고</option>
          <option value="ADJUST">재고조정</option>
          <option value="TRANSFER">이동</option>
          <option value="CANCEL">취소반영</option>
        </select>
        <button class="primary" id="history-search">필터</button>
      </div>
    </div>
    <div class="card" id="history-table"></div>
    <datalist id="history-manager-list">${managerOptions}</datalist>
  `;

  async function draw(q = "") {
    const qTrim = (q || "").trim();
    const typeFilter = qs("#history-type-filter") ? qs("#history-type-filter").value : "ALL";
    const [res, stockRes] = await Promise.all([api(`/api/history?q=${encodeURIComponent(qTrim)}`), api("/api/stock")]);

    const matched = qTrim
      ? stockRes.items.filter((s) => String(s.code).includes(qTrim) || String(s.name).includes(qTrim)).map((s) => `${s.code}: ${s.stock}`)
      : [];
    const matchedStocks = matched.length ? matched.join(" / ") : qTrim ? "해당 상품 없음" : "-";

    const items = typeFilter === "ALL" ? res.items : res.items.filter((x) => x.type === typeFilter);

    const rows = items
      .map((x) => `<tr>
        <td>${x.id}</td>
        <td>${typeBadge(x.type, x.cancelled)}</td>
        <td>${esc(x.productCode)}</td>
        <td>${esc(x.ecountCode || "")}</td>
        <td>${esc(x.productName)}</td>
        <td>${x.qty}</td>
        <td>${esc(x.warehouse || "-")}</td>
        <td>${esc(x.toWarehouse || "-")}</td>
        <td>${x.type === "IN" ? esc(x.partner) : x.type === "CANCEL" && x.originType === "IN" ? esc(x.partner) : "-"}</td>
        <td>${x.type === "OUT" ? esc(x.partner) : x.type === "CANCEL" && x.originType === "OUT" ? esc(x.partner) : "-"}</td>
        <td>${esc(x.user)}</td>
        <td>${esc(x.memo)}</td>
        <td>${x.createdAt}</td>
        <td>${x.stockAfter ?? "-"}</td>
        <td>${(!x.cancelled && ["IN", "OUT", "ADJUST"].includes(x.type)) ? `<button class="cancel-btn history-cancel-btn" data-id="${x.id}">등록취소</button>` : "-"}</td>
      </tr>`)
      .join("");

    qs("#history-table").innerHTML = `
      <table id="history-table-list">
        <thead><tr><th>ID</th><th>구분</th><th>상품코드</th><th>품목코드</th><th>상품명</th><th>수량</th><th>창고</th><th>이동창고</th><th>입고처</th><th>출고처</th><th>담당</th><th>메모</th><th>일시</th><th>시점재고</th><th>액션</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="15"><strong>현재고(검색 기준): </strong>${esc(matchedStocks)}</td></tr></tfoot>
      </table>
    `;
    applyExcelLikeFilter("#history-table-list");

    document.querySelectorAll(".history-cancel-btn").forEach((btn) => {
      btn.onclick = async () => {
        const manager = prompt("취소 담당자명을 입력하세요 (기본정보>담당자 등록 필요)");
        if (!manager) return;
        try {
          await api("/api/movements/cancel", {
            method: "POST",
            body: JSON.stringify({ id: Number(btn.dataset.id), user: manager.trim() })
          });
          await afterMovementDone();
        } catch (err) {
          alert(err.message);
        }
      };
    });
  }

  qs("#history-search").onclick = () => draw(qs("#history-q").value.trim());
  await draw("");
}

function renderAlert() {
  qs("#view-alert").innerHTML = `
    <div class="card">
      <h2>알림</h2>
      <p class="muted">추후 업그레이드 예정 메뉴입니다.</p>
    </div>
  `;
}

async function afterMovementDone() {
  await refreshCommon();
  renderStock();
  renderProducts();
  renderMaster();
  await renderDashboard();
  await renderHistory();
  const active = document.querySelector(".main .view:not(.hidden)");
  if (active) {
    if (active.id === "view-inbound") renderInbound();
    if (active.id === "view-outbound") renderOutbound();
    if (active.id === "view-adjust") renderAdjust();
  }
}

async function init() {
  document.querySelectorAll(".sidebar button").forEach((btn) => {
    btn.onclick = async () => {
      const v = btn.dataset.view;
      switchView(v);
      if (v === "dashboard") await renderDashboard();
      if (v === "master") renderMaster();
      if (v === "products") renderProducts();
      if (v === "stock") renderStock();
      if (v === "inbound") renderInbound();
      if (v === "inbound-plan") await renderInboundPlan();
      if (v === "inbound-plan-2") await renderInboundPlan2();
      if (v === "outbound") renderOutbound();
      if (v === "adjust") renderAdjust();
      if (v === "history") await renderHistory();
      if (v === "alert") renderAlert();
    };
  });

  await refreshCommon();
  await renderDashboard();
  renderMaster();
  renderProducts();
  renderStock();
  renderInbound();
  await renderInboundPlan();
  await renderInboundPlan2();
  renderOutbound();
  renderAdjust();
  await renderHistory();
  renderAlert();
  let initialView = "dashboard";
  try {
    const saved = localStorage.getItem(LAST_VIEW_KEY);
    if (saved && views.includes(saved)) initialView = saved;
  } catch (_) {
    // ignore storage errors
  }
  switchView(initialView);
}

init().catch((e) => {
  alert(`초기화 실패: ${e.message}`);
});
