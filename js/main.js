// ==========================================
// CRAZY GAMES SDK INTEGRATION
// ==========================================
let crazyGamesSDK = null;
let isCrazyGamesEnvironment = false;
let cgEnvironment = "disabled";

// In non-CrazyGames builds, provide localStorage fallback (or in-memory storage).
(function ensureStorage() {
    if (window.gameStorage) return;
    try {
        window.localStorage.setItem("__probe__", "1");
        window.localStorage.removeItem("__probe__");
        window.gameStorage = window.localStorage;
    } catch (e) {
        const mem = new Map();
        window.gameStorage = {
            getItem: k => (mem.has(String(k)) ? mem.get(String(k)) : null),
            setItem: (k, v) => { mem.set(String(k), String(v)); },
            removeItem: k => { mem.delete(String(k)); },
            clear: () => { mem.clear(); }
        };
        console.warn("Persistent storage is unavailable; progress is temporary");
    }
})();

async function initCrazyGamesSDK() {
    if (window.CrazyGames && window.CrazyGames.SDK) {
        try {
            if (!window.__cgInitialized) await window.CrazyGames.SDK.init();
            crazyGamesSDK = window.CrazyGames.SDK;
            const applySdkAudioSettings = settings => {
                sdkAudioMuted = !!(settings && settings.muteAudio);
                if (sdkAudioMuted) {
                    Object.keys(sounds).forEach(k => stopSound(k));
                    stopBgMusic();
                } else {
                    if (soundToggle) soundToggle.checked = soundEnabled;
                    if (musicToggle) musicToggle.checked = musicEnabled;
                    if (audioUnlocked) startBgMusic();
                }
            };
            if (crazyGamesSDK.game && typeof crazyGamesSDK.game.addSettingsChangeListener === "function") {
                applySdkAudioSettings(crazyGamesSDK.game.settings || {});
                crazyGamesSDK.game.addSettingsChangeListener(applySdkAudioSettings);
            }

            // Проверяем среду: 'local', 'crazygames' или 'disabled'
            const env = crazyGamesSDK.environment;
            cgEnvironment = env;
            console.log(`CrazyGames SDK initialized. Environment: ${env}`);

            // Настоящая платформа = 'crazygames'. В 'local' игра запущена
            // на своём домене (превью/QA) — рекламу там просить нельзя.
            if (env === 'crazygames') {
                isCrazyGamesEnvironment = true;
            }
            // Подхватить игровой цикл, если SDK завершил инициализацию уже после старта.
            _cgGameplayActive = false;
            updateGameplayState();
        } catch (e) {
            console.error("CrazyGames SDK init error:", e);
        }
    } else {
        console.log("CrazyGames SDK not found (running locally without SDK)");
    }
}

// --- Хелперы игрового цикла CrazyGames (обязательны по правилам платформы) ---
let _cgGameplayActive = false;
let _cgGameplayEverStarted = false;

function cgGameplayStart() {
    _cgGameplayEverStarted = true;
    if (isPauseMenuOpen() || !isGameplayScreenVisible()) return;
    if (_cgGameplayActive) return;
    _cgGameplayActive = true;
    if (isCrazyGamesEnvironment && crazyGamesSDK) {
        try { crazyGamesSDK.game.gameplayStart(); }
        catch (e) { console.error("gameplayStart:", e); }
    }
}

function cgGameplayStop() {
    if (!_cgGameplayActive) return;
    _cgGameplayActive = false;
    if (isCrazyGamesEnvironment && crazyGamesSDK) {
        try { crazyGamesSDK.game.gameplayStop(); }
        catch (e) { console.error("gameplayStop:", e); }
    }
}

// --- Пауза игрового цикла: любое меню, модальное окно или другой экран ---
function isGameplayScreenVisible() {
    // Игровые экраны: главная и битвы. Магазин, инвентарь и рейтинг — это пауза.
    const ids = ["main-content-wrapper", "screen-battles"];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && el.style.display !== "none") return true;
    }
    return false;
}

function isPauseMenuOpen() {
    if (document.querySelector(".modal-overlay.active") !== null) return true;
    const ids = ["menu-settings", "menu-notifications"];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && el.classList.contains("active")) return true;
    }
    return false;
}

function updateGameplayState() {
    // Platform handles focus changes itself; only report actual in-game menus/breaks.
    const paused = isPauseMenuOpen() || !isGameplayScreenVisible();
    if (paused) cgGameplayStop();
    else if (_cgGameplayEverStarted) cgGameplayStart();
}

// Changes in game visibility are handled by the observer below; focus changes belong to the platform.

// Любое открытие/закрытие меню или смена экрана меняет класс/стиль —
// этого достаточно, чтобы пересчитать состояние игры. Пересчёт отложен,
// чтобы не дёргать платформу на каждый кадр анимации.
let _gameplayStateScheduled = false;
function scheduleGameplayStateUpdate() {
    if (_gameplayStateScheduled) return;
    _gameplayStateScheduled = true;
    const run = () => {
        _gameplayStateScheduled = false;
        updateGameplayState();
        if (!document.hidden && audioUnlocked) startBgMusic();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
}

const _gameplayStateObserver = new MutationObserver(scheduleGameplayStateUpdate);
_gameplayStateObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "style"],
    subtree: true
});

const AD_UNAVAILABLE_MESSAGE = "Ad unavailable—possibly blocked by AdBlock. Disable it or try later; sell drops for coins.";
const REWARDED_AD_COOLDOWN_MS = 3 * 60 * 1000;
const REWARDED_AD_LAST_SHOWN_KEY = "lastRewardedAdStarted";
let _adInFlight = false;

function getRewardedAdCooldownRemaining() {
    const lastShown = parseInt(gameStorage.getItem(REWARDED_AD_LAST_SHOWN_KEY), 10) || 0;
    return Math.max(0, REWARDED_AD_COOLDOWN_MS - (Date.now() - lastShown));
}

function markRewardedAdShown() {
    gameStorage.setItem(REWARDED_AD_LAST_SHOWN_KEY, String(Date.now()));
}

function formatCooldown(ms) {
    const seconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

// Реклама доступна только на реальной платформе CrazyGames.
// Локально (для отладки) просмотр эмулируется, во всех остальных случаях —
// честно сообщаем игроку, что рекламы сейчас нет (AdBlock и т.п.).
function isAdSimulationAllowed() {
    const host = (location.hostname || "").toLowerCase();
    const isLocalDev = location.protocol === "file:" || host === "" ||
        host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
    return isLocalDev || cgEnvironment === "local";
}

function hasSdkAds() {
    return !!(crazyGamesSDK && crazyGamesSDK.ad && typeof crazyGamesSDK.ad.requestAd === "function");
}

function pauseForAd() {
    cgGameplayStop();
    try {
        Object.keys(sounds).forEach(k => stopSound(k));
    } catch (e) {}
    stopBgMusic();
}

function resumeAfterAd() {
    if (!document.hidden && !isPauseMenuOpen()) startBgMusic();
    updateGameplayState();
}

function notifyAdUnavailable(message = AD_UNAVAILABLE_MESSAGE) {
    try { showToast(message); } catch (e) { console.warn(message); }
}

// Rewarded ads must be at least three minutes apart.
function showRewardedAd(callback) {
    const done = typeof callback === "function" ? callback : function () {};
    if (_adInFlight) { notifyAdUnavailable(); done(false); return; }

    const cooldownRemaining = getRewardedAdCooldownRemaining();
    if (cooldownRemaining > 0) {
        notifyAdUnavailable(`Please wait ${formatCooldown(cooldownRemaining)} before another ad. Sell drops to earn coins.`);
        done(false);
        return;
    }

    // Нет SDK / AdBlock / не платформа — реклама недоступна
    if (!isCrazyGamesEnvironment || !hasSdkAds()) {
        if (isAdSimulationAllowed()) {
            console.log("Simulating ad view...");
            _adInFlight = true;
            pauseForAd();
            setTimeout(() => {
                _adInFlight = false;
                markRewardedAdShown();
                resumeAfterAd();
                done(true);
            }, 1500);
            return;
        }
        notifyAdUnavailable();
        done(false);
        return;
    }

    // Перед рекламой игровой процесс должен быть остановлен, звук выключен
    _adInFlight = true;
    pauseForAd();

    let settled = false;
    let adTimeout = setTimeout(() => {
        notifyAdUnavailable();
        finish(false);
    }, 30000);
    const finish = (success) => {
        if (settled) return;
        settled = true;
        clearTimeout(adTimeout);
        _adInFlight = false;
        if (success) markRewardedAdShown();
        resumeAfterAd();
        done(success);
    }; 

    try {
        crazyGamesSDK.ad.requestAd("rewarded", {
            adStarted: () => {
                console.log("Ad started");
                markRewardedAdShown();
            },
            adFinished: () => {
                console.log("Ad watched in full");
                markRewardedAdShown();
                finish(true);
            },
            adError: (error) => {
                console.warn("Ad not available:", error);
                notifyAdUnavailable();
                finish(false);
            }
        });
    } catch (e) {
        console.warn("Ad request failed:", e);
        notifyAdUnavailable();
        finish(false);
    }
}

// Запускаем инициализацию сразу
initCrazyGamesSDK();

// ==========================================
// ИГРОВОЕ ОКНО ПОДТВЕРЖДЕНИЯ (без браузерных диалогов)
// ==========================================
const confirmModal = document.getElementById("confirm-modal");
const confirmTitleEl = document.getElementById("confirm-title");
const confirmTextEl = document.getElementById("confirm-text");
const confirmOkBtn = document.getElementById("confirm-ok-btn");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
let _confirmResolve = null;

function showConfirm(options, onResolve) {
    const opts = typeof options === "string" ? { text: options } : (options || {});
    const done = typeof onResolve === "function"
        ? onResolve
        : (typeof options === "function" ? options : null);

    if (!confirmModal) { if (done) done(true); return; }

    if (confirmTitleEl) confirmTitleEl.textContent = opts.title || "Confirmation";
    if (confirmTextEl) confirmTextEl.textContent = opts.text || "Are you sure?";
    if (confirmOkBtn) {
        confirmOkBtn.textContent = opts.okText || "Confirm";
        confirmOkBtn.classList.toggle("btn-danger-solid", !!opts.danger);
    }
    if (confirmCancelBtn) confirmCancelBtn.textContent = opts.cancelText || "Cancel";

    _confirmResolve = done;
    confirmModal.classList.add("active");
    setTimeout(() => { if (confirmOkBtn) confirmOkBtn.focus(); }, 50);
}

function closeConfirm(result) {
    if (confirmModal) confirmModal.classList.remove("active");
    const cb = _confirmResolve;
    _confirmResolve = null;
    if (cb) cb(result);
}

if (confirmOkBtn) confirmOkBtn.addEventListener("click", () => { playSound("click"); closeConfirm(true); });
if (confirmCancelBtn) confirmCancelBtn.addEventListener("click", () => { playSound("click"); closeConfirm(false); });
if (confirmModal) {
    confirmModal.addEventListener("click", (e) => {
        if (e.target === confirmModal) closeConfirm(false);
    });
}
document.addEventListener("keydown", (e) => {
    if (!confirmModal || !confirmModal.classList.contains("active")) return;
    // Если фокус стоит на кнопке — отдаём Enter самой кнопке, чтобы не подменить действие
    const focused = document.activeElement;
    const onButton = focused && confirmModal.contains(focused) &&
        focused.tagName === "BUTTON";
    if (e.key === "Escape") { e.preventDefault(); closeConfirm(false); }
    else if (e.key === "Enter" && !onButton) { e.preventDefault(); closeConfirm(true); }
});

// ==========================================
// УВЕДОМЛЕНИЯ (TOAST)
// ==========================================
const toast = document.getElementById("toast");
let toastTimer;

function iconMarkup(name, className = "icon") {
    return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function showToast(message, onClick = null) {
    if (!toast) return;
    const text = String(message ?? "");
    const textWithoutIcons = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F]/gu, "");
    const warning = /not enough|insufficient|unable to|failed|error|already|cannot|invalid|must be|only english|already taken/i.test(textWithoutIcons);
    const icon = warning ? "warning" : "info";
    const iconEl = toast.querySelector(".toast-icon");
    const textEl = toast.querySelector(".toast-message");
    if (iconEl) iconEl.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#icon-${icon}"></use></svg>`;
    if (textEl) textEl.textContent = text;
    else toast.textContent = text;
    toast.classList.toggle("toast-warning", warning);
    toast.classList.toggle("toast-clickable", typeof onClick === "function");
    toast.onclick = typeof onClick === "function" ? () => { toast.classList.remove("show"); onClick(); } : null;
    toast.classList.add("show");

    clearTimeout(toastTimer);

    toastTimer = setTimeout(() => {
        toast.classList.remove("show");
    }, 2200);
}

// ==========================================
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ ИГРОКА
// ==========================================
let playerState = { 
    coins: parseInt(gameStorage.getItem("playerCoins")) || 0, 
    gems: parseInt(gameStorage.getItem("playerGems")) || 0,
    xp: parseInt(gameStorage.getItem("playerXP")) || 0,
    level: parseInt(gameStorage.getItem("playerLevel")) || 1
};

function getXpForLevel(lvl) { return lvl * 500; }

function addXP(amount) {
    playerState.xp += amount;
    let needed = getXpForLevel(playerState.level);
    let leveledUp = false;
    while (playerState.xp >= needed) {
        playerState.xp -= needed;
        playerState.level++;
        needed = getXpForLevel(playerState.level);
        leveledUp = true;
    }
    if (leveledUp) {
        if (typeof checkAchievements === "function") checkAchievements();
        showToast(`Level up! Now Lv. ${playerState.level}`);
        try { playSound("levelUp"); } catch (e) {}
        try { playSound("achiv"); } catch (e) {}
    }
    saveCurrency();
    updateLevelUI();
    if (typeof checkAchievements === "function") checkAchievements();
}

function updateLevelUI() {
    const needed = getXpForLevel(playerState.level);
    const pct = Math.min(100, (playerState.xp / needed) * 100);
    
    // Topbar
    const lvSpan = document.querySelector('.level span');
    const xpFill = document.querySelector('.xp .xp-fill');
    const xpSmall = document.querySelector('.level small');
    if (lvSpan) lvSpan.textContent = `Lv. ${playerState.level}`;
    if (xpFill) xpFill.style.width = `${pct}%`;
    if (xpSmall) xpSmall.textContent = `${playerState.xp} / ${needed}`;
    
    // Achievements modal
    const achLv = document.getElementById('ach-level-display');
    const achFill = document.getElementById('ach-xp-fill');
    const achText = document.getElementById('ach-xp-text');
    if (achLv) achLv.textContent = `Lv. ${playerState.level}`;
    if (achFill) achFill.style.width = `${pct}%`;
    if (achText) achText.textContent = `${playerState.xp} / ${needed} XP`;
}

// ==========================================
// X2 BOOST SYSTEM
// ==========================================
function isBoostActive() {
    const expiry = parseInt(gameStorage.getItem("boostExpiry")) || 0;
    return Date.now() < expiry;
}

function getBoostRemaining() {
    const expiry = parseInt(gameStorage.getItem("boostExpiry")) || 0;
    const remaining = Math.max(0, expiry - Date.now());
    return remaining;
}

function activateBoost() {
    showRewardedAd((success) => {
        if (success) {
            const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
            gameStorage.setItem("boostExpiry", expiry);
            updateBoostUI();
            showToast("Double income activated for 5 minutes!");
        }
    });
}

function refreshBoostWithCrystals() {
    if (playerState.gems < 100) {
        showToast("Not enough gems! 100 gems required");
        return;
    }
    playerState.gems -= 100;
    saveCurrency();
    updateCurrencyUI();
    const expiry = Date.now() + 5 * 60 * 1000;
    gameStorage.setItem("boostExpiry", expiry);
    updateBoostUI();
    showToast("Boost refreshed for 100 gems!");
}

function updateBoostUI() {
    const active = isBoostActive();
    const sidebar = document.getElementById("sidebar-boost");
    if (sidebar) sidebar.remove();
    const sidebarTimer = document.getElementById("boost-timer-sidebar");
    const shopBoost = document.querySelector(".shop-boost");
    const topbarIndicator = document.getElementById("boost-indicator-topbar");
    const topbarTimer = document.getElementById("boost-timer-topbar");
    const boostBtn = document.getElementById("btn-activate-boost");
    const boostParent = boostBtn?.closest(".shop-boost");
    if (boostParent) boostParent.style.display = "block";
    
    if (active) {
        const remaining = getBoostRemaining();
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        
        if (sidebarTimer) { sidebarTimer.style.display = "block"; sidebarTimer.innerHTML = `${iconMarkup("clock")} ${timeStr}`; }
        if (shopBoost) shopBoost.style.display = "block";
        if (topbarIndicator) { topbarIndicator.style.display = "flex"; }
        if (topbarTimer) topbarTimer.textContent = timeStr;
        if (boostBtn) { boostBtn.innerHTML = `${iconMarkup("check")} Boost active`; boostBtn.disabled = true; }
    } else {
        if (sidebarTimer) sidebarTimer.style.display = "none";
        if (shopBoost) shopBoost.style.display = "block";
        if (topbarIndicator) topbarIndicator.style.display = "none";
        if (boostBtn) { boostBtn.innerHTML = `${iconMarkup("bolt")} Double income (5 min)`; boostBtn.disabled = false; }
    }
}

// Boost timer tick
setInterval(updateBoostUI, 1000);

// Avatar unlock levels
const AVATAR_UNLOCKS = [
    { file: "avatar.png", level: 1 },
    { file: "avatar-2.jpeg", level: 3 },
    { file: "avatar-3.png", level: 5 },
    { file: "avatar-4.png", level: 8 },
    { file: "avatar-5.png", level: 12 },
    { file: "avatar-6.png", level: 16 },
    { file: "avatar-7.jpeg", level: 20 }
];

function updateCurrencyUI() {
    const coinEl = document.querySelector(".coin-currency b");
    const gemEl = document.querySelector(".gem-currency b");
    if (coinEl) coinEl.textContent = playerState.coins.toLocaleString('en-US');
    if (gemEl) gemEl.textContent = playerState.gems.toLocaleString('en-US');
    // Leaderboard инициализируется позже — до этого момента проверку места не запускаем
    if (leaderboardReady) scheduleRankCheck();
}

// Ставится в true, когда живой рейтинг готов (чтобы не ловить TDZ при раннем рендере валюты)
var leaderboardReady = false;

function saveCurrency() {
    gameStorage.setItem("playerCoins", playerState.coins);
    gameStorage.setItem("playerGems", playerState.gems);
    gameStorage.setItem("playerXP", playerState.xp);
    gameStorage.setItem("playerLevel", playerState.level);
}

updateCurrencyUI();

// ==========================================
// НАВИГАЦИЯ И ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ
// ==========================================

const screenMainContent = document.getElementById("main-content-wrapper");
const screenAllCases = document.getElementById("screen-all-cases");
const screenInventory = document.getElementById("screen-inventory");
const screenLeaderboard = document.getElementById("screen-leaderboard");
const screenShop = document.getElementById("screen-shop");
const screenBattles = document.getElementById("screen-battles");
const screenMissions = document.getElementById("screen-missions");
const screenCollection = document.getElementById("screen-collection");

const btnViewAllCases = document.getElementById("view-all-cases-btn");
const btnBackToMain = document.getElementById("back-to-main-btn");
const btnBackFromInv = document.getElementById("back-to-main-from-inv-btn");
const btnBackFromLb = document.getElementById("back-to-main-from-lb-btn");
const btnBackFromShop = document.getElementById("back-to-main-from-shop-btn");
const btnBackFromBattles = document.getElementById("back-to-main-from-battles-btn");

// 1. Клик по логотипу
const logoElement = document.querySelector(".logo");
if (logoElement) {
    logoElement.addEventListener("click", (e) => {
        e.preventDefault();
        showToast("Loading...");
        setTimeout(() => location.reload(), 300);
    });
}

// Универсальная функция скрытия всех экранов
function hideAllScreens() {
    if (screenMainContent) screenMainContent.style.display = "none";
    if (screenAllCases) screenAllCases.style.display = "none";
    if (screenInventory) screenInventory.style.display = "none";
    if (screenLeaderboard) screenLeaderboard.style.display = "none";
    if (screenShop) screenShop.style.display = "none";
    if (screenBattles) screenBattles.style.display = "none";
    if (screenMissions) screenMissions.style.display = "none";
    if (screenCollection) screenCollection.style.display = "none";
}

// Показ Главной
function showMainScreen() {
    hideAllScreens();
    if (screenMainContent) {
        screenMainContent.style.display = "flex";
        screenMainContent.style.flexDirection = "column";
        screenMainContent.style.gap = "12px";
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const homeNavBtn = document.querySelector('.nav-item[data-section="Home"]');
    if (homeNavBtn) homeNavBtn.classList.add("active");
    if (typeof renderMiniLeaderboard === "function") renderMiniLeaderboard();
}

// Показ Всех Кейсов
function showAllCases() {
    hideAllScreens();
    if (screenAllCases) {
        screenAllCases.style.display = "block";
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const casesNavBtn = document.querySelector('.nav-item[data-section="Cases"]');
    if (casesNavBtn) casesNavBtn.classList.add("active");
}

// Показ Инвентаря
function showInventoryScreen() {
    hideAllScreens();
    if (screenInventory) {
        screenInventory.style.display = "block";
        renderInventory(); // Рендерим при открытии
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const invNavBtn = document.querySelector('.nav-item[data-section="Inventory"]');
    if (invNavBtn) invNavBtn.classList.add("active");
}

// Показ Leaderboardа
function showLeaderboardScreen() {
    hideAllScreens();
    if (screenLeaderboard) {
        screenLeaderboard.style.display = "block";
        generateLeaderboard(); // Генерируем таблицу
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const lbNavBtn = document.querySelector('.nav-item[data-section="Leaderboard"]');
    if (lbNavBtn) lbNavBtn.classList.add("active");
}

// Показ Shopа
function showShopScreen() {
    hideAllScreens();
    if (screenShop) {
        screenShop.style.display = "block";
        updateShopUI();
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const shopNavBtn = document.querySelector('.nav-item[data-section="Shop"]');
    if (shopNavBtn) shopNavBtn.classList.add("active");
}

// Показ Битв (полный экран)
function showBattlesScreen() {
    hideAllScreens();
    if (screenBattles) {
        screenBattles.style.display = "block";
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const battlesNavBtn = document.querySelector('.nav-item[data-section="Battles"]');
    if (battlesNavBtn) battlesNavBtn.classList.add("active");
}

function showMissionsScreen() {
    hideAllScreens();
    if (screenMissions) screenMissions.style.display = "block";
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    document.querySelector('.nav-item[data-section="Missions"]')?.classList.add("active");
    renderDailyMissions();
}

function showCollectionScreen() {
    hideAllScreens();
    if (screenCollection) screenCollection.style.display = "block";
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    document.querySelector('.nav-item[data-section="Collection"]')?.classList.add("active");
    renderArtifactCollection();
}

// Обновление UI магазина (аналог updateRewardUI но для обоих типов)
const NICKNAME_STYLES = [
    { id: "neon-purple", name: "Neon Purple (Неоновый фиолетовый)", price: 50 },
    { id: "cyber-blue", name: "Cyber Blue (Кибер-синий)", price: 50 },
    { id: "golden", name: "Golden (Золотой)", price: 100 },
    { id: "inferno", name: "Inferno (Инферно)", price: 150 },
    { id: "rainbow", name: "Rainbow (Радужный)", price: 250 }
];
const NICKNAME_STYLE_STORAGE_KEY = "ownedNicknameStyles";
const DAILY_CASE_STORAGE_KEY = "dailyCrystalCases";
const DAILY_CRYSTAL_CASES = [
    { id: "lab", name: "Splat Lab (Лаборатория Плюха)", price: 50 },
    { id: "mystic", name: "Mystic Catalog (Мистический Каталог)", price: 100 }
];

function readStorageArray(key) {
    try { const value = JSON.parse(gameStorage.getItem(key) || "[]"); return Array.isArray(value) ? value : []; }
    catch (e) { return []; }
}
function getOwnedNicknameStyles() { return readStorageArray(NICKNAME_STYLE_STORAGE_KEY); }
function nicknameStyleClass(styleId) { return styleId ? `nickname-style-${styleId}` : ""; }
function applyNicknameStyle(element, styleId = gameStorage.getItem("nicknameStyle")) {
    if (!element) return;
    NICKNAME_STYLES.forEach(style => element.classList.remove(nicknameStyleClass(style.id)));
    if (NICKNAME_STYLES.some(style => style.id === styleId)) element.classList.add(nicknameStyleClass(styleId));
}
function updatePlayerNameDisplay(name = gameStorage.getItem("playerName") || "CrazyPlayer") {
    if (!nameText) return;
    let nameEl = nameText.querySelector(".player-name-text");
    if (!nameEl) {
        nameEl = document.createElement("span");
        nameEl.className = "player-name-text";
        nameText.prepend(nameEl);
    }
    nameEl.textContent = name;
    applyNicknameStyle(nameEl);
    if (!nameText.querySelector(".edit-name")) {
        const edit = document.createElement("span");
        edit.className = "edit-name";
        edit.setAttribute("aria-label", "Edit name");
        nameText.appendChild(edit);
    }
    bindEditNameClick();
}
function getDailyCrystalCaseState() {
    let state;
    try { state = JSON.parse(gameStorage.getItem(DAILY_CASE_STORAGE_KEY) || "{}"); } catch (e) { state = {}; }
    const today = new Date().toDateString();
    if (!state || state.date !== today) state = { date: today, purchased: [] };
    if (!Array.isArray(state.purchased)) state.purchased = [];
    return state;
}

function updateShopUI() {
    const coinList = document.getElementById("shop-coins-list");
    if (coinList) updateRewardListUI(coinList, "coin");
    const gemList = document.getElementById("shop-gems-list");
    if (gemList) updateRewardListUI(gemList, "gem");
    document.querySelectorAll("#screen-shop .reward-btn").forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = "true";
        btn.addEventListener("click", e => handleRewardClaim(e.currentTarget));
    });
    renderNicknameStyleShop();
    renderDailyCaseShop();
}

function renderNicknameStyleShop() {
    const list = document.getElementById("nickname-style-list");
    if (!list) return;
    const owned = getOwnedNicknameStyles();
    const equipped = gameStorage.getItem("nicknameStyle") || "";
    list.replaceChildren();
    NICKNAME_STYLES.forEach(style => {
        const card = document.createElement("div");
        card.className = "shop-offer-card";
        const preview = document.createElement("span");
        preview.className = `nickname-style-preview ${nicknameStyleClass(style.id)}`;
        preview.textContent = "Nickname";
        const name = document.createElement("b");
        name.textContent = style.name;
        const price = document.createElement("small");
        price.textContent = `${style.price} 💎`;
        const button = document.createElement("button");
        button.className = "reward-btn shop-offer-btn";
        const isOwned = owned.includes(style.id);
        const isEquipped = equipped === style.id;
        button.textContent = isEquipped ? "Equipped" : isOwned ? "Equip" : "Buy";
        button.disabled = isEquipped;
        button.addEventListener("click", () => {
            if (isEquipped) return;
            if (!isOwned) {
                if (playerState.gems < style.price) { playSound("error"); showToast(`Not enough gems! ${style.price} gems required`); return; }
                playerState.gems -= style.price;
                owned.push(style.id);
                gameStorage.setItem(NICKNAME_STYLE_STORAGE_KEY, JSON.stringify(owned));
                saveCurrency();
                updateCurrencyUI();
                playSound("shop");
                renderNicknameStyleShop();
                showToast(`${style.name} purchased!`);
                return;
            }
            gameStorage.setItem("nicknameStyle", style.id);
            updatePlayerNameDisplay();
            if (screenLeaderboard && getComputedStyle(screenLeaderboard).display !== "none") generateLeaderboard();
            renderNicknameStyleShop();
            showToast(`${style.name} equipped!`);
        });
        const meta = document.createElement("div");
        meta.className = "shop-offer-meta";
        meta.append(name, price);
        card.append(preview, meta, button);
        list.appendChild(card);
    });
}

function renderDailyCaseShop() {
    const list = document.getElementById("daily-case-list");
    if (!list) return;
    const state = getDailyCrystalCaseState();
    gameStorage.setItem(DAILY_CASE_STORAGE_KEY, JSON.stringify(state));
    list.replaceChildren();
    DAILY_CRYSTAL_CASES.forEach(offer => {
        const caseData = CASES_DATA[offer.id];
        if (!caseData) return;
        const card = document.createElement("div");
        card.className = "shop-offer-card";
        const image = document.createElement("img");
        image.className = "shop-case-image";
        image.src = `assets/cases/${caseData.img}`;
        image.alt = caseData.title;
        const name = document.createElement("b");
        name.textContent = offer.name;
        const price = document.createElement("small");
        price.textContent = `${offer.price} 💎`;
        const button = document.createElement("button");
        button.className = "reward-btn shop-offer-btn";
        const purchased = state.purchased.includes(offer.id);
        button.textContent = purchased ? "Purchased today" : "Buy & open";
        button.disabled = purchased;
        button.addEventListener("click", () => {
            const current = getDailyCrystalCaseState();
            if (current.purchased.includes(offer.id)) { playSound("error"); renderDailyCaseShop(); return; }
            if (playerState.gems < offer.price) { playSound("error"); showToast(`Not enough gems! ${offer.price} gems required`); return; }
            playerState.gems -= offer.price;
            current.purchased.push(offer.id);
            gameStorage.setItem(DAILY_CASE_STORAGE_KEY, JSON.stringify(current));
            saveCurrency();
            updateCurrencyUI();
            playSound("shop");
            renderDailyCaseShop();
            currentCaseData = caseData;
            startRoulette();
        });
        const meta = document.createElement("div");
        meta.className = "shop-offer-meta";
        meta.append(name, price);
        card.append(image, meta, button);
        list.appendChild(card);
    });
}

function updateRewardListUI(listEl, type) {
    const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
    const claimedRewards = JSON.parse(gameStorage.getItem(storageKey)) || [];

    listEl.querySelectorAll(".reward-card").forEach((card, index) => {
        const btn = card.querySelector(".reward-btn");
        if (claimedRewards.includes(index)) {
            card.classList.add("claimed");
            btn.disabled = true;
            btn.textContent = "Claimed";
        } else {
            card.classList.remove("claimed");
            btn.disabled = false;
            btn.textContent = "Watch video";
        }
    });
}

if (btnViewAllCases) btnViewAllCases.addEventListener("click", showAllCases);
if (btnBackToMain) btnBackToMain.addEventListener("click", showMainScreen);
if (btnBackFromInv) btnBackFromInv.addEventListener("click", showMainScreen);
if (btnBackFromLb) btnBackFromLb.addEventListener("click", showMainScreen);
if (btnBackFromShop) btnBackFromShop.addEventListener("click", showMainScreen);
if (btnBackFromBattles) btnBackFromBattles.addEventListener("click", showMainScreen);

// 2. ЕДИНСТВЕННЫЙ обработчик бокового меню
document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
        if (button.classList.contains("active")) return; // Если уже нажата, ничего не делаем

        const section = button.dataset.section;

        if (section === "Home") showMainScreen();
        else if (section === "Cases") showAllCases();
        else if (section === "Inventory") showInventoryScreen();
        else if (section === "Leaderboard") showLeaderboardScreen();
        else if (section === "Shop") showShopScreen();
        else if (section === "Battles") showBattlesScreen();
        else if (section === "Missions") showMissionsScreen();
        else if (section === "Collection") showCollectionScreen();
        else {
            showToast("Section under construction");
            showMainScreen();
        }
    });
});

// ==========================================
// ОСТАЛЬНЫЕ КНОПКИ
// ==========================================

const playBtn = document.querySelector(".play-button");
const casesArea = document.querySelector(".cases-area");
const battleArea = document.querySelector(".battle");

if (playBtn) {
    playBtn.addEventListener("click", () => {
        showMainScreen();
        if (casesArea) casesArea.scrollIntoView({ behavior: "smooth", block: "center" });

        // CRAZY GAMES: Сообщаем платформе, что игра началась (Gameplay Start)
        cgGameplayStart();

        setTimeout(() => {
            if (casesArea) casesArea.classList.add("highlight-pulse");
            if (battleArea) battleArea.classList.add("highlight-pulse");
            const actionButtons = document.querySelectorAll(".case-button, .battle-button");
            actionButtons.forEach(btn => btn.classList.add("highlight-btn"));
            setTimeout(() => {
                if (casesArea) casesArea.classList.remove("highlight-pulse");
                if (battleArea) battleArea.classList.remove("highlight-pulse");
                actionButtons.forEach(btn => btn.classList.remove("highlight-btn"));
            }, 6000);
        }, 600);
    });
}

// Обработчик кнопки битвы теперь в блоке Case Battle System ниже

const goldBtn = document.getElementById("btn-activate-boost");
if (goldBtn) goldBtn.addEventListener("click", () => {
    if (isBoostActive()) {
        showToast("Boost is already active! Wait for it to end.");
    } else {
        activateBoost();
    }
});

const promoBtn = document.getElementById("btn-open-achievements");
if (promoBtn) promoBtn.addEventListener("click", () => openAchievementsModal()); 

const dailyBtn = document.querySelector(".daily-button");
// Обработчик кнопки "Подарок за вход" находится в блоке ONBOARDING & DAILY REWARD ниже

document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => showToast(button.dataset.action));
});

document.querySelectorAll("img").forEach(image => {
    image.addEventListener("error", () => image.classList.add("image-error"));
});

// ==========================================
// ЛОГИКА ПРОФИЛЯ
// ==========================================

const takenNames = ["admin", "crazyplayer", "sigmaboy", "progamer", "bot"];
const availableAvatars = ["avatar.png", "avatar-2.jpeg", "avatar-3.png", "avatar-4.png", "avatar-5.png", "avatar-6.png", "avatar-7.jpeg"];

const avatarImg = document.querySelector(".avatar");
const nameText = document.querySelector(".player-name");
const avatarModal = document.getElementById("avatar-modal");
const avatarGrid = document.getElementById("avatar-grid");
const nameModal = document.getElementById("name-modal");
const nameInput = document.getElementById("name-input");
const nameError = document.getElementById("name-error");

function loadProfile() {
    const savedAvatar = gameStorage.getItem("playerAvatar");
    const savedName = gameStorage.getItem("playerName");
    const level = Math.max(1, parseInt(playerState.level, 10) || 1);
    const standardAvatarUnlocked = AVATAR_UNLOCKS.some(avatar => avatar.file === savedAvatar && level >= avatar.level);
    const achievementAvatars = {
        "collector-avatar": "avatar-collector.png",
        "fighter-avatar": "avatar-fighter.png",
        "upgrader-avatar": "avatar-upgrader.png",
        "legend-avatar": "avatar-legend.png"
    };
    let achievementUnlocks = [];
    try { achievementUnlocks = JSON.parse(gameStorage.getItem("achievementUnlocksV1") || "[]"); } catch (e) {}
    const achievementAvatarUnlocked = Object.entries(achievementAvatars).some(([id, file]) => file === savedAvatar && achievementUnlocks.includes(id));
    const avatarFile = standardAvatarUnlocked || achievementAvatarUnlocked ? savedAvatar : "avatar.png";

    if (avatarImg) {
        avatarImg.src = `assets/avatar/${avatarFile}`;
        avatarImg.onerror = () => {
            avatarImg.onerror = null;
            avatarImg.src = "assets/avatar/avatar.png";
            gameStorage.setItem("playerAvatar", "avatar.png");
        };
    }
    if (savedAvatar !== avatarFile) gameStorage.setItem("playerAvatar", avatarFile);
    updatePlayerNameDisplay(savedName || "CrazyPlayer");
    updatePlayerTitle();
    
    bindEditNameClick();
}

// Уровень, с которого открыт аватар
function getAvatarRequiredLevel(avatarFile) {
    const found = AVATAR_UNLOCKS.find(a => a.file === avatarFile);
    return found ? found.level : 1;
}

// Отрисовка сетки аватаров с учётом уровня игрока
function renderAvatarFrameChooser() {
    const grid = document.getElementById("avatar-frame-grid");
    if (!grid) return;
    grid.replaceChildren();
    const unlocked = getAchievementUnlocks();
    const activeId = gameStorage.getItem("playerFrame") || "";
    FRAME_REWARDS.forEach(frame => {
        const def = ACHIEVEMENT_DEFS.find(item => item.frame === frame.id);
        const earned = !!def && unlocked.includes(def.id);
        const option = document.createElement("button");
        option.type = "button";
        option.className = `avatar-frame-option${activeId === frame.id ? " selected" : ""}`;
        option.disabled = !earned;
        option.innerHTML = `<span class="frame-preview ${frame.className}"><svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg></span><small>${frame.name}${earned ? "" : " · Locked"}</small>`;
        option.addEventListener("click", () => {
            if (!earned) return;
            gameStorage.setItem("playerFrame", frame.id);
            updateAvatarFrame();
            renderAvatarGrid();
            renderAvatarFrameChooser();
            if (screenLeaderboard && typeof generateLeaderboard === "function") generateLeaderboard();
        });
        grid.appendChild(option);
    });
}

function renderAvatarGrid() {
    if (!avatarGrid) return;
    avatarGrid.innerHTML = "";
    const level = parseInt(playerState.level) || 1;

    const achievementAvatars = EXCLUSIVE_AVATARS.map(avatar => ({ ...avatar, achievement: ACHIEVEMENT_DEFS.find(def => def.avatar === avatar.file)?.id }));
    [...AVATAR_UNLOCKS.map(avatar => ({ ...avatar, level: avatar.level })), ...achievementAvatars].forEach(({ file: avatarFile, level: reqLevel, achievement }) => {
        const wrap = document.createElement("div");
        wrap.className = "avatar-cell";

        const img = document.createElement("img");
        img.src = `assets/avatar/${avatarFile}`;
        img.classList.add("avatar-option");
        img.alt = "Avatar";

        const isUnlocked = achievement ? getAchievementUnlocks().includes(achievement) : level >= reqLevel;
        const isSelected = (gameStorage.getItem("playerAvatar") || "avatar.png") === avatarFile;
        if (isSelected) img.classList.add("selected");
        const frameWrap = document.createElement("span");
        frameWrap.className = "avatar-option-frame";
        const appliedFrame = gameStorage.getItem("playerFrame");
        if (appliedFrame) decorateAvatar(frameWrap, appliedFrame);

        if (isUnlocked) {
            img.addEventListener("click", () => {
                avatarImg.src = `assets/avatar/${avatarFile}`;
                gameStorage.setItem("playerAvatar", avatarFile);
                updateAvatarFrame();
                renderAvatarFrameChooser();
                renderAchievementRewards();
                avatarGrid.querySelectorAll(".avatar-option").forEach(el => el.classList.remove("selected"));
                img.classList.add("selected");
                setTimeout(() => {
                    avatarModal.classList.remove("active");
                    showToast("Avatar changed!");
                }, 180);
            });
        } else {
            img.classList.add("locked");
            img.addEventListener("click", () => {
                const def = achievement ? ACHIEVEMENT_DEFS.find(item => item.id === achievement) : null;
                showToast(def ? `Unlock through achievement: ${def.title}` : `Avatar unlocks at level ${reqLevel}. Your level: ${level}.`);
            });
        }

        frameWrap.appendChild(img);
        wrap.appendChild(frameWrap);

        const label = document.createElement("div");
        label.className = "avatar-cell-label" + (isUnlocked ? " unlocked" : " locked");
        label.textContent = isUnlocked ? "Unlocked" : achievement ? (ACHIEVEMENT_DEFS.find(def => def.id === achievement)?.title || "Achievement reward") : `Lv. ${reqLevel}`;
        wrap.appendChild(label);

        avatarGrid.appendChild(wrap);
    });
}

if (avatarImg && avatarModal) {
    avatarImg.addEventListener("click", () => {
        renderAvatarGrid();
        renderAvatarFrameChooser();
        avatarModal.classList.add("active");
    });
}

function bindEditNameClick() {
    const editIcon = document.querySelector(".edit-name");
    if (!editIcon) return;
    const newIcon = editIcon.cloneNode(true);
    editIcon.parentNode.replaceChild(newIcon, editIcon);

    newIcon.addEventListener("click", (e) => {
        e.stopPropagation();
        const currentName = nameText.querySelector(".player-name-text")?.textContent.trim() || "";
        nameInput.value = currentName;
        nameError.textContent = "";
        nameModal.classList.add("active");
        nameInput.focus();
    });
}

const saveNameBtn = document.getElementById("save-name-btn");
if (saveNameBtn) {
    saveNameBtn.addEventListener("click", () => {
        const newName = nameInput.value.trim().toLowerCase();
        if (newName.length < 3 || newName.length > 15) { nameError.textContent = "Name must be 3 to 15 characters"; return; }
        if (!/^[a-zA-Z0-9_]+$/.test(newName)) { nameError.textContent = "Only English letters, digits and _"; return; }
        if (takenNames.includes(newName)) { nameError.textContent = "That name is already taken"; return; }

        gameStorage.setItem("playerName", nameInput.value.trim());
        updatePlayerNameDisplay(nameInput.value.trim());
        updatePlayerTitle();
        nameModal.classList.remove("active");
        showToast("Nickname changed!");
    });
}

const closeAvatarBtn = document.querySelector("#avatar-modal .close-modal-btn");
if (closeAvatarBtn) closeAvatarBtn.addEventListener("click", () => avatarModal.classList.remove("active"));
const cancelNameBtn = document.querySelector("#name-modal .cancel-btn");
if (cancelNameBtn) cancelNameBtn.addEventListener("click", () => nameModal.classList.remove("active"));

document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.classList.remove("active");
    });
});

loadProfile();

// ==========================================
// ПОЛУЧЕНИЕ ВАЛЮYOU ЗА РЕКЛАМУ
// ==========================================

const rewardsData = { coin: [500], gem: [10] };
const coinsModal = document.getElementById("coins-modal");
const gemsModal = document.getElementById("gems-modal");

document.querySelectorAll(".coin-currency").forEach(el => {
    el.addEventListener("click", () => { updateRewardUI("coin"); if (coinsModal) coinsModal.classList.add("active"); });
});

document.querySelectorAll(".gem-currency").forEach(el => {
    el.addEventListener("click", () => { updateRewardUI("gem"); if (gemsModal) gemsModal.classList.add("active"); });
});

const closeCoinsBtn = document.getElementById("close-coins-btn");
if (closeCoinsBtn) closeCoinsBtn.addEventListener("click", () => coinsModal.classList.remove("active"));
const closeGemsBtn = document.getElementById("close-gems-btn");
if (closeGemsBtn) closeGemsBtn.addEventListener("click", () => gemsModal.classList.remove("active"));

function updateRewardUI(type) {
    const modal = type === "coin" ? coinsModal : gemsModal;
    if (!modal) return;
    const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
    const claimedRewards = JSON.parse(gameStorage.getItem(storageKey)) || [];

    modal.querySelectorAll(".reward-card").forEach((card, index) => {
        const btn = card.querySelector(".reward-btn");
        if (claimedRewards.includes(index)) {
            card.classList.add("claimed");
            btn.disabled = true;
            btn.textContent = "Claimed";
        } else {
            card.classList.remove("claimed");
            btn.disabled = false;
            btn.textContent = "Watch video";
        }
    });

    const closeBtn = type === "coin" ? document.getElementById("close-coins-btn") : document.getElementById("close-gems-btn");
    if (closeBtn) closeBtn.textContent = claimedRewards.length >= 1 ? "Come back tomorrow!" : "Close";
}

// Единый обработчик получения награды: один просмотр рекламы — одна награда.
function handleRewardClaim(btn) {
    if (!btn || btn.disabled) return;
    const card = btn.closest(".reward-card");
    if (!card) return;
    const index = parseInt(card.dataset.index, 10) || 0;
    const type = card.dataset.type || "coin";
    const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
    const claimedRewards = JSON.parse(gameStorage.getItem(storageKey)) || [];
    if (claimedRewards.includes(index)) return;

    btn.textContent = "Loading ad...";
    btn.disabled = true;

    showRewardedAd((success) => {
        if (success) {
            const rewardAmount = rewardsData[type][index];
            if (type === "coin") playerState.coins += rewardAmount;
            else playerState.gems += rewardAmount;

            saveCurrency();
            updateCurrencyUI();
            playSound("shop");

            const claimed = JSON.parse(gameStorage.getItem(storageKey)) || [];
            if (!claimed.includes(index)) claimed.push(index);
            gameStorage.setItem(storageKey, JSON.stringify(claimed));

            updateRewardUI("coin");
            updateRewardUI("gem");
            updateShopUI();
            showToast(`You received ${rewardAmount} ${type === "coin" ? "coins" : "gems"}!`);
        } else {
            // Причина уже показана игроку в showRewardedAd
            playSound("error");
            btn.textContent = "Watch video";
            btn.disabled = false;
        }
    });
}

document.querySelectorAll(".reward-btn").forEach(btn => {
    // Пропускаем уже привязанные кнопки
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    btn.addEventListener("click", (e) => handleRewardClaim(e.currentTarget));
});

function checkDailyReset() {
    const lastReset = gameStorage.getItem("lastRewardReset");
    const today = new Date().toDateString();
    if (lastReset !== today) {
        gameStorage.removeItem("claimedCoins");
        gameStorage.removeItem("claimedGems");
        gameStorage.setItem("lastRewardReset", today);
    }
}
checkDailyReset();

// ==========================================
// ВЫПАДАЮЩИЕ МЕНЮ (Notifications / Settings)
// ==========================================

const btnNotifications = document.getElementById("btn-notifications");
const btnSettings = document.getElementById("btn-settings");
const menuNotifications = document.getElementById("menu-notifications");
const menuSettings = document.getElementById("menu-settings");

function toggleMenu(menu, otherMenu) {
    if (otherMenu && otherMenu.classList.contains("active")) otherMenu.classList.remove("active");
    if (menu) menu.classList.toggle("active");
}

if (btnNotifications && btnSettings && menuNotifications && menuSettings) {
    btnNotifications.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(menuNotifications, menuSettings); });
    btnSettings.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(menuSettings, menuNotifications); });
    document.addEventListener("click", () => {
        menuNotifications.classList.remove("active");
        menuSettings.classList.remove("active");
    });
    menuNotifications.addEventListener("click", (e) => e.stopPropagation());
    menuSettings.addEventListener("click", (e) => e.stopPropagation());
}

const resetProgressBtn = document.getElementById("btn-reset-progress");
if (resetProgressBtn) {
    resetProgressBtn.addEventListener("click", () => {
        showConfirm({
            title: "Reset progress?",
            text: "Are you sure you want to reset ALL progress? Coins, gems, inventory and level will be deleted. This cannot be undone.",
            okText: "Reset everything",
            danger: true
        }, async (ok) => {
            if (!ok) return;
            resetProgressBtn.disabled = true;
            try {
                if (typeof window.__clearGameProgress === "function") {
                    await window.__clearGameProgress();
                } else {
                    gameStorage.clear();
                    gameStorage.setItem("artifactClashLocalSaveMigratedV1", "true");
                }
                location.reload();
            } catch (error) {
                console.error("Unable to reset game progress:", error);
                resetProgressBtn.disabled = false;
                showToast("Could not reset progress. Please try again.");
            }
        });
    });
}

// ==========================================
// ЛУЧШИЙ ДРОП
// ==========================================

function renderBestDrop() {
    const bestDropJSON = gameStorage.getItem("bestDrop");
    const dropImg = document.getElementById("drop-display-img");
    const dropName = document.getElementById("drop-display-name");
    const dropRarity = document.getElementById("drop-display-rarity");
    const dropValue = document.getElementById("drop-display-value");

    if (!dropImg || !dropName) return;

    if (bestDropJSON) {
        const bestDrop = JSON.parse(bestDropJSON);
        dropImg.src = artifactImgSrc(bestDrop.image);
        dropImg.style.opacity = "1";
        dropImg.style.padding = "0";
        dropName.innerHTML = bestDrop.name.replace(" ", "<br>");
        dropRarity.style.display = "inline-block";
        dropRarity.textContent = bestDrop.rarity;
        dropRarity.className = `rarity rarity-${bestDrop.rarity.toLowerCase()}`;
        dropValue.style.display = "inline-block";
        dropValue.textContent = `+${bestDrop.value} cr.`;
    } else {
        dropImg.src = "assets/logo.png";
        dropImg.style.opacity = "0.3";
        dropImg.style.padding = "40px";
        dropName.textContent = "No drops yet";
        dropRarity.style.display = "none";
        dropValue.style.display = "none";
    }
}
renderBestDrop();

// Нормализация пути к картинке артефакта: старые сохранения хранят .png,
// а файлы в assets/artifacts теперь в .webp
function artifactImgSrc(image) {
    return "assets/artifacts/" + String(image || "").replace(/\.png$/i, ".webp");
}

// ==========================================
// БАЗА АРТЕФАКТОВ
// ==========================================

// ==========================================
// БАЛАНСИРОВКА: ЦЕНЫ ПРИВЯЗАНЫ К РЕДКОСТИ
// Common: 10-50 | Rare: 100-500 | Epic: 800-2500 | Legendary: 3000-8000 | Mythic: 10000+
// ==========================================
const artifactsDB = {
    // --- COMMON (10-50) ---
    "stone": { name: "Stone 'just a stone'", image: "common/stone.webp", rarity: "Common", value: 10, desc: "Does absolutely nothing. But at least it is honest." },
    "glass_half": { name: "Glass 'half way'", image: "common/glass_half.webp", rarity: "Common", value: 15, desc: "Half empty. Half full. Half forgotten on the table." },
    "pen_empty": { name: "Pen 'out of ink'", image: "common/pen_empty.webp", rarity: "Common", value: 18, desc: "Ran out of ink exactly while you were signing an important document." },
    "slime_smart": { name: "Slime 'almost smart'", image: "common/slime_smart.webp", rarity: "Common", value: 22, desc: "Tried to solve a theorem, then forgot how to breathe." },
    "moth_light": { name: "Moth 'to the light'", image: "common/moth_light.webp", rarity: "Common", value: 25, desc: "Flying toward the light since 2015. Still has not arrived." },
    "nut_useful": { name: "Nut 'I will be useful someday'", image: "common/nut_useful.webp", rarity: "Common", value: 12, desc: "Sitting in a drawer for 10 years. Waiting for a moment that will never come." },
    "panel_broken": { name: "Panel 'almost working'", image: "common/panel_broken.webp", rarity: "Common", value: 20, desc: "Works at 99 percent. The other 1 percent is when you are in a hurry." },
    "paperclip": { name: "Paperclip 'one more document'", image: "common/paperclip.webp", rarity: "Common", value: 10, desc: "Bent, unbent and bent again. Just like your career." },
    "door_handle": { name: "Door handle 'not that way'", image: "common/door_handle.webp", rarity: "Common", value: 30, desc: "Opens a door that leads into a wall." },
    "slime_compass": { name: "Slime compass", image: "common/slime_compass.webp", rarity: "Common", value: 35, desc: "Always points at the fridge." },
    "compass_north": { name: "Compass 'almost north'", image: "common/compass_north.webp", rarity: "Common", value: 32, desc: "Points north. Sometimes south. Mostly at the couch." },
    "rusty_wrench": { name: "Rusty bolt wrench", image: "common/rusty_wrench.webp", rarity: "Common", value: 24, desc: "Perfect for stripping any nut. Or a finger." },
    "mug_hot": { name: "Mug 'almost hot'", image: "common/mug_hot.webp", rarity: "Common", value: 22, desc: "The tea cools down exactly one second before your first sip." },
    "spoon_bad": { name: "Spoon of the failed bite", image: "common/spoon_bad.webp", rarity: "Common", value: 28, desc: "Always spills soup past your mouth. Right onto the white shirt." },

    // --- RARE (100-500) ---
    "toaster_doom": { name: "Toaster of doom", image: "rare/toaster_doom.webp", rarity: "Rare", value: 150, desc: "Burns even what you never put inside." },
    "fork_dilemma": { name: "Fork of the eternal dilemma", image: "rare/fork_dilemma.webp", rarity: "Rare", value: 180, desc: "4 prongs left, 4 right. The choice is impossible." },
    "neuro_flashlight": { name: "Neuro flashlight", image: "rare/neuro_flashlight.webp", rarity: "Rare", value: 250, desc: "Lights up your thoughts. Sadly, only the dumb ones." },
    "boots_backwards": { name: "Backward heel boots", image: "rare/boots_backwards.webp", rarity: "Rare", value: 220, desc: "Let you walk backwards at incredible speed." },
    "map_somewhere": { name: "Map 'somewhere around here'", image: "rare/map_somewhere.webp", rarity: "Rare", value: 120, desc: "Shows an X in the ocean. You cannot swim." },
    "hourglass_minute": { name: "Hourglass 'just a minute'", image: "rare/hourglass_minute.webp", rarity: "Rare", value: 200, desc: "The sand never runs out. Neither do your excuses." },
    "antenna_poor": { name: "Antenna 'I hear you badly'", image: "rare/antenna_poor.webp", rarity: "Rare", value: 110, desc: "Only picks up signals from last Tuesday." },
    "fragment_fault": { name: "Fragment 'not my fault'", image: "rare/fragment_fault.webp", rarity: "Rare", value: 140, desc: "Broke off something important. But you had nothing to do with it." },
    "cable_tangled": { name: "Cable 'tangled itself'", image: "rare/cable_tangled.webp", rarity: "Rare", value: 130, desc: "It ties knots while you sleep." },
    "stamp_pending": { name: "Stamp 'almost approved'", image: "rare/stamp_pending.webp", rarity: "Rare", value: 100, desc: "Confirms everything except your salary." },
    "folder_wrong": { name: "Folder 'wrong place'", image: "rare/folder_wrong.webp", rarity: "Rare", value: 160, desc: "Contains important documents that nobody will ever find." },
    "printer_jammed": { name: "Printer 'jammed'", image: "rare/printer_jammed.webp", rarity: "Rare", value: 145, desc: "Ate your report. And your career too." },
    "cat_notmine": { name: "Cat 'not mine'", image: "rare/cat_notmine.webp", rarity: "Rare", value: 400, desc: "It came by itself. It will not leave. Draw your own conclusions." },
    "hamster_world": { name: "Hamster 'backup world'", image: "rare/hamster_world.webp", rarity: "Rare", value: 500, desc: "Its cheeks hold at least one galaxy." },

    // --- EPIC (800-2500) ---
    "teapot_infinity": { name: "Teapot of infinity", image: "epic/teapot_infinity.webp", rarity: "Epic", value: 900, desc: "Boils forever. Pours emptiness." },
    "crystal_destiny": { name: "Crystal of questionable taste", image: "epic/crystal_destiny.webp", rarity: "Epic", value: 1200, desc: "Glows. Does nothing. Tastes like a battery." },
    "frying_pan": { name: "Soft landing frying pan", image: "epic/frying_pan.webp", rarity: "Epic", value: 850, desc: "Cooks an omelette. Once. Then it flies away." },
    "cloak_jumper": { name: "Cloak of the cautious jumper", image: "epic/cloak_jumper.webp", rarity: "Epic", value: 1000, desc: "Slows your fall just enough for you to get scared." },
    "helmet_commentator": { name: "Helmet of the quiet commentator", image: "epic/helmet_commentator.webp", rarity: "Epic", value: 1500, desc: "Lets you comment on your boss, but he will not hear you." },
    "gloves_fault": { name: "Gloves 'not my fault'", image: "epic/gloves_fault.webp", rarity: "Epic", value: 1100, desc: "You can break a vase in them and say it was already like that." },
    "candle_chance": { name: "Candle of the last chance", image: "epic/candle_chance.webp", rarity: "Epic", value: 800, desc: "Burns exactly until the moment you give up." },
    "trash_ideas": { name: "Trash can of singularity", image: "epic/trash_ideas.webp", rarity: "Epic", value: 1150, desc: "All your startups are in here. And they attract garbage." },
    "lantern_socks": { name: "Lantern of lost socks", image: "epic/lantern_socks.webp", rarity: "Epic", value: 950, desc: "Attracts lost socks from the whole neighborhood." },
    "chest_stranger": { name: "Reliquary of the wanderer", image: "epic/chest_stranger.webp", rarity: "Epic", value: 1800, desc: "Holds dust from 100 cities." },
    "coffee_machine": { name: "Coffee machine 'one more'", image: "epic/coffee_machine.webp", rarity: "Epic", value: 1050, desc: "Brews coffee that makes you shake." },
    "heart_singularity": { name: "Heart of cozy singularity", image: "epic/heart_singularity.webp", rarity: "Epic", value: 1300, desc: "Warms better than a blanket. But may swallow your house." },
    "fox_plan": { name: "Fox 'clever plan'", image: "epic/fox_plan.webp", rarity: "Epic", value: 1600, desc: "The plan had three parts: steal, eat, run." },
    "exoskeleton_tired": { name: "Exoskeleton of a tired hero", image: "mythic/exoskeleton_tired.webp", rarity: "Epic", value: 2500, desc: "He fought evil. Now he wants to sleep." },

    // --- LEGENDARY (3000-8000) ---
    "knife_blunt": { name: "Knife that does not cut", image: "legendary/knife_blunt.webp", rarity: "Legendary", value: 3500, desc: "Safe for fingers. And for food." },
    "plate_second": { name: "Plate of the endless second", image: "legendary/plate_second.webp", rarity: "Legendary", value: 3200, desc: "You will never go hungry. And never lose weight." },
    "backpack_bottomless": { name: "Bottomless pocket backpack", image: "legendary/backpack_bottomless.webp", rarity: "Legendary", value: 3000, desc: "You can find everything inside except what you are looking for." },
    "helmet_legendary": { name: "Helmet 'almost legendary'", image: "legendary/helmet_legendary.webp", rarity: "Legendary", value: 3100, desc: "Differs from the legendary one by the missing crown." },
    "feather_writer": { name: "Quill of the late writer", image: "legendary/feather_writer.webp", rarity: "Legendary", value: 3300, desc: "Writes only at night. And only about how tired you are." },
    "key_wrong_door": { name: "Key to the wrong door", image: "legendary/key_wrong_door.webp", rarity: "Legendary", value: 4000, desc: "Opens only the door you do not need." },
    "lock_unopened": { name: "Hatch 'do not open'", image: "legendary/lock_unopened.webp", rarity: "Legendary", value: 5000, desc: "If you open it, you will regret it." },
    "box_black": { name: "Black box 'recorded everything'", image: "legendary/box_black.webp", rarity: "Legendary", value: 3800, desc: "Stores recordings of your most awkward moments." },
    "badge_intern": { name: "Badge 'intern'", image: "legendary/badge_intern.webp", rarity: "Legendary", value: 4500, desc: "Grants the right to free coffee. That is it." },
    "handle_busy": { name: "Meeting room 'occupied'", image: "legendary/handle_busy.webp", rarity: "Legendary", value: 5500, desc: "There is always someone inside. Even when the room is empty." },
    "penguin_golden": { name: "Penguin 'cool head'", image: "legendary/penguin_golden.webp", rarity: "Legendary", value: 6500, desc: "Does not panic even while drowning. The perfect employee." },
    "dragon_sneeze": { name: "Little dragon 'almost fire breathing'", image: "legendary/dragon_sneeze.webp", rarity: "Legendary", value: 8000, desc: "Sneezes sparks. Do not feed it pepper." },

    // --- MYTHIC (10000+) ---
    "chair_minutes": { name: "Chair 'five more minutes'", image: "mythic/chair_minutes.webp", rarity: "Mythic", value: 12000, desc: "You sit down and lose track of time." },
    "satellite_space": { name: "Satellite 'personal space'", image: "mythic/satellite_space.webp", rarity: "Mythic", value: 15000, desc: "Guards your borders. Keeps everyone at least 10 meters away." },
    "mirror_truth": { name: "Shard of the mirror of truth", image: "mythic/mirror_truth.webp", rarity: "Mythic", value: 10000, desc: "Shows the truth. Usually it is 'you look tired'." },
    "reactor_stable": { name: "Reactor 'almost stable'", image: "mythic/reactor_stable.webp", rarity: "Mythic", value: 20000, desc: "It will not explode. Probably." },
    "void_pet": { name: "Pet of the void", image: "mythic/void_pet.webp", rarity: "Mythic", value: 11000, desc: "Looks at you with judgment. It knows what you did." }
};

// ==========================================
// КЕЙСЫ
// ==========================================

// ==========================================
// КОНФИГУРАЦИЯ КЕЙСОВ (БАЛАНС ШАНСОВ 100%)
// ==========================================
const CASES_DATA = {
    "bara": {
        title: "Junk Market",
        desc: "Everything almost works. Almost cheap.",
        price: 100,
        img: "case-common.png",
        pool: [
            { id: "stone", chance: 25 }, { id: "paperclip", chance: 20 }, { id: "nut_useful", chance: 15 },
            { id: "pen_empty", chance: 10 }, { id: "glass_half", chance: 10 }, { id: "panel_broken", chance: 8 },
            { id: "rusty_wrench", chance: 5 }, { id: "mug_hot", chance: 4 }, { id: "spoon_bad", chance: 2 },
            { id: "antenna_poor", chance: 1 } // Rare drop
        ]
    },
    "office": {
        title: "Office Dump",
        desc: "Bureaucracy that will survive the apocalypse.",
        price: 300,
        img: "case-rare.png",
        pool: [
            { id: "stamp_pending", chance: 20 }, { id: "cable_tangled", chance: 15 }, { id: "fragment_fault", chance: 15 },
            { id: "map_somewhere", chance: 10 }, { id: "printer_jammed", chance: 10 }, { id: "folder_wrong", chance: 8 },
            { id: "fork_dilemma", chance: 7 }, { id: "boots_backwards", chance: 5 }, { id: "toaster_doom", chance: 4 },
            { id: "neuro_flashlight", chance: 3 }, { id: "cat_notmine", chance: 2 }, { id: "hamster_world", chance: 1 }
        ]
    },
    "lab": {
        title: "Splat Lab",
        desc: "Scientists wanted it cozy. It got too cozy.",
        price: 750,
        img: "case-lab.png",
        pool: [
            { id: "slime_compass", chance: 20 }, { id: "door_handle", chance: 15 }, { id: "compass_north", chance: 10 },
            { id: "teapot_infinity", chance: 10 }, { id: "frying_pan", chance: 10 }, { id: "lantern_socks", chance: 8 },
            { id: "cloak_jumper", chance: 7 }, { id: "coffee_machine", chance: 6 }, { id: "gloves_fault", chance: 5 },
            { id: "crystal_destiny", chance: 4 }, { id: "fox_plan", chance: 3 }, { id: "chest_stranger", chance: 2 }
        ]
    },
    "mystic": {
        title: "Mystic Catalog",
        desc: "You did not order this. It is already on its way.",
        price: 1500,
        img: "case-mystic.png",
        pool: [
            { id: "candle_chance", chance: 14 }, { id: "trash_ideas", chance: 12 }, { id: "heart_singularity", chance: 11 },
            { id: "helmet_commentator", chance: 11 }, { id: "exoskeleton_tired", chance: 9 }, { id: "backpack_bottomless", chance: 9 },
            { id: "plate_second", chance: 8 }, { id: "knife_blunt", chance: 7 }, { id: "feather_writer", chance: 6 },
            { id: "box_black", chance: 5 }, { id: "key_wrong_door", chance: 4 }, { id: "mirror_truth", chance: 2 },
            { id: "void_pet", chance: 1 }, { id: "chair_minutes", chance: 1 }
        ]
    },
    "home": {
        title: "Home Hoard",
        desc: "Cleaned up. Found something better left unfound.",
        price: 4000,
        img: "case-legendary.png",
        pool: [
            { id: "helmet_legendary", chance: 16 }, { id: "lock_unopened", chance: 13 }, { id: "badge_intern", chance: 11 },
            { id: "handle_busy", chance: 11 }, { id: "penguin_golden", chance: 9 }, { id: "dragon_sneeze", chance: 5 },
            { id: "mirror_truth", chance: 10 }, { id: "void_pet", chance: 8 }, { id: "chair_minutes", chance: 7 },
            { id: "satellite_space", chance: 6 }, { id: "reactor_stable", chance: 4 }
        ]
    },
    "space": {
        title: "Space Junk",
        desc: "All that is left of the Almost Arrived program.",
        price: 10000,
        img: "case-space.png",
        pool: [
            { id: "satellite_space", chance: 25 }, { id: "reactor_stable", chance: 20 }, { id: "void_pet", chance: 15 },
            { id: "chair_minutes", chance: 15 }, { id: "dragon_sneeze", chance: 10 }, { id: "penguin_golden", chance: 10 },
            { id: "mirror_truth", chance: 5 }
        ]
    }
};

// ==========================================
// DAILY MISSIONS + PERMANENT ARTIFACT COLLECTION
// ==========================================
const DAILY_MISSION_DEFS = [
    { id: "openCases", title: "Open 3 cases", icon: "case", goal: 3, xp: 120 },
    { id: "sellItems", title: "Sell 5 artifacts", icon: "coin", goal: 5, xp: 100 },
    { id: "winBattles", title: "Win 1 battle", icon: "sword", goal: 1, xp: 150 },
    { id: "upgrades", title: "Attempt 1 upgrade", icon: "sparkle", goal: 1, xp: 130 }
];
const MISSION_STATE_KEY = "dailyMissionsState";
const COLLECTION_STATE_KEY = "artifactCollection";
const COLLECTION_REWARDS_KEY = "completedCollections";
const ACHIEVEMENT_STATE_KEY = "achievementProgressV1";
const ACHIEVEMENT_UNLOCKS_KEY = "achievementUnlocksV1";
const FRAME_REWARDS = [
    { id: "frame-bronze", name: "Bronze", className: "frame-bronze" },
    { id: "frame-silver", name: "Silver", className: "frame-silver" },
    { id: "frame-gold", name: "Gold", className: "frame-gold" },
    { id: "frame-purple", name: "Purple", className: "frame-purple" },
    { id: "frame-legendary", name: "Legendary", className: "frame-legendary" }
];
const EXCLUSIVE_AVATARS = [
    { file: "avatar-collector.png", name: "Collector" },
    { file: "avatar-fighter.png", name: "Fighter" },
    { file: "avatar-upgrader.png", name: "Upgrader" },
    { file: "avatar-legend.png", name: "Legend" }
];
const ACHIEVEMENT_DEFS = [
    { id: "first-synthesis", title: "First Synthesis", description: "Successfully upgrade an artifact.", goal: 1, progress: s => s.syntheses || 0, reward: "Bronze avatar frame", frame: "frame-bronze", gems: 10 },
    { id: "bara-collection", title: "Junk Market Collector", description: "Complete the Junk Market collection.", goal: 1, progress: () => getCollectionRewardState().includes("bara") ? 1 : 0, reward: "Silver avatar frame", frame: "frame-silver", gems: 20 },
    { id: "battle-wins-10", title: "Battle Veteran", description: "Win 10 battles.", goal: 10, progress: s => s.battleWins || 0, reward: "Gold avatar frame", frame: "frame-gold", gems: 30 },
    { id: "level-10", title: "Rising Star", description: "Reach level 10.", goal: 10, progress: () => playerState.level, reward: "Purple avatar frame", frame: "frame-purple", gems: 20 },
    { id: "full-collection", title: "Master Collector", description: "Collect every artifact.", goal: Object.keys(artifactsDB).length, progress: () => Object.keys(getCollectionState()).filter(id => artifactsDB[id]).length, reward: "Animated legendary frame", frame: "frame-legendary", gems: 50 },
    { id: "collector-avatar", title: "Collector", description: "Complete the entire artifact collection.", goal: Object.keys(artifactsDB).length, progress: () => Object.keys(getCollectionState()).filter(id => artifactsDB[id]).length, reward: "Exclusive Collector avatar", avatar: "avatar-collector.png", gems: 25 },
    { id: "fighter-avatar", title: "Fighter", description: "Win 50 battles.", goal: 50, progress: s => s.battleWins || 0, reward: "Exclusive Fighter avatar", avatar: "avatar-fighter.png", gems: 40 },
    { id: "upgrader-avatar", title: "Upgrader", description: "Attempt 20 upgrades.", goal: 20, progress: s => s.upgrades || 0, reward: "Exclusive Upgrader avatar", avatar: "avatar-upgrader.png", gems: 25 },
    { id: "legend-avatar", title: "Legend", description: "Reach level 50.", goal: 50, progress: () => playerState.level, reward: "Exclusive Legend avatar", avatar: "avatar-legend.png", gems: 50 }
];

function getAchievementState() {
    try { return JSON.parse(gameStorage.getItem(ACHIEVEMENT_STATE_KEY) || "{}"); } catch (e) { return {}; }
}
function getAchievementUnlocks() {
    try { return JSON.parse(gameStorage.getItem(ACHIEVEMENT_UNLOCKS_KEY) || "[]"); } catch (e) { return []; }
}
function decorateAvatar(element, frameId = gameStorage.getItem("playerFrame")) {
    if (!element) return;
    FRAME_REWARDS.forEach(frame => element.classList.remove(frame.className));
    const frame = FRAME_REWARDS.find(item => item.id === frameId);
    element.classList.toggle("avatar-framed", !!frame);
    if (frame) element.classList.add(frame.className);
}
function updateAvatarFrame() {
    try {
        const frameId = gameStorage.getItem("playerFrame");
        decorateAvatar(document.getElementById("profile-avatar-frame"), frameId);
        decorateAvatar(avatarImg, frameId);
        ["battle-player-frame", "vs-player-frame"].forEach(id => decorateAvatar(document.getElementById(id), frameId));
    } catch (e) { /* Achievement styles are initialized later in the script. */ }
}
function checkAchievements() {
    if (typeof ACHIEVEMENT_DEFS === "undefined") return;
    const state = getAchievementState();
    const unlocked = getAchievementUnlocks();
    let changed = false;
    ACHIEVEMENT_DEFS.forEach(def => {
        const progress = Math.min(def.goal, Math.max(0, Number(def.progress(state)) || 0));
        if (progress < def.goal || unlocked.includes(def.id)) return;
        unlocked.push(def.id);
        changed = true;
        playerState.gems += def.gems;
        saveCurrency();
        updateCurrencyUI();
        try { playSound("achiv"); } catch (e) {}
        if (typeof addNotification === "function") addNotification(`Achievement unlocked: ${def.title}`, `${def.description} Reward: ${def.reward} and ${def.gems} crystals.`, () => openAchievementsModal(def.id));
        showToast(`Achievement unlocked: ${def.title} · +${def.gems} crystals`, () => openAchievementsModal(def.id));
    });
    if (changed) {
        gameStorage.setItem(ACHIEVEMENT_UNLOCKS_KEY, JSON.stringify(unlocked));
        updateCurrencyUI();
        updateAvatarFrame();
        renderAchievementsMini();
        renderAchievementRewards();
        if (achievementsModal?.classList.contains("active")) renderAchievementList();
    }
}
function recordAchievementProgress(key, amount = 1) {
    const state = getAchievementState();
    state[key] = (Number(state[key]) || 0) + amount;
    gameStorage.setItem(ACHIEVEMENT_STATE_KEY, JSON.stringify(state));
    checkAchievements();
    renderAchievementList();
}

function getLocalDayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getDailyMissionState() {
    const today = getLocalDayKey();
    let state;
    try { state = JSON.parse(gameStorage.getItem(MISSION_STATE_KEY) || "null"); } catch (e) { state = null; }
    if (!state || state.day !== today) {
        state = { day: today, progress: {}, claimed: [], bonusClaimed: false };
        gameStorage.setItem(MISSION_STATE_KEY, JSON.stringify(state));
    }
    return state;
}

function saveDailyMissionState(state) {
    gameStorage.setItem(MISSION_STATE_KEY, JSON.stringify(state));
}

function recordMissionProgress(missionId, amount = 1) {
    const def = DAILY_MISSION_DEFS.find(mission => mission.id === missionId);
    if (!def) return;
    const state = getDailyMissionState();
    const wasComplete = (state.progress[missionId] || 0) >= def.goal;
    state.progress[missionId] = Math.min(def.goal, (state.progress[missionId] || 0) + amount);
    saveDailyMissionState(state);
    renderDailyMissions();
    if (!wasComplete && state.progress[missionId] >= def.goal) {
        const badge = document.getElementById("missions-nav-badge");
        if (badge) badge.classList.add("visible");
        showToast(`Mission completed: ${def.title}`);
    }
}

function renderDailyMissions() {
    const list = document.getElementById("missions-list");
    const bonus = document.getElementById("missions-bonus");
    const claim = document.getElementById("missions-bonus-claim");
    if (!list || !bonus || !claim) return;
    const state = getDailyMissionState();
    const badge = document.getElementById("missions-nav-badge");
    const hasClaimableMission = DAILY_MISSION_DEFS.some(def =>
        (state.progress[def.id] || 0) >= def.goal && !state.claimed.includes(def.id)
    );
    const allMissionsComplete = DAILY_MISSION_DEFS.every(def => (state.progress[def.id] || 0) >= def.goal);
    const hasClaimableBonus = allMissionsComplete && !state.bonusClaimed;
    if (badge) badge.classList.toggle("visible", hasClaimableMission || hasClaimableBonus);
    list.innerHTML = "";
    let allComplete = true;
    DAILY_MISSION_DEFS.forEach(def => {
        const progress = Math.min(def.goal, state.progress[def.id] || 0);
        const done = progress >= def.goal;
        if (!done) allComplete = false;
        const claimed = state.claimed.includes(def.id);
        const card = document.createElement("article");
        card.className = `mission-card${done ? " mission-done" : ""}`;
        const heading = document.createElement("div");
        heading.className = "mission-heading";
        heading.innerHTML = `<span class="mission-icon">${iconMarkup(def.icon, "icon")}</span>`;
        const text = document.createElement("div");
        text.className = "mission-copy";
        const title = document.createElement("b");
        title.textContent = def.title;
        const detail = document.createElement("small");
        detail.textContent = `${progress}/${def.goal} complete · +${def.xp} XP`;
        const bar = document.createElement("div");
        bar.className = "mission-progress";
        bar.innerHTML = "<span></span>";
        bar.firstElementChild.style.width = `${(progress / def.goal) * 100}%`;
        text.append(title, detail, bar);
        const button = document.createElement("button");
        button.className = "save-btn mission-claim-btn";
        button.textContent = claimed ? "Claimed" : done ? "Claim XP" : "In progress";
        button.disabled = !done || claimed;
        button.addEventListener("click", () => {
            const current = getDailyMissionState();
            if ((current.progress[def.id] || 0) < def.goal || current.claimed.includes(def.id)) return;
            current.claimed.push(def.id);
            saveDailyMissionState(current);
            addXP(def.xp);
            showToast(`Mission complete: +${def.xp} XP!`);
            renderDailyMissions();
        });
        heading.append(text, button);
        card.appendChild(heading);
        list.appendChild(card);
    });
    const remaining = DAILY_MISSION_DEFS.filter(def => (state.progress[def.id] || 0) >= def.goal).length;
    bonus.innerHTML = `${iconMarkup("gift")} Bonus: Complete all ${DAILY_MISSION_DEFS.length} missions to unlock one free Splat Lab case. (${remaining}/${DAILY_MISSION_DEFS.length})`;
    claim.style.display = "block";
    claim.replaceChildren();
    const bonusButton = document.createElement("button");
    bonusButton.className = "save-btn mission-bonus-btn";
    bonusButton.textContent = state.bonusClaimed ? "Splat Lab case claimed" : allComplete ? "Claim free Splat Lab case" : "Finish all missions to unlock";
    bonusButton.disabled = !allComplete || state.bonusClaimed;
    bonusButton.addEventListener("click", () => {
        const current = getDailyMissionState();
        if (current.bonusClaimed || !DAILY_MISSION_DEFS.every(def => (current.progress[def.id] || 0) >= def.goal)) return;
        current.bonusClaimed = true;
        saveDailyMissionState(current);
        renderDailyMissions();
        currentCaseData = CASES_DATA.lab;
        startRoulette(true);
        showToast("Daily bonus: a free Splat Lab case!");
    });
    claim.appendChild(bonusButton);
}

function getCollectionState() {
    try { return JSON.parse(gameStorage.getItem(COLLECTION_STATE_KEY) || "{}"); } catch (e) { return {}; }
}

function recordCollectedArtifact(item) {
    if (!item) return;
    const itemId = (item.id && artifactsDB[item.id] ? item.id : null) || Object.keys(artifactsDB).find(id => {
        const dbItem = artifactsDB[id];
        return dbItem.name === item.name && dbItem.image === item.image;
    });
    if (!itemId) return;
    const state = getCollectionState();
    state[itemId] = true;
    gameStorage.setItem(COLLECTION_STATE_KEY, JSON.stringify(state));
    checkAchievements();
    Object.entries(CASES_DATA).forEach(([caseKey, caseData]) => {
        if (getCaseCollection(caseData).every(id => state[id])) claimCollectionReward(caseKey);
    });
    renderArtifactCollection();
}

function getCaseCollection(caseData) {
    return [...new Set(caseData.pool.map(entry => entry.id).filter(id => artifactsDB[id]))];
}

function getCollectionRewardState() {
    try { return JSON.parse(gameStorage.getItem(COLLECTION_REWARDS_KEY) || "[]"); } catch (e) { return []; }
}

function claimCollectionReward(caseKey) {
    const completed = getCollectionRewardState();
    if (completed.includes(caseKey)) return;
    const caseData = CASES_DATA[caseKey];
    if (!caseData || !getCaseCollection(caseData).every(id => getCollectionState()[id])) return;
    completed.push(caseKey);
    gameStorage.setItem(COLLECTION_REWARDS_KEY, JSON.stringify(completed));
    const earnedFrames = JSON.parse(gameStorage.getItem("collectionFrames") || "[]");
    if (!earnedFrames.includes(caseKey)) earnedFrames.push(caseKey);
    gameStorage.setItem("collectionFrames", JSON.stringify(earnedFrames));
    playerState.coins += 600;
    playerState.gems += 10;
    saveCurrency();
    updateCurrencyUI();
    const title = "Certified Loot Goblin";
    gameStorage.setItem("playerTitle", title);
    const ownedTitles = JSON.parse(gameStorage.getItem("playerTitles") || "[]");
    if (!ownedTitles.includes(title)) {
        ownedTitles.push(title);
        gameStorage.setItem("playerTitles", JSON.stringify(ownedTitles));
    }
    updatePlayerTitle();
    checkAchievements();
    showToast(`Collection complete! +600 coins, +10 gems, Loot Goblin title & collector frame!`);
    renderArtifactCollection();
}

function updatePlayerTitle() {
    updateAvatarFrame();
    const titleEl = document.getElementById("player-title");
    const title = gameStorage.getItem("playerTitle");
    if (!titleEl) return;
    titleEl.innerHTML = title ? `${iconMarkup("tag")} ${escapeLbName(title)}` : "";
    titleEl.style.display = title ? "block" : "none";
    if (avatarImg) {
        let earnedFrames = [];
        try { earnedFrames = JSON.parse(gameStorage.getItem("collectionFrames") || "[]"); } catch (e) {}
        if (!gameStorage.getItem("playerFrame")) avatarImg.classList.toggle("collector-frame", earnedFrames.length > 0);
    }
}

function renderArtifactCollection() {
    const root = document.getElementById("collection-cases");
    const totalEl = document.getElementById("collection-total-progress");
    if (!root || !totalEl) return;
    const collected = getCollectionState();
    const allIds = [...new Set(Object.values(CASES_DATA).flatMap(getCaseCollection))];
    totalEl.textContent = `${allIds.filter(id => collected[id]).length}/${allIds.length} artifacts`;
    root.innerHTML = "";
    Object.entries(CASES_DATA).forEach(([caseKey, caseData]) => {
        const ids = getCaseCollection(caseData);
        const found = ids.filter(id => collected[id]).length;
        const complete = found === ids.length;
        const rewarded = getCollectionRewardState().includes(caseKey);
        const section = document.createElement("section");
        section.className = "collection-case";
        const heading = document.createElement("div");
        heading.className = "collection-case-heading";
        const title = document.createElement("h3");
        title.textContent = caseData.title;
        const progress = document.createElement("span");
        progress.textContent = `${found}/${ids.length} предметов собрано`;
        heading.append(title, progress);
        section.appendChild(heading);
        const reward = document.createElement("div");
        reward.className = "collection-reward";
        reward.innerHTML = rewarded ? `${iconMarkup("trophy")} Collection reward claimed · Loot Goblin title · Collector frame` : `${iconMarkup("trophy")} Complete set: 600 coins + 10 gems + a unique collector frame + title`;
        section.appendChild(reward);
        const grid = document.createElement("div");
        grid.className = "collection-items";
        ids.forEach(id => {
            const item = artifactsDB[id];
            const card = document.createElement("div");
            card.className = `collection-item${collected[id] ? " collected" : " collection-locked"} frame-item-${item.rarity.toLowerCase()}`;
            const img = document.createElement("img");
            img.src = collected[id] ? artifactImgSrc(item.image) : "assets/logo.png";
            img.alt = collected[id] ? item.name : "Unknown artifact";
            const name = document.createElement("span");
            name.textContent = collected[id] ? item.name : "???";
            card.append(img, name);
            grid.appendChild(card);
        });
        section.appendChild(grid);
        if (complete && !rewarded) {
            const button = document.createElement("button");
            button.className = "save-btn collection-claim-btn";
            button.textContent = "Claim collection reward";
            button.addEventListener("click", () => claimCollectionReward(caseKey));
            section.appendChild(button);
        }
        root.appendChild(section);
    });
}

function checkDailyMissionRollover() {
    getDailyMissionState();
    if (screenMissions && getComputedStyle(screenMissions).display !== "none") renderDailyMissions();
}
setInterval(checkDailyMissionRollover, 60000);

// ==========================================
// ДИНАМИЧЕСКИЙ РЕНДЕРИНГ КЕЙСОВ (ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ)
// ==========================================
function getCaseCardHTML(key, cData) {
    let cardClass = "case common";
    let btnStyle = "";
    let cardStyle = "";
    
    if (key === "office" || key === "mystic") cardClass = "case purple";
    else if (key === "home") cardClass = "case gold";
    else if (key === "lab") {
        cardStyle = 'border-color: #27caff; background: radial-gradient(ellipse at 50% 30%, #27caff33, transparent 65%), linear-gradient(155deg, #182958, #11142e);';
        btnStyle = 'background: linear-gradient(#27caff, #106da5); border-color: #7be3ff; box-shadow: 0 3px 0 #08466b, 0 0 12px #27caff55;';
    } else if (key === "space") {
        cardStyle = 'border-color: #ff4d4d; background: radial-gradient(ellipse at 50% 30%, #ff4d4d33, transparent 65%), linear-gradient(155deg, #3a1010, #11142e);';
        btnStyle = 'background: linear-gradient(#ff4d4d, #a30000); border-color: #ff9999; box-shadow: 0 3px 0 #5c0000, 0 0 12px #ff4d4d55;';
    }

    return `
        <article class="${cardClass}" data-case-key="${key}" ${cardStyle ? `style="${cardStyle}"` : ''}>
            <div class="case-image"><img src="assets/cases/${cData.img}" alt="${cData.title}"></div>
            <h3>${cData.title}</h3>
            <div class="price"><img src="assets/coin.png" alt=""> ${cData.price}</div>
            <button class="case-button" ${btnStyle ? `style="${btnStyle}"` : ''}>Open</button>
        </article>
    `;
}

function bindCaseButtons() {
    document.querySelectorAll(".case").forEach(card => {
        const btn = card.querySelector(".case-button");
        if (btn) {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                const caseKey = card.dataset.caseKey;
                if (caseKey) openPreview(caseKey);
            });
        }
    });
}

function renderCasesDynamically() {
    const mainGrid = document.getElementById("main-cases-grid");
    const allCasesGrid = document.getElementById("all-cases-grid");
    
    if (mainGrid) mainGrid.innerHTML = "";
    if (allCasesGrid) allCasesGrid.innerHTML = "";

    // Сортируем кейсы по цене для главной страницы
    const sortedKeys = Object.keys(CASES_DATA).sort((a, b) => CASES_DATA[a].price - CASES_DATA[b].price);
    
    // Home: только 3 самых дешевых
    if (mainGrid) {
        sortedKeys.slice(0, 3).forEach(key => {
            mainGrid.insertAdjacentHTML('beforeend', getCaseCardHTML(key, CASES_DATA[key]));
        });
    }

    // All cases: полный список
    if (allCasesGrid) {
        sortedKeys.forEach(key => {
            allCasesGrid.insertAdjacentHTML('beforeend', getCaseCardHTML(key, CASES_DATA[key]));
        });
    }

    bindCaseButtons();
}

renderCasesDynamically();

const previewModal = document.getElementById("case-preview-modal");
const openModal = document.getElementById("case-open-modal");
const resultModal = document.getElementById("drop-result-modal");
const rouletteTrack = document.getElementById("roulette-track");

let currentCaseData = null;
let currentDropItem = null;

// ==========================================
// ОТКРЫТИЕ ОКНА ПРЕВЬЮ (Карусель)
// ==========================================

function openPreview(caseKey) {
    currentCaseData = CASES_DATA[caseKey];
    if (!currentCaseData) return;

    document.getElementById("preview-title").textContent = currentCaseData.title;
    document.getElementById("preview-desc").textContent = currentCaseData.desc;
    document.getElementById("btn-price").textContent = currentCaseData.price;
    
    const previewImg = document.getElementById("preview-img");
    if (previewImg) previewImg.src = `assets/cases/${currentCaseData.img}`;

    const carousel = document.getElementById("preview-carousel");
    if (!carousel) return;
    
    carousel.innerHTML = "";

    const groupedItems = { "Common": [], "Rare": [], "Epic": [], "Legendary": [], "Mythic": [] };

    currentCaseData.pool.forEach(poolItem => {
        const item = artifactsDB[poolItem.id];
        if (item && groupedItems[item.rarity]) {
            groupedItems[item.rarity].push({ ...item, chance: poolItem.chance });
        }
    });

    const rarityOrder = ["Common", "Rare", "Epic", "Legendary", "Mythic"];

    rarityOrder.forEach(rarity => {
        const items = groupedItems[rarity];
        if (items.length === 0) return; 

        const col = document.createElement("div");
        col.className = "rarity-column";

        const title = document.createElement("div");
        title.className = `rarity-col-title title-${rarity.toLowerCase()}`;
        title.textContent = rarity;
        col.appendChild(title);

        const row = document.createElement("div");
        row.className = "rarity-row";

        items.sort((a, b) => b.chance - a.chance);

        items.forEach(item => {
            const el = document.createElement("div");
            el.className = `carousel-item frame-item-${item.rarity.toLowerCase()}`;

            let chanceColor = "#a19db9";
            if (item.rarity === "Rare") chanceColor = "#27caff";
            if (item.rarity === "Epic") chanceColor = "#b64cff";
            if (item.rarity === "Legendary") chanceColor = "#ffca35";
            if (item.rarity === "Mythic") chanceColor = "#ff4d4d";

            el.innerHTML = `
                <img src="${artifactImgSrc(item.image)}" alt="">
                <span class="item-name">${item.name}</span>
                <span class="item-chance" style="color: ${chanceColor}">${item.chance}%</span>
            `;
            
            el.addEventListener("click", () => showItemInfo(item));
            row.appendChild(el);
        });

        col.appendChild(row);
        carousel.appendChild(col);
    });

    previewModal.classList.add("active");
}

// Старый статический обработчик удален — теперь используется renderCasesDynamically()

document.getElementById("close-preview-btn").addEventListener("click", () => previewModal.classList.remove("active"));

// ==========================================
// ЗАПУСК РУЛЕТКИ
// ==========================================

document.getElementById("confirm-open-btn").addEventListener("click", () => {
    if (!currentCaseData) return;
    
    if (playerState.coins < currentCaseData.price) {
        showToast("Not enough coins!");
        return;
    }

    previewModal.classList.remove("active");
    playerState.coins -= currentCaseData.price;
    saveCurrency();
    updateCurrencyUI();

    startRoulette();
});

function getRandomWeightedEntry(pool, forceLegendary = false) {
    // Guaranteed legendary drop on the first free onboarding case.
    if (forceLegendary) {
        const legendaryItems = pool.filter(entry => artifactsDB[entry.id] && artifactsDB[entry.id].rarity === "Legendary");
        if (legendaryItems.length) return legendaryItems[Math.floor(Math.random() * legendaryItems.length)];
    }

    const validItems = pool.filter(entry => artifactsDB[entry.id] && Number(entry.chance) > 0);
    if (!validItems.length) return null;
    const totalChance = validItems.reduce((sum, entry) => sum + entry.chance, 0);
    let random = Math.random() * totalChance;
    for (const entry of validItems) {
        if (random < entry.chance) return entry;
        random -= entry.chance;
    }
    return validItems[validItems.length - 1];
}

function getRandomWeightedItem(pool, forceLegendary = false) {
    const entry = getRandomWeightedEntry(pool, forceLegendary);
    const item = entry ? artifactsDB[entry.id] : null;
    return item ? { ...item, id: entry.id } : null;
}

function startRoulette(isFree = false) {
    if (!currentCaseData || !Array.isArray(currentCaseData.pool)) {
        showToast("This case is unavailable right now.");
        return;
    }
    if (!openModal || !rouletteTrack) {
        showToast("Unable to display case roulette.");
        return;
    }
    openModal.classList.add("active");
    rouletteTrack.innerHTML = "";
    rouletteTrack.style.transition = "none";
    rouletteTrack.style.left = "0px";
    rouletteTrack.style.transform = "none";
    const rouletteContainer = rouletteTrack.parentElement;
    if (rouletteContainer) rouletteContainer.scrollLeft = 0;

    // Гарантированный легендарный дроп только при первом открытии (онбординг)
    const forceLegendary = isFree && isFirstOpenGuaranteedLegendary;

    const winningEntry = getRandomWeightedEntry(currentCaseData.pool, forceLegendary);
    if (!winningEntry || !artifactsDB[winningEntry.id]) {
        openModal.classList.remove("active");
        showToast("This case has no valid drops.");
        return;
    }
    const winningItem = { ...artifactsDB[winningEntry.id], id: winningEntry.id };
    if (forceLegendary) isFirstOpenGuaranteedLegendary = false;
    recordCollectedArtifact(winningItem);
    recordMissionProgress("openCases");

    // Keep the reel short enough to avoid mobile GPU texture limits while
    // still giving the spin a long enough travel distance.
    const totalItems = 36;
    const winningIndex = 28;

    const reelItems = [];
    const reelFragment = document.createDocumentFragment();
    for (let i = 0; i < totalItems; i++) {
        const itemToShow = (i === winningIndex) ? winningItem : getRandomWeightedItem(currentCaseData.pool);
        const el = document.createElement("div");
        el.className = "roulette-item";
        const img = document.createElement("img");
        img.alt = "";
        img.decoding = "async";
        img.loading = "eager";
        img.fetchPriority = i === winningIndex ? "high" : "auto";
        img.src = artifactImgSrc(itemToShow.image);
        el.appendChild(img);
        reelFragment.appendChild(el);
        reelItems.push(img);
    }
    rouletteTrack.appendChild(reelFragment);

    // Wait for image decoding before spinning; errors are ignored, but missing assets never stall opening.
    const reelReady = Promise.all(reelItems.map(img => {
        const loaded = img.complete ? Promise.resolve() : new Promise(resolve => {
            const finish = () => { clearTimeout(timeout); resolve(); };
            const timeout = setTimeout(finish, 2500);
            img.addEventListener("load", finish, { once: true });
            img.addEventListener("error", finish, { once: true });
        });
        return loaded.then(() => typeof img.decode === "function" ? img.decode().catch(() => {}) : undefined);
    }));
    reelReady.then(() => requestAnimationFrame(() => { 
        requestAnimationFrame(() => {
            const rouletteContainer = rouletteTrack.parentElement;
            const winningCard = rouletteTrack.children[winningIndex];
            if (!rouletteContainer || !winningCard) {
                openModal.classList.remove("active");
                showToast("Unable to display case roulette.");
                return;
            }
            const containerWidth = rouletteContainer.clientWidth;
            const itemPitch = rouletteTrack.firstElementChild.getBoundingClientRect().width +
                (parseFloat(getComputedStyle(rouletteTrack.firstElementChild).marginLeft) || 0) +
                (parseFloat(getComputedStyle(rouletteTrack.firstElementChild).marginRight) || 0);
            const cardWidth = winningCard.getBoundingClientRect().width;
            const targetLeft = (containerWidth - cardWidth) / 2 - winningIndex * itemPitch;
            rouletteTrack.style.transition = "left 5s cubic-bezier(0.15, 0.9, 0.2, 1)";
            // Animate from the rendered origin and keep the center card visible in narrow layouts.
            void rouletteTrack.offsetWidth;
            rouletteTrack.style.left = `${targetLeft}px`;

            setTimeout(() => {
                openModal.classList.remove("active");
                showResult(winningItem);
            }, 5200);
        });
    }));
}

// ==========================================
// РЕЗУЛЬТАТ
// ==========================================

function showResult(item) {
    currentDropItem = item;
    recordCollectedArtifact(item);
    resultModal.classList.add("active");
    
    document.getElementById("result-image").src = artifactImgSrc(item.image);
    document.getElementById("result-name").textContent = item.name;
    document.getElementById("result-desc").textContent = item.desc;
    document.getElementById("result-value").textContent = `+${item.value}`;
    
    const rarityEl = document.getElementById("result-rarity");
    const frameEl = document.getElementById("result-frame");
    
    frameEl.className = "result-image-wrapper";
    rarityEl.className = "result-rarity";
    rarityEl.textContent = item.rarity;
    
    if (item.rarity === "Common") { frameEl.classList.add("frame-common"); rarityEl.style.background = "#4b447c"; rarityEl.style.color = "#fff";}
    else if (item.rarity === "Rare") { frameEl.classList.add("frame-rare"); rarityEl.style.background = "#27caff"; rarityEl.style.color = "#000"; }
    else if (item.rarity === "Epic") { frameEl.classList.add("frame-epic"); rarityEl.style.background = "#8b35ff"; rarityEl.style.color = "#fff"; }
    else if (item.rarity === "Legendary") { frameEl.classList.add("frame-legendary"); rarityEl.style.background = "#ffca35"; rarityEl.style.color = "#000"; }
    else if (item.rarity === "Mythic") { frameEl.classList.add("frame-mythic"); rarityEl.style.background = "#ff4d4d"; rarityEl.style.color = "#fff"; }

    const currentBestJSON = gameStorage.getItem("bestDrop");
    const currentBest = currentBestJSON ? JSON.parse(currentBestJSON) : { value: 0 };
    if (item.value > currentBest.value) {
        gameStorage.setItem("bestDrop", JSON.stringify(item));
        renderBestDrop();
    }

    // После первого открытия добавляем уведомление о ежедневной награде
    if (isFirstOpenGuaranteedLegendary === false && !gameStorage.getItem("dailyNotifAdded")) {
        addNotification("Daily reward", "Claim your free case! Tap here.", () => {
            showMainScreen();
            setTimeout(() => {
                const dailyBlock = document.querySelector(".daily");
                if (dailyBlock) {
                    dailyBlock.scrollIntoView({ behavior: "smooth", block: "center" });
                    dailyBlock.classList.add("highlight-pulse");
                    setTimeout(() => dailyBlock.classList.remove("highlight-pulse"), 3000);
                }
            }, 300);
        });
        gameStorage.setItem("dailyNotifAdded", "true");
    }
}

// ==========================================
// СИСТЕМА УВЕДОМЛЕНИЙ
// ==========================================
function addNotification(title, text, onClickCallback) {
    const menu = document.getElementById("menu-notifications");
    if (!menu) return;
    
    const item = document.createElement("div");
    item.className = "dropdown-item";
    item.innerHTML = `<span class="notif-dot"></span><div><b>${title}</b><p>${text}</p></div>`;
    
    if (onClickCallback) {
        item.style.cursor = "pointer";
        item.addEventListener("click", () => {
            menu.classList.remove("active");
            onClickCallback();
        });
    }

    const h3 = menu.querySelector("h3");
    if (h3 && h3.nextSibling) {
        menu.insertBefore(item, h3.nextSibling);
    } else {
        menu.appendChild(item);
    }

    // Не даём списку разрастаться бесконечно
    const items = [...menu.querySelectorAll(".dropdown-item")];
    items.slice(8).forEach(el => el.remove());

    // Индикатор на иконке уведомлений
    if (btnNotifications) {
        btnNotifications.classList.add("has-new");
        btnNotifications.addEventListener("click", () => {
            btnNotifications.classList.remove("has-new");
        }, { once: true });
    }
}

// Кнопки результата
document.getElementById("btn-keep-case").addEventListener("click", () => {
    if (currentDropItem) {
        playerInventory.push(currentDropItem);
        recordCollectedArtifact(currentDropItem);
        // X2 Boost: give second copy
        if (isBoostActive()) {
            playerInventory.push({...currentDropItem});
            showToast(`BOOST! Got 2x "${currentDropItem.name}"!`);
        } else {
            showToast(`Artifact "${currentDropItem.name}" has been added to your inventory!`);
        }
        saveInventory();
        // XP for opening case
        if (currentCaseData) addXP(Math.floor(currentCaseData.price / 10));
    }
    document.getElementById("drop-result-modal").classList.remove("active");
});

document.getElementById("btn-sell-case").addEventListener("click", () => {
    if (currentDropItem) {
        recordMissionProgress("sellItems");
        playerState.coins += currentDropItem.value;
        saveCurrency();
        updateCurrencyUI();
        playSound("money");
        showToast(`You sold the artifact for ${currentDropItem.value} credits!`);
        // XP for opening case
        if (currentCaseData) addXP(Math.floor(currentCaseData.price / 10));
    }
    document.getElementById("drop-result-modal").classList.remove("active");
});

// ==========================================
// ИНВЕНТАРЬ
// ==========================================

let playerInventory = JSON.parse(gameStorage.getItem("inventory")) || [];

function saveInventory() {
    gameStorage.setItem("inventory", JSON.stringify(playerInventory));
}

function renderInventory() {
    const grid = document.getElementById("inventory-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (playerInventory.length === 0) {
        grid.innerHTML = `<div class="empty-inventory"><p>Your inventory is empty.</p><p style="font-size: 12px; color: #b8b4d9;">Open cases and collect artifacts!</p></div>`;
        return;
    }

    const sortedInv = playerInventory.map((item, index) => ({ item, index })).sort((a, b) => b.item.value - a.item.value);

    sortedInv.forEach(({ item, index }) => {
        const el = document.createElement("div");
        el.className = `inv-item frame-item-${item.rarity.toLowerCase()}`;
        el.innerHTML = `<img src="${artifactImgSrc(item.image)}" alt=""><span class="inv-name">${item.name}</span><span class="inv-value">${item.value} cr.</span>`;
        el.addEventListener("click", () => showItemInfo(item, "inventory", index));
        grid.appendChild(el);
    });
}

// Кнопка "Sell all"
document.getElementById("sell-all-btn").addEventListener("click", () => {
    if (playerInventory.length === 0) {
        showToast("Inventory is empty!");
        return;
    }

    const totalValue = playerInventory.reduce((sum, item) => sum + item.value, 0);

    showConfirm({
        title: "Sell all items?",
        text: `Are you sure you want to sell ALL items (${playerInventory.length}) for ${totalValue.toLocaleString("en-US")} credits? This cannot be undone.`,
        okText: `Sell for ${totalValue.toLocaleString("en-US")}`,
        danger: true
    }, (ok) => {
        if (!ok) return;
        recordMissionProgress("sellItems", playerInventory.length);
        playerState.coins += totalValue;
        saveCurrency();
        updateCurrencyUI();

        playerInventory = [];
        saveInventory();
        renderInventory();

        playSound("money");
        showToast(`You sold everything for ${totalValue.toLocaleString("en-US")} credits!`);
    });
});

// ==========================================
// ИНФО О ПРЕДМЕТЕ
// ==========================================

const itemInfoModal = document.getElementById("item-info-modal");
let currentInfoItem = null;
let currentInfoSource = "";
let currentInfoIndex = -1;

document.getElementById("close-item-info-btn").addEventListener("click", () => {
    itemInfoModal.classList.remove("active");
});

itemInfoModal.addEventListener("click", (e) => {
    if (e.target === itemInfoModal) itemInfoModal.classList.remove("active");
});

function showItemInfo(item, source = "preview", inventoryIndex = -1) {
    currentInfoItem = item;
    currentInfoSource = source;
    currentInfoIndex = source === "inventory" ? inventoryIndex : -1;

    document.getElementById("item-info-img").src = artifactImgSrc(item.image);
    document.getElementById("item-info-name").textContent = item.name;
    document.getElementById("item-info-desc").textContent = item.desc;
    
    const chanceEl = document.getElementById("item-info-chance");
    if (item.chance !== undefined) {
        chanceEl.textContent = `${item.chance}%`;
    } else {
        chanceEl.textContent = "Already dropped";
        chanceEl.style.fontSize = "14px";
    }
    
    document.getElementById("item-info-value").textContent = `${item.value} cr.`;
    
    const rarityEl = document.getElementById("item-info-rarity");
    const frameEl = document.getElementById("item-info-frame");
    
    frameEl.className = "item-info-image-wrapper";
    rarityEl.className = "result-rarity";
    rarityEl.textContent = item.rarity;
    
    if (item.rarity === "Common") { frameEl.classList.add("frame-common"); rarityEl.style.background = "#4b447c"; rarityEl.style.color = "#fff"; }
    else if (item.rarity === "Rare") { frameEl.classList.add("frame-rare"); rarityEl.style.background = "#27caff"; rarityEl.style.color = "#000"; }
    else if (item.rarity === "Epic") { frameEl.classList.add("frame-epic"); rarityEl.style.background = "#8b35ff"; rarityEl.style.color = "#fff"; }
    else if (item.rarity === "Legendary") { frameEl.classList.add("frame-legendary"); rarityEl.style.background = "#ffca35"; rarityEl.style.color = "#000"; }
    else if (item.rarity === "Mythic") { frameEl.classList.add("frame-mythic"); rarityEl.style.background = "#ff4d4d"; rarityEl.style.color = "#fff"; }

    const sellBtn = document.getElementById("sell-item-info-btn");
    const upgradeBtn = document.getElementById("upgrade-item-info-btn");
    sellBtn.style.display = source === "inventory" ? "block" : "none";
    upgradeBtn.style.display = source === "inventory" && item.rarity !== "Mythic" ? "block" : "none";

    itemInfoModal.classList.add("active");
}

document.getElementById("sell-item-info-btn").addEventListener("click", () => {
    if (!currentInfoItem || currentInfoSource !== "inventory") return;

    const index = playerInventory.findIndex(invItem => invItem.name === currentInfoItem.name && invItem.value === currentInfoItem.value);
    
    if (index !== -1) {
        const item = playerInventory[index];
        showConfirm({
            title: "Sell item?",
            text: `Are you sure you want to sell ${item.name} for ${item.value.toLocaleString("en-US")} credits?`,
            okText: `Sell for ${item.value.toLocaleString("en-US")}`
        }, (ok) => {
            if (!ok) return;

            const idx = playerInventory.findIndex(invItem => invItem.name === item.name && invItem.value === item.value);
            if (idx === -1) return;

            playerInventory.splice(idx, 1);
            saveInventory();
            recordMissionProgress("sellItems");

            playerState.coins += item.value;
            saveCurrency();
            updateCurrencyUI();

            playSound("money");
            showToast(`You sold ${item.name} for ${item.value} cr.`);
            renderInventory();
            itemInfoModal.classList.remove("active");
        });
    }
});

// ==========================================
// UPGRADE INVENTORY ITEMS
// ==========================================
const upgradeModal = document.getElementById("upgrade-modal");
const upgradeSourceGrid = document.getElementById("upgrade-source-grid");
const upgradeDetails = document.getElementById("upgrade-details");
const upgradeTargetGrid = document.getElementById("upgrade-target-grid");
const upgradeTrack = document.getElementById("upgrade-roulette-track");
const upgradeRoulette = document.getElementById("upgrade-roulette-container");
const upgradeStartBtn = document.getElementById("btn-start-upgrade");
const rarityProgression = ["Common", "Rare", "Epic", "Legendary", "Mythic"];
const upgradeWinChances = { Common: 45, Rare: 35, Epic: 25, Legendary: 15 };
let selectedUpgradeIndex = -1;
let upgradeInProgress = false;

function openUpgradeModal(preselectedIndex = -1) {
    if (!playerInventory.length) {
        showToast("Your inventory is empty!");
        return;
    }
    selectedUpgradeIndex = -1;
    upgradeInProgress = false;
    upgradeSourceGrid.innerHTML = "";
    upgradeTargetGrid.innerHTML = "";
    upgradeDetails.style.display = "none";
    upgradeRoulette.style.display = "none";
    upgradeStartBtn.disabled = true;
    upgradeStartBtn.textContent = "Choose an item";
    playerInventory.forEach((item, index) => {
        const card = document.createElement("div");
        card.className = `inv-item upgrade-source-item frame-item-${item.rarity.toLowerCase()}`;
        card.innerHTML = `<img src="${artifactImgSrc(item.image)}" alt=""><span class="inv-name"></span><span class="inv-value"></span>`;
        card.querySelector(".inv-name").textContent = item.name;
        card.querySelector(".inv-value").textContent = `${item.value} cr. · ${item.rarity}`;
        if (item.rarity === "Mythic") {
            card.classList.add("upgrade-unavailable");
            card.title = "Mythic is the highest rarity";
        } else {
            card.addEventListener("click", () => selectUpgradeItem(index));
        }
        card.dataset.inventoryIndex = index;
        upgradeSourceGrid.appendChild(card);
    });
    upgradeModal.classList.add("active");
    if (preselectedIndex >= 0 && preselectedIndex < playerInventory.length && playerInventory[preselectedIndex].rarity !== "Mythic") {
        selectUpgradeItem(preselectedIndex);
    }
}

function selectUpgradeItem(index) {
    if (upgradeInProgress || !playerInventory[index]) return;
    const item = playerInventory[index];
    const rarityIndex = rarityProgression.indexOf(item.rarity);
    if (rarityIndex < 0 || rarityIndex === rarityProgression.length - 1) return;
    selectedUpgradeIndex = index;
    upgradeSourceGrid.querySelectorAll(".upgrade-source-item").forEach(card => {
        card.classList.toggle("upgrade-selected", Number(card.dataset.inventoryIndex) === index);
    });
    const nextRarity = rarityProgression[rarityIndex + 1];
    const targets = Object.values(artifactsDB).filter(candidate => candidate.rarity === nextRarity);
    const successChance = upgradeWinChances[item.rarity];
    document.getElementById("upgrade-rarity-label").textContent = `(${nextRarity}; ${successChance}% success)`;
    upgradeTargetGrid.innerHTML = "";
    targets.forEach(target => {
        const card = document.createElement("div");
        card.className = `upgrade-target-card frame-item-${target.rarity.toLowerCase()}`;
        card.innerHTML = `<img src="${artifactImgSrc(target.image)}" alt=""><span class="upgrade-target-name"></span><span class="upgrade-target-odds"></span>`;
        card.querySelector(".upgrade-target-name").textContent = target.name;
        card.querySelector(".upgrade-target-odds").textContent = `${(successChance / targets.length).toFixed(2)}%`;
        upgradeTargetGrid.appendChild(card);
    });
    upgradeDetails.style.display = "block";
    upgradeStartBtn.disabled = targets.length === 0;
    upgradeStartBtn.textContent = targets.length ? `Try upgrade (${successChance}% success)` : "No results available";
}

function runUpgrade() {
    if (upgradeInProgress || selectedUpgradeIndex < 0 || !playerInventory[selectedUpgradeIndex]) return;
    const sourceItem = playerInventory[selectedUpgradeIndex];
    const rarityIndex = rarityProgression.indexOf(sourceItem.rarity);
    if (rarityIndex < 0 || rarityIndex >= rarityProgression.length - 1) return;
    const nextRarity = rarityProgression[rarityIndex + 1];
    const targets = Object.values(artifactsDB).filter(candidate => candidate.rarity === nextRarity);
    if (!targets.length) return;

    upgradeInProgress = true;
    recordMissionProgress("upgrades");
    recordAchievementProgress("upgrades");
    upgradeStartBtn.disabled = true;
    upgradeStartBtn.textContent = "Upgrading…";
    upgradeSourceGrid.querySelectorAll(".upgrade-source-item").forEach(card => { card.style.pointerEvents = "none"; });
    const won = Math.random() * 100 < upgradeWinChances[sourceItem.rarity];
    const winningItem = won ? targets[Math.floor(Math.random() * targets.length)] : null;
    const total = 45;
    const winningIndex = 39;
    upgradeRoulette.style.display = "block";
    upgradeTrack.innerHTML = "";
    upgradeTrack.style.transition = "none";
    upgradeTrack.style.transform = "translateX(0)";
    for (let i = 0; i < total; i++) {
        const candidate = i === winningIndex ? winningItem : (Math.random() < 0.18 ? null : targets[Math.floor(Math.random() * targets.length)]);
        const card = document.createElement("div");
        card.className = `roulette-item upgrade-roulette-item${candidate ? "" : " upgrade-fail-item"}`;
        if (candidate) card.innerHTML = `<img src="${artifactImgSrc(candidate.image)}" alt=""><span>UPGRADE</span>`;
        else card.innerHTML = `<span>DESTROYED</span>`;
        upgradeTrack.appendChild(card);
    }
    setTimeout(() => {
        upgradeTrack.style.transition = "transform 5s cubic-bezier(0.15, 0.9, 0.2, 1)";
        const winningCard = upgradeTrack.children[winningIndex];
        const cardCenter = winningCard.offsetLeft + winningCard.offsetWidth / 2;
        const jitter = (Math.random() * 30 - 15);
        const offset = upgradeRoulette.clientWidth / 2 - cardCenter + jitter;
        upgradeTrack.style.transform = `translateX(${offset}px)`;
        setTimeout(() => {
            const stillSelected = playerInventory[selectedUpgradeIndex] === sourceItem;
            const actualIndex = stillSelected ? selectedUpgradeIndex : playerInventory.indexOf(sourceItem);
            if (actualIndex >= 0) {
                if (won) {
                    recordAchievementProgress("syntheses");
                    const winningId = Object.keys(artifactsDB).find(id => artifactsDB[id] === winningItem);
                    const upgradedItem = { ...winningItem, id: winningId };
                    playerInventory.splice(actualIndex, 1, upgradedItem);
                    recordCollectedArtifact(upgradedItem);
                } else playerInventory.splice(actualIndex, 1);
                saveInventory();
                renderInventory();
            }
            upgradeModal.classList.remove("active");
            upgradeInProgress = false;
            if (won) {
                playSound("money");
                showToast(`Upgrade successful! ${sourceItem.name} became ${winningItem.name}.`);
            } else {
                showToast(`${sourceItem.name} was destroyed. Upgrade failed.`);
            }
        }, 5200);
    }, 60);
}

document.getElementById("upgrade-inventory-btn").addEventListener("click", () => openUpgradeModal());
document.getElementById("upgrade-item-info-btn").addEventListener("click", () => {
    if (currentInfoSource !== "inventory" || currentInfoIndex < 0) return;
    itemInfoModal.classList.remove("active");
    openUpgradeModal(currentInfoIndex);
});
upgradeStartBtn.addEventListener("click", runUpgrade);
document.getElementById("btn-close-upgrade").addEventListener("click", () => {
    if (!upgradeInProgress) upgradeModal.classList.remove("active");
});
upgradeModal.addEventListener("click", event => {
    if (event.target === upgradeModal && !upgradeInProgress) upgradeModal.classList.remove("active");
});

// ==========================================
// ЛОКАЛЬНЫЙ РЕЙТИНГ (100 МЕСТ)
// ==========================================

const topBots = [
    { name: "SigmaBoy", avatar: "avatar-2.jpeg", score: 2500000 },
    { name: "CrazyLegend", avatar: "avatar-3.png", score: 2100000 },
    { name: "ProGamer", avatar: "avatar-4.png", score: 1800000 },
    { name: "Kotik_Ne_Moy", avatar: "avatar-5.png", score: 1500000 },
    { name: "Slish_Umniy", avatar: "avatar-6.png", score: 1200000 },
    { name: "Hamster_World", avatar: "avatar-7.jpeg", score: 1000000 },
    { name: "Toster_Sudnogo", avatar: "avatar-3.png", score: 900000 },
    { name: "Vilka_Dilemma", avatar: "avatar-4.png", score: 800000 },
    { name: "Kofemashina", avatar: "avatar-5.png", score: 700000 },
    { name: "Dragon_Sneeze", avatar: "avatar-6.png", score: 600000 },
    { name: "Koroleva_Korol", avatar: "avatar.png", score: 500000 },
    { name: "Slime_King", avatar: "avatar-2.jpeg", score: 450000 },
    { name: "Bread_Winner", avatar: "avatar-3.png", score: 400000 },
    { name: "Rychag_Ne_tuda", avatar: "avatar-4.png", score: 350000 },
    { name: "Myshka_Norka", avatar: "avatar-5.png", score: 300000 },
    { name: "Pylesos_Dnya", avatar: "avatar-6.png", score: 250000 },
    { name: "Kaktus_Bezboli", avatar: "avatar-7.jpeg", score: 200000 },
    { name: "Tapok_V_kosmose", avatar: "avatar.png", score: 150000 },
    { name: "Chaynik_Beskonech", avatar: "avatar-2.jpeg", score: 100000 },
    { name: "Tapochki_Doma", avatar: "avatar-3.png", score: 80000 }
];

const nickPrefixes = ["Noob", "Pro", "Mega", "Ultra", "Lazy", "Crazy", "Funny", "Toxic", "Kind", "Sneaky"];
const nickSuffixes = ["Slime", "Cat", "Duck", "Sock", "Cable", "Toaster", "Box", "Crystal", "Totem", "Fridge", "Kettle", "Mouse", "Spoon"];

// ---- Живой рейтинг: один источник правды для главной и экрана "Leaderboard" ----
// 98 ботов + игрок = 99 мест. Игрок всегда стартует с 99-го.
const LB_ROSTER_KEY = "leaderboardRosterV4";
const LB_DRIFT_KEY = "leaderboardLastDrift";
const LB_BEST_RANK_KEY = "playerBestRank";
const LB_TICK_MS = 20000;
const LB_TOTAL_PLACES = 99;
const LB_TOP_SCORE = 20000000; // лидер — 20 млн, до топ-1 очень долго
const LB_BOTTOM_SCORE = 200;   // 98-е место — 200 cr.

const LB_AVATARS = ["avatar.png", "avatar-2.jpeg", "avatar-3.png", "avatar-4.png", "avatar-5.png", "avatar-6.png", "avatar-7.jpeg"];

function escapeLbName(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// English plural helper: 1 player / 2 players
function pluralEn(n, one, many) {
    return Math.abs(n) === 1 ? one : many;
}

// Опорные точки шкалы: внизу места идут часто и дёшево, к топу — дорого и редко.
// rank: место бота (1 = топ), score: сколько cr. нужно, чтобы его обойти.
const LB_ANCHORS = [
    { rank: 98, score: 500 },
    { rank: 96, score: 1400 },
    { rank: 92, score: 4000 },
    { rank: 85, score: 12000 },
    { rank: 75, score: 45000 },
    { rank: 65, score: 130000 },
    { rank: 55, score: 350000 },
    { rank: 45, score: 900000 },
    { rank: 35, score: 2300000 },
    { rank: 25, score: 5500000 },
    { rank: 15, score: 11000000 },
    { rank: 1, score: LB_TOP_SCORE }
];

// Счёт для места rank (1..98)
function leaderboardScoreForRank(rank) {
    const r = Math.min(98, Math.max(1, rank));
    let lo = LB_ANCHORS[0], hi = LB_ANCHORS[1];
    for (let i = 0; i < LB_ANCHORS.length - 1; i++) {
        // LB_ANCHORS идёт от 98-го места (мало cr.) к 1-му (много cr.)
        if (r <= LB_ANCHORS[i].rank && r >= LB_ANCHORS[i + 1].rank) {
            lo = LB_ANCHORS[i];      // место побольше, счёт поменьше
            hi = LB_ANCHORS[i + 1];  // место поменьше, счёт побольше
            break;
        }
    }
    const span = Math.max(1, lo.rank - hi.rank);
    const t = (lo.rank - r) / span; // 0 внизу, 1 у верхней опоры
    const score = Math.exp(Math.log(lo.score) + (Math.log(hi.score) - Math.log(lo.score)) * t);
    return Math.max(120, Math.round(score));
}

function createRoster() {
    const roster = [];
    const usedNames = new Set(topBots.map(bot => bot.name));
    const botSlots = LB_TOTAL_PLACES - 1;

    for (let rank = 1; rank <= botSlots; rank++) {
        let name, avatar;
        if (rank <= topBots.length) {
            name = topBots[rank - 1].name;
            avatar = topBots[rank - 1].avatar;
        } else {
            const i = rank - topBots.length - 1;
            const base = nickPrefixes[i % nickPrefixes.length] + "_" + nickSuffixes[(i * 7 + 3) % nickSuffixes.length];
            name = base;
            let n = 2;
            while (usedNames.has(name)) { name = base + n; n++; }
            avatar = LB_AVATARS[rank % LB_AVATARS.length];
        }
        usedNames.add(name);
        roster.push({ name, avatar, score: leaderboardScoreForRank(rank) });
    }
    return roster;
}

function saveRoster(roster) {
    try {
        gameStorage.setItem(LB_ROSTER_KEY, JSON.stringify(roster));
        gameStorage.setItem(LB_DRIFT_KEY, String(Date.now()));
    } catch (e) {}
}

function loadRoster() {
    let roster = null;
    try {
        const raw = gameStorage.getItem(LB_ROSTER_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length === LB_TOTAL_PLACES - 1) roster = parsed;
        }
    } catch (e) { roster = null; }

    if (!roster) {
        roster = createRoster();
        saveRoster(roster);
        return roster;
    }

    // Догоняем рост за время отсутствия — рейтинг только растёт
    const last = parseInt(gameStorage.getItem(LB_DRIFT_KEY) || "0", 10) || Date.now();
    const ticks = Math.min(Math.max((Date.now() - last) / LB_TICK_MS, 0), 4320);
    if (ticks >= 1) {
        const capped = Math.min(ticks, 240);
        roster.forEach(bot => {
            bot.score = Math.round(bot.score * (1 + lbDriftRate() * capped));
        });
        saveRoster(roster);
    }
    return roster;
}

// Скорость роста дохода ботов: чуть-чуть, чтобы рейтинг был живым,
// но угнаться за топом было очень сложно
function lbDriftRate() {
    return 0.00002 + Math.random() * 0.00006;
}

let _rosterCache = null;
function getRoster() {
    if (!_rosterCache) _rosterCache = loadRoster();
    return _rosterCache;
}

function formatCompactScore(n) {    if (n >= 1000000) return (n / 1000000).toFixed(n >= 10000000 ? 0 : 1).replace(".", ",") + "M";
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",") + "k";
    return String(n);
}

// Топ-3 на главной — строго из того же ростера, что и экран "Leaderboard"
function renderMiniLeaderboard() {
    const box = document.getElementById("mini-leaderboard");
    if (!box) return;

    const top = getRoster()
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    box.innerHTML = top.map((p, i) => `
        <div class="leader">
            <b class="rank${i === 0 ? " first" : ""}">${i + 1}</b>
            <img src="assets/avatar/${p.avatar}" class="mini-avatar" alt="" onerror="this.src='assets/avatar/avatar.png'">
            <strong>${p.isPlayer ? `<span class="${nicknameStyleClass(gameStorage.getItem("nicknameStyle"))}">${escapeLbName(p.name)}</span>` : escapeLbName(p.name)}</strong>
            <span>${p.score.toLocaleString("en-US")} cr.</span>
        </div>
    `).join("");
}

function driftRoster() {
    const roster = getRoster();
    roster.forEach(bot => {
        const gain = bot.score * lbDriftRate();
        bot.score += Math.max(1, Math.floor(gain));
    });
    saveRoster(roster);
    renderMiniLeaderboard();

    if (screenLeaderboard && getComputedStyle(screenLeaderboard).display !== "none") {
        generateLeaderboard();
    }
}
function startLeaderboardDrift() {
    renderMiniLeaderboard();
    leaderboardReady = true;
    trackPlayerRank();
    setInterval(driftRoster, LB_TICK_MS);
}

// Полный рейтинг: боты + игрок, отсортировано. Игрок не может быть выше 99-го места
// пока не обгонит кого-то по деньгам.
function getRankedPlayers() {
    const playerName = gameStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = gameStorage.getItem("playerAvatar") || "avatar.png";
    const playerTitle = gameStorage.getItem("playerTitle") || "";

    const all = getRoster().map(bot => ({
        name: bot.name, avatar: bot.avatar, frame: "", score: bot.score, isPlayer: false, title: ""
    }));
    all.push({ name: playerName, avatar: playerAvatar, frame: gameStorage.getItem("playerFrame") || "", score: Math.max(0, Math.floor(playerState.coins)), isPlayer: true, title: playerTitle });
    all.sort((a, b) => b.score - a.score);
    return all;
}

function getPlayerRank() {
    const idx = getRankedPlayers().findIndex(p => p.isPlayer);
    return idx >= 0 ? idx + 1 : LB_TOTAL_PLACES;
}

// Следим за ростом места игрока и поздравляем уведомлением
let _rankCheckTimer = null;
function scheduleRankCheck() {
    if (_rankCheckTimer) return;
    _rankCheckTimer = setTimeout(() => {
        _rankCheckTimer = null;
        trackPlayerRank();
        if (screenLeaderboard && getComputedStyle(screenLeaderboard).display !== "none") {
            generateLeaderboard();
        }
    }, 400);
}
function trackPlayerRank() {
    const rank = getPlayerRank();
    const saved = parseInt(gameStorage.getItem(LB_BEST_RANK_KEY) || "0", 10);

    if (!saved) {
        gameStorage.setItem(LB_BEST_RANK_KEY, String(rank));
        return rank;
    }

    if (rank < saved) {
        gameStorage.setItem(LB_BEST_RANK_KEY, String(rank));
        const place = `#${rank}`;
        if (typeof addNotification === "function") {
            addNotification(
                `New leaderboard place: ${place}!`,
                rank === 1
                    ? "You passed everyone. You are an Artifact Clash legend!"
                    : `You moved up from #${saved} to #${rank}. Keep it up!`,
                () => { if (typeof showLeaderboardScreen === "function") showLeaderboardScreen(); }
            );
        }
        if (typeof showToast === "function") showToast(`Leaderboard: ${place}!`);
    }
    return rank;
}

function renderPlayerPlaceBanner(listEl, rank, allPlayers) {
    const total = allPlayers.length;
    const place = document.createElement("div");
    place.className = "lb-place-banner";
    place.innerHTML = `<span>Your place</span><b>#${rank}</b><span>of ${total}</span>`;
    listEl.appendChild(place);
}

function generateLeaderboard() {
    // ПРОВЕРКА: если контейнера нет, выходим
    const listEl = document.getElementById("leaderboard-list");
    if (!listEl) {
        console.error("Error: element #leaderboard-list not found in the HTML!");
        return;
    }

    const allPlayers = getRankedPlayers();
    const playerIndex = allPlayers.findIndex(p => p.isPlayer);
    const playerRank = playerIndex >= 0 ? playerIndex + 1 : allPlayers.length;

    listEl.innerHTML = "";

    // ТОП-20
    const top = allPlayers.slice(0, 20);

    top.forEach((player, index) => {
        const rank = index + 1;
        let rankClass = "";
        if (rank === 1) rankClass = "rank-1";
        else if (rank === 2) rankClass = "rank-2";
        else if (rank === 3) rankClass = "rank-3";

        const row = document.createElement("div");
        row.className = `lb-row ${player.isPlayer ? 'is-player' : ''}`;
        const playerStyleClass = player.isPlayer ? nicknameStyleClass(gameStorage.getItem("nicknameStyle")) : "";
        row.innerHTML = `
            <div class="lb-rank ${rankClass}">#${rank}</div>
            <span class="lb-avatar-wrap ${player.isPlayer && player.frame ? `avatar-framed ${player.frame}` : ""}"><img src="assets/avatar/${player.avatar}" class="lb-avatar" alt="" onerror="this.src='assets/avatar/avatar.png'"></span>
            <div class="lb-name"><span class="${playerStyleClass}">${escapeLbName(player.name)}</span>${player.title ? `<small class="lb-title">${iconMarkup("tag")} ${escapeLbName(player.title)}</small>` : ""}</div>
            <div class="lb-score">${player.score.toLocaleString('en-US')} cr.</div>
        `;
        listEl.appendChild(row);
    });

    // Игрок за пределами топ-20 — показываем его отдельным блоком в самом конце
    if (playerRank > 20) {
        const gap = document.createElement("div");
        gap.className = "lb-gap";
        const between = playerRank - 21;
        gap.textContent = between > 0
            ? `. . . ${between} more players . . .`
            : `. . .`;
        listEl.appendChild(gap);

        const player = allPlayers[playerIndex];
        const row = document.createElement("div");
        row.className = "lb-row is-player";
        row.innerHTML = `
            <div class="lb-rank">#${playerRank}</div>
            <span class="lb-avatar-wrap ${player.frame ? `avatar-framed ${player.frame}` : ""}"><img src="assets/avatar/${player.avatar}" class="lb-avatar" alt="" onerror="this.src='assets/avatar/avatar.png'"></span>
            <div class="lb-name"><span class="${nicknameStyleClass(gameStorage.getItem("nicknameStyle"))}">${escapeLbName(player.name)}</span>${player.title ? `<small class="lb-title">${iconMarkup("tag")} ${escapeLbName(player.title)}</small>` : ""}</div>
            <div class="lb-score">${player.score.toLocaleString('en-US')} cr.</div>
        `;
        listEl.appendChild(row);
    }

    // Плашка "твоё место"
    renderPlayerPlaceBanner(listEl, playerRank, allPlayers);

    // Свежий рейтинг мог изменить место игрока — проверяем на поздравление
    trackPlayerRank();
}

// ==========================================
// ONBOARDING & DAILY REWARD SYSTEM
// ==========================================
const onboardingModal = document.getElementById("onboarding-modal");
const dailyRewardModal = document.getElementById("daily-reward-modal");

function checkOnboardingAndDaily() {
    getDailyMissionState();
    renderArtifactCollection();
    const hasSeenOnboarding = gameStorage.getItem("hasSeenOnboarding");
    const lastDailyDate = gameStorage.getItem("lastDailyRewardDate");
    const today = new Date().toDateString();

    // 1. Онбординг (приоритет)
    if (!hasSeenOnboarding && onboardingModal) {
        setTimeout(() => {
            onboardingModal.classList.add("active");
        }, 500);
        return;
    }

    // 2. Daily reward
    if (lastDailyDate !== today && dailyRewardModal) {
        setTimeout(() => {
            dailyRewardModal.classList.add("active");
        }, 800);
    }
}

// Флаг гарантированного легендарного дропа при первом открытии
let isFirstOpenGuaranteedLegendary = true;

// Обработчик онбординга
const btnStartOnboarding = document.getElementById("btn-start-onboarding");
if (btnStartOnboarding) {
    btnStartOnboarding.addEventListener("click", () => {
        // Set state only after the starter case has passed validation.
        currentCaseData = CASES_DATA["mystic"];
        const hasValidDrop = currentCaseData && currentCaseData.pool.some(entry => artifactsDB[entry.id]);
        if (!hasValidDrop) {
            showToast("Mystic Catalog is temporarily unavailable.");
            return;
        }
        if (!openModal || !rouletteTrack) {
            showToast("Unable to display the free case right now.");
            return;
        }
        btnStartOnboarding.disabled = true;
        gameStorage.setItem("hasSeenOnboarding", "true");
        onboardingModal.classList.remove("active");
        startRoulette(true);
    });
}

// Обработчик ежедневной награды
const btnClaimDaily = document.getElementById("btn-claim-daily");
const btnSkipDaily = document.getElementById("btn-skip-daily");

if (btnClaimDaily) {
    btnClaimDaily.addEventListener("click", () => {
        const today = new Date().toDateString();
        gameStorage.setItem("lastDailyRewardDate", today);
        dailyRewardModal.classList.remove("active");
        
        // XP and crystals for daily reward
        addXP(50);
        playerState.gems += 5;
        saveCurrency();
        updateCurrencyUI();
        showToast("Daily reward: +5 crystals!");
        
        // Бесплатное открытие барахолки
        currentCaseData = CASES_DATA["bara"];
        startRoulette(true); // true = free open
    });
}

if (btnSkipDaily) {
    btnSkipDaily.addEventListener("click", () => {
        dailyRewardModal.classList.remove("active");
    });
}

// Привязка кнопки "Подарок за вход" в UI
const dailyBtnUI = document.querySelector(".daily-button");
if (dailyBtnUI) {
    dailyBtnUI.addEventListener("click", () => {
        const today = new Date().toDateString();
        const lastDailyDate = gameStorage.getItem("lastDailyRewardDate");

        if (lastDailyDate === today) {
            showToast("You already claimed today's reward! Come back tomorrow.");
            return;
        }
        dailyRewardModal.classList.add("active");
    });
}

// Запуск проверки при загрузке
setTimeout(checkOnboardingAndDaily, 1000);

// ==========================================
// CASE BATTLE SYSTEM (БИТВА КЕЙСОВ)
// ==========================================
const battleModal = document.getElementById("battle-modal");
const battleSetup = document.getElementById("battle-setup");
const battleArena = document.getElementById("battle-arena");
const battleCasesGrid = document.getElementById("battle-cases-grid");
const btnCloseBattle = document.getElementById("btn-close-battle");
const btnFinishBattle = document.getElementById("btn-finish-battle");
const battleStatus = document.getElementById("battle-status");
const battleStakeDisplay = document.getElementById("battle-stake-display");
const battlePlayerDrop = document.getElementById("battle-player-drop");
const battleBotDrop = document.getElementById("battle-bot-drop");

let currentBattleCase = null;
let battlePlayerItem = null;
let battleBotItem = null;

// Unlockedие меню битв
const battleBtnMain = document.querySelector(".battle-button");
if (battleBtnMain) {
    battleBtnMain.addEventListener("click", () => {
        if (!battleModal) return;
        
        // Генерируем список доступных для битвы кейсов
        battleCasesGrid.innerHTML = "";
        Object.keys(CASES_DATA).forEach(key => {
            const cData = CASES_DATA[key];
            const el = document.createElement("article");
            el.className = "case common"; // Упрощенный стиль
            el.style.padding = "10px";
            el.innerHTML = `
                <div class="case-image" style="height: 80px;"><img src="assets/cases/${cData.img}" alt=""></div>
                <h3 style="font-size: 13px;">${cData.title}</h3>
                <div class="price" style="font-size: 14px;"><img src="assets/coin.png" alt=""> ${cData.price}</div>
            `;
            el.addEventListener("click", () => startBattleSetup(key));
            battleCasesGrid.appendChild(el);
        });
        
        battleSetup.style.display = "block";
        battleArena.style.display = "none";
        battleModal.classList.add("active");
    });
}

if (btnCloseBattle) {
    btnCloseBattle.addEventListener("click", () => battleModal.classList.remove("active"));
}

function startBattleSetup(caseKey) {
    currentBattleCase = CASES_DATA[caseKey];
    const battleKey = caseKey;
    if (playerState.coins < currentBattleCase.price) {
        showToast("Not enough coins for the battle!");
        return;
    }

    // Разные боты для каждой битвы
    const bot = getRandomBot();
    const playerName = gameStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = gameStorage.getItem("playerAvatar") || "avatar.png";

    // Списание ставки
    playerState.coins -= currentBattleCase.price;
    saveCurrency();
    updateCurrencyUI();

    // Заставка VS
    showVsAnimation(playerName, playerAvatar, bot.name, bot.avatar, () => {
        const botAvatarEl = document.getElementById("battle-bot-avatar");
        const botNameEl = document.getElementById("battle-bot-name");
        const battlePlayerNameEl = document.getElementById("battle-player-name");
        const battlePlayerTitleEl = document.getElementById("battle-player-title");
        if (botAvatarEl) botAvatarEl.src = `assets/avatar/${bot.avatar}`;
        if (botNameEl) botNameEl.textContent = bot.name;
        if (battlePlayerNameEl) {
            battlePlayerNameEl.textContent = playerName;
            applyNicknameStyle(battlePlayerNameEl);
        }
        if (battlePlayerTitleEl) {
            const title = gameStorage.getItem("playerTitle") || "";
            battlePlayerTitleEl.innerHTML = title ? `${iconMarkup("tag")} ${escapeLbName(title)}` : "";
            battlePlayerTitleEl.style.display = title ? "block" : "none";
        }

        battleSetup.style.display = "none";
        battleArena.style.display = "block";
        battleStakeDisplay.textContent = `${currentBattleCase.price} cr.`;
        battleStatus.textContent = "Opening...";
        battleStatus.style.color = "#f8f7ff";
        btnFinishBattle.style.display = "none";

        // Сброс визуала
        battlePlayerDrop.style.opacity = "0.3";
        battlePlayerDrop.innerHTML = '<span style="font-size: 40px;">?</span>';
        battlePlayerDrop.className = "result-image-wrapper frame-common";

        battleBotDrop.style.opacity = "0.3";
        battleBotDrop.innerHTML = '<span style="font-size: 40px;">?</span>';
        battleBotDrop.className = "result-image-wrapper frame-common";

        // Задержка для драмы
        setTimeout(() => resolveBattle(battleKey), 1200);
    });
}

function resolveBattle(battleKey) {
    const caseData = (battleKey && CASES_DATA[battleKey]) ? CASES_DATA[battleKey] : currentBattleCase;
    if (!caseData) return;
    currentBattleCase = caseData;

    // Генерация дропа игрока
    battlePlayerItem = getRandomWeightedItem(caseData.pool);
    // Генерация дропа бота
    battleBotItem = getRandomWeightedItem(caseData.pool);
    
    // Показ дропа игрока
    renderBattleDrop(battlePlayerDrop, battlePlayerItem);
    battleStatus.textContent = "The bot is opening...";
    
    setTimeout(() => {
        // Показ дропа бота
        renderBattleDrop(battleBotDrop, battleBotItem);
        
        // Определение победителя
        let won = false;
        if (battlePlayerItem.value > battleBotItem.value) {
            won = true;
            battleStatus.innerHTML = `${iconMarkup("trophy")} YOU WIN!`;
            battleStatus.style.color = "#42e8a3";
        } else if (battlePlayerItem.value < battleBotItem.value) {
            won = false;
            battleStatus.innerHTML = `${iconMarkup("skull")} BOT WINS`;
            battleStatus.style.color = "#ff4d4d";
        } else {
            won = true; // Ничья = игрок забирает своё
            battleStatus.innerHTML = `${iconMarkup("handshake")} DRAW (the item is yours)`;
            battleStatus.style.color = "#ffca35";
        }
        
        // Расчет выигрыша
        const totalWin = battlePlayerItem.value + battleBotItem.value;

        btnFinishBattle.style.display = "block";
        btnFinishBattle.onclick = () => {
            if (won) {
                // Победитель забирает оба предмета в инвентарь
                recordMissionProgress("winBattles");
                recordAchievementProgress("battleWins");
                recordCollectedArtifact(battlePlayerItem);
                recordCollectedArtifact(battleBotItem);
                playerInventory.push(battlePlayerItem);
                playerInventory.push(battleBotItem);
                if (isBoostActive()) {
                    playerInventory.push({...battlePlayerItem});
                    playerInventory.push({...battleBotItem});
                }
                // XP for winning battle
                addXP(Math.floor(currentBattleCase.price / 5));
                saveInventory();
                showToast(`Victory! Got 2 items worth ${totalWin} cr.`);
            } else {
                // Проигравший не получает предмет обратно — только 50% его стоимости
                const consolation = Math.floor(battlePlayerItem.value * 0.5);
                playerState.coins += consolation;
                saveCurrency();
                updateCurrencyUI();
                addXP(Math.floor(currentBattleCase.price / 20));
                showToast(`Defeat. Consolation prize: ${consolation} cr.`);
            }
            saveInventory();
            battleModal.classList.remove("active");
            battleStatus.style.color = "#f8f7ff";
        };
        
    }, 1000);
}

function renderBattleDrop(container, item) {
    container.style.opacity = "1";
    container.innerHTML = `<img src="${artifactImgSrc(item.image)}" alt="" style="width: 80%; height: 80%; object-fit: contain;">`;
    container.className = `result-image-wrapper frame-${item.rarity.toLowerCase()}`;
}

// ==========================================
// CAROUSEL DRAG SCROLLING (Mouse + Touch)
// ==========================================
function enableDragScroll(el) {
    if (!el) return;
    let isDown = false, startX, scrollLeft;
    
    el.addEventListener("mousedown", (e) => {
        isDown = true; el.style.cursor = "grabbing";
        startX = e.pageX - el.offsetLeft;
        scrollLeft = el.scrollLeft;
    });
    el.addEventListener("mouseleave", () => { isDown = false; el.style.cursor = "grab"; });
    el.addEventListener("mouseup", () => { isDown = false; el.style.cursor = "grab"; });
    el.addEventListener("mousemove", (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - el.offsetLeft;
        const walk = (x - startX) * 1.5;
        el.scrollLeft = scrollLeft - walk;
    });
    
    // Touch support
    let touchStartX = 0, touchScrollLeft = 0;
    el.addEventListener("touchstart", (e) => {
        touchStartX = e.touches[0].pageX;
        touchScrollLeft = el.scrollLeft;
    }, { passive: true });
    el.addEventListener("touchmove", (e) => {
        const x = e.touches[0].pageX;
        const walk = (x - touchStartX) * 1.5;
        el.scrollLeft = touchScrollLeft - walk;
    }, { passive: true });
}

enableDragScroll(document.getElementById("preview-carousel"));
enableDragScroll(document.getElementById("roulette-track"));

// ==========================================
// ACHIEVEMENTS SYSTEM
// ==========================================
const achievementsModal = document.getElementById("achievements-modal");
const achievementsGrid = document.getElementById("achievements-grid");
const closeAchievementsBtn = document.getElementById("close-achievements-btn");

function renderAchievementsMini() {
    const container = document.getElementById("achievements-avatars-mini");
    if (!container) return;
    container.innerHTML = "";
    const unlocked = getAchievementUnlocks();
    [...AVATAR_UNLOCKS, ...EXCLUSIVE_AVATARS.map(a => ({ ...a, achievement: ACHIEVEMENT_DEFS.find(d => d.avatar === a.file)?.id }))].slice(0, 7).forEach(a => {
        const img = document.createElement("img");
        img.src = `assets/avatar/${a.file}`;
        img.className = `ach-avatar-mini ${(a.level ? playerState.level >= a.level : unlocked.includes(a.achievement)) ? 'unlocked' : ''}`;
        img.title = a.level ? `Lv. ${a.level}` : (ACHIEVEMENT_DEFS.find(d => d.id === a.achievement)?.title || a.name);
        container.appendChild(img);
    });
}

function renderAchievementRewards() {
    const container = document.getElementById("achievement-rewards");
    if (!container) return;
    container.innerHTML = "";
    const unlocked = getAchievementUnlocks();
    FRAME_REWARDS.forEach(frame => {
        const def = ACHIEVEMENT_DEFS.find(a => a.frame === frame.id);
        const card = document.createElement("div");
        card.className = "achievement-reward-card";
        const preview = document.createElement("span");
        preview.className = `frame-preview ${frame.className}`;
        preview.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-trophy"></use></svg>';
        const label = document.createElement("small");
        label.textContent = `${frame.name} frame · ${def.title}`;
        const button = document.createElement("button");
        button.className = "save-btn";
        const earned = unlocked.includes(def.id);
        button.textContent = !earned ? "Locked" : gameStorage.getItem("playerFrame") === frame.id ? "Applied" : "Apply frame";
        button.disabled = !earned || gameStorage.getItem("playerFrame") === frame.id;
        button.addEventListener("click", () => { gameStorage.setItem("playerFrame", frame.id); updateAvatarFrame(); if (screenLeaderboard && typeof generateLeaderboard === "function") generateLeaderboard(); renderAchievementRewards(); });
        card.append(preview, label, button);
        container.appendChild(card);
    });
    EXCLUSIVE_AVATARS.forEach(avatar => {
        const def = ACHIEVEMENT_DEFS.find(a => a.avatar === avatar.file);
        const card = document.createElement("div");
        card.className = "achievement-reward-card";
        const img = document.createElement("img");
        img.className = "achievement-avatar-preview";
        img.src = `assets/avatar/${avatar.file}`;
        img.alt = avatar.name;
        const label = document.createElement("small");
        label.textContent = `${avatar.name} · ${def.title}`;
        const button = document.createElement("button");
        button.className = "save-btn";
        const earned = unlocked.includes(def.id);
        button.textContent = !earned ? "Locked" : gameStorage.getItem("playerAvatar") === avatar.file ? "Applied" : "Apply avatar";
        button.disabled = !earned || gameStorage.getItem("playerAvatar") === avatar.file;
        button.addEventListener("click", () => { gameStorage.setItem("playerAvatar", avatar.file); if (avatarImg) avatarImg.src = `assets/avatar/${avatar.file}`; if (screenLeaderboard && typeof generateLeaderboard === "function") generateLeaderboard(); renderAchievementRewards(); });
        card.append(img, label, button);
        container.appendChild(card);
    });
}

function renderAchievementList(focusId = null) {
    if (!achievementsGrid) return;
    achievementsGrid.innerHTML = "";
    const levelTitle = document.createElement("div");
    levelTitle.className = "achievement-section-title";
    levelTitle.textContent = "Achievements";
    levelTitle.id = "achievement-list-title";
    achievementsGrid.appendChild(levelTitle);
    const state = getAchievementState();
    const unlocked = getAchievementUnlocks();
    ACHIEVEMENT_DEFS.forEach(def => {
        const value = Math.min(def.goal, Math.max(0, Number(def.progress(state)) || 0));
        const earned = unlocked.includes(def.id);
        const card = document.createElement("article");
        card.className = `achievement-card${earned ? " achieved" : ""}`;
        card.id = `achievement-${def.id}`;
        const title = document.createElement("strong");
        title.textContent = `${earned ? "✓ " : ""}${def.title}`;
        const desc = document.createElement("p");
        desc.textContent = def.description;
        const progress = document.createElement("small");
        progress.textContent = `${value}/${def.goal} · Reward: ${def.reward} + ${def.gems} crystals`;
        const bar = document.createElement("div");
        bar.className = "achievement-progress";
        const fill = document.createElement("span");
        fill.style.width = `${(value / def.goal) * 100}%`;
        bar.appendChild(fill);
        card.append(title, desc, progress, bar);
        if (earned && (def.frame || def.avatar)) {
            const apply = document.createElement("button");
            apply.className = "save-btn achievement-apply-btn";
            const isApplied = def.frame ? gameStorage.getItem("playerFrame") === def.frame : gameStorage.getItem("playerAvatar") === def.avatar;
            apply.textContent = isApplied ? "Applied" : def.frame ? "Apply frame" : "Apply avatar";
            apply.disabled = isApplied;
            apply.addEventListener("click", () => {
                if (def.frame) { gameStorage.setItem("playerFrame", def.frame); updateAvatarFrame(); }
                if (def.avatar) { gameStorage.setItem("playerAvatar", def.avatar); if (avatarImg) avatarImg.src = `assets/avatar/${def.avatar}`; }
                if (screenLeaderboard && typeof generateLeaderboard === "function") generateLeaderboard();
                openAchievementsModal(def.id);
            });
            card.appendChild(apply);
        }
        achievementsGrid.appendChild(card);
    });
    if (focusId) requestAnimationFrame(() => document.getElementById(`achievement-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
}

function openAchievementsModal(focusId = null) {
    if (!achievementsModal) return;
    updateLevelUI();
    renderAchievementList(focusId);
    if (focusId) {
        const alreadyUnlocked = getAchievementUnlocks().includes(focusId);
        const def = ACHIEVEMENT_DEFS.find(item => item.id === focusId);
        const listTitle = document.getElementById("achievement-list-title");
        if (alreadyUnlocked && def && listTitle) listTitle.textContent = `Achievement unlocked: ${def.title}`;
    }
    renderAchievementRewards();
    if (achievementsGrid) {
        const levelTitle = document.createElement("div");
        levelTitle.className = "achievement-section-title level-avatar-title";
        levelTitle.textContent = "Level avatars";
        achievementsGrid.appendChild(levelTitle);
        AVATAR_UNLOCKS.forEach(a => {
            const wrapper = document.createElement("div");
            wrapper.className = "achievement-reward-card";
            const img = document.createElement("img");
            img.src = `assets/avatar/${a.file}`;
            img.className = "achievement-avatar-preview";
            img.alt = `Level ${a.level} avatar`;
            const unlocked = playerState.level >= a.level;
            const label = document.createElement("small");
            label.textContent = unlocked ? `Level ${a.level} avatar` : `Unlocks at level ${a.level}`;
            const button = document.createElement("button");
            button.className = "save-btn";
            button.textContent = !unlocked ? "Locked" : gameStorage.getItem("playerAvatar") === a.file ? "Applied" : "Apply avatar";
            button.disabled = !unlocked || gameStorage.getItem("playerAvatar") === a.file;
            button.addEventListener("click", () => { gameStorage.setItem("playerAvatar", a.file); if (avatarImg) avatarImg.src = `assets/avatar/${a.file}`; if (screenLeaderboard && typeof generateLeaderboard === "function") generateLeaderboard(); openAchievementsModal(focusId); });
            wrapper.append(img, label, button);
            achievementsGrid.appendChild(wrapper);
        });
    }
    achievementsModal.classList.add("active");
}

if (closeAchievementsBtn) {
    closeAchievementsBtn.addEventListener("click", () => achievementsModal.classList.remove("active"));
}
if (achievementsModal) {
    achievementsModal.addEventListener("click", (e) => {
        if (e.target === achievementsModal) achievementsModal.classList.remove("active");
    });
}

// Click on level badge opens achievements
const levelBadge = document.querySelector('.level');
if (levelBadge) {
    levelBadge.style.cursor = "pointer";
    levelBadge.addEventListener("click", () => openAchievementsModal());
}

// Also open from achievements block
const achBlock = document.getElementById("achievements-block");
if (achBlock) {
    achBlock.addEventListener("click", (e) => {
        if (e.target.id !== "btn-open-achievements") openAchievementsModal();
    });
}

// ==========================================
// BATTLE SCREEN MODES
// ==========================================
const battleVsModal = document.getElementById("battle-vs-modal");
const battleItemPickModal = document.getElementById("battle-item-pick-modal");
const btnBattleCasesMode = document.getElementById("btn-battle-cases-mode");
const btnBattleItemsMode = document.getElementById("btn-battle-items-mode");

const botNames = ["DuckSlayer", "KotikBoss", "SlimeKing", "ToasterLord", "HamsterPro", "CrystalMage", "NeuroFox", "DragonFan", "MegaSock", "LazyLegend"];
const botAvatars = ["avatar-2.jpeg", "avatar-3.png", "avatar-4.png", "avatar-5.png", "avatar-6.png", "avatar-7.jpeg"];

function getRandomBot() {
    return {
        name: botNames[Math.floor(Math.random() * botNames.length)],
        avatar: botAvatars[Math.floor(Math.random() * botAvatars.length)]
    };
}

function showVsAnimation(playerName, playerAvatar, botName, botAvatar, callback) {
    
    if (!battleVsModal) { if (callback) callback(); return; }
    
    try { playSound("vs"); } catch (e) {}
    
    const vsPlayerNameEl = document.getElementById("vs-player-name");
    if (vsPlayerNameEl) {
        vsPlayerNameEl.textContent = playerName || "YOU";
        applyNicknameStyle(vsPlayerNameEl);
    }
    const title = gameStorage.getItem("playerTitle") || "";
    const vsPlayerTitleEl = document.getElementById("vs-player-title");
    if (vsPlayerTitleEl) {
        vsPlayerTitleEl.innerHTML = title ? `${iconMarkup("tag")} ${escapeLbName(title)}` : "";
        vsPlayerTitleEl.style.display = title ? "block" : "none";
    }
    const battlePlayerNameEl = document.getElementById("battle-player-name");
    if (battlePlayerNameEl) {
        battlePlayerNameEl.textContent = playerName || "YOU";
        applyNicknameStyle(battlePlayerNameEl);
    }
    const battlePlayerTitleEl = document.getElementById("battle-player-title");
    if (battlePlayerTitleEl) {
        battlePlayerTitleEl.innerHTML = title ? `${iconMarkup("tag")} ${escapeLbName(title)}` : "";
        battlePlayerTitleEl.style.display = title ? "block" : "none";
    }
    document.getElementById("vs-player-avatar").src = `assets/avatar/${playerAvatar || 'avatar.png'}`;
    const battlePlayerAvatarEl = document.getElementById("battle-player-avatar");
    if (battlePlayerAvatarEl) battlePlayerAvatarEl.src = `assets/avatar/${playerAvatar || 'avatar.png'}`;
    updateAvatarFrame();
    document.getElementById("vs-bot-name").textContent = botName;
    document.getElementById("vs-bot-avatar").src = `assets/avatar/${botAvatar}`;

    battleVsModal.classList.add("active");

    // 3 секунды: 1с полёт + 0.6с VS + пауза
    setTimeout(() => {
        battleVsModal.classList.remove("active");
        if (callback) callback();
    }, 3000);
}

// Battle Cases Mode - opens existing battle modal
if (btnBattleCasesMode) {
    btnBattleCasesMode.addEventListener("click", () => {
        const bBtn = document.querySelector(".battle-button");
        if (bBtn) bBtn.click();
    });
}

// Battle Items Mode
let selectedItemForBattle = null;

if (btnBattleItemsMode) {
    btnBattleItemsMode.addEventListener("click", () => {
        if (playerInventory.length === 0) {
            showToast("Inventory is empty! Open some cases first.");
            return;
        }
        
        const grid = document.getElementById("battle-item-pick-grid");
        if (!grid) return;
        grid.innerHTML = "";
        
        playerInventory.forEach((item, idx) => {
            const el = document.createElement("div");
            el.className = `inv-item frame-item-${item.rarity.toLowerCase()}`;
            el.innerHTML = `<img src="${artifactImgSrc(item.image)}" alt=""><span class="inv-name">${item.name}</span><span class="inv-value">${item.value} cr.</span>`;
            el.addEventListener("click", () => {
                selectedItemForBattle = { item, index: idx };
                battleItemPickModal.classList.remove("active");
                startItemBattle();
            });
            grid.appendChild(el);
        });
        
        battleItemPickModal.classList.add("active");
    });
}

const btnCloseItemPick = document.getElementById("btn-close-item-pick");
if (btnCloseItemPick) {
    btnCloseItemPick.addEventListener("click", () => battleItemPickModal.classList.remove("active"));
}

function startItemBattle() {
    if (!selectedItemForBattle) return;
    
    const playerItem = selectedItemForBattle.item;
    const playerIdx = selectedItemForBattle.index;
    const bot = getRandomBot();
    const playerName = gameStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = gameStorage.getItem("playerAvatar") || "avatar.png";
    
    // Generate bot item of similar value range
    const minVal = Math.max(10, Math.floor(playerItem.value * 0.5));
    const maxVal = Math.ceil(playerItem.value * 1.5);
    
    // Find artifacts in similar range
    const candidates = Object.values(artifactsDB).filter(a => a.value >= minVal && a.value <= maxVal);
    let botItem;
    if (candidates.length > 0) {
        botItem = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
        // Fallback: random artifact
        const allItems = Object.values(artifactsDB);
        botItem = allItems[Math.floor(Math.random() * allItems.length)];
    }
    
    showConfirm({ title: "Risk your item?", text: `${bot.name}'s possible item value: ${minVal}–${maxVal} cr. (selected: ${botItem.value} cr.). You risk ${playerItem.name} (${playerItem.value} cr.). Win: keep yours and get the bot item's value in coins. Lose: your item is gone, but you get a random Common item + 30% coin refund.`, okText: "Risk it", cancelText: "Back", danger: true }, accepted => {
        if (!accepted) { selectedItemForBattle = null; battleItemPickModal?.classList.add("active"); return; }
        showVsAnimation(playerName, playerAvatar, bot.name, bot.avatar, () => {
        // Resolve item battle
        const won = playerItem.value >= botItem.value;
        
        // Show result in battle modal (reuse existing)
        if (battleModal) {
            battleSetup.style.display = "none";
            battleArena.style.display = "block";
            battleStakeDisplay.textContent = `${playerItem.value} vs ${botItem.value}`;
            
            renderBattleDrop(battlePlayerDrop, playerItem);
            renderBattleDrop(battleBotDrop, botItem);
            
            if (won) {
                battleStatus.innerHTML = `${iconMarkup("trophy")} YOU WIN!`;
                battleStatus.style.color = "#42e8a3";
            } else {
                battleStatus.innerHTML = `${iconMarkup("skull")} BOT WINS`;
                battleStatus.style.color = "#ff4d4d";
            }
            
            btnFinishBattle.style.display = "block";
            btnFinishBattle.onclick = () => {
                if (won) {
                    // Winner keeps their item + gets opponent's item value as coins
                    recordMissionProgress("winBattles");
                    recordAchievementProgress("battleWins");
                    recordCollectedArtifact(botItem);
                    playerState.coins += botItem.value;
                    saveCurrency();
                    updateCurrencyUI();
                    addXP(Math.floor(botItem.value / 5));
                    showToast(`Victory! Got ${botItem.value} cr.`);
                } else {
                    // Loser loses their item but gets 30% back as coins
                    const refund = Math.floor(playerItem.value * 0.3);
                    playerInventory.splice(playerIdx, 1);
                    const commonItems = Object.entries(artifactsDB).filter(([, item]) => item.rarity === "Common");
                    if (commonItems.length) {
                        const [commonId, commonItem] = commonItems[Math.floor(Math.random() * commonItems.length)];
                        playerInventory.push({ ...commonItem, id: commonId });
                        showToast(`Defeat. Item lost, Common consolation: ${commonItem.name} + ${refund} cr.`);
                    } else {
                        showToast(`Defeat. Item lost, refund: ${refund} cr.`);
                    }
                    playerState.coins += refund;
                    saveCurrency();
                    saveInventory();
                    renderInventory();
                    updateCurrencyUI();
                }
                battleModal.classList.remove("active");
                battleStatus.style.color = "#f8f7ff";
                selectedItemForBattle = null;
            };
            
            battleModal.classList.add("active");
        }
        });
    });
}

// ==========================================
// INITIALIZE ON LOAD
// ==========================================
updateLevelUI();
updateBoostUI();
updatePlayerTitle();
renderDailyMissions();
renderArtifactCollection();
checkAchievements();
renderAchievementsMini();
startLeaderboardDrift();

// ==========================================
// ЗВУКОВАЯ СИСТЕМА (CrazyGames Compliant, БЕЗ ЛАГОВ)
// ==========================================
const SOUND_ENABLED_KEY = "soundEnabled";
const MUSIC_ENABLED_KEY = "musicEnabled";
let soundEnabled = gameStorage.getItem(SOUND_ENABLED_KEY) !== "false";
let musicEnabled = gameStorage.getItem(MUSIC_ENABLED_KEY) !== "false";
let sdkAudioMuted = false;
let audioUnlocked = false;

// Конфиг: ключ → { файл, громкость, зацикливание, минимальный интервал между запусками (мс) }
const SOUND_CONFIG = {
    vs:            { file: "assets/music/VS.mp3",                  vol: 0.7, loop: false, throttle: 0 },
    achiv:         { file: "assets/music/achiv.mp3",               vol: 0.8, loop: false, throttle: 0 },
    click:         { file: "assets/music/click.mp3",               vol: 0.5, loop: false, throttle: 60 },
    commonDrop:    { file: "assets/music/common-artifact.mp3",     vol: 0.7, loop: false, throttle: 0 },
    roulette:      { file: "assets/music/drop.mp3",                vol: 0.5, loop: true,  throttle: 0 },
    hover:         { file: "assets/music/hover.mp3",               vol: 0.2, loop: false, throttle: 90 },
    legendaryDrop: { file: "assets/music/legendary-artifact.mp3",  vol: 0.9, loop: false, throttle: 0 },
    levelUp:       { file: "assets/music/lvl.mp3",                 vol: 0.8, loop: false, throttle: 0 },
    money:         { file: "assets/music/money.mp3",               vol: 0.7, loop: false, throttle: 120 },
    openCase:      { file: "assets/music/open-case.mp3",           vol: 0.6, loop: false, throttle: 0 },
    shop:          { file: "assets/music/shop.mp3",                vol: 0.7, loop: false, throttle: 200 }
};

// Создаём пулы аудио (по 2 экземпляра каждого звука для наложения)
const sounds = {};
const lastPlayed = {};

// Фоновые/зацикленные звуки — управляются тумблером «Музыка».
// Все короткие эффекты (клик, дроп, VS, деньги и т.д.) идут через «Sound».
const MUSIC_SOUNDS = [];
Object.entries(SOUND_CONFIG).forEach(([key, cfg]) => {
    sounds[key] = [];
    // Для hover и click — 3 копии, чтобы накладывались без обрыва
    const copies = (key === "hover" || key === "click") ? 3 : 2;
    for (let i = 0; i < copies; i++) {
        const a = new Audio();
        a.src = cfg.file;
        a.volume = cfg.vol;
        a.loop = cfg.loop;
        a.preload = "auto";
        a.load(); // Принудительная предзагрузка
        sounds[key].push(a);
    }
    lastPlayed[key] = 0;
});

// Индекс для round-robin по пулу
const poolIndex = {};
Object.keys(sounds).forEach(k => poolIndex[k] = 0);

// Разблокировка звука по первому действию
function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    // Пробуем проиграть и сразу остановить все пулы — это разблокирует AudioContext
    Object.values(sounds).flat().forEach(a => {
        const p = a.play();
        if (p && p.then) {
            p.then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
        }
    });
    startBgMusic();
    document.removeEventListener("pointerdown", unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);

// ---- Фоновая музыка (assets/music/bg.mp3) ----
const MUSIC_VOLUME_KEY = "musicVolume";
const MUSIC_BASE_VOLUME = 0.35;

function readMusicVolume() {
    const raw = parseFloat(gameStorage.getItem(MUSIC_VOLUME_KEY));
    if (isNaN(raw)) return MUSIC_BASE_VOLUME;
    return Math.min(1, Math.max(0, raw));
}

let musicVolume = readMusicVolume();

var bgMusic = new Audio("assets/music/bg.mp3");
bgMusic.loop = true;
bgMusic.volume = musicVolume;
bgMusic.preload = "auto";

// Громкость применяется и к фоновой музыке, и к зацикленным музыкальным звукам
function applyMusicVolume() {
    bgMusic.volume = musicVolume;
    MUSIC_SOUNDS.forEach(k => {
        const base = SOUND_CONFIG[k] ? SOUND_CONFIG[k].vol : 0.5;
        const scaled = Math.min(1, base * (musicVolume / MUSIC_BASE_VOLUME));
        (sounds[k] || []).forEach(a => { a.volume = scaled; });
    });
}

let bgMusicStarted = false;

function startBgMusic() {
    if (!musicEnabled || sdkAudioMuted || !audioUnlocked || document.hidden || isPauseMenuOpen()) return;
    // Browser/SDK may pause the element while leaving our state flag stale.
    if (bgMusicStarted && !bgMusic.paused) return;
    bgMusicStarted = true;
    const p = bgMusic.play();
    if (p && p.catch) p.catch(() => { bgMusicStarted = false; });
}

function stopBgMusic() {
    bgMusicStarted = false;
    try { bgMusic.pause(); } catch (e) {}
}

// Музыка стартует только после первого действия игрока (политика автоплея)

// Пауза при сворачивании вкладки
bgMusic.addEventListener("pause", () => { bgMusicStarted = false; });
document.addEventListener("pointerdown", () => { if (audioUnlocked) startBgMusic(); });
document.addEventListener("keydown", () => { if (audioUnlocked) startBgMusic(); });
document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopBgMusic();
    else if (audioUnlocked && !isPauseMenuOpen()) startBgMusic();
});

// ---- Переключатели звука и музыки в настройках ----
const soundToggle = document.getElementById("sound-toggle");
const musicToggle = document.getElementById("music-toggle");
const musicVolumeSlider = document.getElementById("music-volume");
const musicVolumeValue = document.getElementById("music-volume-value");

if (musicVolumeSlider) {
    musicVolumeSlider.value = String(Math.round(musicVolume * 100));
    if (musicVolumeValue) musicVolumeValue.textContent = Math.round(musicVolume * 100) + "%";

    musicVolumeSlider.addEventListener("input", () => {
        musicVolume = Math.min(1, Math.max(0, parseInt(musicVolumeSlider.value, 10) / 100 || 0));
        gameStorage.setItem(MUSIC_VOLUME_KEY, String(musicVolume));
        if (musicVolumeValue) musicVolumeValue.textContent = Math.round(musicVolume * 100) + "%";
        applyMusicVolume();
    });
}
applyMusicVolume();

if (soundToggle) {
    soundToggle.checked = soundEnabled;
    soundToggle.addEventListener("change", () => {
        soundEnabled = soundToggle.checked;
        if (sdkAudioMuted && soundEnabled) {
            soundEnabled = false;
            soundToggle.checked = false;
            return;
        }
        gameStorage.setItem(SOUND_ENABLED_KEY, String(soundEnabled));
        if (!soundEnabled) {
            Object.keys(sounds).forEach(k => stopSound(k));
        }
    });
}

if (musicToggle) {
    musicToggle.checked = musicEnabled;
    musicToggle.addEventListener("change", () => {
        musicEnabled = musicToggle.checked;
        if (sdkAudioMuted && musicEnabled) {
            musicEnabled = false;
            musicToggle.checked = false;
            return;
        }
        gameStorage.setItem(MUSIC_ENABLED_KEY, String(musicEnabled));
        if (!musicEnabled) {
            MUSIC_SOUNDS.forEach(k => stopSound(k));
            stopBgMusic();
        } else {
            startBgMusic();
        }
    });
}

// Воспроизведение с троттлингом и пулом
function playSound(name, forceRestart = false) {
    if (!soundEnabled || sdkAudioMuted || !audioUnlocked) return;
    // Each case spin restarts drop.mp3 from the beginning.
    const pool = sounds[name];
    const cfg = SOUND_CONFIG[name];
    if (!pool || !cfg) return;

    // Музыкальные/фоновые лупы подчиняются отдельному переключателю
    if (MUSIC_SOUNDS.includes(name) && !musicEnabled) return;

    // Throttle — не даём звуку спамиться
    const now = performance.now();
    if (cfg.throttle > 0 && now - lastPlayed[name] < cfg.throttle) return;
    lastPlayed[name] = now;

    // Берём следующий экземпляр из пула (round-robin)
    const idx = poolIndex[name] % pool.length;
    poolIndex[name]++;
    const audio = pool[idx];

    // Если звук не зациклен — просто перезапускаем
    if (cfg.loop) {
        if (forceRestart || audio.paused) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
        }
        return;
    }

    // Для одиночных звуков: перезапуск без обрыва (быстрое «перещелкивание»)
    try {
        audio.currentTime = 0;
        const p = audio.play();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {}
}

function stopSound(name) {
    const pool = sounds[name];
    if (!pool) return;
    pool.forEach(a => {
        try { a.pause(); a.currentTime = 0; } catch (e) {}
    });
}

// ==========================================
// ПРИВЯЗКА К КНОПКАМ И ИГРОВОЙ ЛОГИКЕ
// ==========================================

// ==========================================
// ХОВЕР: ТОЛЬКО ПРИ РЕАЛЬНОМ ВХОДЕ НА КНОПКУ
// ==========================================

// Отслеживаем, на каком интерактивном элементе сейчас курсор
let currentHoveredEl = null;

// Все интерактивные селекторы в одном месте
const HOVER_SELECTOR = "button, .case, .inv-item, .carousel-item, .nav-item, .top-icon, .avatar, .edit-name";

// mouseover срабатывает при движении внутри, поэтому используем комбинацию:
// - mouseover: определяем, вошли ли мы в новый интерактивный элемент
// - mouseout: определяем, покинули ли мы его
// На тач-устройствах «ховера» нет — звук наведения там не нужен
const CAN_HOVER = (() => {
    try { return window.matchMedia("(hover: hover) and (pointer: fine)").matches; }
    catch (e) { return true; }
})();

document.addEventListener("mouseover", (e) => {
    if (!CAN_HOVER) return;
    const el = e.target.closest(HOVER_SELECTOR);
    if (!el) return;

    // Если курсор всё ещё внутри того же элемента — не играем звук
    if (el === currentHoveredEl) return;

    // Если курсор перешёл в дочерний элемент той же кнопки — тоже игнорируем
    if (currentHoveredEl && currentHoveredEl.contains(el)) return;

    // Запоминаем новый элемент и играем звук
    currentHoveredEl = el;
    playSound("hover");
});

document.addEventListener("mouseout", (e) => {
    const el = e.target.closest(HOVER_SELECTOR);
    if (!el) return;

    // Если курсор ушёл на дочерний элемент внутри той же кнопки — не сбрасываем
    const related = e.relatedTarget;
    if (related && el.contains(related)) return;

    // Курсор реально покинул элемент
    if (currentHoveredEl === el) {
        currentHoveredEl = null;
    }
});

// 2. Клик — тоже делегированный (быстрее, чем на каждую кнопку)
document.addEventListener("click", (e) => {
    const el = e.target.closest("button, .case, .inv-item, .carousel-item, .nav-item, .top-icon, .avatar, .edit-name");
    if (!el) return;
    // Не дублируем клик там, где звук уже играет свой обработчик
    if (["confirm-open-btn", "btn-sell-case", "confirm-ok-btn", "confirm-cancel-btn"].includes(el.id)) return;
    playSound("click");
});

// 3. Unlockedие кейса — звук играет ровно один раз в обёртке startRoulette()

// 4. Продажа / деньги — звук money играет внутри самих обработчиков,
//    чтобы не звучать при отмене подтверждения.

// ==========================================
// АНИМАЦИЯ ОТКРЫТИЯ КЕЙСА + РУЛЕТКА + ПОКАЗ ДРОПА
// ==========================================
if (!window.__rouletteWrapped) {
    window.__rouletteWrapped = true;

    // Сохраняем оригинальные функции
    const _origStartRoulette = window.startRoulette;
    const _origShowResult = window.showResult;

    // Перехватываем showResult: он вызывается внутри рулетки ровно в момент,
    // когда предмет уже определён.
    window.showResult = function(item) {
        // Сохраняем предмет глобально
        window.__lastDropItem = item;

        // Вызываем оригинал (открывает модалку результата)
        _origShowResult.call(this, item);

        // Показываем полноэкранную анимацию дропа
        // (только если не пришло из битвы — а из битвы showResult не вызывается)
        showDropRevealAnimation(item);
    };

    window.startRoulette = function(...args) {
        // === ЭТАП 1: Анимация открытия кейса ===
        const animOverlay = document.getElementById("case-opening-animation");
        const animImg = document.getElementById("case-opening-img");
        const animInner = document.querySelector(".case-opening-inner");

        if (animImg && typeof currentCaseData !== "undefined" && currentCaseData) {
            animImg.src = `assets/cases/${currentCaseData.img}`;
        }
        if (animInner) animInner.classList.remove("flash");

        if (animOverlay) {
            animOverlay.classList.add("active");
            if (animImg) {
                animImg.style.animation = "none";
                void animImg.offsetWidth;
                animImg.style.animation = "";
            }
        }

        playSound("openCase");
        const OPEN_DURATION = 1500;

        setTimeout(() => {
            if (animInner) animInner.classList.add("flash");

            setTimeout(() => {
                if (animOverlay) animOverlay.classList.remove("active");
                if (animInner) animInner.classList.remove("flash");

                // === ЭТАП 2: Рулетка ===
                stopSound("roulette");
                playSound("roulette", true);
                setTimeout(() => stopSound("roulette"), 5200);

                // Запускаем оригинальную рулетку.
                // Внутри неё через 5.2 сек вызовется showResult (наша обёртка),
                // и уже там запустится showDropRevealAnimation.
                _origStartRoulette.apply(this, args);

            }, 400);
        }, OPEN_DURATION);
    };
}

// ==========================================
// ПОКАЗ ДРОПА — 5 СЕК + РЕЗКИЙ ФИНАЛ
// ==========================================
let _dropRevealRunning = false;

function showDropRevealAnimation(item) {
    if (_dropRevealRunning) return;
    const overlay = document.getElementById("drop-reveal-animation");
    const img = document.getElementById("drop-reveal-img");
    const frame = document.getElementById("drop-reveal-frame");
    const inner = document.querySelector(".drop-reveal-inner");
    if (!overlay || !img || !frame) return;

    _dropRevealRunning = true;

    // Подставляем предмет
    img.src = artifactImgSrc(item.image);

    // Класс редкости
    frame.className = "drop-reveal-frame";
    frame.classList.add(`frame-${item.rarity.toLowerCase()}`);

    // Сброс finish
    if (inner) inner.classList.remove("finish");

    // Показываем оверлей
    overlay.classList.add("active");

    // Перезапуск CSS-анимаций
    if (frame) {
        frame.style.animation = "none";
        void frame.offsetWidth;
        frame.style.animation = "";
    }


    // РЕЗКИЙ ФИНАЛ через 5 секунд
    setTimeout(() => {
        if (inner) inner.classList.add("finish");

        setTimeout(() => {
            overlay.classList.remove("active");
            if (inner) inner.classList.remove("finish");
            _dropRevealRunning = false;
        }, 350);
    }, 5000);
}

// ==========================================
// ЗВУК ОШИБКИ (error.mp3)
// ==========================================

// Добавляем звук ошибки в общую звуковую систему
SOUND_CONFIG.error = {
    file: "assets/music/error.mp3",
    vol: 0.6,
    loop: false,
    throttle: 250
};

// Создаём пул для error (2 экземпляра, чтобы звуки не обрывали друг друга)
sounds.error = [];
for (let i = 0; i < 2; i++) {
    const a = new Audio();
    a.src = SOUND_CONFIG.error.file;
    a.volume = SOUND_CONFIG.error.vol;
    a.preload = "auto";
    a.load();
    sounds.error.push(a);
}
poolIndex.error = 0;
lastPlayed.error = 0;

// Удобный вызов
function playError(message) {
    try { playSound("error"); } catch (e) {}
    if (message) showToast(message);
}

// ==========================================
// ПЕРЕХВАТ ОШИБОК
// ==========================================

// 1. Не хватает монет при открытии кейса
const _confirmOpenErr = document.getElementById("confirm-open-btn");
if (_confirmOpenErr) {
    _confirmOpenErr.addEventListener("click", () => {
        if (!currentCaseData) {
            playSound("error");
            return;
        }
        if (playerState.coins < currentCaseData.price) {
            playSound("error");
        }
    }, true);
}

// 3. Не хватает монет для битвы кейсов
const _origStartBattleSetupErr = window.startBattleSetup;
if (typeof _origStartBattleSetupErr === "function") {
    window.startBattleSetup = function(caseKey) {
        const cData = CASES_DATA[caseKey];
        if (cData && playerState.coins < cData.price) playSound("error");
        return _origStartBattleSetupErr.apply(this, arguments);
    };
}

// 4. Второй раз забрать ежедневную награду
const _dailyBtnErr = document.querySelector(".daily-button");
if (_dailyBtnErr) {
    _dailyBtnErr.addEventListener("click", () => {
        const today = new Date().toDateString();
        const lastDailyDate = gameStorage.getItem("lastDailyRewardDate");
        if (lastDailyDate === today) playSound("error");
    }, true);
}

// 5. Ошибка ввода ника (занято, мало символов, запрещённые символы)
const _saveNameErr = document.getElementById("save-name-btn");
if (_saveNameErr) {
    _saveNameErr.addEventListener("click", () => {
        setTimeout(() => {
            const err = document.getElementById("name-error");
            if (err && err.textContent.trim() !== "") playSound("error");
        }, 0);
    });
}

// 6. Реклама недоступна — сообщение об этом уже показывает showRewardedAd,
// поэтому лишний звук ошибки здесь не нужен.

// 7. Попытка продать всё при пустом инвентаре
const _sellAllErr = document.getElementById("sell-all-btn");
if (_sellAllErr) {
    _sellAllErr.addEventListener("click", () => {
        if (typeof playerInventory !== "undefined" && playerInventory.length === 0) {
            playSound("error");
        }
    }, true);
}

// 8. Попытка начать битву предметов с пустым инвентарём
const _btnBattleItemsErr = document.getElementById("btn-battle-items-mode");
if (_btnBattleItemsErr) {
    _btnBattleItemsErr.addEventListener("click", () => {
        if (typeof playerInventory !== "undefined" && playerInventory.length === 0) {
            playSound("error");
        }
    }, true);
}

// 9. Клик по заблокированному аватару
document.addEventListener("click", (e) => {
    const lockedAvatar = e.target.closest(".avatar-option.locked");
    if (lockedAvatar) playSound("error");
});

// 10. Клик по кейсу при нехватке монет — делегированно, без привязки к динамическим кнопкам.
document.addEventListener("click", (event) => {
    const btn = event.target.closest(".case-button");
    if (!btn) return;
    const card = btn.closest(".case");
    const caseData = card && CASES_DATA[card.dataset.caseKey];
    if (caseData && playerState.coins < caseData.price) playSound("error");
}, true);
