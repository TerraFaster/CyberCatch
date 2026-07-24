import { state } from './state.js';
import { sounds } from './sound.js';
import { update, startStandardGame, startDailyGame, buyUpgrade, startNextLevel, resetGame, gameOver, triggerEvent, updateSideLeaderboardVisibility } from './engine.js';
import { initDeviceId, logSystemMessage, getQuestTimeLeft, showToast, showModal } from './utils.js';
import { loadAchievements, loadQuests, loadSeasonInfo, loadLeaderboard, initCosmetics, loadTerraSiteProfile, submitScore, checkAchievement, checkUrlReplay, API_BASE, loadServerConfig, syncCloudProfile, logoutTerraSite } from './api.js';
import { renderCustomizeUI, renderAchievementsList, startPreviewLoop, stopPreviewLoop, toggleHUDMode } from './render.js';
import { bgMusic } from './music.js';

const canvas = document.getElementById('gameCanvas');

state.keysPressed = {};

// Обработчик клавиш
window.addEventListener('keydown', (e) => {
    // Пауза на Escape
    if (e.code === 'Escape') {
        if (state.gameState === 'PLAYING') {
            state.gameState = 'PAUSED';
            logSystemMessage('ПАУЗА: Нейросеть в спящем режиме.');
        } else if (state.gameState === 'PAUSED') {
            state.gameState = 'PLAYING';
            logSystemMessage('СОЕДИНЕНИЕ ВОССТАНОВЛЕНО.');
        }
        updateSideLeaderboardVisibility();
        return;
    }
    
    if (state.isReplayPlayback) return;
    
    state.keysPressed[e.code] = true;
    
    if (e.code === 'Enter' || e.code === 'Space') {
        if (document.activeElement === document.getElementById('player-name') ||
            document.activeElement === document.getElementById('twitch-channel')) {
            return;
        }
        
        if (state.gameState === 'START' || state.gameState === 'GAMEOVER') {
            startStandardGame();
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (state.isReplayPlayback) return;
    state.keysPressed[e.code] = false;
});

// Управление кликами по Canvas
canvas.addEventListener('mousedown', (e) => {
    if (state.gameState !== 'PLAYING' || state.isReplayPlayback) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const targetX = Math.max(10, Math.min(canvas.width - state.wolf.width - 10, clickX - state.wolf.width / 2));
    state.targetX = targetX;
    state.newClickTargetX = targetX;
});

canvas.addEventListener('touchstart', (e) => {
    if (state.gameState !== 'PLAYING' || state.isReplayPlayback) return;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const clickX = ((touch.clientX - rect.left) / rect.width) * canvas.width;
    const targetX = Math.max(10, Math.min(canvas.width - state.wolf.width - 10, clickX - state.wolf.width / 2));
    state.targetX = targetX;
    state.newClickTargetX = targetX;
}, { passive: true });

// --- ИНИЦИАЛИЗАЦИЯ И ОБРАБОТЧИКИ СОБЫТИЙ ---

initDeviceId();
initCosmetics();
updateSideLeaderboardVisibility();

// Подставляем ранее сохранённое имя оператора, чтобы автоматическая отправка
// результата (см. gameOver()) записывала счёт под привычным именем, а не
// под ANON, даже если игрок не успел ничего напечатать после игры.
const savedPlayerName = localStorage.getItem('cybercatch_player_name');
if (savedPlayerName) {
    const nameInputEl = document.getElementById('player-name');
    if (nameInputEl) nameInputEl.value = savedPlayerName;
}
document.getElementById('player-name').addEventListener('input', (e) => {
    if (!state.terraSiteUser && e.target.value.trim()) {
        localStorage.setItem('cybercatch_player_name', e.target.value.trim());
    }
});

// Проверка токена (выполняется асинхронно в init())

// Привязка вкладок лидерборда (режимы STANDARD / DAILY)
const startBtn = document.getElementById('start-btn');
const dailyRunBtn = document.getElementById('daily-run-btn');

document.querySelectorAll('.tab-mode-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const mode = btn.dataset.mode;
        
        // Синхронизируем класс active на кнопках выбора режима во всех виджетах
        document.querySelectorAll('.tab-mode-btn').forEach(b => {
            if (b.dataset.mode === mode) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        // Синхронизируем видимость вкладок периодов
        document.querySelectorAll('.period-selector').forEach(sel => {
            sel.style.display = (mode === 'standard') ? 'flex' : 'none';
        });
        
        state.currentMode = mode;
        loadLeaderboard();
    });
});

// Проверка статуса Daily Run
async function checkDailyQuestStatus() {
    try {
        const res = await fetch(`${API_BASE}api/daily/seed?deviceId=${state.deviceId}`);
        const data = await res.json();
        if (data.hasPlayed) {
            dailyRunBtn.disabled = true;
            dailyRunBtn.querySelector('.btn-content').textContent = 'СЫГРАНО СЕГОДНЯ';
        } else {
            dailyRunBtn.disabled = false;
            dailyRunBtn.querySelector('.btn-content').textContent = 'DAILY REFLEX CHALLENGE (1 ПОПЫТКА)';
        }
    } catch(e) {
        console.error(e);
    }
}

// Периоды лидерборда
document.querySelectorAll('.tab-period-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const period = btn.dataset.period;
        
        // Синхронизируем класс active на кнопках выбора периода во всех виджетах
        document.querySelectorAll('.tab-period-btn').forEach(b => {
            if (b.dataset.period === period) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
        
        window.currentPeriod = period;
        loadLeaderboard();
    });
});

// Кнопка настройки кастомизации
const customizeBtn = document.getElementById('customize-btn');
const customizeScreen = document.getElementById('customize-screen');
const closeCustomizeBtn = document.getElementById('close-customize-btn');

customizeBtn.addEventListener('click', () => {
    state.gameState = 'CUSTOMIZE';
    renderCustomizeUI();
    customizeScreen.classList.add('active');
    updateSideLeaderboardVisibility();
    startPreviewLoop();
});

closeCustomizeBtn.addEventListener('click', () => {
    state.gameState = 'START';
    customizeScreen.classList.remove('active');
    updateSideLeaderboardVisibility();
    stopPreviewLoop();
});

// Кнопки переключения режимов в вкладке ИГРА
const selectStandardBtn = document.getElementById('mode-select-standard');
const selectDailyBtn = document.getElementById('mode-select-daily');

selectStandardBtn.addEventListener('click', () => {
    selectStandardBtn.style.borderColor = 'var(--neon-cyan)';
    selectStandardBtn.style.background = 'rgba(0, 240, 255, 0.1)';
    selectStandardBtn.querySelector('.btn-content').style.color = 'var(--neon-cyan)';
    
    selectDailyBtn.style.borderColor = 'rgba(255, 222, 0, 0.3)';
    selectDailyBtn.style.background = 'rgba(255, 222, 0, 0.02)';
    selectDailyBtn.querySelector('.btn-content').style.color = 'var(--text-muted)';
    
    startBtn.style.display = 'flex';
    dailyRunBtn.style.display = 'none';
    
    // Переключаем вкладку в лидерборде главного меню
    const tabBtn = document.querySelector('#menu-leaderboard-widget .tab-mode-btn[data-mode="standard"]');
    if (tabBtn) tabBtn.click();
});

selectDailyBtn.addEventListener('click', () => {
    selectDailyBtn.style.borderColor = 'var(--neon-yellow)';
    selectDailyBtn.style.background = 'rgba(255, 222, 0, 0.1)';
    selectDailyBtn.querySelector('.btn-content').style.color = 'var(--neon-yellow)';
    
    selectStandardBtn.style.borderColor = 'rgba(0, 240, 255, 0.3)';
    selectStandardBtn.style.background = 'rgba(0, 240, 255, 0.02)';
    selectStandardBtn.querySelector('.btn-content').style.color = 'var(--text-muted)';
    
    startBtn.style.display = 'none';
    dailyRunBtn.style.display = 'flex';
    
    checkDailyQuestStatus();
    
    // Переключаем вкладку в лидерборде главного меню
    const tabBtn = document.querySelector('#menu-leaderboard-widget .tab-mode-btn[data-mode="daily"]');
    if (tabBtn) tabBtn.click();
});

// Кнопки старта
startBtn.addEventListener('click', () => {
    if (state.isReplayPlayback) {
        sounds.init();
        
        // 1. Убираем лидерборд меню (заезжает под карточку)
        const menuLeaderboard = document.getElementById('menu-leaderboard-widget');
        if (menuLeaderboard) {
            menuLeaderboard.classList.remove('show');
        }

        // 2. Ждем окончания анимации скрытия лидерборда (300мс)
        setTimeout(() => {
            // 3. Запускаем фейд-аут меню-скрина
            document.getElementById('menu-screen').classList.remove('active');

            // 4. Ждем завершения фейда меню-скрина (400мс)
            setTimeout(() => {
                state.gameState = 'PLAYING';
                state.replayStartMs = Date.now();
                state.replaySpeed = 1;
                document.querySelectorAll('.replay-speed-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.speed === '1');
                });
                
                resetGame();
                
                // Включаем шапку HUD
                const hudHeader = document.querySelector('.hud-header');
                if (hudHeader) hudHeader.classList.add('show');
                
                // 5. Выезжает лидерборд игры (справа налево)
                const gameLeaderboard = document.getElementById('game-leaderboard-widget');
                if (gameLeaderboard) {
                    gameLeaderboard.classList.add('show');
                }
                
                updateSideLeaderboardVisibility();
                logSystemMessage('Запуск воспроизведения реплея...');
            }, 400);
        }, 300);
    } else {
        startStandardGame();
    }
});
dailyRunBtn.addEventListener('click', startDailyGame);

// Управление скоростью воспроизведения реплея
document.querySelectorAll('.replay-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        state.replaySpeed = parseFloat(btn.dataset.speed);
        document.querySelectorAll('.replay-speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    });
});

// Кнопка "К игре" в панели реплея — уводит со страницы реплея (?replay=...)
// обратно на обычную страницу игры, а не в список/меню реплея.
const replayToGameBtn = document.getElementById('replay-to-game-btn');
if (replayToGameBtn) {
    replayToGameBtn.addEventListener('click', () => {
        window.location.href = window.location.origin + window.location.pathname;
    });
}

// Кнопка "Играть (Выйти из реплея)" в главном меню реплея
const replayPlayBtn = document.getElementById('replay-play-btn');
if (replayPlayBtn) {
    replayPlayBtn.addEventListener('click', () => {
        window.location.href = window.location.origin + window.location.pathname;
    });
}

// Настройка отображения коллайдеров
const showCollidersCheckbox = document.getElementById('show-colliders-checkbox');
if (showCollidersCheckbox) {
    state.showColliders = localStorage.getItem('cybercatch_show_colliders') === 'true';
    showCollidersCheckbox.checked = state.showColliders;
    showCollidersCheckbox.addEventListener('change', (e) => {
        state.showColliders = e.target.checked;
        localStorage.setItem('cybercatch_show_colliders', state.showColliders);
    });
}

// Привязка остальных кнопок
document.getElementById('submit-score-btn').addEventListener('click', submitScore);
document.getElementById('player-name').addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
        submitScore();
    }
});

document.getElementById('upg-speed-btn').addEventListener('click', () => buyUpgrade('speed'));
document.getElementById('upg-hitbox-btn').addEventListener('click', () => buyUpgrade('hitbox'));
document.getElementById('upg-slow-btn').addEventListener('click', () => buyUpgrade('slow'));
document.getElementById('upg-shield-btn').addEventListener('click', () => buyUpgrade('shield'));
document.getElementById('next-lvl-btn').addEventListener('click', startNextLevel);

// Звук
const muteBtn = document.getElementById('mute-btn');
const muteIcon = document.getElementById('mute-icon');

muteBtn.addEventListener('click', () => {
    const isMuted = sounds.toggleMute();
    state.muted = isMuted;
    bgMusic.updateMuteState(isMuted);
    
    // Синхронизируем положение слайдера при муте
    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        volumeSlider.value = isMuted ? 0 : bgMusic.targetVolume;
    }
    
    if (isMuted) {
        muteIcon.innerHTML = '<path d="M4.27 3L3 4.27L7.73 9H3V15H7L12 20V13.27L16.25 17.53C15.58 18.04 14.83 18.43 14 18.68V20.76C15.38 20.44 16.63 19.78 17.67 18.95L19.73 21L21 19.73L4.27 3M19 12C19 12.83 18.83 13.62 18.54 14.35L20.1 15.91C20.68 14.74 21 13.4 21 12C21 7.72 18 4.14 14 3.23V5.31C16.89 6.16 19 8.83 19 12M14 8.83V7.07C14.86 7.42 15.61 8 16.2 8.78L14.73 10.25M16.5 12C16.5 12.3 16.46 16.6 16.46 16.6L14 14.14V12.92C14.54 12.75 15 12.43 15.36 12L16.5 12.02" />';
        logSystemMessage('Звуковые сигналы отключены.');
    } else {
        muteIcon.innerHTML = '<path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />';
        logSystemMessage('Звуковые сигналы включены.');
    }
});

const volumeSlider = document.getElementById('volume-slider');
if (volumeSlider) {
    volumeSlider.value = state.muted ? 0 : bgMusic.targetVolume;
    volumeSlider.addEventListener('input', (e) => {
        const vol = parseFloat(e.target.value);
        bgMusic.setVolume(vol);
        if (vol > 0 && state.muted) {
            // Если звук был выключен, включаем его при перетаскивании
            const isMuted = sounds.toggleMute(); // выключает mute
            state.muted = false;
            bgMusic.updateMuteState(false);
            muteIcon.innerHTML = '<path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z" />';
        }
    });
}

// Наэкранные сенсорные кнопки управления для мобильных устройств
const mobileLeft = document.getElementById('mobile-left-btn');
const mobileRight = document.getElementById('mobile-right-btn');

if (mobileLeft && mobileRight) {
    mobileLeft.addEventListener('touchstart', (e) => {
        e.preventDefault();
        state.keysPressed['KeyA'] = true;
    }, { passive: false });
    
    mobileLeft.addEventListener('touchend', (e) => {
        e.preventDefault();
        state.keysPressed['KeyA'] = false;
    }, { passive: false });
    
    mobileRight.addEventListener('touchstart', (e) => {
        e.preventDefault();
        state.keysPressed['KeyD'] = true;
    }, { passive: false });
    
    mobileRight.addEventListener('touchend', (e) => {
        e.preventDefault();
        state.keysPressed['KeyD'] = false;
    }, { passive: false });
}

// --- ИНТЕГРАЦИЯ ТАБОВ МЕНЮ ---
function switchMenuTab(tabName) {
    document.querySelectorAll('.menu-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.menu-tab-content').forEach(content => content.classList.remove('active'));
    
    const activeBtn = document.getElementById(`menu-tab-${tabName}`);
    const activeContent = document.getElementById(`tab-content-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');
    if (activeContent) activeContent.classList.add('active');
}

// Регистрируем события табов
document.getElementById('menu-tab-game').addEventListener('click', () => switchMenuTab('game'));
document.getElementById('menu-tab-achievements').addEventListener('click', () => switchMenuTab('achievements'));
document.getElementById('menu-tab-settings').addEventListener('click', () => switchMenuTab('settings'));

// --- TWITCH ИНТЕГРАЦИЯ ---
function connectTwitch() {
    const channelInput = document.getElementById('twitch-channel');
    const channel = channelInput.value.trim().toLowerCase();
    const statusEl = document.getElementById('twitch-status');
    const connectBtn = document.getElementById('twitch-connect-btn');
    
    if (!channel) {
        showToast('Укажите имя канала Twitch!', 'warning');
        return;
    }
    
    if (state.twitchSocket) {
        state.twitchSocket.close();
    }
    
    statusEl.textContent = 'Соединение...';
    
    state.twitchSocket = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    
    state.twitchSocket.onopen = () => {
        state.twitchSocket.send('PASS oauth:anonymous');
        state.twitchSocket.send('NICK justinfan' + Math.floor(10000 + Math.random() * 90000));
        state.twitchSocket.send('JOIN #' + channel);
        state.twitchConnected = true;
        
        statusEl.textContent = `Подключено: #${channel}`;
        statusEl.style.color = 'var(--neon-cyan)';
        connectBtn.textContent = 'ОТКЛЮЧИТЬ';
        logSystemMessage(`Twitch-интеграция запущена для канала: #${channel}`);
        
        checkAchievement('twitch_target', 1);
    };
    
    state.twitchSocket.onmessage = (event) => {
        const raw = event.data;
        if (raw.includes('PING')) {
            state.twitchSocket.send('PONG :tmi.twitch.tv');
            return;
        }
        
        const match = raw.match(/:([^!]+)![^@]+@[^\s]+\s+PRIVMSG\s+#[^\s]+\s+:(.+)/);
        if (match) {
            const user = match[1];
            const msg = match[2].trim().toLowerCase();
            
            if (msg.startsWith('!')) {
                const cmd = msg.substring(1);
                const allowed = ['storm', 'blackout', 'virus', 'shift', 'laser', 'gravity'];
                if (allowed.includes(cmd)) {
                    if (state.gameState !== 'PLAYING') return;
                    if (state.activeEvent !== null) return;
                    
                    const now = Date.now();
                    if (state.twitchCooldowns[cmd] && now - state.twitchCooldowns[cmd] < 35000) {
                        return;
                    }
                    
                    state.twitchCooldowns[cmd] = now;
                    logSystemMessage(`Зритель @${user} активировал событие !${cmd}!`);
                    triggerEvent(cmd);
                }
            }
        }
    };
    
    state.twitchSocket.onclose = () => {
        state.twitchConnected = false;
        statusEl.textContent = 'Статус: отключено';
        statusEl.style.color = 'var(--text-muted)';
        connectBtn.textContent = 'ПОДКЛЮЧИТЬ';
        logSystemMessage('Twitch-интеграция отключена.');
    };
    
    connectBtn.onclick = () => {
        if (state.twitchConnected) {
            state.twitchSocket.close();
        } else {
            connectTwitch();
        }
    };
}

document.getElementById('twitch-connect-btn').addEventListener('click', connectTwitch);

// Привязка обработчиков модалки предложения авторизации
document.getElementById('modal-login-btn').addEventListener('click', () => {
    document.getElementById('terrasite-prompt-modal').classList.remove('active');
    switchMenuTab('settings');
});
document.getElementById('modal-register-btn').addEventListener('click', () => {
    window.open('http://localhost:8000/auth/register', '_blank');
});
document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('terrasite-prompt-modal').classList.remove('active');
});

// Привязка кнопок TerraSite в настройках
const terrasiteLogoutBtn = document.getElementById('terrasite-logout-btn');
if (terrasiteLogoutBtn) {
    terrasiteLogoutBtn.addEventListener('click', logoutTerraSite);
}
const terrasiteWebLoginBtn = document.getElementById('terrasite-web-login-btn');
if (terrasiteWebLoginBtn) {
    terrasiteWebLoginBtn.addEventListener('click', () => {
        const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const authBase = isLocal ? 'http://localhost:3000/auth' : '/auth';
        const redirectPath = isLocal ? '/' : window.location.pathname + window.location.search;
        window.location.href = `${authBase}?redirect=${encodeURIComponent(redirectPath)}`;
    });
}

// Загрузка изображений ассетов
function loadAssets() {
    let loadedCount = 0;
    const totalAssets = Object.keys(state.images).length;
    
    Object.keys(state.images).forEach(key => {
        const imgObj = state.images[key];
        const img = new Image();
        img.src = imgObj.src;
        img.onload = () => {
            imgObj.loaded = true;
            imgObj.element = img;
            loadedCount++;
            if (loadedCount === totalAssets) {
                logSystemMessage('Все кибер-ассеты успешно загружены.');
                // Начинаем анимацию превью на случай открытия кастомизации
                renderCustomizeUI();
            }
        };
        img.onerror = () => {
            console.error(`Ошибка загрузки ассета: ${imgObj.src}`);
            loadedCount++; // Продолжаем запуск даже с процедурными заглушками
        };
    });
}
loadAssets();

async function init() {
    await loadServerConfig();
    await loadTerraSiteProfile();
    await syncCloudProfile();
    await checkUrlReplay();
    loadAchievements();
    loadQuests();
    loadSeasonInfo();
    loadLeaderboard();
    renderAchievementsList();
    toggleHUDMode(false);

    // Скрываем режим отладки для прода
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!isLocal) {
        const debugBox = document.getElementById('debug-colliders-box');
        if (debugBox) {
            debugBox.style.display = 'none';
        }
        state.showColliders = false;
    }

    // Инициализируем фоновую музыку
    bgMusic.init();
}
init();

// Запуск ежесекундного обновления таймера контракта
setInterval(() => {
    const timeLeftEl = document.getElementById('quest-time-left');
    if (timeLeftEl) {
        timeLeftEl.textContent = `ОБНОВЛЕНИЕ ЧЕРЕЗ: ${getQuestTimeLeft()}`;
    }
}, 1000);

// Привязка альтернативной кнопки закрытия [X] в кастомизации
const exitCustomizeBtn = document.getElementById('exit-customize-btn');
if (exitCustomizeBtn) {
    exitCustomizeBtn.addEventListener('click', () => {
        state.gameState = 'START';
        customizeScreen.classList.remove('active');
        updateSideLeaderboardVisibility();
        stopPreviewLoop();
    });
}

// Запуск игрового цикла
requestAnimationFrame(update);
