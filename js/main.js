// ==========================================
// CRAZY GAMES SDK INTEGRATION
// ==========================================
let crazyGamesSDK = null;
let isCrazyGamesEnvironment = false;

async function initCrazyGamesSDK() {
    if (window.CrazyGames && window.CrazyGames.SDK) {
        try {
            await window.CrazyGames.SDK.init();
            crazyGamesSDK = window.CrazyGames.SDK;
            
            // Проверяем среду: 'local', 'crazygames' или 'disabled'
            const env = crazyGamesSDK.environment;
            console.log(`CrazyGames SDK initialized. Environment: ${env}`);
            
            if (env !== 'disabled') {
                isCrazyGamesEnvironment = true;
            }
        } catch (e) {
            console.error("Ошибка инициализации CrazyGames SDK:", e);
        }
    } else {
        console.log("CrazyGames SDK не найден (локальный запуск без SDK)");
    }
}

// Функция вызова рекламы (Rewarded Video)
function showRewardedAd(callback) {
    if (isCrazyGamesEnvironment && crazyGamesSDK) {
        crazyGamesSDK.ad.requestAd('rewarded', {
            adStarted: () => console.log("Реклама началась"),
            adFinished: () => {
                console.log("Реклама просмотрена полностью");
                if (callback) callback(true);
            },
            adError: (error) => {
                console.error("Ошибка рекламы:", error);
                if (callback) callback(false);
            }
        });
    } else {
        // Эмуляция для локальной разработки
        console.log("Эмуляция просмотра рекламы...");
        setTimeout(() => {
            if (callback) callback(true);
        }, 1500);
    }
}

// Запускаем инициализацию сразу
initCrazyGamesSDK();

// ==========================================
// УВЕДОМЛЕНИЯ (TOAST)
// ==========================================
const toast = document.getElementById("toast");
let toastTimer;

function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
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
    coins: parseInt(localStorage.getItem("playerCoins")) || 0, 
    gems: parseInt(localStorage.getItem("playerGems")) || 0,
    xp: parseInt(localStorage.getItem("playerXP")) || 0,
    level: parseInt(localStorage.getItem("playerLevel")) || 1
};

function getXpForLevel(lvl) { return lvl * 500; }

function addXP(amount) {
    playerState.xp += amount;
    let needed = getXpForLevel(playerState.level);
    while (playerState.xp >= needed) {
        playerState.xp -= needed;
        playerState.level++;
        needed = getXpForLevel(playerState.level);
        showToast(`🎉 Уровень повышен! Теперь Lv. ${playerState.level}`);
    }
    saveCurrency();
    updateLevelUI();
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
    const expiry = parseInt(localStorage.getItem("boostExpiry")) || 0;
    return Date.now() < expiry;
}

function getBoostRemaining() {
    const expiry = parseInt(localStorage.getItem("boostExpiry")) || 0;
    const remaining = Math.max(0, expiry - Date.now());
    return remaining;
}

function activateBoost() {
    showRewardedAd((success) => {
        if (success) {
            const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes
            localStorage.setItem("boostExpiry", expiry);
            updateBoostUI();
            showToast("⚡ Удвоение дохода активировано на 5 минут!");
        } else {
            showToast("Не удалось загрузить рекламу.");
        }
    });
}

function refreshBoostWithCrystals() {
    if (playerState.gems < 100) {
        showToast("Недостаточно кристаллов! Нужно 100 💎");
        return;
    }
    playerState.gems -= 100;
    saveCurrency();
    updateCurrencyUI();
    const expiry = Date.now() + 5 * 60 * 1000;
    localStorage.setItem("boostExpiry", expiry);
    updateBoostUI();
    showToast("⚡ Буст обновлён за 100 💎!");
}

function updateBoostUI() {
    const active = isBoostActive();
    const sidebarTimer = document.getElementById("boost-timer-sidebar");
    const topbarIndicator = document.getElementById("boost-indicator-topbar");
    const topbarTimer = document.getElementById("boost-timer-topbar");
    const boostBtn = document.getElementById("btn-activate-boost");
    
    if (active) {
        const remaining = getBoostRemaining();
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const timeStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        
        if (sidebarTimer) { sidebarTimer.style.display = "block"; sidebarTimer.textContent = `⏱ ${timeStr}`; }
        if (topbarIndicator) { topbarIndicator.style.display = "flex"; }
        if (topbarTimer) topbarTimer.textContent = timeStr;
        if (boostBtn) { boostBtn.textContent = "✅ Буст активен"; boostBtn.disabled = true; }
    } else {
        if (sidebarTimer) sidebarTimer.style.display = "none";
        if (topbarIndicator) topbarIndicator.style.display = "none";
        if (boostBtn) { boostBtn.textContent = "⚡ Удвоить доход (5 мин)"; boostBtn.disabled = false; }
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
    if (coinEl) coinEl.textContent = playerState.coins.toLocaleString('ru-RU');
    if (gemEl) gemEl.textContent = playerState.gems.toLocaleString('ru-RU');
    // Рейтинг инициализируется позже — до этого момента проверку места не запускаем
    if (leaderboardReady) scheduleRankCheck();
}

// Ставится в true, когда живой рейтинг готов (чтобы не ловить TDZ при раннем рендере валюты)
var leaderboardReady = false;

function saveCurrency() {
    localStorage.setItem("playerCoins", playerState.coins);
    localStorage.setItem("playerGems", playerState.gems);
    localStorage.setItem("playerXP", playerState.xp);
    localStorage.setItem("playerLevel", playerState.level);
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
        showToast("Загрузка...");
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
    const homeNavBtn = document.querySelector('.nav-item[data-section="Главная"]');
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
    const casesNavBtn = document.querySelector('.nav-item[data-section="Кейсы"]');
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
    const invNavBtn = document.querySelector('.nav-item[data-section="Инвентарь"]');
    if (invNavBtn) invNavBtn.classList.add("active");
}

// Показ Рейтинга
function showLeaderboardScreen() {
    hideAllScreens();
    if (screenLeaderboard) {
        screenLeaderboard.style.display = "block";
        generateLeaderboard(); // Генерируем таблицу
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const lbNavBtn = document.querySelector('.nav-item[data-section="Рейтинг"]');
    if (lbNavBtn) lbNavBtn.classList.add("active");
}

// Показ Магазина
function showShopScreen() {
    hideAllScreens();
    if (screenShop) {
        screenShop.style.display = "block";
        updateShopUI();
    }
    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    const shopNavBtn = document.querySelector('.nav-item[data-section="Магазин"]');
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
    const battlesNavBtn = document.querySelector('.nav-item[data-section="Битвы"]');
    if (battlesNavBtn) battlesNavBtn.classList.add("active");
}

// Обновление UI магазина (аналог updateRewardUI но для обоих типов)
function updateShopUI() {
    // Монеты
    const coinList = document.getElementById("shop-coins-list");
    if (coinList) updateRewardListUI(coinList, "coin");
    
    // Кристаллы
    const gemList = document.getElementById("shop-gems-list");
    if (gemList) updateRewardListUI(gemList, "gem");
    
    // Повторная привязка кнопок магазина (на случай если они не были привязаны)
    document.querySelectorAll("#screen-shop .reward-btn").forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = "true";
        btn.addEventListener("click", (e) => {
            const card = e.target.closest(".reward-card");
            if (!card) return;
            const index = parseInt(card.dataset.index);
            const type = card.dataset.type || "coin";
            btn.textContent = "Загрузка рекламы...";
            btn.disabled = true;
            showRewardedAd((success) => {
                if (success) {
                    const rewardAmount = rewardsData[type][index];
                    if (type === "coin") playerState.coins += rewardAmount;
                    else playerState.gems += rewardAmount;
                    saveCurrency();
                    updateCurrencyUI();
                    const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
                    let claimedRewards = JSON.parse(localStorage.getItem(storageKey)) || [];
                    claimedRewards.push(index);
                    localStorage.setItem(storageKey, JSON.stringify(claimedRewards));
                    updateRewardUI(type);
                    updateShopUI();
                    showToast(`Вы получили ${rewardAmount} ${type === 'coin' ? 'монет' : 'кристаллов'}!`);
                } else {
                    showToast("Не удалось загрузить рекламу.");
                    btn.textContent = "Смотреть видео";
                    btn.disabled = false;
                }
            });
        });
    });
}

function updateRewardListUI(listEl, type) {
    const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
    const claimedRewards = JSON.parse(localStorage.getItem(storageKey)) || [];

    listEl.querySelectorAll(".reward-card").forEach((card, index) => {
        const btn = card.querySelector(".reward-btn");
        if (claimedRewards.includes(index)) {
            card.classList.add("claimed");
            btn.disabled = true;
        } else {
            card.classList.remove("claimed");
            btn.disabled = false;
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

        if (section === "Главная") showMainScreen();
        else if (section === "Кейсы") showAllCases();
        else if (section === "Инвентарь") showInventoryScreen();
        else if (section === "Рейтинг") showLeaderboardScreen();
        else if (section === "Магазин") showShopScreen();
        else if (section === "Битвы") showBattlesScreen();
        else {
            showToast("Раздел в разработке");
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
        if (isCrazyGamesEnvironment && crazyGamesSDK) {
            try {
                crazyGamesSDK.game.gameplayStart();
                console.log("CrazyGames: Gameplay Start event sent");
            } catch (e) {
                console.error("Ошибка отправки gameplayStart:", e);
            }
        }

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
        showToast("Буст уже активен! Дождитесь окончания.");
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
    const savedAvatar = localStorage.getItem("playerAvatar");
    const savedName = localStorage.getItem("playerName");

    if (savedAvatar && avatarImg) avatarImg.src = `assets/avatar/${savedAvatar}`;
    if (savedName && nameText) nameText.innerHTML = `${savedName} <span class="edit-name">✎</span>`;
    
    bindEditNameClick();
}

// Уровень, с которого открыт аватар
function getAvatarRequiredLevel(avatarFile) {
    const found = AVATAR_UNLOCKS.find(a => a.file === avatarFile);
    return found ? found.level : 1;
}

// Отрисовка сетки аватаров с учётом уровня игрока
function renderAvatarGrid() {
    if (!avatarGrid) return;
    avatarGrid.innerHTML = "";
    const level = parseInt(playerState.level) || 1;

    AVATAR_UNLOCKS.forEach(({ file: avatarFile, level: reqLevel }) => {
        const wrap = document.createElement("div");
        wrap.className = "avatar-cell";

        const img = document.createElement("img");
        img.src = `assets/avatar/${avatarFile}`;
        img.classList.add("avatar-option");
        img.alt = "Аватар";

        const isUnlocked = level >= reqLevel;
        const isSelected = (localStorage.getItem("playerAvatar") || "avatar.png") === avatarFile;
        if (isSelected) img.classList.add("selected");

        if (isUnlocked) {
            img.addEventListener("click", () => {
                avatarImg.src = `assets/avatar/${avatarFile}`;
                localStorage.setItem("playerAvatar", avatarFile);
                avatarGrid.querySelectorAll(".avatar-option").forEach(el => el.classList.remove("selected"));
                img.classList.add("selected");
                setTimeout(() => {
                    avatarModal.classList.remove("active");
                    showToast("Аватар успешно изменён!");
                }, 180);
            });
        } else {
            img.classList.add("locked");
            img.addEventListener("click", () => {
                showToast(`Аватар откроется на ${reqLevel} уровне. Твой уровень: ${level}.`);
            });
        }

        wrap.appendChild(img);

        const label = document.createElement("div");
        label.className = "avatar-cell-label" + (isUnlocked ? " unlocked" : " locked");
        label.textContent = isUnlocked ? "Открыт" : `Lv. ${reqLevel}`;
        wrap.appendChild(label);

        avatarGrid.appendChild(wrap);
    });
}

if (avatarImg && avatarModal) {
    avatarImg.addEventListener("click", () => {
        renderAvatarGrid();
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
        const currentName = nameText.innerText.replace("✎", "").trim();
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
        if (newName.length < 3 || newName.length > 15) { nameError.textContent = "Имя должно быть от 3 до 15 символов"; return; }
        if (!/^[a-zA-Z0-9_]+$/.test(newName)) { nameError.textContent = "Только английские буквы, цифры и _"; return; }
        if (takenNames.includes(newName)) { nameError.textContent = "Это имя уже занято другим игроком"; return; }

        localStorage.setItem("playerName", nameInput.value.trim());
        nameText.innerHTML = `${nameInput.value.trim()} <span class="edit-name">✎</span>`;
        bindEditNameClick(); 
        nameModal.classList.remove("active");
        showToast("Никнейм успешно изменен!");
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
// ПОЛУЧЕНИЕ ВАЛЮТЫ ЗА РЕКЛАМУ
// ==========================================

const rewardsData = { coin: [500, 1500, 5000], gem: [10, 30, 100] };
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
    const claimedRewards = JSON.parse(localStorage.getItem(storageKey)) || [];

    modal.querySelectorAll(".reward-card").forEach((card, index) => {
        const btn = card.querySelector(".reward-btn");
        if (claimedRewards.includes(index)) {
            card.classList.add("claimed");
            btn.disabled = true;
        } else {
            card.classList.remove("claimed");
            btn.disabled = false;
        }
    });

    const closeBtn = type === "coin" ? document.getElementById("close-coins-btn") : document.getElementById("close-gems-btn");
    if (closeBtn) closeBtn.textContent = claimedRewards.length === 3 ? "Приходите завтра!" : "Закрыть";
}

document.querySelectorAll(".reward-btn").forEach(btn => {
    // Пропускаем уже привязанные кнопки
    if (btn.dataset.bound) return;
    btn.dataset.bound = "true";
    
    btn.addEventListener("click", (e) => {
        const card = e.target.closest(".reward-card");
        if (!card) return;
        const index = parseInt(card.dataset.index);
        const type = card.dataset.type || "coin"; 
        
        btn.textContent = "Загрузка рекламы...";
        btn.disabled = true;

        showRewardedAd((success) => {
            if (success) {
                const rewardAmount = rewardsData[type][index];
                if (type === "coin") playerState.coins += rewardAmount;
                else playerState.gems += rewardAmount;
                
                saveCurrency();
                updateCurrencyUI();
                
                const storageKey = type === "coin" ? "claimedCoins" : "claimedGems";
                let claimedRewards = JSON.parse(localStorage.getItem(storageKey)) || [];
                claimedRewards.push(index);
                localStorage.setItem(storageKey, JSON.stringify(claimedRewards));

                updateRewardUI(type);
                updateShopUI();
                showToast(`Вы получили ${rewardAmount} ${type === 'coin' ? 'монет' : 'кристаллов'}!`);
            } else {
                showToast("Не удалось загрузить рекламу. Попробуйте позже.");
                btn.textContent = "Смотреть видео";
                btn.disabled = false;
            }
        });
    });
});

function checkDailyReset() {
    const lastReset = localStorage.getItem("lastRewardReset");
    const today = new Date().toDateString();
    if (lastReset !== today) {
        localStorage.removeItem("claimedCoins");
        localStorage.removeItem("claimedGems");
        localStorage.setItem("lastRewardReset", today);
    }
}
checkDailyReset();

// ==========================================
// ВЫПАДАЮЩИЕ МЕНЮ (Уведомления / Настройки)
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
        if (confirm("Вы уверены, что хотите сбросить ВЕСЬ прогресс? Это действие нельзя отменить.")) {
            localStorage.clear();
            location.reload();
        }
    });
}

// ==========================================
// ЛУЧШИЙ ДРОП
// ==========================================

function renderBestDrop() {
    const bestDropJSON = localStorage.getItem("bestDrop");
    const dropImg = document.getElementById("drop-display-img");
    const dropName = document.getElementById("drop-display-name");
    const dropRarity = document.getElementById("drop-display-rarity");
    const dropValue = document.getElementById("drop-display-value");

    if (!dropImg || !dropName) return;

    if (bestDropJSON) {
        const bestDrop = JSON.parse(bestDropJSON);
        dropImg.src = `assets/artifacts/${bestDrop.image}`;
        dropImg.style.opacity = "1";
        dropImg.style.padding = "0";
        dropName.innerHTML = bestDrop.name.replace(" ", "<br>");
        dropRarity.style.display = "inline-block";
        dropRarity.textContent = bestDrop.rarity;
        dropRarity.className = `rarity rarity-${bestDrop.rarity.toLowerCase()}`;
        dropValue.style.display = "inline-block";
        dropValue.textContent = `+${bestDrop.value} ₽`;
    } else {
        dropImg.src = "assets/logo.png";
        dropImg.style.opacity = "0.3";
        dropImg.style.padding = "40px";
        dropName.textContent = "Дропа еще нет";
        dropRarity.style.display = "none";
        dropValue.style.display = "none";
    }
}
renderBestDrop();

// ==========================================
// БАЗА АРТЕФАКТОВ
// ==========================================

// ==========================================
// БАЛАНСИРОВКА: ЦЕНЫ ПРИВЯЗАНЫ К РЕДКОСТИ
// Common: 10-50 | Rare: 100-500 | Epic: 800-2500 | Legendary: 3000-8000 | Mythic: 10000+
// ==========================================
const artifactsDB = {
    // --- COMMON (10-50) ---
    "stone": { name: "Камень «просто камень»", image: "common/stone.png", rarity: "Common", value: 10, desc: "Он не делает ничего. Но он хотя бы честный." },
    "glass_half": { name: "Стакан «наполовину»", image: "common/glass_half.png", rarity: "Common", value: 15, desc: "Наполовину пуст. Наполовину полон. Наполовину забыт на столе." },
    "pen_empty": { name: "Ручка «кончилась»", image: "common/pen_empty.png", rarity: "Common", value: 18, desc: "Стержень закончился ровно тогда, когда ты подписывал важный документ." },
    "slime_smart": { name: "Слизень «почти умный»", image: "common/slime_smart.png", rarity: "Common", value: 22, desc: "Он пытался решить теорему, но потом забыл, как дышать." },
    "moth_light": { name: "Мотылек «к свету»", image: "common/moth_light.png", rarity: "Common", value: 25, desc: "Летит на свет с 2015 года. До сих пор не долетел." },
    "nut_useful": { name: "Гайка «я еще пригожусь»", image: "common/nut_useful.png", rarity: "Common", value: 12, desc: "Лежит в ящике 10 лет. Ждёт своего часа, которого не будет." },
    "panel_broken": { name: "Панель «почти работает»", image: "common/panel_broken.png", rarity: "Common", value: 20, desc: "Работает на 99%. Остальные 1% — это когда тебе нужно срочно." },
    "paperclip": { name: "Скрепка «еще один документ»", image: "common/paperclip.png", rarity: "Common", value: 10, desc: "Согнута, разогнута и снова согнута. Как и твоя карьера." },
    "door_handle": { name: "Дверная ручка «не сюда»", image: "common/door_handle.png", rarity: "Common", value: 30, desc: "Открывает дверь, которая ведет в стену." },
    "slime_compass": { name: "Слизневый компас", image: "common/slime_compass.png", rarity: "Common", value: 35, desc: "Всегда указывает на холодильник." },
    "compass_north": { name: "Компас «почти север»", image: "common/compass_north.png", rarity: "Common", value: 32, desc: "Указывает на север. Иногда на юг. Но чаще на диван." },
    "rusty_wrench": { name: "Ржавый болтоключ", image: "common/rusty_wrench.png", rarity: "Common", value: 24, desc: "Идеально подходит, чтобы сорвать любую гайку. Или палец." },
    "mug_hot": { name: "Кружка «почти горячо»", image: "common/mug_hot.png", rarity: "Common", value: 22, desc: "Чай остывает ровно за секунду до того, как ты сделаешь глоток." },
    "spoon_bad": { name: "Ложка неудачного укуса", image: "common/spoon_bad.png", rarity: "Common", value: 28, desc: "Всегда проливает суп мимо рта. Прямо на белую рубашку." },

    // --- RARE (100-500) ---
    "toaster_doom": { name: "Тостер судного дня", image: "rare/toaster_doom.png", rarity: "Rare", value: 150, desc: "Подгорает даже то, что ты не клал внутрь." },
    "fork_dilemma": { name: "Вилка вечной дилеммы", image: "rare/fork_dilemma.png", rarity: "Rare", value: 180, desc: "4 зубца слева, 4 справа. Выбор невозможен." },
    "neuro_flashlight": { name: "Нейро-фонарик", image: "rare/neuro_flashlight.png", rarity: "Rare", value: 250, desc: "Подсвечивает мысли. К сожалению, только глупые." },
    "boots_backwards": { name: "Ботинки обратной пятки", image: "rare/boots_backwards.png", rarity: "Rare", value: 220, desc: "Позволяют ходить задом наперед с невероятной скоростью." },
    "map_somewhere": { name: "Карта «где-то тут»", image: "rare/map_somewhere.png", rarity: "Rare", value: 120, desc: "Показывает крестик в океане. Вы не умеете плавать." },
    "hourglass_minute": { name: "Песочные часы «еще минутку»", image: "rare/hourglass_minute.png", rarity: "Rare", value: 200, desc: "Песок в них никогда не заканчивается. Как и твои отговорки." },
    "antenna_poor": { name: "Антенна «слышу вас плохо»", image: "rare/antenna_poor.png", rarity: "Rare", value: 110, desc: "Ловит сигналы только из прошлого вторника." },
    "fragment_fault": { name: "Обломок «не моя вина»", image: "rare/fragment_fault.png", rarity: "Rare", value: 140, desc: "Отвалился от чего-то важного. Но ты не при делах." },
    "cable_tangled": { name: "Кабель «запутался сам»", image: "rare/cable_tangled.png", rarity: "Rare", value: 130, desc: "Он вяжет узлы, пока ты спишь." },
    "stamp_pending": { name: "Печать «почти согласование»", image: "rare/stamp_pending.png", rarity: "Rare", value: 100, desc: "Подтверждает всё, кроме твоей зарплаты." },
    "folder_wrong": { name: "Папка «не туда»", image: "rare/folder_wrong.png", rarity: "Rare", value: 160, desc: "Внутри важные документы, которые никто никогда не найдёт." },
    "printer_jammed": { name: "Принтер «зажевал»", image: "rare/printer_jammed.png", rarity: "Rare", value: 145, desc: "Зажевал твой отчет. И твою карьеру заодно." },
    "cat_notmine": { name: "Кот «не мой»", image: "rare/cat_notmine.png", rarity: "Rare", value: 400, desc: "Он пришел сам. Он не уходит. Выводы делай сам." },
    "hamster_world": { name: "Хомяк «запасной мир»", image: "rare/hamster_world.png", rarity: "Rare", value: 500, desc: "В его щеках хранится минимум одна галактика." },

    // --- EPIC (800-2500) ---
    "teapot_infinity": { name: "Чайник бесконечности", image: "epic/teapot_infinity.png", rarity: "Epic", value: 900, desc: "Кипит вечно. Наливает пустоту." },
    "crystal_destiny": { name: "Кристалл спорного вкуса", image: "epic/crystal_destiny.png", rarity: "Epic", value: 1200, desc: "Светится. Ничего не делает. На вкус как батарейка." },
    "frying_pan": { name: "Сковорода мягкой посадки", image: "epic/frying_pan.png", rarity: "Epic", value: 850, desc: "Готовит яичницу. Один раз. Потом она улетает." },
    "cloak_jumper": { name: "Плащ осторожного прыгуна", image: "epic/cloak_jumper.png", rarity: "Epic", value: 1000, desc: "Замедляет падение ровно настолько, чтобы ты успел испугаться." },
    "helmet_commentator": { name: "Шлем тихого комментатора", image: "epic/helmet_commentator.png", rarity: "Epic", value: 1500, desc: "Позволяет комментировать действия начальника, но он тебя не услышит." },
    "gloves_fault": { name: "Перчатки «не моя вина»", image: "epic/gloves_fault.png", rarity: "Epic", value: 1100, desc: "В них можно разбить вазу и сказать, что так и было." },
    "candle_chance": { name: "Свеча последнего шанса", image: "epic/candle_chance.png", rarity: "Epic", value: 800, desc: "Горит ровно до того момента, как ты сдашься." },
    "trash_ideas": { name: "Мусорный бак сингулярности", image: "epic/trash_ideas.png", rarity: "Epic", value: 1150, desc: "Здесь лежат все твои стартапы. И они притягивают мусор." },
    "lantern_socks": { name: "Фонарь потерянных носков", image: "epic/lantern_socks.png", rarity: "Epic", value: 950, desc: "Привлекает потерянные носки со всей округи." },
    "chest_stranger": { name: "Реликварий странника", image: "epic/chest_stranger.png", rarity: "Epic", value: 1800, desc: "Внутри хранится пыль из 100 городов." },
    "coffee_machine": { name: "Кофемашина «еще одна»", image: "epic/coffee_machine.png", rarity: "Epic", value: 1050, desc: "Варит кофе, который заставляет тебя дрожать." },
    "heart_singularity": { name: "Сердце уютной сингулярности", image: "epic/heart_singularity.png", rarity: "Epic", value: 1300, desc: "Греет лучше пледа. Но может поглотить твой дом." },
    "fox_plan": { name: "Лис «хитрый план»", image: "epic/fox_plan.png", rarity: "Epic", value: 1600, desc: "План состоял из трех частей: украсть, съесть, убежать." },
    "exoskeleton_tired": { name: "Экзоскелет уставшего героя", image: "mythic/exoskeleton_tired.png", rarity: "Epic", value: 2500, desc: "Он сражался со злом. Но теперь он хочет спать." },

    // --- LEGENDARY (3000-8000) ---
    "knife_blunt": { name: "Нож, который не режет", image: "legendary/knife_blunt.png", rarity: "Legendary", value: 3500, desc: "Безопасен для пальцев. И для еды." },
    "plate_second": { name: "Тарелка бесконечного второго", image: "legendary/plate_second.png", rarity: "Legendary", value: 3200, desc: "Никогда не останешься голодным. И никогда не похудеешь." },
    "backpack_bottomless": { name: "Рюкзак бездонного кармана", image: "legendary/backpack_bottomless.png", rarity: "Legendary", value: 3000, desc: "Внутри можно найти всё, кроме того, что ты ищешь." },
    "helmet_legendary": { name: "Шлем «почти легендарный»", image: "legendary/helmet_legendary.png", rarity: "Legendary", value: 3100, desc: "Отличается от легендарного отсутствием короны." },
    "feather_writer": { name: "Перо позднего писателя", image: "legendary/feather_writer.png", rarity: "Legendary", value: 3300, desc: "Пишет только ночью. И только о том, как ты устал." },
    "key_wrong_door": { name: "Ключ от неправильной двери", image: "legendary/key_wrong_door.png", rarity: "Legendary", value: 4000, desc: "Открывает только ту дверь, которая тебе не нужна." },
    "lock_unopened": { name: "Люк «не открывать»", image: "legendary/lock_unopened.png", rarity: "Legendary", value: 5000, desc: "Если ты его откроешь, ты пожалеешь." },
    "box_black": { name: "Черный ящик «все записал»", image: "legendary/box_black.png", rarity: "Legendary", value: 3800, desc: "Хранит запись твоих самых неловких моментов." },
    "badge_intern": { name: "Бейдж «стажер»", image: "legendary/badge_intern.png", rarity: "Legendary", value: 4500, desc: "Даёт право на бесплатный кофе. И всё." },
    "handle_busy": { name: "Переговорка «занято»", image: "legendary/handle_busy.png", rarity: "Legendary", value: 5500, desc: "Внутри всегда кто-то есть. Даже если комната пуста." },
    "penguin_golden": { name: "Пингвин «холодная голова»", image: "legendary/penguin_golden.png", rarity: "Legendary", value: 6500, desc: "Не паникует даже когда тонет. Идеальный сотрудник." },
    "dragon_sneeze": { name: "Дракончик «почти огнедышащий»", image: "legendary/dragon_sneeze.png", rarity: "Legendary", value: 8000, desc: "Чихает искрами. Не пытайтесь кормить перцем." },

    // --- MYTHIC (10000+) ---
    "chair_minutes": { name: "Кресло «еще пять минут»", image: "mythic/chair_minutes.png", rarity: "Mythic", value: 12000, desc: "Ты садишься в него и теряешь счет времени." },
    "satellite_space": { name: "Спутник «личное пространство»", image: "mythic/satellite_space.png", rarity: "Mythic", value: 15000, desc: "Охраняет твои границы. Не подпускает никого ближе 10 метров." },
    "mirror_truth": { name: "Осколок зеркала правды", image: "mythic/mirror_truth.png", rarity: "Mythic", value: 10000, desc: "Показывает правду. Обычно это «ты выглядишь уставшим»." },
    "reactor_stable": { name: "Реактор «почти стабильный»", image: "mythic/reactor_stable.png", rarity: "Mythic", value: 20000, desc: "Он не взорвется. Наверное." },
    "void_pet": { name: "Питомец пустоты", image: "mythic/void_pet.png", rarity: "Mythic", value: 11000, desc: "Смотрит на тебя с осуждением. Он знает, что ты сделал." }
};

// ==========================================
// КЕЙСЫ
// ==========================================

// ==========================================
// КОНФИГУРАЦИЯ КЕЙСОВ (БАЛАНС ШАНСОВ 100%)
// ==========================================
const CASES_DATA = {
    "bara": {
        title: "Барахолка",
        desc: "«Всё почти работает. Почти дёшево.»",
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
        title: "Офисная Свалка",
        desc: "«Бюрократия, которая переживёт апокалипсис.»",
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
        title: "Лаборатория Плюха",
        desc: "«Учёные хотели сделать уютно. Стало слишком уютно.»",
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
        title: "Мистический Каталог",
        desc: "«Вы это не заказывали. Оно уже в пути.»",
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
        title: "Домашний Скарб",
        desc: "«Убрались. Нашли то, что лучше бы не находить.»",
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
        title: "Космический Утиль",
        desc: "«Всё, что осталось от программы 'Почти долетели'.»",
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
            <button class="case-button" ${btnStyle ? `style="${btnStyle}"` : ''}>Открыть</button>
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
    
    // Главная: только 3 самых дешевых
    if (mainGrid) {
        sortedKeys.slice(0, 3).forEach(key => {
            mainGrid.insertAdjacentHTML('beforeend', getCaseCardHTML(key, CASES_DATA[key]));
        });
    }

    // Все кейсы: полный список
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
                <img src="assets/artifacts/${item.image}" alt="">
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
        showToast("Недостаточно монет!");
        return;
    }

    previewModal.classList.remove("active");
    playerState.coins -= currentCaseData.price;
    saveCurrency();
    updateCurrencyUI();

    startRoulette();
});

function getRandomWeightedItem(pool, forceLegendary = false) {
    // Гарантированный легендарный дроп при первом открытии
    if (forceLegendary) {
        const legendaryItems = pool.filter(p => artifactsDB[p.id] && artifactsDB[p.id].rarity === "Legendary");
        if (legendaryItems.length > 0) {
            const pick = legendaryItems[Math.floor(Math.random() * legendaryItems.length)];
            return artifactsDB[pick.id];
        }
    }
    
    const totalChance = pool.reduce((sum, item) => sum + item.chance, 0);
    let random = Math.random() * totalChance;
    
    for (const item of pool) {
        if (random < item.chance) return artifactsDB[item.id];
        random -= item.chance;
    }
    return artifactsDB[pool[pool.length - 1].id];
}

function startRoulette(isFree = false) {
    openModal.classList.add("active");
    rouletteTrack.innerHTML = "";
    rouletteTrack.style.transition = "none";
    rouletteTrack.style.transform = "translateX(0)";

    // Гарантированный легендарный дроп только при первом открытии (онбординг)
    const forceLegendary = isFree && isFirstOpenGuaranteedLegendary;
    if (forceLegendary) isFirstOpenGuaranteedLegendary = false;

    const winningItem = getRandomWeightedItem(currentCaseData.pool, forceLegendary);

    const totalItems = 60;
    const winningIndex = 54;
    const itemWidth = 130;

    for (let i = 0; i < totalItems; i++) {
        const itemToShow = (i === winningIndex) ? winningItem : getRandomWeightedItem(currentCaseData.pool);
        const el = document.createElement("div");
        el.className = "roulette-item";
        el.innerHTML = `<img src="assets/artifacts/${itemToShow.image}" alt="">`;
        rouletteTrack.appendChild(el);
    }

    setTimeout(() => {
        rouletteTrack.style.transition = "transform 5s cubic-bezier(0.15, 0.9, 0.2, 1)";
        const containerWidth = document.querySelector(".roulette-container").offsetWidth;
        const randomOffset = (Math.random() * 40) - 20;
        const offset = (containerWidth / 2) - (110 / 2) - (winningIndex * itemWidth) + randomOffset;
        
        rouletteTrack.style.transform = `translateX(${offset}px)`;

        setTimeout(() => {
            openModal.classList.remove("active");
            showResult(winningItem);
        }, 5200);
    }, 50);
}

// ==========================================
// РЕЗУЛЬТАТ
// ==========================================

function showResult(item) {
    currentDropItem = item;
    resultModal.classList.add("active");
    
    document.getElementById("result-image").src = `assets/artifacts/${item.image}`;
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

    const currentBestJSON = localStorage.getItem("bestDrop");
    const currentBest = currentBestJSON ? JSON.parse(currentBestJSON) : { value: 0 };
    if (item.value > currentBest.value) {
        localStorage.setItem("bestDrop", JSON.stringify(item));
        renderBestDrop();
    }
    
    // После первого открытия добавляем уведомление о ежедневной награде
    if (isFirstOpenGuaranteedLegendary === false && !localStorage.getItem("dailyNotifAdded")) {
        addNotification("Ежедневная награда", "Забери свой бесплатный кейс! Нажми сюда.", () => {
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
        localStorage.setItem("dailyNotifAdded", "true");
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
        // X2 Boost: give second copy
        if (isBoostActive()) {
            playerInventory.push({...currentDropItem});
            showToast(`⚡ БУСТ! Получено 2x "${currentDropItem.name}"!`);
        } else {
            showToast(`Артефакт "${currentDropItem.name}" добавлен в инвентарь!`);
        }
        saveInventory();
        // XP for opening case
        if (currentCaseData) addXP(Math.floor(currentCaseData.price / 10));
    }
    document.getElementById("drop-result-modal").classList.remove("active");
});

document.getElementById("btn-sell-case").addEventListener("click", () => {
    if (currentDropItem) {
        playerState.coins += currentDropItem.value;
        saveCurrency();
        updateCurrencyUI();
        showToast(`Вы продали артефакт за ${currentDropItem.value} кредитов!`);
        // XP for opening case
        if (currentCaseData) addXP(Math.floor(currentCaseData.price / 10));
    }
    document.getElementById("drop-result-modal").classList.remove("active");
});

// Crystal Reroll
document.getElementById("btn-reroll-case").addEventListener("click", () => {
    if (!currentCaseData) return;
    if (playerState.gems < 50) {
        showToast("Недостаточно кристаллов! Нужно 50 💎");
        return;
    }
    playerState.gems -= 50;
    saveCurrency();
    updateCurrencyUI();
    
    // Close result modal, re-run roulette without charging coins
    document.getElementById("drop-result-modal").classList.remove("active");
    startRoulette(true); // free reroll
});

// ==========================================
// ИНВЕНТАРЬ
// ==========================================

let playerInventory = JSON.parse(localStorage.getItem("inventory")) || [];

function saveInventory() {
    localStorage.setItem("inventory", JSON.stringify(playerInventory));
}

function renderInventory() {
    const grid = document.getElementById("inventory-grid");
    if (!grid) return;
    grid.innerHTML = "";

    if (playerInventory.length === 0) {
        grid.innerHTML = `<div class="empty-inventory"><p>Твой инвентарь пуст.</p><p style="font-size: 12px; color: #b8b4d9;">Открывай кейсы и забирай артефакты!</p></div>`;
        return;
    }

    const sortedInv = [...playerInventory].sort((a, b) => b.value - a.value);

    sortedInv.forEach((item) => {
        const el = document.createElement("div");
        el.className = `inv-item frame-item-${item.rarity.toLowerCase()}`;
        el.innerHTML = `<img src="assets/artifacts/${item.image}" alt=""><span class="inv-name">${item.name}</span><span class="inv-value">${item.value} кр.</span>`;
        el.addEventListener("click", () => showItemInfo(item, "inventory"));
        grid.appendChild(el);
    });
}

// Кнопка "Продать всё"
document.getElementById("sell-all-btn").addEventListener("click", () => {
    if (playerInventory.length === 0) {
        showToast("Инвентарь пуст!");
        return;
    }

    const totalValue = playerInventory.reduce((sum, item) => sum + item.value, 0);
    
    if (confirm(`Вы уверены, что хотите продать ВСЕ предметы (${playerInventory.length} шт.) за ${totalValue} кредитов?`)) {
        playerState.coins += totalValue;
        saveCurrency();
        updateCurrencyUI();
        
        playerInventory = [];
        saveInventory();
        renderInventory();
        
        showToast(`Вы продали всё за ${totalValue} кредитов!`);
    }
});

// ==========================================
// ИНФО О ПРЕДМЕТЕ
// ==========================================

const itemInfoModal = document.getElementById("item-info-modal");
let currentInfoItem = null;
let currentInfoSource = "";

document.getElementById("close-item-info-btn").addEventListener("click", () => {
    itemInfoModal.classList.remove("active");
});

itemInfoModal.addEventListener("click", (e) => {
    if (e.target === itemInfoModal) itemInfoModal.classList.remove("active");
});

function showItemInfo(item, source = "preview") {
    currentInfoItem = item;
    currentInfoSource = source;

    document.getElementById("item-info-img").src = `assets/artifacts/${item.image}`;
    document.getElementById("item-info-name").textContent = item.name;
    document.getElementById("item-info-desc").textContent = item.desc;
    
    const chanceEl = document.getElementById("item-info-chance");
    if (item.chance !== undefined) {
        chanceEl.textContent = `${item.chance}%`;
    } else {
        chanceEl.textContent = "Уже выпал";
        chanceEl.style.fontSize = "14px";
    }
    
    document.getElementById("item-info-value").textContent = `${item.value} кр.`;
    
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
    if (source === "inventory") sellBtn.style.display = "block";
    else sellBtn.style.display = "none";

    itemInfoModal.classList.add("active");
}

document.getElementById("sell-item-info-btn").addEventListener("click", () => {
    if (!currentInfoItem || currentInfoSource !== "inventory") return;

    const index = playerInventory.findIndex(invItem => invItem.name === currentInfoItem.name && invItem.value === currentInfoItem.value);
    
    if (index !== -1) {
        playerInventory.splice(index, 1);
        saveInventory();
        
        playerState.coins += currentInfoItem.value;
        saveCurrency();
        updateCurrencyUI();
        
        showToast(`Вы продали "${currentInfoItem.name}" за ${currentInfoItem.value} кр.`);
        renderInventory();
        itemInfoModal.classList.remove("active");
    }
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
    { name: "Myshka_Norkа", avatar: "avatar-5.png", score: 300000 },
    { name: "Pylesos_Dnya", avatar: "avatar-6.png", score: 250000 },
    { name: "Kaktus_Bezboli", avatar: "avatar-7.jpeg", score: 200000 },
    { name: "Tapok_V_kosmose", avatar: "avatar.png", score: 150000 },
    { name: "Chaynik_Beskonech", avatar: "avatar-2.jpeg", score: 100000 },
    { name: "Tapochki_Doma", avatar: "avatar-3.png", score: 80000 }
];

const nickPrefixes = ["Noob", "Pro", "Mega", "Ultra", "Lazy", "Crazy", "Funny", "Toxic", "Kind", "Sneaky"];
const nickSuffixes = ["Slime", "Cat", "Duck", "Sock", "Cable", "Toaster", "Box", "Crystal", "Totem", "Fridge", "Kettle", "Mouse", "Spoon"];

// ---- Живой рейтинг: один источник правды для главной и экрана "Рейтинг" ----
// 98 ботов + игрок = 99 мест. Игрок всегда стартует с 99-го.
const LB_ROSTER_KEY = "leaderboardRosterV4";
const LB_DRIFT_KEY = "leaderboardLastDrift";
const LB_BEST_RANK_KEY = "playerBestRank";
const LB_TICK_MS = 20000;
const LB_TOTAL_PLACES = 99;
const LB_TOP_SCORE = 20000000; // лидер — 20 млн, до топ-1 очень долго
const LB_BOTTOM_SCORE = 200;   // 98-е место — 200 кр.

const LB_AVATARS = ["avatar.png", "avatar-2.jpeg", "avatar-3.png", "avatar-4.png", "avatar-5.png", "avatar-6.png", "avatar-7.jpeg"];

function escapeLbName(str) {
    return String(str).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Опорные точки шкалы: внизу места идут часто и дёшево, к топу — дорого и редко.
// rank: место бота (1 = топ), score: сколько кр. нужно, чтобы его обойти.
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
        // LB_ANCHORS идёт от 98-го места (мало кр.) к 1-му (много кр.)
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
        localStorage.setItem(LB_ROSTER_KEY, JSON.stringify(roster));
        localStorage.setItem(LB_DRIFT_KEY, String(Date.now()));
    } catch (e) {}
}

function loadRoster() {
    let roster = null;
    try {
        const raw = localStorage.getItem(LB_ROSTER_KEY);
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
    const last = parseInt(localStorage.getItem(LB_DRIFT_KEY) || "0", 10) || Date.now();
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

// Топ-3 на главной — строго из того же ростера, что и экран "Рейтинг"
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
            <img src="assets/avatar/${p.avatar}" class="mini-avatar" alt="" onerror="this.src='assets/avatar.png'">
            <strong>${escapeLbName(p.name)}</strong>
            <span>${p.score.toLocaleString("ru-RU")} кр.</span>
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
    const playerName = localStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = localStorage.getItem("playerAvatar") || "avatar.png";

    const all = getRoster().map(bot => ({
        name: bot.name, avatar: bot.avatar, score: bot.score, isPlayer: false
    }));
    all.push({ name: playerName, avatar: playerAvatar, score: Math.max(0, Math.floor(playerState.coins)), isPlayer: true });
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
    const saved = parseInt(localStorage.getItem(LB_BEST_RANK_KEY) || "0", 10);

    if (!saved) {
        localStorage.setItem(LB_BEST_RANK_KEY, String(rank));
        return rank;
    }

    if (rank < saved) {
        localStorage.setItem(LB_BEST_RANK_KEY, String(rank));
        const place = rank === 1 ? "1-е место" : `${rank}-е место`;
        if (typeof addNotification === "function") {
            addNotification(
                `🏆 Новое место в рейтинге: ${place}!`,
                rank === 1
                    ? "Ты обошёл всех. Ты легенда Артефакт Клэш!"
                    : `Ты поднялся с ${saved}-го на ${rank}-е место. Продолжай в том же духе!`,
                () => { if (typeof showLeaderboardScreen === "function") showLeaderboardScreen(); }
            );
        }
        if (typeof showToast === "function") showToast(`🏆 Рейтинг: ${place}!`);
    }
    return rank;
}

function renderPlayerPlaceBanner(listEl, rank, allPlayers) {
    const total = allPlayers.length;
    const place = document.createElement("div");
    place.className = "lb-place-banner";
    place.innerHTML = `<span>Твоё место</span><b>#${rank}</b><span>из ${total}</span>`;
    listEl.appendChild(place);
}

function generateLeaderboard() {
    // ПРОВЕРКА: если контейнера нет, выходим
    const listEl = document.getElementById("leaderboard-list");
    if (!listEl) {
        console.error("Ошибка: Элемент #leaderboard-list не найден в HTML!");
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
        row.innerHTML = `
            <div class="lb-rank ${rankClass}">#${rank}</div>
            <img src="assets/avatar/${player.avatar}" class="lb-avatar" alt="" onerror="this.src='assets/avatar.png'">
            <div class="lb-name">${escapeLbName(player.name)}</div>
            <div class="lb-score">${player.score.toLocaleString('ru-RU')} кр.</div>
        `;
        listEl.appendChild(row);
    });

    // Игрок за пределами топ-20 — показываем его отдельным блоком в самом конце
    if (playerRank > 20) {
        const gap = document.createElement("div");
        gap.className = "lb-gap";
        gap.textContent = `. . .  ${playerRank - 21 > 0 ? `ещё ${playerRank - 21} игроков` : ""}  . . .`;
        listEl.appendChild(gap);

        const player = allPlayers[playerIndex];
        const row = document.createElement("div");
        row.className = "lb-row is-player";
        row.innerHTML = `
            <div class="lb-rank">#${playerRank}</div>
            <img src="assets/avatar/${player.avatar}" class="lb-avatar" alt="" onerror="this.src='assets/avatar.png'">
            <div class="lb-name">${escapeLbName(player.name)}</div>
            <div class="lb-score">${player.score.toLocaleString('ru-RU')} кр.</div>
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
    const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding");
    const lastDailyDate = localStorage.getItem("lastDailyRewardDate");
    const today = new Date().toDateString();

    // 1. Онбординг (приоритет)
    if (!hasSeenOnboarding && onboardingModal) {
        setTimeout(() => {
            onboardingModal.classList.add("active");
        }, 500);
        return;
    }

    // 2. Ежедневная награда
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
        localStorage.setItem("hasSeenOnboarding", "true");
        onboardingModal.classList.remove("active");
        
        // Бесплатное открытие мистического кейса с гарантированным легендой
        currentCaseData = CASES_DATA["mystic"];
        startRoulette(true);
    });
}

// Обработчик ежедневной награды
const btnClaimDaily = document.getElementById("btn-claim-daily");
const btnSkipDaily = document.getElementById("btn-skip-daily");

if (btnClaimDaily) {
    btnClaimDaily.addEventListener("click", () => {
        const today = new Date().toDateString();
        localStorage.setItem("lastDailyRewardDate", today);
        dailyRewardModal.classList.remove("active");
        
        // XP for daily reward
        addXP(50);
        
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
        const lastDailyDate = localStorage.getItem("lastDailyRewardDate");

        if (lastDailyDate === today) {
            showToast("Ты уже забрал награду сегодня! Приходи завтра.");
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

// Открытие меню битв
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
        showToast("Недостаточно монет для битвы!");
        return;
    }

    // Разные боты для каждой битвы
    const bot = getRandomBot();
    const playerName = localStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = localStorage.getItem("playerAvatar") || "avatar.png";

    // Списание ставки
    playerState.coins -= currentBattleCase.price;
    saveCurrency();
    updateCurrencyUI();

    // Заставка VS
    showVsAnimation(playerName, playerAvatar, bot.name, bot.avatar, () => {
        const botAvatarEl = document.getElementById("battle-bot-avatar");
        const botNameEl = document.getElementById("battle-bot-name");
        if (botAvatarEl) botAvatarEl.src = `assets/avatar/${bot.avatar}`;
        if (botNameEl) botNameEl.textContent = bot.name;

        battleSetup.style.display = "none";
        battleArena.style.display = "block";
        battleStakeDisplay.textContent = `${currentBattleCase.price} кр.`;
        battleStatus.textContent = "Открытие...";
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
    battleStatus.textContent = "Бот открывает...";
    
    setTimeout(() => {
        // Показ дропа бота
        renderBattleDrop(battleBotDrop, battleBotItem);
        
        // Определение победителя
        let won = false;
        if (battlePlayerItem.value > battleBotItem.value) {
            won = true;
            battleStatus.textContent = "🏆 ТЫ ПОБЕДИЛ!";
            battleStatus.style.color = "#42e8a3";
        } else if (battlePlayerItem.value < battleBotItem.value) {
            won = false;
            battleStatus.textContent = "💀 БОТ ПОБЕДИЛ";
            battleStatus.style.color = "#ff4d4d";
        } else {
            won = true; // Ничья = игрок забирает своё
            battleStatus.textContent = "🤝 НИЧЬЯ (Предмет твой)";
            battleStatus.style.color = "#ffca35";
        }
        
        // Расчет выигрыша
        const totalWin = battlePlayerItem.value + battleBotItem.value;

        btnFinishBattle.style.display = "block";
        btnFinishBattle.onclick = () => {
            if (won) {
                // Победитель забирает оба предмета в инвентарь
                playerInventory.push(battlePlayerItem);
                playerInventory.push(battleBotItem);
                if (isBoostActive()) {
                    playerInventory.push({...battlePlayerItem});
                    playerInventory.push({...battleBotItem});
                }
                // XP for winning battle
                addXP(Math.floor(currentBattleCase.price / 5));
                saveInventory();
                showToast(`Победа! Получено 2 предмета на сумму ${totalWin} кр.`);
            } else {
                // Проигравший не получает предмет обратно — только 50% его стоимости
                const consolation = Math.floor(battlePlayerItem.value * 0.5);
                playerState.coins += consolation;
                saveCurrency();
                updateCurrencyUI();
                addXP(Math.floor(currentBattleCase.price / 20));
                showToast(`Поражение. Утешительный приз: ${consolation} кр.`);
            }
            saveInventory();
            battleModal.classList.remove("active");
            battleStatus.style.color = "#f8f7ff";
        };
        
    }, 1000);
}

function renderBattleDrop(container, item) {
    container.style.opacity = "1";
    container.innerHTML = `<img src="assets/artifacts/${item.image}" alt="" style="width: 80%; height: 80%; object-fit: contain;">`;
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
    AVATAR_UNLOCKS.forEach(a => {
        const img = document.createElement("img");
        img.src = `assets/avatar/${a.file}`;
        img.className = `ach-avatar-mini ${playerState.level >= a.level ? 'unlocked' : ''}`;
        img.title = `Lv. ${a.level}`;
        container.appendChild(img);
    });
}

function openAchievementsModal() {
    if (!achievementsGrid || !achievementsModal) return;
    achievementsGrid.innerHTML = "";
    updateLevelUI();
    
    AVATAR_UNLOCKS.forEach(a => {
        const wrapper = document.createElement("div");
        wrapper.style.textAlign = "center";
        
        const img = document.createElement("img");
        img.src = `assets/avatar/${a.file}`;
        img.className = "avatar-option";
        const unlocked = playerState.level >= a.level;
        if (!unlocked) {
            img.classList.add("locked");
            img.style.opacity = "0.3";
            img.style.filter = "grayscale(1)";
            img.style.cursor = "not-allowed";
        } else {
            img.addEventListener("click", () => {
                const avatarImgEl = document.querySelector(".avatar");
                if (avatarImgEl) {
                    avatarImgEl.src = `assets/avatar/${a.file}`;
                    localStorage.setItem("playerAvatar", a.file);
                    showToast("Аватар изменён!");
                }
            });
        }
        
        const lvlText = document.createElement("div");
        lvlText.className = "ach-level-req";
        lvlText.textContent = unlocked ? "✅ Открыт" : `🔒 Lv. ${a.level}`;
        lvlText.style.color = unlocked ? "#42e8a3" : "#b8b4d9";
        
        wrapper.appendChild(img);
        wrapper.appendChild(lvlText);
        achievementsGrid.appendChild(wrapper);
    });
    
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
    
    document.getElementById("vs-player-name").textContent = playerName || "ТЫ";
    document.getElementById("vs-player-avatar").src = `assets/avatar/${playerAvatar || 'avatar.png'}`;
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
            showToast("Инвентарь пуст! Сначала откройте кейсы.");
            return;
        }
        
        const grid = document.getElementById("battle-item-pick-grid");
        if (!grid) return;
        grid.innerHTML = "";
        
        playerInventory.forEach((item, idx) => {
            const el = document.createElement("div");
            el.className = `inv-item frame-item-${item.rarity.toLowerCase()}`;
            el.innerHTML = `<img src="assets/artifacts/${item.image}" alt=""><span class="inv-name">${item.name}</span><span class="inv-value">${item.value} кр.</span>`;
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
    const playerName = localStorage.getItem("playerName") || "CrazyPlayer";
    const playerAvatar = localStorage.getItem("playerAvatar") || "avatar.png";
    
    // Generate bot item of similar value range
    const valueRange = playerItem.value * 0.5; // ±50%
    const minVal = Math.max(10, playerItem.value - valueRange);
    const maxVal = playerItem.value + valueRange;
    
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
                battleStatus.textContent = "🏆 ТЫ ПОБЕДИЛ!";
                battleStatus.style.color = "#42e8a3";
            } else {
                battleStatus.textContent = "💀 БОТ ПОБЕДИЛ";
                battleStatus.style.color = "#ff4d4d";
            }
            
            btnFinishBattle.style.display = "block";
            btnFinishBattle.onclick = () => {
                if (won) {
                    // Winner keeps their item + gets opponent's item value as coins
                    playerState.coins += botItem.value;
                    saveCurrency();
                    updateCurrencyUI();
                    addXP(Math.floor(botItem.value / 5));
                    showToast(`Победа! Получено ${botItem.value} кр.`);
                } else {
                    // Loser loses their item but gets 30% back as coins
                    const refund = Math.floor(playerItem.value * 0.3);
                    playerInventory.splice(playerIdx, 1);
                    playerState.coins += refund;
                    saveCurrency();
                    saveInventory();
                    updateCurrencyUI();
                    showToast(`Поражение. Потерян предмет, возврат: ${refund} кр.`);
                }
                battleModal.classList.remove("active");
                battleStatus.style.color = "#f8f7ff";
                selectedItemForBattle = null;
            };
            
            battleModal.classList.add("active");
        }
    });
}

// ==========================================
// INITIALIZE ON LOAD
// ==========================================
updateLevelUI();
updateBoostUI();
renderAchievementsMini();
startLeaderboardDrift();

// ==========================================
// ЗВУКОВАЯ СИСТЕМА (CrazyGames Compliant, БЕЗ ЛАГОВ)
// ==========================================
const SOUND_ENABLED_KEY = "soundEnabled";
let soundEnabled = localStorage.getItem(SOUND_ENABLED_KEY) !== "false";
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
    document.removeEventListener("pointerdown", unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
}
document.addEventListener("pointerdown", unlockAudio);
document.addEventListener("keydown", unlockAudio);

// Воспроизведение с троттлингом и пулом
function playSound(name, forceRestart = false) {
    if (!soundEnabled || !audioUnlocked) return;
    const pool = sounds[name];
    const cfg = SOUND_CONFIG[name];
    if (!pool || !cfg) return;

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
        if (audio.paused) {
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
document.addEventListener("mouseover", (e) => {
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
    // Не дублируем клик на кнопках со своим звуком
    if (["confirm-open-btn", "btn-reroll-case", "btn-sell-case", "btn-keep-case", "sell-all-btn", "btn-activate-boost"].includes(el.id)) return;
    playSound("click");
});

// 3. Открытие кейса
document.addEventListener("click", (e) => {
    if (e.target.closest("#confirm-open-btn")) playSound("openCase");
});

// 4. Продажа / деньги
document.addEventListener("click", (e) => {
    if (e.target.closest("#btn-sell-case") || e.target.closest("#sell-item-info-btn") || e.target.closest("#sell-all-btn")) {
        playSound("money");
    }
});

// 5. Магазин (награда за рекламу)
document.addEventListener("click", (e) => {
    if (e.target.closest("#screen-shop .reward-btn")) playSound("shop");
});

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
                playSound("roulette");
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
    img.src = `assets/artifacts/${item.image}`;

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

    // Звук дропа
    const isLegend = ["Legendary", "Mythic"].includes(item.rarity);
    playSound(isLegend ? "legendaryDrop" : "commonDrop");

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

// 2. Не хватает кристаллов при реролле
const _rerollErr = document.getElementById("btn-reroll-case");
if (_rerollErr) {
    _rerollErr.addEventListener("click", () => {
        if (playerState.gems < 50) playSound("error");
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
        const lastDailyDate = localStorage.getItem("lastDailyRewardDate");
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

// 6. Реклама не загрузилась
const _origShowRewardedAdErr = window.showRewardedAd;
if (typeof _origShowRewardedAdErr === "function") {
    window.showRewardedAd = function(callback) {
        return _origShowRewardedAdErr.call(this, (success) => {
            if (!success) playSound("error");
            if (callback) callback(success);
        });
    };
}

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

// 10. Клик по кнопке «Открыть» любого кейса при нехватке монет
document.querySelectorAll(".case-button").forEach(btn => {
    btn.addEventListener("click", () => {
        if (currentCaseData && playerState.coins < currentCaseData.price) {
            playSound("error");
        }
    }, true);
});