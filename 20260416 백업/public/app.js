const views = ["dashboard", "master", "products", "stock", "inbound", "outbound", "adjust", "history", "alert"];
const LAST_VIEW_KEY = "wms:lastView";
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

function applyExcelLikeFilter(tableSelector) {
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

  const filterState = colValues.map((set) => ({
    allValues: Array.from(set),
    selected: new Set(Array.from(set))
  }));
  const sortState = { col: -1, dir: "" };
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
  }

  function closeMenu() {
    if (openedMenu) {
      openedMenu.remove();
      openedMenu = null;
    }
  }

  Array.from(headRow.cells).forEach((th, colIdx) => {
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

function setupDropZone(zoneId, fileInputId) {
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
    if (!e.dataTransfer.files || !e.dataTransfer.files[0]) return;
    fileInput.files = e.dataTransfer.files;
  };
}

function downloadGuide(type) {
  const guides = {
    product: [
      {
        "품목코드(이카운트)": "EC-1001",
        "바코드": "8800000000012",
        "물류바코드": "L-8800000000012",
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
  const normalizeKey = (v) => String(v || "").replace(/\s+/g, "").toLowerCase();
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
        barcode: String(getByKeys(r, ["바코드", "barcode"]) || "").trim(),
        logisticsBarcode: String(getByKeys(r, ["물류바코드", "logisticsBarcode"]) || "").trim(),
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
    <div class="card">
      <h2>기본상품정보</h2>
      <div class="product-top compact-top">
        <div class="compact-upload">
          <h3>개별상품등록</h3>
          <p class="muted">단건 등록/수정</p>
          <button id="open-product-popup" class="primary compact-primary" type="button">개별등록</button>
        </div>
        <div class="compact-upload">
          <h3>상품일괄등록</h3>
          <button id="product-guide" type="button">가이드 다운로드</button>
          <button id="product-export-all" type="button" style="margin-top:8px;">현재상품 전체 다운로드</button>
          <button id="product-upload" class="primary" type="button" style="margin-top:8px;">업로드</button>
          <div id="product-dropzone" class="dropzone">드래그/클릭 업로드</div>
          <input type="file" id="product-file" accept=".xlsx,.xls,.csv" class="hidden-file" />
          <button id="product-update-upload" class="primary" type="button" style="margin-top:8px;">특정상품 정보 업데이트 업로드</button>
          <input type="file" id="product-update-file" accept=".xlsx,.xls,.csv" class="hidden-file" />
          <p class="muted">다중태그는 쉼표(,)로 입력</p>
        </div>
        <div class="compact-upload">
          <h3>옵션등록</h3>
          <p class="muted">옵션 일괄 설정</p>
          <button id="open-option-popup" class="primary compact-primary" type="button">옵션등록</button>
        </div>
      </div>
    </div>

    <div id="product-modal-overlay" class="modal-overlay hidden">
      <div class="modal">
        <div class="modal-header">
          <h3 id="product-modal-title">개별상품등록</h3>
          <button id="product-modal-close" class="cancel-btn del-small" type="button">닫기</button>
        </div>
        <form id="product-popup-form" class="modal-form">
          <div><label>품목코드(이카운트)</label><input name="ecountCode" required /></div>
          <div><label>바코드</label><input name="barcode" /></div>
          <div><label>물류바코드</label><input name="logisticsBarcode" /></div>
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
          <div><button class="primary" type="submit">등록/수정</button></div>
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

    <div class="card products-left">
      <div class="row" style="grid-template-columns: 1fr 420px; align-items: start; margin-bottom: 10px;">
        <h3 style="margin: 0;">현재 등록된 상품정보</h3>
        <div>
          <h3 style="margin: 0 0 8px;">상품 조회</h3>
          <div class="row product-search-row" style="margin-bottom: 10px;">
            <input id="product-search-q" class="product-search-q" placeholder="이카운트/상품코드 검색" />
            <button class="primary" id="product-search-btn">조회</button>
          </div>
          <div id="product-search-result" class="muted" style="margin-bottom:0;">
            상품을 검색하세요.
          </div>
        </div>
      </div>
        <div class="row product-search-row" style="margin-bottom:10px; grid-template-columns: 120px 120px;">
          <button id="product-edit-selected" type="button">선택 수정</button>
          <button id="product-delete-selected" class="cancel-btn" type="button">선택 삭제</button>
        </div>
        <div class="table-scroll-proxy-wrap"><div id="products-scroll-proxy" class="table-scroll-proxy-inner"></div></div>
        <div class="table-scroll-x">
          <table id="products-table">
            <thead><tr><th><input id="product-check-all" type="checkbox" /></th><th>품목코드(이카운트)</th><th>바코드</th><th>물류바코드</th><th>품목명(이카운트)</th><th>상태</th><th>판매처</th><th>판매처관리코드</th><th>판매처 품목명</th><th>규격</th><th>구매처</th><th>수급형태</th><th>발주부서</th><th>발주담당자</th><th>구매처 품목코드</th><th>구매처 품목명</th><th>창고그룹(이카운트)</th><th>사용창고</th><th>구분</th><th>카테고리</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
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

  // 상품 조회(검색) -> 아래 리스트 필터
  const searchInput = qs("#product-search-q");
  const searchBtn = qs("#product-search-btn");
  const resultEl = qs("#product-search-result");
  const applyProductSearch = () => {
    const q = (searchInput?.value || "").trim().toLowerCase();
    const rowsEls = Array.from(document.querySelectorAll("#products-table tbody tr"));
    let shown = 0;
    rowsEls.forEach((tr) => {
      const ok = !q || String(tr.dataset.search || "").includes(q);
      tr.style.display = ok ? "" : "none";
      if (ok) shown += 1;
    });
    if (resultEl) resultEl.textContent = q ? `검색 결과: ${shown}건` : `전체 ${rowsEls.length}건`;
  };
  if (searchBtn && searchInput && resultEl) {
    preventEnterSubmit(searchInput.closest(".product-search-row") || searchInput);
    searchBtn.onclick = applyProductSearch;
    searchInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyProductSearch();
      }
    };
    applyProductSearch();
  }

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

  const tableWrap = qs(".table-scroll-x");
  const proxy = qs("#products-scroll-proxy");
  if (tableWrap && proxy) {
    proxy.style.width = `${tableWrap.scrollWidth}px`;
    let syncing = false;
    proxy.parentElement.onscroll = () => {
      if (syncing) return;
      syncing = true;
      tableWrap.scrollLeft = proxy.parentElement.scrollLeft;
      syncing = false;
    };
    tableWrap.onscroll = () => {
      if (syncing) return;
      syncing = true;
      proxy.parentElement.scrollLeft = tableWrap.scrollLeft;
      syncing = false;
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

  setupDropZone("product-dropzone", "product-file");
  qs("#product-guide").onclick = () => downloadGuide("product");
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
        "바코드": p.barcode || "",
        "물류바코드": p.logisticsBarcode || "",
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
  qs("#product-upload").onclick = async () => {
    const file = qs("#product-file").files[0];
    if (!file) return alert("파일을 선택하세요.");
    try {
      const rows2 = await parseSheet(file);
      const normalized = normalizeProductRows(rows2);
      if (!normalized.length) {
        throw new Error("업로드 가능한 상품행이 없습니다. 헤더명(품목코드(이카운트), 품목명(이카운트))과 데이터 유무를 확인하세요.");
      }
      await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ rows: normalized }) });
      await refreshCommon();
      renderProducts();
      renderStock();
      renderMaster();
      await renderDashboard();
      alert(`엑셀 업로드 완료 (${normalized.length}건)`);
    } catch (e2) {
      alert(e2.message);
    }
  };
  qs("#product-update-upload").onclick = async () => {
    const updateInput = qs("#product-update-file");
    if (!updateInput) return;
    if (!updateInput.files[0]) {
      updateInput.click();
      return;
    }
    try {
      const rows2 = await parseSheet(updateInput.files[0]);
      const normalized = normalizeProductRows(rows2);
      if (!normalized.length) throw new Error("업데이트 가능한 상품행이 없습니다.");
      await api("/api/products/bulk", { method: "POST", body: JSON.stringify({ rows: normalized }) });
      await refreshCommon();
      renderProducts();
      renderStock();
      renderMaster();
      await renderDashboard();
      updateInput.value = "";
      alert(`상품정보 업데이트 완료 (${normalized.length}건)`);
    } catch (err) {
      alert(err.message);
    }
  };
  const updateInput = qs("#product-update-file");
  if (updateInput) {
    updateInput.onchange = async () => {
      if (!updateInput.files[0]) return;
      qs("#product-update-upload").click();
    };
  }

  applyExcelLikeFilter("#products-table");
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
