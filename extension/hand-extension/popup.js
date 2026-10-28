const els = {
  title: document.getElementById("statusTitle"),
  sub: document.getElementById("statusSub"),
  icon: document.getElementById("icon"),
  lastSync: document.getElementById("lastSync"),
  commands: document.getElementById("commands"),
  site: document.getElementById("site"),
  toggle: document.getElementById("btnToggle")
};

const STALE_AFTER_MS = 10000; // если сервер не отвечал дольше — считаем, что связи нет

const VIEW = {
  stopped: { title: "Остановлен",          icon: "⏻", sub: "Нажмите «Запустить»" },
  waiting: { title: "Работает",            icon: "✓", sub: "Жду команду от ИИ" },
  working: { title: "Выполняет команду",   icon: "⚙", sub: "Кликаю и заполняю поля…" },
  error:   { title: "Ошибка связи",        icon: "!", sub: "Проверьте, запущен ли сервер на :8080" },
  stale:   { title: "Нет ответа",          icon: "!", sub: "Сервер или агент не отвечают" }
};

let status = { state: "stopped", detail: "", lastSync: null, commandsDone: 0, tabUrl: "" };

function formatAgo(ts) {
  if (!ts) return "—";
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 2) return "только что";
  if (sec < 60) return `${sec} сек назад`;
  return `${Math.floor(sec / 60)} мин назад`;
}

function getHost(url) {
  try {
    return new URL(url).host || "—";
  } catch (e) {
    return "—";
  }
}

function render() {
  const running = status.state !== "stopped";

  // Если агент включён, но давно не было связи — показываем "stale"
  let state = status.state;
  if (
    (state === "waiting" || state === "working") &&
    status.lastSync &&
    Date.now() - status.lastSync > STALE_AFTER_MS
  ) {
    state = "stale";
  }

  const view = VIEW[state];
  document.body.dataset.state = state;

  els.title.textContent = view.title;
  els.icon.textContent = view.icon;
  // detail от background точнее, чем текст по умолчанию (кроме ошибок и stale)
  els.sub.textContent =
    state === "waiting" || state === "stopped" ? status.detail || view.sub : view.sub;

  els.lastSync.textContent = running ? formatAgo(status.lastSync) : "—";
  els.commands.textContent = status.commandsDone ?? 0;
  els.site.textContent = running ? getHost(status.tabUrl) : "—";

  els.toggle.textContent = running ? "Остановить агента" : "Запустить агента";
  els.toggle.classList.toggle("is-running", running);
}

async function loadStatus() {
  const data = await chrome.storage.session.get("status");
  if (data.status) status = data.status;
  render();
}

els.toggle.addEventListener("click", async () => {
  const running = status.state !== "stopped";
  try {
    await chrome.runtime.sendMessage({ action: running ? "STOP_AGENT" : "START_AGENT" });
  } catch (e) {
    console.error("Не удалось отправить команду в background:", e);
  }
});

// Мгновенное обновление, когда background меняет статус
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.status) {
    status = changes.status.newValue;
    render();
  }
});

// Обновляем «N сек назад» каждую секунду
setInterval(render, 1000);

loadStatus();