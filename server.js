const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const XLSX = require("xlsx");

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
      seq: 1,
      inboundPlanUpload: { lines: [], sourceFileName: "", uploadedAt: "" }
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
    p.middleBarcode = String(p.middleBarcode || "");
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
  if (!db.inboundPlanUpload || typeof db.inboundPlanUpload !== "object") {
    db.inboundPlanUpload = { lines: [], sourceFileName: "", uploadedAt: "" };
  }
  if (!Array.isArray(db.inboundPlanUpload.lines)) db.inboundPlanUpload.lines = [];
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
    middleBarcode: String(product.middleBarcode || ""),
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

let ecountSessionCache = { value: "", expiresAt: 0 };
let ecountZoneCache = { zone: "", domain: "", expiresAt: 0 };
let ecountApiBaseCache = { value: "", expiresAt: 0 };

function normalizeDateCompact(ymd) {
  const raw = String(ymd || "").trim();
  const onlyDigits = raw.replace(/[^\d]/g, "");
  if (onlyDigits.length !== 8) return "";
  return onlyDigits;
}

function compactToUtcDate(yyyymmdd) {
  const s = normalizeDateCompact(yyyymmdd);
  if (!s) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function utcDateToCompact(dt) {
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function clampDateRangeToMax30Days(fromCompact, toCompact) {
  let fromDate = compactToUtcDate(fromCompact);
  let toDate = compactToUtcDate(toCompact);
  if (!fromDate || !toDate) return { fromCompact, toCompact, adjusted: false };
  // If user selects reversed dates, normalize order.
  if (fromDate.getTime() > toDate.getTime()) {
    const tmp = fromDate;
    fromDate = toDate;
    toDate = tmp;
  }
  const normalizedFrom = utcDateToCompact(fromDate);
  const normalizedTo = utcDateToCompact(toDate);
  const diffDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86400000) + 1; // inclusive
  if (diffDays <= 30) return { fromCompact: normalizedFrom, toCompact: normalizedTo, adjusted: false };
  const adjustedFrom = new Date(toDate.getTime() - 29 * 86400000); // inclusive 30 days
  return { fromCompact: utcDateToCompact(adjustedFrom), toCompact: normalizedTo, adjusted: true };
}

function extractSessionId(payload) {
  if (!payload || typeof payload !== "object") return "";
  const direct =
    payload.SESSION_ID ||
    payload.session_id ||
    payload.sessionId ||
    (payload.Data && (payload.Data.SESSION_ID || payload.Data.session_id || payload.Data.sessionId));
  if (direct) return String(direct);

  // Fallback: recursive search for possible session fields.
  const stack = [payload];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (v && typeof v === "object") stack.push(v);
      if (/session[_-]?id/i.test(String(k)) && v) return String(v);
    }
  }
  return "";
}

async function fetchEcountSession() {
  const now = Date.now();
  if (ecountSessionCache.value && ecountSessionCache.expiresAt > now + 10_000) {
    return ecountSessionCache.value;
  }

  const comCode = String(process.env.ECOUNT_COM_CODE || "").trim();
  const userId = String(process.env.ECOUNT_USER_ID || "").trim();
  const userPw = String(process.env.ECOUNT_USER_PW || "").trim();
  const apiKey = String(process.env.ECOUNT_API_KEY || "").trim();
  const lang = String(process.env.ECOUNT_LANG || "ko-KR").trim();
  const zoneInfo = await fetchEcountZone(comCode);

  if (!comCode || !userId || !userPw || !apiKey) {
    throw new Error(
      "ECOUNT_COM_CODE/ECOUNT_USER_ID/ECOUNT_USER_PW/ECOUNT_API_KEY 설정이 필요합니다."
    );
  }

  const loginBodies = Array.from(
    new Set([String(comCode || "").trim(), String(comCode || "").trim().padStart(6, "0")].filter(Boolean))
  ).map((cc) => ({
    COM_CODE: cc,
    USER_ID: userId,
    USER_PW: userPw,
    API_CERT_KEY: apiKey,
    LAN_TYPE: lang,
    ZONE: String(zoneInfo?.zone || "").trim(),
    DOMAIN: String(zoneInfo?.domain || "").trim()
  }));
  const loginCandidates = [];
  const forcedLoginUrl = String(process.env.ECOUNT_LOGIN_URL || "").trim();
  if (forcedLoginUrl) loginCandidates.push(forcedLoginUrl);
  for (const origin of buildEcountApiOrigins(zoneInfo)) {
    loginCandidates.push(`${origin}/OAPI/V2/OAPILogin`);
  }

  let sessionId = "";
  let lastErr = "";
  for (const loginUrl of Array.from(new Set(loginCandidates))) {
    for (const loginBody of loginBodies) {
      try {
        const resp = await fetch(loginUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(loginBody)
        });
        const txt = await resp.text();
        if (!resp.ok) {
          lastErr = `${loginUrl} [COM_CODE=${loginBody.COM_CODE}] -> (${resp.status}) ${txt.slice(0, 300)}`;
          continue;
        }
        let data = {};
        try {
          data = JSON.parse(txt || "{}");
        } catch (_) {
          data = {};
        }
        sessionId = extractSessionId(data);
        if (!sessionId) {
          lastErr = `${loginUrl} [COM_CODE=${loginBody.COM_CODE}] -> SESSION_ID not found: ${txt.slice(0, 300)}`;
          continue;
        }
        // Keep the successful API origin for subsequent calls.
        const origin = new URL(loginUrl).origin;
        ecountApiBaseCache = { value: origin, expiresAt: now + 20 * 60 * 1000 };
        break;
      } catch (err) {
        lastErr = `${loginUrl} [COM_CODE=${loginBody.COM_CODE}] -> network error: ${err?.message || String(err)}`;
        continue;
      }
    }
    if (sessionId) break;
  }
  if (!sessionId) {
    throw new Error(`이카운트 로그인 실패: ${lastErr || "응답 확인 필요"}`);
  }

  // Default cache 20 minutes (session ttl unknown); refresh early.
  ecountSessionCache = {
    value: sessionId,
    expiresAt: now + 20 * 60 * 1000
  };
  return sessionId;
}

function buildEcountApiOrigins(zoneInfo) {
  const list = [];
  const forcedBase = String(process.env.ECOUNT_API_BASE_URL || "").trim();
  if (forcedBase) {
    try {
      list.push(new URL(forcedBase).origin);
    } catch (_) {
      list.push(`https://${forcedBase.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`);
    }
  }
  const domain = String(zoneInfo?.domain || "").trim();
  if (domain) {
    const cleaned = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    list.push(`https://${cleaned}`);
  }
  const zone = String(zoneInfo?.zone || "").trim();
  if (zone) {
    list.push(`https://oapi${zone}.ecount.com`);
    list.push(`https://sboapi${zone}.ecount.com`);
  }
  return Array.from(new Set(list));
}

async function fetchEcountApiBase(comCode) {
  const now = Date.now();
  if (ecountApiBaseCache.value && ecountApiBaseCache.expiresAt > now + 10_000) {
    return ecountApiBaseCache.value;
  }
  const zoneInfo = await fetchEcountZone(comCode);
  const origins = buildEcountApiOrigins(zoneInfo);
  if (!origins.length) throw new Error("이카운트 API 베이스 URL을 구성하지 못했습니다.");
  ecountApiBaseCache = { value: origins[0], expiresAt: now + 20 * 60 * 1000 };
  return ecountApiBaseCache.value;
}

async function fetchEcountZone(comCode) {
  const forced = String(process.env.ECOUNT_ZONE || "").trim();
  const forcedDomain = String(process.env.ECOUNT_DOMAIN || "").trim();
  if (forced) return { zone: forced, domain: forcedDomain };

  const now = Date.now();
  if (ecountZoneCache.zone && ecountZoneCache.expiresAt > now + 60_000) {
    return { zone: ecountZoneCache.zone, domain: ecountZoneCache.domain };
  }
  if (!comCode) throw new Error("ECOUNT_COM_CODE가 필요합니다.");

  const zoneUrl = "https://oapi.ecount.com/OAPI/V2/Zone";
  const comCandidates = Array.from(
    new Set([String(comCode || "").trim(), String(comCode || "").trim().padStart(6, "0")].filter(Boolean))
  );

  let zone = "";
  let domain = "";
  let lastErrText = "";
  for (const candidate of comCandidates) {
    try {
      const resp = await fetch(zoneUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ COM_CODE: candidate })
      });
      const bodyText = await resp.text();
      if (!resp.ok) {
        lastErrText = `COM_CODE=${candidate} -> (${resp.status}) ${bodyText.slice(0, 300)}`;
        continue;
      }
      let data = {};
      try {
        data = JSON.parse(bodyText || "{}");
      } catch (_) {
        data = {};
      }
      zone = String(
        pickFirst(data, ["ZONE"]) || pickFirst(data?.Data, ["ZONE"]) || pickFirst(data?.Result, ["ZONE"]) || ""
      ).trim();
      domain = String(
        pickFirst(data, ["DOMAIN"]) || pickFirst(data?.Data, ["DOMAIN"]) || pickFirst(data?.Result, ["DOMAIN"]) || ""
      ).trim();
      if (zone) break;
      lastErrText = `COM_CODE=${candidate} -> ZONE not found: ${bodyText.slice(0, 300)}`;
    } catch (err) {
      lastErrText = `COM_CODE=${candidate} -> network error: ${err?.message || String(err)}`;
      continue;
    }
  }

  if (!zone) {
    throw new Error(
      `Zone API 조회 실패. 회사코드(원본:${comCode}, 6자리:${String(comCode || "").trim().padStart(6, "0")})를 확인해주세요. 응답: ${String(
        lastErrText || ""
      ).slice(0, 300)}`
    );
  }

  // Cache for one day; Zone rarely changes.
  ecountZoneCache = { zone, domain, expiresAt: now + 24 * 60 * 60 * 1000 };
  return { zone, domain };
}

function pickFirst(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return "";
}

function pickFirstNonEmpty(obj, keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function pickFirstByKeyPattern(obj, patternFn) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of Object.keys(obj)) {
    if (!patternFn(k)) continue;
    const v = obj[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function pickPurchaseRequestNo(obj) {
  const ordNo = String(pickFirstNonEmpty(obj, ["ORD_NO"]) || "").trim();
  if (ordNo) return ordNo;

  const ioNo = String(pickFirstNonEmpty(obj, ["IO_NO"]) || "").trim();
  if (ioNo) return ioNo;

  // Keep purchase-request style keys as a conservative fallback only.
  return String(
    pickFirstNonEmpty(obj, [
      "PR_NO",
      "REQ_NO",
      "PUR_REQ_NO",
      "REQUEST_NO",
      "PURCHASE_REQ_NO",
      "REQNUM",
      "REQ_NUM",
      "REQNO",
      "PRNUM",
      "PR_NUM",
      "PURCHASE_REQUEST_NO",
      "구매요청번호"
    ]) || ""
  ).trim();
}

function formatOrderNoByDateAndSeq(orderNo, orderDate, fallbackDateCompact = "") {
  const no = String(orderNo || "").trim();
  const dt = String(orderDate || "").trim();
  if (!no) return no;

  // Already complete format like 26/04/20-1
  if (/^\d{2}\/\d{2}\/\d{2}-\d+$/.test(no)) return no;

  // If numeric-like suffix is present (e.g. "1", "1.0000000000"), rebuild with order date.
  const seqMatch = no.match(/(\d+)(?:\.0+)?$/);
  if (!seqMatch) return no;
  const seq = String(seqMatch[1] || "").trim();
  if (!seq) return no;
  const compact = normalizeDateCompact(dt) || String(fallbackDateCompact || "").trim();
  if (!compact || compact.length !== 8) return no;
  const yy = compact.slice(2, 4);
  const mm = compact.slice(4, 6);
  const dd = compact.slice(6, 8);
  return `${yy}/${mm}/${dd}-${seq}`;
}

function buildInboundPlanDetail(raw) {
  const x = raw && typeof raw === "object" ? raw : {};
  const entries = [
    ["전표번호", pickFirstNonEmpty(x, ["ORD_NO", "IO_NO"])],
    ["발주일자", pickFirstNonEmpty(x, ["ORD_DATE", "IO_DATE"])],
    ["납기일자", pickFirstNonEmpty(x, ["TIME_DATE"])],
    ["거래처코드", pickFirstNonEmpty(x, ["CUST"])],
    ["거래처명", pickFirstNonEmpty(x, ["CUST_DES"])],
    ["담당자", pickFirstNonEmpty(x, ["CUST_NAME", "EMP_CD", "WRITER_ID", "LOGID"])],
    ["품목명", pickFirstNonEmpty(x, ["PROD_DES", "ITEM_DES", "ITEM_NAME"])],
    ["수량", pickFirstNonEmpty(x, ["QTY", "ORDER_QTY", "PUR_QTY"])],
    ["창고코드", pickFirstNonEmpty(x, ["WH_CD"])],
    ["창고명", pickFirstNonEmpty(x, ["WH_DES"])],
    ["비고", pickFirstNonEmpty(x, ["REF_DES"])],
    ["상태코드", pickFirstNonEmpty(x, ["P_FLAG"])],
    ["전송상태", pickFirstNonEmpty(x, ["SEND_FLAG"])]
  ];
  for (let i = 1; i <= 6; i += 1) {
    entries.push([`보조항목${i}`, pickFirstNonEmpty(x, [`P_DES${i}`])]);
  }
  return entries
    .map(([label, value]) => ({ label, value: String(value || "").trim() }))
    .filter((row) => row.value);
}

/** 발주서조회API Result 한 행 → WMS 입고예정목록 행 (이카운트 필드명은 주석/문서와 동일 계열). */
function normalizeInboundPlanRows(rawRows, fallbackDateCompact = "") {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  return rows
    .map((x) => {
      const poNo = String(pickPurchaseRequestNo(x));
      const poDate = String(
        pickFirstNonEmpty(x, ["ORD_DATE", "PO_DATE", "PODATE", "ORDER_DATE", "DATE", "WRITE_DATE", "IO_DATE"])
      );
      // 거래처는 CUST_DES(거래처명)를 최우선으로 사용.
      const vendor = String(
        pickFirstNonEmpty(x, ["CUST_DES", "CUST_NM", "VENDOR_NM", "VENDOR_NAME", "CLIENT_NAME", "CUST"])
      );
      const manager = String(pickFirstNonEmpty(x, ["CUST_NAME", "EMP_CD", "WRITER_ID", "LOGID", "MANAGER", "MANAGER_NM"]));
      const itemCode = String(
        pickFirstNonEmpty(x, ["PROD_CD", "ITEM_CD", "ITEM_CODE", "GOODS_CD", "PRODUCT_CODE", "ITEM_NO", "품목코드"])
      );
      const itemName = String(
        pickFirstNonEmpty(x, [
          "PROD_DES",
          "ITEM_NM",
          "ITEM_NAME",
          "GOODS_NM",
          "PRODUCT_NAME",
          "ITEM_DES",
          "품목명",
          "DES",
          "REMARK"
        ])
      );
      const spec = String(pickFirstNonEmpty(x, ["SPEC", "SIZE_DES", "ITEM_SPEC", "규격"]));
      const barcode = String(pickFirstNonEmpty(x, ["BAR_CODE", "BARCODE", "PROD_BARCODE", "ITEM_BARCODE"]));
      const boxQty = pickFirstNonEmpty(x, ["UQTY", "BOX_QTY", "QTY_BOX"]);
      const qty = pickFirstNonEmpty(x, ["QTY", "ORDER_QTY", "PUR_QTY", "PO_QTY", "STOCK_QTY", "AMT_QTY"]);
      const dueDate = String(pickFirstNonEmpty(x, ["TIME_DATE"]));
      const whName = String(pickFirstNonEmpty(x, ["WH_NM", "WAREHOUSE_NM", "WH_NAME", "WH_DES", "WAREHOUSE_NAME"]));
      const status = String(pickFirstNonEmpty(x, ["STATUS", "STAT_NM", "PROC_STATUS", "STATE", "PROGRESS"]));
      const remark = String(pickFirstNonEmpty(x, ["REF_DES", "REMARK", "NOTE", "DESC"]));
      const note = String(pickFirstNonEmpty(x, ["MEMO", "BIGO", "NOTE2"]));
      const currency = String(pickFirstNonEmpty(x, ["CODE_DES", "EXCHANGE_TYPE", "FOREIGN_FLAG"]));
      const displayPoNo = formatOrderNoByDateAndSeq(poNo, poDate, fallbackDateCompact);
      const detail = buildInboundPlanDetail(x);
      return {
        poNo: displayPoNo,
        poDate,
        vendor,
        manager,
        itemCode,
        itemName,
        spec,
        barcode,
        boxQty,
        qty,
        dueDate,
        whName,
        status,
        remark,
        note,
        currency,
        detail
      };
    });
}

function normalizeSlipNoText(v) {
  return String(v || "").trim().replace(/\s+/g, "");
}

/** 이카운트 발주서현황 엑셀의 「일자-No.」에서 날짜 부분 → YYYY-MM-DD */
function slipDateFromEcountSlipCell(slipRaw) {
  const s = String(slipRaw || "").trim();
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (!m) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function splitItemNameSpecFromEcountCell(raw) {
  const s = String(raw || "").trim();
  const m = s.match(/^(.+?)\s*\[([^\]]*)\]\s*$/);
  if (m) return { itemName: m[1].trim(), spec: m[2].trim() };
  return { itemName: s, spec: "" };
}

function numOrEmpty(v) {
  if (v === "" || v === null || v === undefined) return "";
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : "";
}

/**
 * 이카운트 「발주서현황」 내보내기 시트(1행 제목·2행 헤더) → 라인 객체 배열
 * @param {unknown[][]} matrix sheet_to_json(..., { header:1 }) 결과
 */
function parseInboundPlanUploadMatrix(matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  let headerRow = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const r = rows[i] || [];
    const c0 = String(r[0] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const c1 = String(r[1] ?? "").trim();
    const headLike =
      (c0.includes("일자") && c1 === "품목코드") ||
      c0 === "일자-No." ||
      /^일자[-–]\s*No\.?$/i.test(c0);
    if (headLike && (c1 === "품목코드" || c1.includes("품목코드"))) {
      headerRow = i;
      break;
    }
  }
  if (headerRow < 0) {
    throw new Error("발주서현황 양식을 찾지 못했습니다. 1행 제목·2행에 「일자-No.」「품목코드」 헤더가 있는지 확인하세요.");
  }
  const H = (rows[headerRow] || []).map((c) => String(c ?? "").trim());
  const col = (...labels) => {
    for (const lb of labels) {
      const j = H.indexOf(lb);
      if (j >= 0) return j;
    }
    return -1;
  };
  const iSlip = col("일자-No.");
  const iCode = col("품목코드");
  const iBc = col("바코드");
  const iWh = col("창고명");
  const iName = col("품목명[규격]");
  const iQty = col("수량");
  const iMgr = col("담당자");
  const iVc = col("거래처코드");
  const iVn = col("거래처");
  const iDue = col("납기일자");
  const iPrice = col("단가");
  const iAmt = col("공급가액");
  const iRef = col("적요");
  const iNote = col("비고");
  if (iSlip < 0 || iCode < 0) {
    throw new Error("필수 열(일자-No., 품목코드)을 찾지 못했습니다.");
  }
  const lines = [];
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const slipRaw = String(row[iSlip] ?? "").trim();
    const itemCode = String(row[iCode] ?? "").trim();
    if (!slipRaw && !itemCode) continue;
    if (!slipRaw || !itemCode) continue;
    const { itemName, spec } = splitItemNameSpecFromEcountCell(iName >= 0 ? row[iName] : "");
    const poDate = slipDateFromEcountSlipCell(slipRaw);
    lines.push({
      slipNo: slipRaw.replace(/\s+/g, " ").trim(),
      poDate,
      itemCode,
      barcode: iBc >= 0 ? String(row[iBc] ?? "").trim() : "",
      whName: iWh >= 0 ? String(row[iWh] ?? "").trim() : "",
      itemName,
      spec,
      qty: numOrEmpty(iQty >= 0 ? row[iQty] : ""),
      manager: iMgr >= 0 ? String(row[iMgr] ?? "").trim() : "",
      vendorCode: iVc >= 0 ? String(row[iVc] ?? "").trim() : "",
      vendor: iVn >= 0 ? String(row[iVn] ?? "").trim() : "",
      dueDate: iDue >= 0 ? String(row[iDue] ?? "").trim().replace(/\s+$/, "") : "",
      unitPrice: numOrEmpty(iPrice >= 0 ? row[iPrice] : ""),
      supplyAmount: numOrEmpty(iAmt >= 0 ? row[iAmt] : ""),
      remark: iRef >= 0 ? String(row[iRef] ?? "").trim() : "",
      note: iNote >= 0 ? String(row[iNote] ?? "").trim() : ""
    });
  }
  if (!lines.length) throw new Error("데이터 행이 없습니다. 헤더 아래에 품목 행이 있는지 확인하세요.");
  return lines;
}

function aggregateInboundPlanUploadLines(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const by = new Map();
  for (const row of arr) {
    const k = normalizeSlipNoText(row.slipNo);
    if (!k) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(row);
  }
  const items = [];
  for (const [, group] of by) {
    group.sort((a, b) => String(a.itemCode).localeCompare(String(b.itemCode)));
    const first = group[0];
    const totalQty = group.reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const names = group.map((x) => x.itemName).filter(Boolean);
    const itemSummary = names.length <= 1 ? (names[0] || "") : `${names[0]} 외 ${names.length - 1}건`;
    items.push({
      poNo: first.slipNo,
      poDate: first.poDate || slipDateFromEcountSlipCell(first.slipNo),
      vendor: first.vendor || "",
      manager: first.manager || "",
      itemName: itemSummary,
      qty: totalQty,
      dueDate: first.dueDate || "",
      whName: first.whName || "",
      status: "업로드",
      lineCount: group.length
    });
  }
  items.sort((a, b) => String(a.poNo).localeCompare(String(b.poNo), "ko"));
  return items;
}

function inboundPlanUploadLinesToDetailRows(lines, slipKeyNorm) {
  const group = (Array.isArray(lines) ? lines : []).filter((x) => normalizeSlipNoText(x.slipNo) === slipKeyNorm);
  return group.map((x) => ({
    poNo: x.slipNo,
    poDate: x.poDate,
    vendor: x.vendor,
    manager: x.manager,
    itemCode: x.itemCode,
    itemName: x.itemName,
    spec: x.spec,
    barcode: x.barcode,
    boxQty: "",
    qty: x.qty,
    dueDate: x.dueDate,
    whName: x.whName,
    status: "",
    remark: x.remark,
    note: x.note,
    currency: "",
    unitPrice: x.unitPrice,
    supplyAmount: x.supplyAmount,
    vendorCode: x.vendorCode,
    detail: []
  }));
}

/** ECOUNT list row may embed line items under various keys; expand for detail view. */
const NESTED_LINE_ARRAY_KEYS = [
  "Details",
  "Detail",
  "DetailList",
  "DETAIL",
  "DETAILS",
  "ItemList",
  "Items",
  "Lines",
  "LineList",
  "DTL",
  "DTL_LIST",
  "ORDER_DETAIL",
  "ORDER_DETAILS",
  "PurchasesOrderDetail",
  "ResultDetail",
  "Datas"
];

function rowLooksLikeOrderLine(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (
    pickFirstNonEmpty(obj, ["PROD_CD", "ITEM_CD", "LINE_NO", "LINE_NUM", "SER_NO", "SEQ", "LINE_SEQ"])
  ) {
    return true;
  }
  const hasName = Boolean(pickFirstNonEmpty(obj, ["PROD_DES", "ITEM_DES", "ITEM_NAME"]));
  const hasQty = Boolean(pickFirstNonEmpty(obj, ["QTY", "ORDER_QTY", "PUR_QTY", "PO_QTY"]));
  const hasOrd = Boolean(pickFirstNonEmpty(obj, ["ORD_NO", "IO_NO"]));
  return hasName && hasQty && !hasOrd;
}

function rowLooksLikeOrderHeader(obj) {
  if (!obj || typeof obj !== "object") return false;
  const hasOrd = Boolean(pickFirstNonEmpty(obj, ["ORD_NO", "IO_NO"]));
  const hasLineHint = rowLooksLikeOrderLine(obj);
  return hasOrd && !hasLineHint;
}

function extractNestedLineRowsFromOrderRow(orderRow, depth = 0) {
  if (!orderRow || typeof orderRow !== "object" || depth > 8) return [];

  for (const k of NESTED_LINE_ARRAY_KEYS) {
    const v = orderRow[k];
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object")) {
      const lineish = v.filter((x) => rowLooksLikeOrderLine(x));
      if (lineish.length >= 1) return lineish;
    }
  }

  for (const k of Object.keys(orderRow)) {
    const v = orderRow[k];
    if (!Array.isArray(v) || v.length < 1) continue;
    if (!v.every((x) => x && typeof x === "object")) continue;
    const lineish = v.filter((x) => rowLooksLikeOrderLine(x));
    if (lineish.length >= 2 || (lineish.length === 1 && !rowLooksLikeOrderHeader(lineish[0]))) {
      return lineish;
    }
  }

  for (const k of Object.keys(orderRow)) {
    const v = orderRow[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = extractNestedLineRowsFromOrderRow(v, depth + 1);
      if (found.length) return found;
    }
  }

  return [];
}

function mergeOrderHeaderWithLines(headerRaw, lineRows) {
  const lines = Array.isArray(lineRows) ? lineRows : [];
  return lines.map((line) => ({ ...headerRaw, ...line }));
}

/** For Network debug: show which keys exist on the slip header (arrays = possible line containers). */
function buildHeaderDebugSummary(headerRaw, maxKeys = 45) {
  if (!headerRaw || typeof headerRaw !== "object") return null;
  const keys = Object.keys(headerRaw).slice(0, maxKeys);
  const summary = {};
  for (const k of keys) {
    const v = headerRaw[k];
    if (v === null || v === undefined) summary[k] = "null";
    else if (Array.isArray(v)) summary[k] = `array[${v.length}]`;
    else if (typeof v === "object") summary[k] = `object{${Object.keys(v).slice(0, 8).join(",")}}`;
    else summary[k] = typeof v;
  }
  return summary;
}

function findMatchingRawOrderRow(rawRows, targetSlipNorm, seq, fallbackDateCompact) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  for (const r of rows) {
    const poNoRaw = String(pickPurchaseRequestNo(r) || "").trim();
    const poDate = String(
      pickFirstNonEmpty(r, ["ORD_DATE", "PO_DATE", "PODATE", "ORDER_DATE", "DATE", "WRITE_DATE", "IO_DATE"])
    );
    const displayPo = formatOrderNoByDateAndSeq(poNoRaw, poDate, fallbackDateCompact);
    const norm = normalizeSlipNoText(displayPo);
    if (norm && norm === targetSlipNorm) return r;
    if (seq && norm.endsWith(`-${seq}`)) return r;
  }
  return null;
}

function extractArrayFromUnknown(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const directCandidates = [
    payload.Datas,
    payload.Data,
    payload.List,
    payload.Result,
    payload.items,
    payload.Rows,
    payload.records
  ];
  for (const c of directCandidates) {
    if (Array.isArray(c)) return c;
  }
  for (const c of directCandidates) {
    if (c && typeof c === "object") {
      const nested = extractArrayFromUnknown(c);
      if (nested.length) return nested;
      // Some APIs return map-like objects instead of arrays.
      const vals = Object.values(c);
      if (vals.length && vals.every((v) => v && typeof v === "object")) return vals;
    }
  }
  return [];
}

/** 발주/구매전표 키로 상세·라인 조회 시도용 요청 바디 후보 (루트 vs ListParam). */
function buildLineLookupBodies(basePayload, slipNo, ordNoRaw, ioNoRaw) {
  const lp = basePayload.ListParam ? { ...basePayload.ListParam } : {};
  const out = [];
  const ord = String(ordNoRaw || "").trim();
  const io = String(ioNoRaw || "").trim();
  const slip = String(slipNo || "").trim();
  const add = (body) => out.push(body);

  if (ord) {
    add({ ...basePayload, ORD_NO: ord });
    add({ ...basePayload, ListParam: { ...lp, ORD_NO: ord } });
  }
  if (io) {
    add({ ...basePayload, IO_NO: io });
    add({ ...basePayload, ListParam: { ...lp, IO_NO: io } });
  }
  if (slip) {
    if (!ord) add({ ...basePayload, ORD_NO: slip });
    if (!ord) add({ ...basePayload, ListParam: { ...lp, ORD_NO: slip } });
    add({ ...basePayload, ListParam: { ...lp, DOC_NO: slip } });
    add({ ...basePayload, DOC_NO: slip });
    add({ ...basePayload, SLIP_NO: slip });
    add({ ...basePayload, ListParam: { ...lp, SLIP_NO: slip } });
  }

  const seen = new Set();
  return out.filter((b) => {
    const s = JSON.stringify(b);
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

function parseInboundLineApiPathSpecs(raw) {
  return String(raw || "")
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((spec) => {
      const t = spec.replace(/^\/+/, "");
      if (!t.includes("/")) return `Purchases/${t}`;
      return t;
    });
}

/** ECOUNT 상세/라인 JSON → normalizeInboundPlanRows와 동일 규칙으로 병합. */
function matchDetailRowsToInboundPlans(data, rangeCompact) {
  const rowsCandidate = extractArrayFromUnknown(data);
  if (!Array.isArray(rowsCandidate) || !rowsCandidate.length) return { matched: [], kind: "empty" };
  if (rowsCandidate.length > 1 && rowsCandidate.every((row) => rowLooksLikeOrderLine(row))) {
    return {
      matched: normalizeInboundPlanRows(rowsCandidate, rangeCompact),
      kind: "multi-line"
    };
  }
  const nested = extractNestedLineRowsFromOrderRow(rowsCandidate[0]);
  if (nested.length) {
    const merged = mergeOrderHeaderWithLines(rowsCandidate[0], nested);
    return {
      matched: normalizeInboundPlanRows(merged, rangeCompact),
      kind: "nested"
    };
  }
  return {
    matched: normalizeInboundPlanRows(rowsCandidate, rangeCompact),
    kind: "flat"
  };
}

function filterLikelyItemLines(matched) {
  const rows = Array.isArray(matched) ? matched : [];
  return rows.filter((x) => {
    const hasCode = String(x.itemCode || "").trim() !== "";
    const hasQty = String(x.qty || "").trim() !== "";
    const isSummaryTitle = /외\s*\d+건/.test(String(x.itemName || ""));
    return (hasCode || hasQty) && !isSummaryTitle;
  });
}

/**
 * GetPurchases 등 내장 후보 API 일괄 호출을 할지 여부.
 * 기본은 호출하지 않음(대부분 존에서 404·412·긴 지연만 발생). 다시 켜려면 ECOUNT_SKIP_BUILTIN_LINE_APIS=0
 */
function shouldSkipBuiltinLineApis() {
  const v = String(process.env.ECOUNT_SKIP_BUILTIN_LINE_APIS ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return true;
}

/** 디버그용: 같은 API 경로·HTTP상태(또는 no-item-lines)로 여러 바디를 시도한 로그를 한 줄로 합침. */
function compressEndpointErrorsForDebug(lines, maxOut = 14) {
  const arr = Array.isArray(lines) ? lines : [];
  const groups = new Map();
  for (const line of arr) {
    let sig = line;
    // Module/method paths contain slashes (e.g. Purchases/GetPurchases); use .+ not [^:]+
    const mHttp = /^(.+):\((\d+)\)/.exec(line);
    if (mHttp) sig = `${mHttp[1]}:${mHttp[2]}`;
    else {
      const idx = line.indexOf(":no-item-lines");
      if (idx > 0) sig = `${line.slice(0, idx)}:no-item-lines`;
    }
    const cur = groups.get(sig);
    if (cur) cur.count += 1;
    else groups.set(sig, { count: 1, sample: line });
  }
  const out = [];
  for (const { count, sample } of groups.values()) {
    const s = String(sample);
    const short = s.length > 200 ? `${s.slice(0, 200)}…` : s;
    out.push(count > 1 ? `${short} (같은 유형 ${count}회 시도)` : short);
  }
  return out.slice(0, maxOut);
}

async function postEcountOapiV2(apiBase, sessionId, v2Path, body) {
  const path = String(v2Path || "").replace(/^\/+/, "");
  const url = `${apiBase}/OAPI/V2/${path}?SESSION_ID=${encodeURIComponent(sessionId)}`;
  const doOnce = async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch (_) {
      data = {};
    }
    return { ok: r.ok, status: r.status, data, text };
  };
  let result = await doOnce();
  if (result.status === 412) {
    await new Promise((resolve) => setTimeout(resolve, 1600));
    result = await doOnce();
  }
  return result;
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

  /*
   * 입고예정목록 2 — 이카운트 「발주서현황」 엑셀 업로드 → data/db.json inboundPlanUpload
   */
  if (req.method === "POST" && pathname === "/api/inbound-plan-upload") {
    try {
      const body = await parseBody(req);
      const sourceFileName = String(body.sourceFileName || "").trim().slice(0, 240);
      let lines = [];
      if (Array.isArray(body.lines) && body.lines.length) {
        lines = body.lines;
      } else if (Array.isArray(body.matrix) && body.matrix.length) {
        lines = parseInboundPlanUploadMatrix(body.matrix);
      } else if (body.sheetBase64 && typeof body.sheetBase64 === "string") {
        const buf = Buffer.from(String(body.sheetBase64).trim(), "base64");
        const wb = XLSX.read(buf, { type: "buffer" });
        const name = wb.SheetNames[0];
        if (!name) throw new Error("시트가 없습니다.");
        const ws = wb.Sheets[name];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        lines = parseInboundPlanUploadMatrix(matrix);
      } else {
        throw new Error("요청에 matrix(2차원 배열), lines, 또는 sheetBase64가 필요합니다.");
      }
      if (lines.length > 20000) throw new Error("행 수가 너무 많습니다(최대 20000).");
      db.inboundPlanUpload.lines = lines;
      db.inboundPlanUpload.sourceFileName = sourceFileName || "upload.xlsx";
      db.inboundPlanUpload.uploadedAt = new Date().toISOString();
      writeDb(db);
      const items = aggregateInboundPlanUploadLines(lines);
      return sendJson(res, 200, {
        ok: true,
        lineCount: lines.length,
        slipCount: items.length,
        items,
        sourceFileName: db.inboundPlanUpload.sourceFileName,
        uploadedAt: db.inboundPlanUpload.uploadedAt
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/inbound-plan-upload") {
    const lines = db.inboundPlanUpload.lines || [];
    const items = aggregateInboundPlanUploadLines(lines);
    return sendJson(res, 200, {
      items,
      lineCount: lines.length,
      sourceFileName: db.inboundPlanUpload.sourceFileName || "",
      uploadedAt: db.inboundPlanUpload.uploadedAt || ""
    });
  }

  if (req.method === "GET" && pathname === "/api/inbound-plan-upload/detail") {
    const slipNo = String(urlObj.searchParams.get("slipNo") || "").trim();
    if (!slipNo) return sendJson(res, 400, { error: "slipNo가 필요합니다." });
    const key = normalizeSlipNoText(slipNo);
    const lines = db.inboundPlanUpload.lines || [];
    const detailLines = inboundPlanUploadLinesToDetailRows(lines, key);
    if (!detailLines.length) {
      return sendJson(res, 200, { item: null, items: [], source: "upload" });
    }
    return sendJson(res, 200, {
      item: detailLines[0],
      items: detailLines,
      source: "upload"
    });
  }

  /*
   * 입고예정목록 = 이카운트 발주서 조회(발주서조회API) 연동 요약
   * - 목록: POST {apiBase}/OAPI/V2/Purchases/GetPurchasesOrderList?SESSION_ID=...
   * - 요청(문서 기준): SESSION_ID, PROD_CD(선택), CUST_CD(선택), ListParam.BASE_DATE_FROM/TO(YYYYMMDD), PAGE_*
   * - 응답: Data.Result[] 등 (extractArrayFromUnknown) → normalizeInboundPlanRows()에서 필드 매핑
   * - 주요 Result 필드(문서/화면 기준): ORD_NO 발주번호, ORD_DATE 일자, CUST/CUST_DES 거래처,
   *   CUST_NAME 담당자, WH_CD/WH_DES 창고, TIME_DATE 납기일, PROD_DES 품목요약(전표당 1줄일 때 제목성),
   *   QTY 합계수량, TTL_CTT 제목, P_FLAG 상태 등
   * - 프론트: public/app.js renderInboundPlan → GET /api/inbound-plans, 클릭 시 /api/inbound-plans/detail
   * - 품목 라인별 상세: 목록에 라인이 없으면 구매/입고 계열 다른 OAPI 시도
   *   · ECOUNT_INBOUND_LINE_API_PATHS=Purchases/GetX,Inventory/GetY (쉼표·세미콜론, 모듈/메서드 또는 메서드만)
   *   · ECOUNT_INBOUND_DETAIL_API=API명 또는 Module/Method (기존 단일 상세 후보)
   *   · ECOUNT_SKIP_BUILTIN_LINE_APIS — 기본: 내장 후보 호출 안 함. 예전처럼 여러 URL을 자동 시도하려면 =0 (false/no/off)
   */
  if (req.method === "GET" && pathname === "/api/inbound-plans") {
    try {
      const from = String(urlObj.searchParams.get("from") || "").trim();
      const to = String(urlObj.searchParams.get("to") || "").trim();

      // 1) explicit mock mode for UI/testing without ECOUNT credentials
      if (String(process.env.ECOUNT_MOCK_MODE || "").trim() === "1") {
        const items = [
          {
            poNo: "PO-2026-0001",
            poDate: from || "2026-04-01",
            vendor: "샘플거래처A",
            itemCode: "EC-1001",
            itemName: "샘플상품",
            qty: 120,
            dueDate: to || "2026-04-30",
            whName: "툴스피아",
            status: "발주완료"
          }
        ];
        return sendJson(res, 200, { items, source: "mock" });
      }

      // 2) Real ECOUNT mode
      const comCode = String(process.env.ECOUNT_COM_CODE || "").trim();

      const fromCompact = normalizeDateCompact(from);
      const toCompact = normalizeDateCompact(to);
      if (!fromCompact || !toCompact) {
        throw new Error("조회 기간 형식이 올바르지 않습니다. (YYYY-MM-DD)");
      }
      const range = clampDateRangeToMax30Days(fromCompact, toCompact);

      const sessionId = await fetchEcountSession();
      const apiBase = await fetchEcountApiBase(comCode);
      const url = `${apiBase}/OAPI/V2/Purchases/GetPurchasesOrderList?SESSION_ID=${encodeURIComponent(sessionId)}`;
      const payload = {
        PROD_CD: "",
        CUST_CD: "",
        ListParam: {
          BASE_DATE_FROM: range.fromCompact,
          BASE_DATE_TO: range.toCompact,
          PAGE_CURRENT: 1,
          PAGE_SIZE: 100
        }
      };

      const callEcountList = async () =>
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        });

      let r = await callEcountList();

      if (!r.ok) {
        const txt = await r.text();
        // session can expire/revoke; clear cache for retry on next call
        ecountSessionCache = { value: "", expiresAt: 0 };
        throw new Error(`발주서 조회 실패(${r.status}): ${txt.slice(0, 300)}`);
      }
      let data = await r.json();
      const bodyMsg = String(data?.Data?.Message || data?.Message || data?.Error?.Message || "");
      const needsRetry =
        bodyMsg.includes("세션") ||
        bodyMsg.toLowerCase().includes("session") ||
        String(data?.Status || "") === "401";
      if (needsRetry) {
        ecountSessionCache = { value: "", expiresAt: 0 };
        const freshSession = await fetchEcountSession();
        const retryUrl = `${apiBase}/OAPI/V2/Purchases/GetPurchasesOrderList?SESSION_ID=${encodeURIComponent(freshSession)}`;
        r = await fetch(retryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          const txt = await r.text();
          throw new Error(`발주서 재조회 실패(${r.status}): ${txt.slice(0, 300)}`);
        }
        data = await r.json();
      }
      const rawRows = extractArrayFromUnknown(data);
      const items = normalizeInboundPlanRows(rawRows, range.toCompact);
      const topKeys = data && typeof data === "object" ? Object.keys(data).slice(0, 20) : [];
      const dataKeys =
        data && data.Data && typeof data.Data === "object" ? Object.keys(data.Data).slice(0, 20) : [];
      const dataType = data?.Data === null ? "null" : Array.isArray(data?.Data) ? "array" : typeof data?.Data;
      const dataPreview =
        data?.Data && typeof data.Data === "object" ? JSON.stringify(data.Data).slice(0, 500) : String(data?.Data || "");
      const errorPreview = data?.Error ? JSON.stringify(data.Error).slice(0, 500) : "";
      const errorsPreview = data?.Errors ? JSON.stringify(data.Errors).slice(0, 500) : "";
      return sendJson(res, 200, {
        items,
        source: "ecount-live",
        debug: {
          countRaw: Array.isArray(rawRows) ? rawRows.length : 0,
          status: data?.Status,
          code: data?.Data?.Code || data?.Code || "",
          message: data?.Data?.Message || data?.Message || "",
          topKeys,
          dataKeys,
          dataType,
          dataPreview,
          errorPreview,
          errorsPreview,
          adjustedDateRange: range.adjusted ? { from: range.fromCompact, to: range.toCompact } : null
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (req.method === "GET" && pathname === "/api/inbound-plans/detail") {
    try {
      const slipNo = String(urlObj.searchParams.get("slipNo") || "").trim();
      const from = String(urlObj.searchParams.get("from") || "").trim();
      const to = String(urlObj.searchParams.get("to") || "").trim();
      if (!slipNo) throw new Error("전표번호(slipNo)가 필요합니다.");

      const comCode = String(process.env.ECOUNT_COM_CODE || "").trim();
      const fromCompact = normalizeDateCompact(from);
      const toCompact = normalizeDateCompact(to);
      const baseDate = toCompact || fromCompact || normalizeDateCompact(new Date().toISOString().slice(0, 10));
      const range = clampDateRangeToMax30Days(fromCompact || baseDate, toCompact || baseDate);

      const sessionId = await fetchEcountSession();
      const apiBase = await fetchEcountApiBase(comCode);
      const basePayload = {
        PROD_CD: "",
        CUST_CD: "",
        ListParam: {
          BASE_DATE_FROM: range.fromCompact,
          BASE_DATE_TO: range.toCompact,
          PAGE_CURRENT: 1,
          PAGE_SIZE: 100
        }
      };
      const target = normalizeSlipNoText(slipNo);
      const seq = target.split("-").pop() || "";
      const endpointErrors = [];
      const skipBuiltinLineApis = shouldSkipBuiltinLineApis();
      let usedEndpoint = "GetPurchasesOrderList";
      let rawRows = [];

      const listUrl = `${apiBase}/OAPI/V2/Purchases/GetPurchasesOrderList?SESSION_ID=${encodeURIComponent(sessionId)}`;
      const listResp = await fetch(listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(basePayload)
      });
      if (!listResp.ok) {
        const txt = await listResp.text();
        throw new Error(`발주 목록 조회 실패(${listResp.status}): ${txt.slice(0, 300)}`);
      }
      const listData = await listResp.json();
      rawRows = extractArrayFromUnknown(listData);

      const headerRaw = findMatchingRawOrderRow(rawRows, target, seq, range.toCompact);
      const ordNoRawEarly = headerRaw ? String(pickFirstNonEmpty(headerRaw, ["ORD_NO"]) || "").trim() : "";
      const ioNoRawEarly = headerRaw ? String(pickFirstNonEmpty(headerRaw, ["IO_NO"]) || "").trim() : "";
      let matched = [];
      let lineSource = "header-flat";
      let nestedLineCount = 0;
      let narrowListTried = false;

      if (headerRaw) {
        const nestedLines = extractNestedLineRowsFromOrderRow(headerRaw);
        nestedLineCount = nestedLines.length;
        if (nestedLines.length) {
          const merged = mergeOrderHeaderWithLines(headerRaw, nestedLines);
          matched = normalizeInboundPlanRows(merged, range.toCompact);
          lineSource = "nested-lines";
        }
      }

      if (!matched.length && headerRaw) {
        const narrowAttempts = [];
        if (ordNoRawEarly) {
          narrowAttempts.push({
            label: "ListParam.ORD_NO",
            body: { ...basePayload, ListParam: { ...basePayload.ListParam, ORD_NO: ordNoRawEarly } }
          });
          narrowAttempts.push({ label: "root.ORD_NO", body: { ...basePayload, ORD_NO: ordNoRawEarly } });
        }
        if (ioNoRawEarly) {
          narrowAttempts.push({
            label: "ListParam.IO_NO",
            body: { ...basePayload, ListParam: { ...basePayload.ListParam, IO_NO: ioNoRawEarly } }
          });
        }
        for (const na of narrowAttempts) {
          narrowListTried = true;
          try {
            const nr = await fetch(listUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify(na.body)
            });
            if (!nr.ok) continue;
            const nd = await nr.json();
            const nrows = extractArrayFromUnknown(nd);
            const h2 = findMatchingRawOrderRow(nrows, target, seq, range.toCompact) || nrows[0];
            if (!h2) continue;
            const nl = extractNestedLineRowsFromOrderRow(h2);
            if (nl.length) {
              nestedLineCount = nl.length;
              matched = normalizeInboundPlanRows(mergeOrderHeaderWithLines(h2, nl), range.toCompact);
              lineSource = `narrow-list-${na.label}`;
              break;
            }
          } catch (_) {
            // ignore narrow failures
          }
        }
      }

      const envLinePaths = parseInboundLineApiPathSpecs(process.env.ECOUNT_INBOUND_LINE_API_PATHS || "");
      if (!matched.length && envLinePaths.length) {
        const ordNoL = ordNoRawEarly || seq;
        const ioNoL = ioNoRawEarly;
        const bodiesL = buildLineLookupBodies(basePayload, slipNo, ordNoL, ioNoL);
        outerEnvLines: for (const v2Path of envLinePaths) {
          for (const body of bodiesL.length ? bodiesL : [basePayload]) {
            try {
              const { ok, status, data, text } = await postEcountOapiV2(apiBase, sessionId, v2Path, body);
              if (!ok) {
                endpointErrors.push(`${v2Path}:(${status}) ${String(text || "").slice(0, 120)}`);
                continue;
              }
              const { matched: cand, kind } = matchDetailRowsToInboundPlans(data, range.toCompact);
              if (kind === "empty" || !filterLikelyItemLines(cand).length) {
                endpointErrors.push(`${v2Path}:no-item-lines`);
                continue;
              }
              matched = cand;
              usedEndpoint = v2Path;
              lineSource = `env-line-api-${kind}`;
              break outerEnvLines;
            } catch (err) {
              endpointErrors.push(`${v2Path}:network ${err?.message || String(err)}`);
            }
          }
        }
      }

      const customDetailApi = String(process.env.ECOUNT_INBOUND_DETAIL_API || "").trim();
      if (!matched.length && customDetailApi) {
        const ordNoRaw = ordNoRawEarly || seq;
        const ioNoRaw = ioNoRawEarly;
        const customV2Path = customDetailApi.includes("/") ? customDetailApi.replace(/^\/+/, "") : `Purchases/${customDetailApi}`;
        const customBodies = buildLineLookupBodies(basePayload, slipNo, ordNoRaw, ioNoRaw);
        outerCustom: for (const body of customBodies.length ? customBodies : [basePayload]) {
          try {
            const { ok, status, data, text } = await postEcountOapiV2(apiBase, sessionId, customV2Path, body);
            if (!ok) {
              endpointErrors.push(`${customV2Path}:(${status}) ${String(text || "").slice(0, 120)}`);
              continue;
            }
            const { matched: cand, kind } = matchDetailRowsToInboundPlans(data, range.toCompact);
            if (kind === "empty" || !filterLikelyItemLines(cand).length) {
              endpointErrors.push(`${customV2Path}:no-item-lines`);
              continue;
            }
            matched = cand;
            usedEndpoint = customV2Path;
            lineSource = `custom-detail-api-${kind}`;
            break outerCustom;
          } catch (err) {
            endpointErrors.push(`${customV2Path}:network ${err?.message || String(err)}`);
          }
        }
      }

      if (!matched.length && !skipBuiltinLineApis) {
        const ordNoRaw = headerRaw ? String(pickFirstNonEmpty(headerRaw, ["ORD_NO"]) || "").trim() : seq;
        const ioNoRaw = headerRaw ? String(pickFirstNonEmpty(headerRaw, ["IO_NO"]) || "").trim() : "";
        const lineBodies = buildLineLookupBodies(basePayload, slipNo, ordNoRaw, ioNoRaw);
        const purchaseMethods = [
          "GetPurchases",
          "GetPurchasesOrderDetail",
          "GetPurchaseOrderDetail",
          "GetPurchasesOrderInfo",
          "GetPurchasesDetail"
        ];
        const extraModulePaths = [
          "Purchases/GetReadPurchases",
          "Purchases/ReadPurchases",
          "Purchases/GetPurchasesList",
          "Stock/GetPurchases",
          "Inventory/GetPurchases",
          "Inventory/GetPurchaseList"
        ];
        const detailAttempts = [];
        for (const method of purchaseMethods) {
          for (const body of lineBodies) {
            detailAttempts.push({ path: `Purchases/${method}`, body });
          }
        }
        for (const path of extraModulePaths) {
          for (const body of lineBodies) {
            detailAttempts.push({ path, body });
          }
        }

        outerBuiltin: for (const c of detailAttempts) {
          try {
            const { ok, status, data, text } = await postEcountOapiV2(apiBase, sessionId, c.path, c.body);
            if (!ok) {
              endpointErrors.push(`${c.path}:(${status}) ${String(text || "").slice(0, 120)}`);
              continue;
            }
            const { matched: cand, kind } = matchDetailRowsToInboundPlans(data, range.toCompact);
            if (kind === "empty" || !filterLikelyItemLines(cand).length) {
              endpointErrors.push(`${c.path}:no-item-lines`);
              continue;
            }
            matched = cand;
            usedEndpoint = c.path;
            lineSource = `detail-api-${kind}`;
            break outerBuiltin;
          } catch (err) {
            endpointErrors.push(`${c.path}:network ${err?.message || String(err)}`);
          }
        }
      }

      if (!matched.length) {
        const items = normalizeInboundPlanRows(rawRows, range.toCompact);
        matched = items.filter((x) => normalizeSlipNoText(x.poNo) === target);
        if (!matched.length) {
          matched = items.filter((x) => normalizeSlipNoText(x.poNo).endsWith(`-${seq}`));
        }
        lineSource = "list-summary-fallback";
      }

      const lineLike = matched.filter((x) => {
        const hasCode = String(x.itemCode || "").trim() !== "";
        const hasQty = String(x.qty || "").trim() !== "";
        const isSummaryTitle = /외\s*\d+건/.test(String(x.itemName || ""));
        return (hasCode || hasQty) && !isSummaryTitle;
      });
      if (lineLike.length) matched = lineLike;

      const lineSourceFinal = lineSource;
      let hint = "";
      if (lineSourceFinal === "list-summary-fallback") {
        const parts = [
          "발주 목록 API만으로는 품목 라인(행별 PROD_CD 등)이 없습니다. 이카운트 개발자센터 OAPI에서 「한 전표·다품목」 조회 API의 정확한 Module/Method 를 확인한 뒤 .env에 ECOUNT_INBOUND_LINE_API_PATHS 또는 ECOUNT_INBOUND_DETAIL_API 로 지정하세요. debug.headerSummary에 라인 배열 후보 키가 보이면 알려주시면 매핑을 이어갈 수 있습니다."
        ];
        if (endpointErrors.length) {
          parts.push(
            "endpointErrors: (404)·EXP00001·No HTTP resource 는 해당 존에 없는 URL, (412)·HTML 은 호출 제한·차단 가능성입니다."
          );
          if (!skipBuiltinLineApis) {
            parts.push(
              "시도가 많다면 .env의 ECOUNT_SKIP_BUILTIN_LINE_APIS=0 을 제거하고 서버를 재시작하세요(기본은 내장 후보 비활성)."
            );
          }
        } else if (skipBuiltinLineApis) {
          parts.push(
            "내장 후보 API는 호출하지 않은 상태입니다(endpointErrors 비어 있음). 품목별 행은 문서에 맞는 경로를 ECOUNT_INBOUND_LINE_API_PATHS 등에 넣어야 합니다."
          );
        }
        hint = parts.join(" ");
      }

      return sendJson(res, 200, {
        item: matched[0] || null,
        items: matched,
        source: "ecount-live-detail",
        debug: {
          requestedSlipNo: slipNo,
          countRaw: Array.isArray(rawRows) ? rawRows.length : 0,
          countMatched: matched.length,
          usedEndpoint,
          lineSource: lineSourceFinal,
          hasHeaderRaw: Boolean(headerRaw),
          nestedLineCount,
          narrowListTried,
          headerSummary: buildHeaderDebugSummary(headerRaw),
          customDetailApi: String(process.env.ECOUNT_INBOUND_DETAIL_API || "").trim() || null,
          inboundLineApiPaths: parseInboundLineApiPathSpecs(process.env.ECOUNT_INBOUND_LINE_API_PATHS || ""),
          skipBuiltinLineApis,
          hint,
          endpointErrorAttempts: endpointErrors.length,
          endpointErrors: compressEndpointErrorsForDebug(endpointErrors, 14)
        }
      });
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
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
