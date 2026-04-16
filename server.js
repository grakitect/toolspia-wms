const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PRODUCT_OPTION_KEYS = [
  "status",
  "deliveryVendors",
  "orderDept",
  "orderManagers",
  "supplyType",
  "warehouseGroup",
  "itemType",
  "categories"
];
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const initial = {
      products: [],
      movements: [],
      warehouses: ["툴스피아", "다이소", "아세로직스", "가온플러스"],
      partners: {
        inbound: [],
        outbound: [],
        purchase: []
      },
      managers: ["admin"],
      seq: 1
    };
    fs.writeFileSync(DB_PATH, JSON.stringify(initial, null, 2), "utf-8");
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
}

function normalizeDb(db) {
  if (!db.partners) {
    db.partners = { inbound: [], outbound: [], purchase: [] };
  }
  if (!Array.isArray(db.partners.inbound)) db.partners.inbound = [];
  if (!Array.isArray(db.partners.outbound)) db.partners.outbound = [];
  if (!Array.isArray(db.partners.purchase)) db.partners.purchase = [];
  if (!Array.isArray(db.managers) || db.managers.length === 0) {
    db.managers = ["admin"];
  }
  if (!Array.isArray(db.warehouses) || db.warehouses.length === 0) {
    db.warehouses = ["툴스피아", "다이소", "아세로직스", "가온플러스"];
  }
  if (!db.productOptions || typeof db.productOptions !== "object") db.productOptions = {};
  for (const k of PRODUCT_OPTION_KEYS) {
    db.productOptions[k] = normalizeOptionValues(db.productOptions[k]);
  }
  for (const p of db.products || []) {
    p.deliveryVendors = toTagList(p.deliveryVendors || p.salesVendor);
    p.orderManagers = toTagList(p.orderManagers);
    p.categories = toTagList(p.categories || p.category);
    p.usedWarehouses = toTagList(p.usedWarehouses).filter((w) => db.warehouses.includes(w));
    if (!p.ecountCode) p.ecountCode = String(p.code || "");
    if (!p.ecountName) p.ecountName = String(p.name || "");
    p.status = firstToken(p.status, "판매중");
    p.supplyType = firstToken(p.supplyType, "");
    p.orderDept = firstToken(p.orderDept, "");
    p.warehouseGroup = firstToken(p.warehouseGroup, "");
    p.itemType = firstToken(p.itemType, "");
    db.productOptions.status.push(String(p.status || "").trim());
    db.productOptions.deliveryVendors.push(...toTagList(p.deliveryVendors));
    db.productOptions.orderDept.push(String(p.orderDept || "").trim());
    db.productOptions.orderManagers.push(...toTagList(p.orderManagers));
    db.productOptions.supplyType.push(String(p.supplyType || "").trim());
    db.productOptions.warehouseGroup.push(String(p.warehouseGroup || "").trim());
    db.productOptions.itemType.push(String(p.itemType || "").trim());
    db.productOptions.categories.push(...toTagList(p.categories));
  }
  for (const k of PRODUCT_OPTION_KEYS) {
    db.productOptions[k] = normalizeOptionValues(db.productOptions[k]);
  }
  for (const m of db.movements) {
    if (!m.warehouse) m.warehouse = "툴스피아";
  }
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function toTagList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeOptionValues(value) {
  const base = Array.isArray(value) ? value : toTagList(value);
  const flat = [];
  for (const v of base) flat.push(...toTagList(v));
  return Array.from(new Set(flat.map((x) => String(x || "").trim()).filter(Boolean)));
}

function firstToken(value, fallback = "") {
  return toTagList(value)[0] || fallback;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "application/javascript; charset=utf-8"
            : "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function upsertProduct(db, product) {
  const ecountCode = String(product.ecountCode || product.code || "").trim();
  const code = String(product.code || ecountCode).trim();
  if (!code) throw new Error("상품코드는 필수입니다.");
  const name = String(product.name || product.ecountName || "").trim();
  if (!name) throw new Error("상품명은 필수입니다.");
  const found = db.products.find((p) => p.code === code || String(p.ecountCode || "").trim() === ecountCode);
  const deliveryVendors = toTagList(product.deliveryVendors);
  const orderManagers = toTagList(product.orderManagers);
  const categories = toTagList(product.categories || product.category);
  const usedWarehouses = toTagList(product.usedWarehouses).filter((w) => db.warehouses.includes(w));
  const updated = {
    name,
    ecountCode,
    ecountName: String(product.ecountName || name),
    barcode: String(product.barcode || ""),
    logisticsBarcode: String(product.logisticsBarcode || ""),
    status: firstToken(product.status, "판매중"),
    deliveryVendors,
    deliveryVendorCode: String(product.deliveryVendorCode || ""),
    deliveryItemName: String(product.deliveryItemName || ""),
    spec: String(product.spec || ""),
    purchaseVendor: String(product.purchaseVendor || ""),
    supplyType: firstToken(product.supplyType, ""),
    orderDept: firstToken(product.orderDept, ""),
    orderManagers,
    purchaseItemCode: String(product.purchaseItemCode || ""),
    purchaseItemName: String(product.purchaseItemName || ""),
    warehouseGroup: firstToken(product.warehouseGroup, ""),
    usedWarehouses,
    itemType: firstToken(product.itemType, ""),
    categories,
    // Backward compatibility for existing stock screens.
    category: categories.join(", "),
    salesVendor: deliveryVendors.join(", "),
    unit: String(product.unit || "EA"),
    safetyStock: Number(product.safetyStock || 0),
    optimalStock: Number(product.optimalStock || 0),
    note: String(product.note || "")
  };
  if (found) {
    // Keep legacy internal code to avoid breaking existing movement history references.
    updated.code = found.code;
    Object.assign(found, updated);
    found.updatedAt = new Date().toISOString();
  } else {
    db.products.push({
      code,
      ...updated,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }
}

function calculateStock(db, warehouseFilter) {
  const items = [];
  const warehouses = warehouseFilter ? [warehouseFilter] : db.warehouses;
  for (const w of warehouses) {
    const stockMap = {};
    for (const p of db.products) stockMap[p.code] = 0;
    for (const m of db.movements) {
      const qty = Number(m.qty || 0);
      if (m.type === "TRANSFER") {
        if (m.warehouse === w) stockMap[m.productCode] = (stockMap[m.productCode] || 0) - Math.abs(qty);
        if (m.toWarehouse === w) stockMap[m.productCode] = (stockMap[m.productCode] || 0) + Math.abs(qty);
        continue;
      }
      if (m.warehouse !== w) continue;
      stockMap[m.productCode] = (stockMap[m.productCode] || 0) + qty;
    }
    for (const p of db.products) {
      items.push({
        ...p,
        warehouse: w,
        stock: stockMap[p.code] || 0
      });
    }
  }
  return items;
}

function addMovement(db, row) {
  const type = row.type;
  if (!["IN", "OUT", "ADJUST", "TRANSFER"].includes(type)) {
    throw new Error("유효하지 않은 구분입니다.");
  }
  const productCode = String(row.productCode || "").trim();
  const qtyRaw = Number(row.qty);
  const warehouse = String(row.warehouse || "").trim();
  const toWarehouse = String(row.toWarehouse || "").trim();
  if (!productCode) throw new Error("상품코드는 필수입니다.");
  if (!Number.isFinite(qtyRaw) || qtyRaw === 0) {
    throw new Error("수량은 0이 아닌 숫자여야 합니다.");
  }
  if (!warehouse) throw new Error("창고는 필수입니다.");
  if (!db.warehouses.includes(warehouse)) throw new Error(`등록되지 않은 창고: ${warehouse}`);
  if (type === "TRANSFER") {
    if (!toWarehouse) throw new Error("이동 대상 창고는 필수입니다.");
    if (!db.warehouses.includes(toWarehouse)) throw new Error(`등록되지 않은 창고: ${toWarehouse}`);
    if (warehouse === toWarehouse) throw new Error("출발/도착 창고가 동일합니다.");
  }
  const product = db.products.find((p) => p.code === productCode);
  if (!product) {
    throw new Error(`등록되지 않은 상품코드: ${productCode}`);
  }
  const usedWarehouses = toTagList(product.usedWarehouses);
  if (usedWarehouses.length) {
    if (!usedWarehouses.includes(warehouse)) {
      throw new Error(`해당 상품은 지정된 사용창고에서만 처리할 수 있습니다: ${usedWarehouses.join(", ")}`);
    }
    if (type === "TRANSFER" && !usedWarehouses.includes(toWarehouse)) {
      throw new Error(`이동 대상 창고가 사용창고에 없습니다: ${usedWarehouses.join(", ")}`);
    }
  }
  const user = String(row.user || "").trim();
  if (!user) throw new Error("담당자는 필수입니다.");
  if (!db.managers.includes(user)) {
    throw new Error(`등록되지 않은 담당자입니다: ${user}`);
  }
  const qty = type === "OUT" ? -Math.abs(qtyRaw) : type === "TRANSFER" ? Math.abs(qtyRaw) : qtyRaw;
  const stockItems = calculateStock(db, warehouse).filter((x) => x.code === productCode);
  const current = stockItems.length ? Number(stockItems[0].stock || 0) : 0;
  if (type === "OUT" && current + qty < 0) {
    throw new Error(`출고 불가(재고 부족): ${productCode}, 현재고 ${current}`);
  }
  if (type === "TRANSFER" && current - Math.abs(qty) < 0) {
    throw new Error(`이동 불가(재고 부족): ${productCode}, 현재고 ${current}`);
  }

  db.movements.push({
    id: db.seq++,
    type,
    productCode,
    qty,
    warehouse,
    toWarehouse: type === "TRANSFER" ? toWarehouse : "",
    partner: String(row.partner || ""),
    memo: String(row.memo || ""),
    user,
    cancelled: false,
    createdAt: row.createdAt || new Date().toISOString()
  });
}

function cancelMovement(db, id, user) {
  const target = db.movements.find((m) => Number(m.id) === Number(id));
  if (!target) throw new Error("취소할 이력이 없습니다.");
  if (target.cancelled) throw new Error("이미 취소된 이력입니다.");
  if (!db.managers.includes(user)) throw new Error("취소 담당자는 등록된 담당자여야 합니다.");
  target.cancelled = true;
  target.cancelledAt = new Date().toISOString();
  target.cancelledBy = user;

  db.movements.push({
    id: db.seq++,
    type: "CANCEL",
    productCode: target.productCode,
    qty: -Number(target.qty || 0),
    warehouse: target.warehouse || "툴스피아",
    toWarehouse: target.toWarehouse || "",
    partner: target.partner,
    memo: `원거래 ${target.id} 취소`,
    user,
    cancelled: false,
    originId: target.id,
    originType: target.type,
    createdAt: new Date().toISOString()
  });
}

function computeStockAfterEachMovement(db) {
  const stockMap = {};
  for (const w of db.warehouses) {
    stockMap[w] = {};
    for (const p of db.products) stockMap[w][p.code] = 0;
  }
  const sorted = [...db.movements].sort((a, b) => {
    const da = new Date(a.createdAt || 0).getTime();
    const dbt = new Date(b.createdAt || 0).getTime();
    if (da !== dbt) return da - dbt;
    return Number(a.id || 0) - Number(b.id || 0);
  });
  const afterMap = {};
  for (const m of sorted) {
    const from = m.warehouse || "툴스피아";
    if (!stockMap[from]) stockMap[from] = {};
    if (!(m.productCode in stockMap[from])) stockMap[from][m.productCode] = 0;
    if (m.type === "TRANSFER") {
      const to = m.toWarehouse || "";
      stockMap[from][m.productCode] -= Math.abs(Number(m.qty || 0));
      if (to) {
        if (!stockMap[to]) stockMap[to] = {};
        if (!(m.productCode in stockMap[to])) stockMap[to][m.productCode] = 0;
        stockMap[to][m.productCode] += Math.abs(Number(m.qty || 0));
      }
      afterMap[m.id] = stockMap[from][m.productCode];
    } else {
      stockMap[from][m.productCode] += Number(m.qty || 0);
      afterMap[m.id] = stockMap[from][m.productCode];
    }
  }
  return afterMap;
}

async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  const db = readDb();
  normalizeDb(db);

  if (req.method === "GET" && pathname === "/api/products") {
    return sendJson(res, 200, { items: db.products });
  }

  if (req.method === "GET" && pathname === "/api/product-options") {
    return sendJson(res, 200, { items: db.productOptions });
  }

  if (req.method === "GET" && pathname === "/api/warehouses") {
    return sendJson(res, 200, { items: db.warehouses });
  }

  if (req.method === "POST" && pathname === "/api/warehouses") {
    try {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      if (!name) throw new Error("창고명은 필수입니다.");
      if (!db.warehouses.includes(name)) db.warehouses.push(name);
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.warehouses });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "DELETE" && pathname === "/api/warehouses") {
    try {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      const approver = String(body.approver || "").trim();
      if (!name) throw new Error("창고명은 필수입니다.");
      if (!approver) throw new Error("담당자명 인증이 필요합니다.");
      if (approver !== "박유정") throw new Error("창고 삭제 권한은 박유정에게만 있습니다.");
      if (!db.managers.includes(approver)) throw new Error("등록된 담당자만 삭제할 수 있습니다.");
      if (name === "툴스피아") throw new Error("기본 창고(툴스피아)는 삭제할 수 없습니다.");
      const stocks = calculateStock(db, name);
      const hasRemaining = stocks.some((s) => Number(s.stock || 0) !== 0);
      if (hasRemaining) {
        throw new Error("해당 창고에 잔여 재고가 있습니다. 모두 이동/조정 후 삭제하세요.");
      }
      db.warehouses = db.warehouses.filter((w) => w !== name);
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.warehouses });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "PUT" && pathname === "/api/warehouses") {
    try {
      const body = await parseBody(req);
      const oldName = String(body.oldName || "").trim();
      const newName = String(body.newName || "").trim();
      if (!oldName || !newName) throw new Error("기존명/변경명은 필수입니다.");
      if (!db.warehouses.includes(oldName)) throw new Error("기존 창고를 찾을 수 없습니다.");
      if (db.warehouses.includes(newName)) throw new Error("이미 존재하는 창고명입니다.");

      db.warehouses = db.warehouses.map((w) => (w === oldName ? newName : w));
      for (const m of db.movements) {
        if (m.warehouse === oldName) m.warehouse = newName;
        if (m.toWarehouse === oldName) m.toWarehouse = newName;
      }
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.warehouses });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/products") {
    try {
      const body = await parseBody(req);
      upsertProduct(db, body);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/products/bulk") {
    try {
      const body = await parseBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      for (const r of rows) upsertProduct(db, r);
      writeDb(db);
      return sendJson(res, 200, { ok: true, count: rows.length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "DELETE" && pathname === "/api/products") {
    try {
      const body = await parseBody(req);
      const codes = Array.isArray(body.codes) ? body.codes.map((x) => String(x || "").trim()).filter(Boolean) : [];
      if (!codes.length) throw new Error("삭제할 상품코드를 선택하세요.");
      db.products = db.products.filter((p) => !codes.includes(String(p.code)));
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/product-options") {
    try {
      const body = await parseBody(req);
      const field = String(body.field || "").trim();
      if (!PRODUCT_OPTION_KEYS.includes(field)) throw new Error("유효하지 않은 옵션 항목입니다.");
      const values = normalizeOptionValues(body.values || body.value);
      const replace = Boolean(body.replace);
      db.productOptions[field] = replace
        ? values
        : normalizeOptionValues([...(db.productOptions[field] || []), ...values]);
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.productOptions });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/partners") {
    return sendJson(res, 200, { items: db.partners });
  }

  if (req.method === "POST" && pathname === "/api/partners") {
    try {
      const body = await parseBody(req);
      const type = String(body.type || "").trim();
      const name = String(body.name || "").trim();
      if (!["inbound", "outbound", "purchase"].includes(type)) {
        throw new Error("유효하지 않은 거래처 구분입니다.");
      }
      if (!name) throw new Error("거래처명은 필수입니다.");
      if (!db.partners[type].includes(name)) db.partners[type].push(name);
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.partners[type] });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "DELETE" && pathname === "/api/partners") {
    try {
      const body = await parseBody(req);
      const type = String(body.type || "").trim();
      const name = String(body.name || "").trim();
      if (!["inbound", "outbound", "purchase"].includes(type)) {
        throw new Error("유효하지 않은 거래처 구분입니다.");
      }
      if (!name) throw new Error("거래처명은 필수입니다.");
      db.partners[type] = db.partners[type].filter((x) => x !== name);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/managers") {
    return sendJson(res, 200, { items: db.managers });
  }

  if (req.method === "POST" && pathname === "/api/managers") {
    try {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      if (!name) throw new Error("담당자명은 필수입니다.");
      if (!db.managers.includes(name)) db.managers.push(name);
      writeDb(db);
      return sendJson(res, 200, { ok: true, items: db.managers });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "DELETE" && pathname === "/api/managers") {
    try {
      const body = await parseBody(req);
      const name = String(body.name || "").trim();
      if (!name) throw new Error("담당자명은 필수입니다.");
      db.managers = db.managers.filter((x) => x !== name);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/stock") {
    const warehouse = String(urlObj.searchParams.get("warehouse") || "").trim();
    return sendJson(res, 200, {
      items: calculateStock(db, warehouse || undefined),
      warehouse: warehouse || ""
    });
  }

  if (req.method === "POST" && pathname === "/api/movements") {
    try {
      const body = await parseBody(req);
      addMovement(db, body);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/movements/bulk") {
    try {
      const body = await parseBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      for (const r of rows) addMovement(db, r);
      writeDb(db);
      return sendJson(res, 200, { ok: true, count: rows.length });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "POST" && pathname === "/api/movements/cancel") {
    try {
      const body = await parseBody(req);
      const id = Number(body.id);
      const user = String(body.user || "").trim();
      if (!Number.isFinite(id)) throw new Error("유효하지 않은 이력 ID입니다.");
      cancelMovement(db, id, user);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/history") {
    const q = String(urlObj.searchParams.get("q") || "").toLowerCase();
    const stockAfter = computeStockAfterEachMovement(db);
    const joined = db.movements
      .map((m) => {
        const p = db.products.find((x) => x.code === m.productCode);
        return {
          ...m,
          productName: p ? p.name : "",
          ecountCode: p ? p.ecountCode || "" : "",
          stockAfter: stockAfter[m.id] ?? 0
        };
      })
      .filter((x) => {
        if (!q) return true;
        return (
          String(x.productCode).toLowerCase().includes(q) ||
          String(x.productName).toLowerCase().includes(q) ||
          String(x.ecountCode || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return sendJson(res, 200, { items: joined });
  }

  if (req.method === "GET" && pathname === "/api/recent") {
    const type = String(urlObj.searchParams.get("type") || "").trim();
    const limit = Math.max(1, Number(urlObj.searchParams.get("limit") || 5));
    if (!["IN", "OUT"].includes(type)) {
      return sendJson(res, 400, { error: "유효하지 않은 조회 타입입니다." });
    }
    const stockAfter = computeStockAfterEachMovement(db);
    const items = db.movements
      .filter((m) => m.type === type && !m.cancelled)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit)
      .map((m) => {
        const p = db.products.find((x) => x.code === m.productCode);
        return {
          ...m,
          productName: p ? p.name : "",
          ecountCode: p ? p.ecountCode || "" : "",
          stockAfter: stockAfter[m.id] ?? 0
        };
      });
    return sendJson(res, 200, { items });
  }

  if (req.method === "GET" && pathname === "/api/dashboard") {
    const stockItems = calculateStock(db);
    const lowStock = stockItems.filter((x) => x.stock <= x.safetyStock).length;
    const totalProducts = db.products.length;
    const today = new Date().toISOString().slice(0, 10);
    const todayMoves = db.movements.filter((m) => (m.createdAt || "").startsWith(today)).length;
    return sendJson(res, 200, {
      totalProducts,
      lowStock,
      todayMoves
    });
  }

  return sendJson(res, 404, { error: "Not found" });
}

ensureDb();

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  if (urlObj.pathname.startsWith("/api/")) {
    return handleApi(req, res, urlObj);
  }
  return serveStatic(req, res, urlObj.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`WMS: http://localhost:${PORT}`);
  if (HOST === "0.0.0.0") console.log("Internal share enabled: http://<this-pc-ip>:" + PORT);
});
