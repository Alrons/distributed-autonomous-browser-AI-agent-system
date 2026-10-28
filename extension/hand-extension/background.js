const API_URL = "http://localhost:9090/sync";
const POLL_INTERVAL_MS = 2000;
const DEBUG_HIGHLIGHT = true; // подсвечивать элементы, с которыми работает агент (поставьте false, чтобы отключить)

let isListening = false;
let workingTabId = null; // вкладка, с которой работает агент
let loopRunning = false; // защита от двух параллельных циклов опроса

// Статус для popup: stopped | waiting | working | error
let status = { state: "stopped", detail: "", lastSync: null, commandsDone: 0, tabUrl: "" };

const BADGES = {
  stopped: ["", "#9e9e9e"],
  waiting: ["ON", "#2e9e5b"],
  working: ["▶", "#f59e0b"],
  error:   ["!", "#e5484d"]
};

async function setStatus(patch) {
  status = { ...status, ...patch };
  await chrome.storage.session.set({ status });
  const [text, color] = BADGES[status.state] || BADGES.stopped;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ---------------------------------------------------------------
// Состояние (service worker в MV3 засыпает, поэтому храним в storage)
// ---------------------------------------------------------------
async function saveState() {
  await chrome.storage.session.set({ isListening, workingTabId });
}

async function loadState() {
  const s = await chrome.storage.session.get(["isListening", "workingTabId", "status"]);
  isListening = !!s.isListening;
  workingTabId = s.workingTabId ?? null;
  if (s.status) status = s.status;
}

// ---------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------
function isRestrictedUrl(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("devtools://") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Ждём, пока вкладка загрузится (с таймаутом)
function waitForTabLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") done();
    }

    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ----------------------------------------------------------------
// 1. Рабочая вкладка
//    Агент работает ТОЛЬКО с одной вкладкой (workingTabId). Она может быть
//    неактивной/в фоне. Если её закрыли — на другую вкладку не переходим.
// ----------------------------------------------------------------
async function getTargetTab() {
  if (!workingTabId) return null;
  try {
    const tab = await chrome.tabs.get(workingTabId);
    if (isRestrictedUrl(tab.url)) return null;
    return tab;
  } catch (e) {
    // вкладку закрыли
    workingTabId = null;
    await saveState();
    return null;
  }
}

// Выбрать вкладку один раз — в момент нажатия «Запустить»
async function pickActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const tab of tabs) {
    if (!isRestrictedUrl(tab.url)) {
      workingTabId = tab.id;
      await saveState();
      return tab;
    }
  }
  return null;
}

// Открыть адрес по команде ИИ: в рабочей вкладке (если она есть), иначе создать новую
async function openUrlInNewTab(url) {
  let tab = await getTargetTab();
  if (tab) {
    tab = await chrome.tabs.update(tab.id, { url });
  } else {
    tab = await chrome.tabs.create({ url, active: false });
  }
  workingTabId = tab.id;
  await saveState();
  await waitForTabLoad(tab.id);
  return tab;
}

// ---------------------------------------------------------------
// 2. Функции, выполняемые ВНУТРИ страницы (должны быть самодостаточными!)
// ---------------------------------------------------------------
// <PAGE_FUNCS>

// Компактный снимок страницы: только видимые интерактивные элементы с готовыми уникальными селекторами.
// Именно его получает n8n вместо сырого HTML.
function collectSnapshot() {
  const MAX_ELEMENTS = 200;
  const clean = (s, n) => {
    s = String(s == null ? "" : s).replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  };
  const qa = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const SAFE_ID = /^[A-Za-z][\w-]*$/;
  const text = (el) => (el ? el.innerText || el.textContent || "" : "");
  const isEditable = (el) =>
    el.isContentEditable === true || ["", "true", "plaintext-only"].includes(el.getAttribute("contenteditable"));

  // ---- видимость ----
  const rectsOk = (el) => {
    const r = el.getClientRects();
    if (!r || !r.length) return false;
    return r[0].width > 0 && r[0].height > 0;
  };
  const cssVisible = (el) =>
    typeof el.checkVisibility === "function"
      ? el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })
      : true;
  const isVisible = (el) => cssVisible(el) && rectsOk(el);

  // ---- тип элемента ----
  const SEARCH_RE = /(search|query|поиск|найти|find)/i;
  function kindOf(el, tag) {
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (tag === "a" || role === "link") return "link";
    if (tag === "select") return "select";
    if (tag === "textarea") {
      return role === "combobox" || SEARCH_RE.test([el.name, el.id, el.getAttribute("aria-label"), el.placeholder].join(" ")) || el.name === "q" ? "search" : "text";
    }
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "file") return "file";
      if (t === "search") return "search";
      if (["text", "email", "tel", "url", "number", "password", ""].includes(t)) {
        const hay = [el.name, el.id, el.getAttribute("aria-label"), el.placeholder].join(" ");
        const inSearchForm = el.form && (el.form.getAttribute("role") === "search" || /\/(results|search)/i.test(el.form.getAttribute("action") || ""));
        return role === "combobox" || SEARCH_RE.test(hay) || /^(q|text)$/.test(el.name || "") || inSearchForm ? "search" : "text";
      }
      return "other";
    }
    if (isEditable(el) || role === "textbox") return "text";
    if (role === "combobox") return "search";
    if (role === "checkbox") return "checkbox";
    if (role === "radio") return "radio";
    return "button";
  }

  // ---- подпись элемента ----
  function labelOf(el, tag) {
    let t = "";
    if (tag === "input" || tag === "textarea" || tag === "select") {
      if (el.labels && el.labels.length) t = Array.from(el.labels).map(text).join(" ");
      if (!clean(t, 5)) {
        const ids = el.getAttribute("aria-labelledby");
        if (ids) t = ids.split(/\s+/).map((id) => text(document.getElementById(id))).join(" ");
      }
      if (!clean(t, 5)) t = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "";
      if (!clean(t, 5) && ["button", "submit"].includes((el.type || "").toLowerCase())) t = el.value;
      return clean(t, 80);
    }
    t = text(el);
    const alt = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "";
    // иконки вроде «➤» или «🔍» ничего не говорят — предпочитаем aria-label / title
    if (!/[\p{L}\p{N}]/u.test(t) && alt) t = alt;
    return clean(t, 80);
  }

  // ---- вопрос, к которому относится поле ввода (если подпись общая: «Type here») ----
  const GENERIC_LABEL = /^(type here|enter|your answer|answer|введите|ваш ответ|ответ|текст|message|сообщение)?\s*$/i;
  function questionOf(el, label) {
    if (label && !GENERIC_LABEL.test(label) && label.length >= 4) return "";
    const hasControls = (n) => n.querySelector && n.querySelector("textarea, input, select, [contenteditable]");
    let node = el;
    for (let depth = 0; depth < 7 && node && node !== document.body; depth++) {
      let sib = node.previousElementSibling;
      for (let i = 0; sib && i < 3; i++, sib = sib.previousElementSibling) {
        const t = clean(text(sib), 300);
        if (t.length >= 8 && !hasControls(sib)) return t;
      }
      node = node.parentElement;
      if (node && node !== document.body) {
        const own = clean(text(node), 400);
        if (own.length > (label || "").length + 12 && node.querySelectorAll("textarea, input:not([type=hidden]), [contenteditable]").length <= 1) {
          return clean(own.replace(label || "", ""), 300);
        }
      }
    }
    return "";
  }

  // ---- уникальный CSS-селектор ----
  const uniq = (el, sel) => {
    try {
      const f = document.querySelectorAll(sel);
      return f.length === 1 && f[0] === el;
    } catch (e) {
      return false;
    }
  };
  function pathSelector(el) {
    const parts = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      const tag = n.tagName.toLowerCase();
      if (n.id && SAFE_ID.test(n.id) && document.querySelectorAll("#" + n.id).length === 1) {
        parts.unshift("#" + n.id);
        break;
      }
      const sibs = n.parentElement ? Array.from(n.parentElement.children).filter((c) => c.tagName === n.tagName) : [n];
      parts.unshift(sibs.length > 1 ? `${tag}:nth-of-type(${sibs.indexOf(n) + 1})` : tag);
      n = n.parentElement;
    }
    return parts.join(" > ");
  }
  function makeSelector(el, tag) {
    const c = [];
    const dq = el.getAttribute("data-qa");
    if (dq) c.push(`[data-qa="${qa(dq)}"]`);
    const tid = el.getAttribute("data-testid");
    if (tid) c.push(`[data-testid="${qa(tid)}"]`);
    if (el.id) c.push(SAFE_ID.test(el.id) ? `#${el.id}` : `[id="${qa(el.id)}"]`);
    const name = el.getAttribute("name");
    if (name) c.push(`${tag}[name="${qa(name)}"]`);
    const al = el.getAttribute("aria-label");
    if (al) c.push(`${tag}[aria-label="${qa(al)}"]`);
    if (tag === "a") {
      const h = el.getAttribute("href");
      if (h && h.length <= 200 && h !== "#" && !h.startsWith("javascript:")) c.push(`a[href="${qa(h)}"]`);
    }
    for (const s of c) if (uniq(el, s)) return s;
    return pathSelector(el);
  }

  // ---- сбор ----
  const SELECTOR =
    'a[href], button, input, textarea, select, summary, [contenteditable=""], [contenteditable="true"], ' +
    '[role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="radio"], ' +
    '[role="tab"], [role="menuitem"], [role="option"]';

  const found = [];
  const seenEls = new Set();
  let domIndex = 0;
  for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
    if (found.length >= 700) break;
    domIndex++;
    if (seenEls.has(el)) continue;
    seenEls.add(el);
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && type === "hidden") continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;

    let vis = isVisible(el);
    if (!vis && tag === "input" && (type === "radio" || type === "checkbox")) {
      vis = (el.labels && Array.from(el.labels).some(isVisible)) || (el.parentElement && isVisible(el.parentElement));
    }
    if (!vis) continue;

    const kind = kindOf(el, tag);
    const label = labelOf(el, tag);
    const rec = { kind, tag, label };

    if (kind === "text" || kind === "search") {
      rec.value = clean(isEditable(el) ? text(el) : el.value, 120);
      if (kind === "text") {
        const q = questionOf(el, label);
        if (q) rec.q = q;
      }
      if (isEditable(el)) rec.ce = 1;
    } else if (kind === "select") {
      const opts = Array.from(el.options || []).map((o) => clean(o.text, 40)).filter(Boolean);
      rec.opts = opts.slice(0, 20);
      rec.value = el.selectedIndex > 0 ? clean((el.selectedOptions[0] || {}).text, 40) : "";
      const q = questionOf(el, label);
      if (q) rec.q = q;
    } else if (kind === "radio" || kind === "checkbox") {
      rec.chk = el.checked ? 1 : 0;
      if (el.name) rec.grp = el.name;
      if (kind === "radio") {
        const q = questionOf(el, "");
        if (q) rec.q = q;
      }
    } else if (kind === "link") {
      const href = el.href || el.getAttribute("href") || "";
      if (href) rec.href = clean(href, 220);
    }
    const dq = el.getAttribute("data-qa");
    if (dq) rec.dq = clean(dq, 50);
    if (el.disabled || el.getAttribute("aria-disabled") === "true") rec.dis = 1;
    if (el.closest('[role="dialog"], [aria-modal="true"], dialog')) rec.dlg = 1;
    found.push({ el, rec, order: domIndex });
  }

  // слишком много элементов — оставляем все не-ссылки и ссылки из диалогов, остальные ссылки добираем
  let chosen = found;
  if (found.length > MAX_ELEMENTS) {
    const prio = found.filter((f) => f.rec.kind !== "link" || f.rec.dlg).slice(0, 140);
    const prioSet = new Set(prio);
    const links = found.filter((f) => !prioSet.has(f)).slice(0, MAX_ELEMENTS - prio.length);
    chosen = prio.concat(links).sort((a, b) => a.order - b.order);
  }

  const elements = chosen.map((f, i) => {
    const rec = f.rec;
    rec.id = i + 1;
    rec.sel = makeSelector(f.el, rec.tag);
    return rec;
  });

  // ---- текст страницы, диалога и хвост переписки (для чатов) ----
  const bodyText = clean(text(document.body), 8000);
  const dlgEl = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog')).find(isVisible);
  let tail = "";
  const TAIL_SELECTORS = [".MessageList", ".messages-container", '[class*="message-list"]', '[role="log"]', "main"];
  for (const s of TAIL_SELECTORS) {
    const n = document.querySelector(s);
    const t = n ? clean(text(n), 100000) : "";
    if (t.length > 20) {
      tail = t.slice(-700);
      break;
    }
  }
  if (!tail) tail = bodyText.slice(-700);

  return {
    title: clean(document.title, 150),
    h1: clean(text(document.querySelector("h1")), 150),
    text: bodyText,
    dlg_text: dlgEl ? clean(text(dlgEl), 1500) : "",
    tail,
    elements
  };
}

// Ввод текста в поля. Поддерживает input/textarea (React), select, contenteditable (Telegram и т.п.).
// Если значение заканчивается переводом строки — после ввода нажимается Enter (отправка/поиск).
function fillMultipleInputsOnPage(inputs, debug) {
  const results = [];
  const isEditable = (el) =>
    el.isContentEditable === true || ["", "true", "plaintext-only"].includes(el.getAttribute("contenteditable"));

  function pressEnter(el) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const down = new KeyboardEvent("keydown", opts);
    el.dispatchEvent(down);
    const press = new KeyboardEvent("keypress", opts);
    el.dispatchEvent(press);
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
    // обычные формы (поиск YouTube/Google/hh) синтетический Enter сам не отправляет
    if (!down.defaultPrevented && !press.defaultPrevented && el.form && typeof el.form.requestSubmit === "function") {
      try { el.form.requestSubmit(); } catch (e) { /* ignore */ }
    }
  }

  for (const item of inputs) {
    const selector = item.selector;
    let value = String(item.value == null ? "" : item.value);
    const enter = /\n$/.test(value);
    if (enter) value = value.replace(/\n+$/, "");

    const el = document.querySelector(selector);
    if (!el) {
      console.warn("[Agent] Не найден input:", selector);
      results.push({ selector, ok: false, error: "not_found" });
      continue;
    }
    if (debug) el.style.outline = "3px solid dodgerblue";
    el.scrollIntoView({ block: "center", behavior: "instant" });
    el.focus();

    if (el.tagName === "SELECT") {
      const want = value.trim().toLowerCase();
      const opt = Array.from(el.options).find((o) => o.text.trim().toLowerCase() === want) ||
                  Array.from(el.options).find((o) => o.text.trim().toLowerCase().includes(want));
      if (opt) {
        el.value = opt.value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        results.push({ selector, ok: false, error: "option_not_found" });
        continue;
      }
    } else if (isEditable(el)) {
      // contenteditable (ProseMirror, Draft.js...): выделяем всё и вставляем текст как пользователь
      const flat = value.replace(/\s*\n+\s*/g, " ");
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand("insertText", false, flat); } catch (e) { ok = false; }
      if (!ok || !(el.innerText || el.textContent || "").trim()) {
        el.textContent = flat;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: flat }));
      }
    } else {
      // нативный setter нужен для React-сайтов (hh.ru и др.)
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (enter) pressEnter(el);
    results.push({ selector, ok: true });
  }
  return results;
}

// Клик. Возвращает сведения о ссылке — чтобы фоновый скрипт мог перейти по ней, если клик ничего не изменил.
function clickElementOnPage(selector, debug) {
  const el = document.querySelector(selector);
  if (!el) {
    // Эта ошибка выводится В КОНСОЛЬ САМОГО САЙТА, а не расширения
    console.warn("[Agent] Не найден элемент для клика:", selector);
    return { found: false };
  }

  // ВИЗУАЛЬНЫЙ ДЕБАГ: красим элемент, чтобы видеть цель
  if (debug) {
    el.style.outline = "5px solid red";
    el.style.backgroundColor = "rgba(255, 0, 0, 0.3)";
  }
  el.scrollIntoView({ block: "center", behavior: "instant" });

  const info = { found: true, href: "", plain: false };
  const link = el.closest ? el.closest("a[href]") : null;
  if (link) {
    const raw = link.getAttribute("href") || "";
    if (raw && raw !== "#" && !/^(javascript|mailto|tel):/i.test(raw)) {
      info.href = link.href;
      info.plain = true;
    }
    // иначе ссылка откроется в новой вкладке, а агент работает в одной
    if (link.getAttribute("target") === "_blank") link.removeAttribute("target");
  }

  const base = { view: window, bubbles: true, cancelable: true, buttons: 1 };
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    try {
      const Ev = t.startsWith("pointer") && typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(t, base));
    } catch (e) { /* ignore */ }
  }
  el.click(); // один настоящий клик (раньше было два — mouse-событие и el.click())
  return info;
}

// Короткая «подпись» состояния страницы — чтобы понять, что страница перестала меняться
function getDomSignature() {
  const b = document.body;
  return location.href + "|" + (b ? (b.innerText || "").length : 0) + "|" + document.getElementsByTagName("*").length;
}

// </PAGE_FUNCS>

// ---------------------------------------------------------------
// 3. Чтение страницы и ожидание, пока она «устоится»
// ---------------------------------------------------------------
async function scrapeSnapshot(tabId) {
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: collectSnapshot });
    return result?.[0]?.result ?? null;
  } catch (e) {
    return null; // страница грузится или недоступна
  }
}

async function domSignature(tabId) {
  try {
    const r = await chrome.scripting.executeScript({ target: { tabId }, func: getDomSignature });
    return r?.[0]?.result ?? "";
  } catch (e) {
    return "";
  }
}

// Ждём: вкладка загружена И страница перестала меняться (таймеры считаем здесь, а не в странице —
// в фоновых вкладках Chrome замедляет таймеры страницы)
async function settleTab(tabId) {
  await sleep(500);
  for (let i = 0; i < 40; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.status === "complete") break;
    await sleep(250);
  }
  let prev = await domSignature(tabId);
  for (let i = 0; i < 8; i++) {
    await sleep(500);
    const cur = await domSignature(tabId);
    if (cur && cur === prev) return;
    prev = cur;
  }
}

// ---------------------------------------------------------------
// 4. Выполнение команды от ИИ
// ---------------------------------------------------------------
async function executeCommand(data) {
  const { url_to_open, click_selector, inputs_to_fill } = data;

  let tabId = null;

  if (url_to_open && url_to_open.trim() !== "") {
    const tab = await openUrlInNewTab(url_to_open.trim());
    tabId = tab.id;
    await settleTab(tabId);
    return; // после открытия сайта других действий в этой же команде не бывает
  }

  const tab = await getTargetTab();
  if (!tab) {
    console.warn("⚠️ Нет подходящей вкладки для выполнения команды");
    return;
  }
  tabId = tab.id;

  try {
    if (inputs_to_fill && inputs_to_fill.length > 0) {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: fillMultipleInputsOnPage,
        args: [inputs_to_fill, DEBUG_HIGHLIGHT]
      });
      const failed = (r?.[0]?.result || []).filter((x) => !x.ok);
      if (failed.length) console.warn("⚠️ Не удалось заполнить:", failed);
      await sleep(300); // даём React обработать ввод
    }

    if (click_selector && click_selector.trim() !== "") {
      const before = await domSignature(tabId);
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        func: clickElementOnPage,
        args: [click_selector, DEBUG_HIGHLIGHT]
      });
      const info = r?.[0]?.result || {};
      await settleTab(tabId);

      // Клик ничего не изменил, а это обычная ссылка — переходим по ней сами
      if (info.plain && info.href) {
        const after = await domSignature(tabId);
        if (before && after && before === after) {
          console.log("↪️ Клик ничего не изменил, перехожу по ссылке:", info.href);
          await chrome.tabs.update(tabId, { url: info.href });
          await waitForTabLoad(tabId);
          await settleTab(tabId);
        }
      }
      return;
    }
  } catch (err) {
    console.warn("⚠️ Ошибка при выполнении скрипта (страница недоступна):", err);
  }

  await settleTab(tabId);
}

// ---------------------------------------------------------------
// 5. Цикл опроса сервера
// ---------------------------------------------------------------
// Возвращает true, если была выполнена команда
async function pollOnce() {
  const targetTab = await getTargetTab();

  let snapshot = null;
  let currentUrl = "";
  if (targetTab) {
    snapshot = await scrapeSnapshot(targetTab.id);
    currentUrl = targetTab.url || "";
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      current_page_html: "", // сырой HTML больше не нужен — вместо него компактный снимок
      current_url: currentUrl,
      snapshot
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();

  const isEmptyCommand =
    !data.url_to_open &&
    !data.click_selector &&
    (!data.inputs_to_fill || data.inputs_to_fill.length === 0);

  if (isEmptyCommand) {
    console.log("⏳ Сервер пуст, ИИ думает...");
    await setStatus({
      state: "waiting",
      detail: targetTab ? "Жду команду от ИИ" : "Вкладки нет — жду url_to_open",
      lastSync: Date.now(),
      tabUrl: currentUrl
    });
    return false;
  }

  console.log("🤖 Выполняю команду от ИИ:", data);
  await setStatus({
    state: "working",
    detail: "Выполняю команду",
    lastSync: Date.now(),
    tabUrl: currentUrl
  });
  await executeCommand(data);
  await setStatus({
    state: "waiting",
    detail: "Жду команду от ИИ",
    commandsDone: status.commandsDone + 1
  });
  return true;
}

async function pollLoop() {
  if (loopRunning) return;
  loopRunning = true;

  try {
    while (isListening) {
      let didCommand = false;
      try {
        didCommand = await pollOnce();
      } catch (error) {
        console.error("❌ Ошибка связи с API:", error);
        await setStatus({ state: "error", detail: "Нет связи с сервером" });
      }
      // после команды сразу отправляем свежее состояние — сервер ждёт именно его
      await sleep(didCommand ? 200 : POLL_INTERVAL_MS);
    }
  } finally {
    loopRunning = false;
  }
}

// ---------------------------------------------------------------
// 6. Запуск / остановка (сообщения из popup)
// ---------------------------------------------------------------
async function startAgent() {
  isListening = true;
  workingTabId = null;
  await saveState();
  const tab = await pickActiveTab();
  await setStatus({
    state: "waiting",
    detail: tab ? "Жду команду от ИИ" : "Откройте обычный сайт",
    lastSync: null,
    commandsDone: 0,
    tabUrl: tab ? tab.url : ""
  });
  chrome.alarms.create("agent-keepalive", { periodInMinutes: 0.5 });
  pollLoop();
}

async function stopAgent() {
  isListening = false;
  await saveState();
  await setStatus({ state: "stopped", detail: "Агент остановлен" });
  chrome.alarms.clear("agent-keepalive");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "START_AGENT") {
    startAgent().then(() => sendResponse({ ok: true }));
    return true; // ответ будет асинхронным
  }
  if (message.action === "STOP_AGENT") {
    stopAgent().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ---------------------------------------------------------------
// Если рабочая вкладка открыла новую (window.open, всплывающее окно) — продолжаем в ней
// ---------------------------------------------------------------
chrome.tabs.onCreated.addListener(async (tab) => {
  await loadState();
  if (isListening && workingTabId && tab.openerTabId === workingTabId) {
    workingTabId = tab.id;
    await saveState();
    console.log("↪️ Рабочая вкладка переключена на новую:", tab.id);
  }
});

// ---------------------------------------------------------------
// 7. Пробуждение service worker (MV3 усыпляет его через ~30 сек)
// ---------------------------------------------------------------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "agent-keepalive") return;
  await loadState();
  if (isListening) pollLoop();
});

// При старте worker восстанавливаем состояние
loadState().then(() => {
  if (isListening) pollLoop();
});