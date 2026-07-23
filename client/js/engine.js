import { state } from './state.js';
import { sounds } from './sound.js';
import { SKINS, TRAILS } from './config.js';
import { gameRandom, seedRandom, logSystemMessage, encodeReplay, showToast, showModal } from './utils.js';
import { render, updateAchievementTracker, updateQuestTracker, updateReplayHUD, toggleHUDMode } from './render.js';
import { startSession, submitScore, checkAchievement, updateQuestProgress, API_BASE } from './api.js';

const canvas = document.getElementById('gameCanvas');

export async function startStandardGame() {
    state.isDailyRun = false;
    state.isReplayPlayback = false;
    await startGame();
}

export async function startDailyGame() {
    state.isDailyRun = true;
    state.isReplayPlayback = false;
    
    try {
        const res = await fetch(`${API_BASE}api/daily/seed?deviceId=${state.deviceId}`);
        const data = await res.json();
        if (data.hasPlayed) {
            showModal('ДОСТУП ЗАПРЕЩЕН', 'Вы уже сыграли Daily Run сегодня! Разрешена только одна попытка в сутки.', { type: 'error' });
            return;
        }
        state.dailySeed = data.seed;
    } catch (e) {
        console.error(e);
        state.dailySeed = Math.floor(Math.random() * 100000);
    }
    
    await startGame();
}

// Раньше показывал/прятал отдельную боковую панель лидерборда, привязанную
// к экрану. Теперь виджет лидерборда — часть карточки меню (см.
// .menu-leaderboard-widget в index.html/style.css) и виден/скрыт
// автоматически вместе с #menu-screen через CSS, отдельная логика не нужна.
// Функция оставлена как no-op, т.к. вызывается из многих мест при смене
// gameState.
export function updateSideLeaderboardVisibility() {
    const menuLeaderboard = document.getElementById('menu-leaderboard-widget');
    const gameLeaderboard = document.getElementById('game-leaderboard-widget');
    
    if (state.gameState === 'PLAYING') {
        if (menuLeaderboard) menuLeaderboard.classList.remove('show');
        if (gameLeaderboard) gameLeaderboard.classList.add('show');
    } else if (state.gameState === 'START' || state.gameState === 'GAMEOVER') {
        if (gameLeaderboard) gameLeaderboard.classList.remove('show');
        if (menuLeaderboard) menuLeaderboard.classList.add('show');
    } else {
        if (menuLeaderboard) menuLeaderboard.classList.remove('show');
        if (gameLeaderboard) gameLeaderboard.classList.remove('show');
    }
}

export async function startGame() {
    sounds.init();
    await startSession();

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
            resetGame();

            const submitBtn = document.getElementById('submit-score-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'ЗАПИСАТЬ';
            }

            // Переключаем шапку HUD в игровой режим
            toggleHUDMode(true);
            updateAchievementTracker();
            updateQuestTracker();

            // 5. Выезжает лидерборд игры (справа налево)
            const gameLeaderboard = document.getElementById('game-leaderboard-widget');
            if (gameLeaderboard) {
                gameLeaderboard.classList.add('show');
            }

            logSystemMessage('Оператор подключен. Синхронизация успешна.');
        }, 400);
    }, 300);
}

// Завершение игры
export function gameOver() {
    if (state.gameState === 'GAMEOVER') return;
    state.gameState = 'GAMEOVER';

    // 1. Прячем лидерборд игры (уезжает вправо за экран)
    const gameLeaderboard = document.getElementById('game-leaderboard-widget');
    if (gameLeaderboard) {
        gameLeaderboard.classList.remove('show');
    }
    
    // 2. Прячем игровой интерфейс и переключаем шапку HUD в режим меню
    toggleHUDMode(false);
    const achTracker = document.getElementById('achievement-tracker');
    if (achTracker) achTracker.classList.remove('show');
    const qTracker = document.getElementById('quest-tracker');
    if (qTracker) qTracker.classList.remove('show');

    // 3. Ждем окончания анимации (300мс)
    setTimeout(() => {
        sounds.playGameOver();
        
        // Статистика
        document.getElementById('menu-stats').style.display = 'block';
        document.getElementById('final-score').textContent = state.score;
        document.getElementById('final-speed').textContent = state.level;

        const ccRow = document.getElementById('final-cc-row');
        const ccVal = document.getElementById('final-cc-earned');
        if (ccRow && ccVal) {
            ccRow.style.display = (!state.isReplayPlayback && state.score > 0) ? 'flex' : 'none';
            ccVal.textContent = '...';
        }

        // Показываем меню (начинает фейд-ин)
        document.getElementById('menu-screen').classList.add('active');

        if (state.isReplayPlayback) {
            document.getElementById('score-submit-container').style.display = 'none';
            document.getElementById('menu-title').textContent = 'REPLAY SPECTATE';
            const name = (state.replayData && state.replayData.name) ? state.replayData.name : 'ANON';
            document.getElementById('menu-subtitle').textContent = `ЗАПИСЬ ОПЕРАТОРА: ${name} // СЧЁТ: ${state.score}`;
            document.getElementById('start-btn-content').textContent = 'СМОТРЕТЬ РЕПЛЕЙ';
        } else {
            document.getElementById('score-submit-container').style.display = 'block';
            document.getElementById('menu-title').textContent = 'GAME OVER';
            document.getElementById('menu-subtitle').textContent = `СЕССИЯ ЗАВЕРШЕНА // ОЧКИ: ${state.score}`;
            document.getElementById('start-btn-content').textContent = 'НАЧАТЬ ЗАНОВО';
        }

        if (!state.isReplayPlayback && state.sessionId && state.score > 0) {
            submitScore();
        }

        // Кнопка реплея
        let shareBtn = document.getElementById('share-replay-btn');
        if (!shareBtn) {
            shareBtn = document.createElement('button');
            shareBtn.id = 'share-replay-btn';
            shareBtn.className = 'shop-item-btn';
            shareBtn.style.marginTop = '10px';
            shareBtn.style.width = '100%';
            document.getElementById('menu-stats').appendChild(shareBtn);
        }
        
        if (state.replayInputs.length > 0 && !state.isReplayPlayback) {
            shareBtn.style.display = 'block';
            shareBtn.textContent = 'ПОДЕЛИТЬСЯ РЕПЛЕЕМ';
            
            shareBtn.onclick = async () => {
                shareBtn.disabled = true;
                shareBtn.textContent = 'СЖАТИЕ И ОТПРАВКА...';
                try {
                    const compressedInputs = await encodeReplay(state.replayInputs);
                    const replayObj = {
                        seed: state.replaySeed,
                        inputs: compressedInputs,
                        score: state.score,
                        name: localStorage.getItem('cybercatch_player_name') || 'OPERATOR',
                        selectedSkin: localStorage.getItem('cybercatch_selected_skin') || 'none',
                        selectedTrail: localStorage.getItem('cybercatch_selected_trail') || 'none'
                    };
                    
                    const res = await fetch(`${API_BASE}api/replay/save`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(replayObj)
                    });
                    const data = await res.json();
                    if (data.success) {
                        const replayUrl = `${window.location.origin}${window.location.pathname}?replay=${data.id}`;
                        navigator.clipboard.writeText(replayUrl).then(() => {
                            logSystemMessage('Ссылка на реплей скопирована!');
                            showToast('Ссылка на реплей скопирована в буфер обмена!', 'success');
                        }).catch(err => {
                            console.error('Ошибка копирования:', err);
                            showModal('РЕПЛЕЙ СОХРАНЕН', 'Реплей сохранен! Скопируйте ссылку вручную (кликните на поле):', {
                                inputVal: replayUrl,
                                type: 'warning'
                            });
                        });
                    } else {
                        showToast('Не удалось сохранить реплей на сервере.', 'error');
                    }
                } catch (err) {
                    console.error('Ошибка сохранения реплея:', err);
                    showToast('Не удалось сохранить реплей.', 'error');
                } finally {
                    shareBtn.disabled = false;
                    shareBtn.textContent = 'ПОДЕЛИТЬСЯ РЕПЛЕЕМ';
                }
            };
        } else {
            shareBtn.style.display = 'none';
        }
        
        updateSideLeaderboardVisibility();

        // Предложение войти в аккаунт после игры
        if (!state.terraSiteUser && !state.isReplayPlayback) {
            setTimeout(() => {
                const modal = document.getElementById('terrasite-prompt-modal');
                if (modal) modal.classList.add('active');
            }, 1200);
        }
    }, 300);
}

// Сброс состояния игры в ноль
export function resetGame() {
    state.score = 0;
    state.lives = 3;
    state.level = 1;
    state.upgradePoints = 0;
    state.scoreInCurrentLevel = 0;
    state.scoreNeededForNextLevel = 15;
    state.slowMotionTimer = 0;
    state.freezeTimer = 0;
    state.doublePointsTimer = 0;
    
    state.upgrades.speed.lvl = 1;
    state.upgrades.hitbox.lvl = 1;
    state.upgrades.slow.lvl = 1;
    state.upgrades.shield.lvl = 1;
    
    state.wolf.height = 170;
    state.wolf.y = 460 - state.wolf.height; // 290
    state.wolf.width = 206.74479166666666; // Фиксированная физическая ширина для 100% соответствия симуляции сервера и загруженному ассету
    state.keysPressed = {};
    
    state.wolf.speed = state.upgrades.speed.base;
    state.wolf.x = 385;
    state.wolf.direction = 'RIGHT';
    
    state.eggs = [];
    state.particles = [];
    state.catchFlashes = [];
    state.coreLeaks = [];
    state.activeEvent = null;
    state.eventTimer = 0;
    state.eventIntervalTimer = 0;
    state.upcomingEvent = null;
    state.eventWarningTimer = 0;
    state.lasers = [];
    state.screenShakeActive = false;
    state.controlInverted = false;
    state.gravityFlipped = false;
    state.streakCounter = 0;
    state.goldenStreakCounter = 0;
    
    state.playTime = 0;
    state.accumulator = 0;
    state.spawnTimer = 0;
    state.baseSpawnInterval = 1800;
    state.speedMultiplier = 1.0;
    
    state.replayIndex = 0;
    state.nextEggSpawnSeq = 0;
    state.newClickTargetX = null;
    state.physicsTick = 0;
    if (!state.isReplayPlayback) {
        state.replaySeed = state.isDailyRun ? state.dailySeed : Math.floor(Math.random() * 100000);
        state.replayInputs = [];
        seedRandom(state.replaySeed);
    } else {
        seedRandom(state.replaySeed);
    }
    
    updateLivesHUD();
    updateScoreHUD();
    updateStreakHUD();
    updateLevelHUD();
}

export function updateLivesHUD() {
    const container = document.getElementById('lives-container');
    if (!container) return;
    
    const shieldLvl = state.upgrades.shield.lvl;
    const maxLives = state.upgrades.shield.base + (shieldLvl - 1) * state.upgrades.shield.step;
    
    container.innerHTML = '';
    for (let i = 0; i < maxLives; i++) {
        const node = document.createElement('div');
        node.className = 'life-node';
        if (i < state.lives) {
            node.classList.add('active');
        }
        container.appendChild(node);
    }
}

export function updateScoreHUD() {
    const valEl = document.getElementById('score');
    if (valEl) valEl.textContent = state.score.toString().padStart(4, '0');
    updateLevelHUD();
    if (window.renderLeaderboard) {
        window.renderLeaderboard();
    }
}

export function updateStreakHUD() {
    const valEl = document.getElementById('hud-current-streak');
    if (valEl) valEl.textContent = state.streakCounter.toString();
}

export function updateLevelHUD() {
    const valEl = document.getElementById('hud-level-val');
    if (valEl) valEl.textContent = state.level.toString();
    
    const nextUpgEl = document.getElementById('hud-next-upgrade-val');
    if (nextUpgEl) {
        if (state.isDailyRun) {
            nextUpgEl.textContent = 'N/A';
        } else {
            const needed = Math.max(0, state.scoreNeededForNextLevel - state.scoreInCurrentLevel);
            nextUpgEl.textContent = needed.toString();
        }
    }
}

// Вызов завершения уровня
export function completeLevel() {
    logSystemMessage(`УРОВЕНЬ ${state.level} УСПЕШНО ПРОЙДЕН!`);
    state.level++;
    state.upgradePoints++;

    state.eggs = [];
    state.particles = [];
    state.catchFlashes = [];

    if (!state.isReplayPlayback) {
        openShop();
    } else {
        // Во время реплея мы не заходим в магазин — просто сбрасываем очки текущего уровня
        state.scoreInCurrentLevel = 0;
        state.scoreNeededForNextLevel = state.level * 10 + 5;
        updateLevelHUD();
    }
}

export function openShop() {
    state.gameState = 'SHOP';
    document.getElementById('shop-screen').classList.add('active');
    updateSideLeaderboardVisibility();
    updateShopUI();
}

export function updateShopUI() {
    const ptsEl = document.getElementById('upgrade-points-val');
    if (ptsEl) ptsEl.textContent = state.upgradePoints;
    
    const categories = ['speed', 'hitbox', 'slow', 'shield'];
    categories.forEach(cat => {
        const upg = state.upgrades[cat];
        const btn = document.getElementById(`upg-${cat}-btn`);
        const lvlInd = document.getElementById(`upg-${cat}-lvl`);
        
        let bar = '[';
        for (let i = 1; i <= upg.max; i++) {
            bar += (i <= upg.lvl) ? '█' : '░';
        }
        bar += `] ${upg.lvl}/${upg.max}`;
        lvlInd.textContent = bar;
        
        if (upg.lvl >= upg.max) {
            btn.disabled = true;
            btn.textContent = 'МАКС.';
        } else if (state.upgradePoints <= 0) {
            btn.disabled = true;
            btn.textContent = 'УЛУЧШИТЬ';
        } else {
            btn.disabled = false;
            btn.textContent = 'УЛУЧШИТЬ';
        }
    });
}

// Покупка апгрейда
export function buyUpgrade(category) {
    if (state.upgradePoints <= 0) return;
    const upg = state.upgrades[category];
    if (upg.lvl >= upg.max) return;
    
    if (!state.isReplayPlayback) {
        state.replayInputs.push({
            tick: state.physicsTick,
            time: state.playTime * 1000,
            type: 'upgrade',
            category: category
        });
    }
    
    upg.lvl++;
    state.upgradePoints--;
    
    sounds.playCatch();
    
    if (category === 'speed') {
        state.wolf.speed = upg.base + (upg.lvl - 1) * upg.step;
        logSystemMessage(`ДВИГАТЕЛЬ: Скорость волка увеличена до ${state.wolf.speed} px/s.`);
    } else if (category === 'hitbox') {
        logSystemMessage(`ПРИЕМНИК: Хитбокс поимки расширен.`);
    } else if (category === 'slow') {
        logSystemMessage(`ЯКОРЬ: Длительность временной аномалии увеличена.`);
    } else if (category === 'shield') {
        const newMax = upg.base + (upg.lvl - 1) * upg.step;
        state.lives++;
        if (state.lives > newMax) state.lives = newMax;
        logSystemMessage(`МАТРИЦА: Максимальные щиты увеличены до ${newMax}. Восстановлена 1 жизнь.`);
        updateLivesHUD();
    }
    
    updateShopUI();
}

// Запуск следующего уровня из магазина.
// Переход на новый уровень больше не пишется в реплей как отдельное событие —
// реплей сам детектирует пересечение порога очков и вызывает
// completeLevelInReplay() ровно там же, где это произошло бы у него самого
// физически (см. комментарий у completeLevelInReplay).
export function startNextLevel() {
    state.gameState = 'PLAYING';
    document.getElementById('shop-screen').classList.remove('active');
    updateSideLeaderboardVisibility();

    state.scoreInCurrentLevel = 0;
    state.scoreNeededForNextLevel = state.level * 10 + 5;
    state.eggs = [];
    
    logSystemMessage(`УРОВЕНЬ ${state.level}: Поток данных активирован.`);
    updateLevelHUD();
}

// Применение улучшений во время проигрывания реплея
export function applyUpgradeInReplay(category) {
    const upg = state.upgrades[category];
    upg.lvl++;
    state.upgradePoints--;
    
    if (category === 'speed') {
        state.wolf.speed = upg.base + (upg.lvl - 1) * upg.step;
    } else if (category === 'hitbox') {
        // Ничего визуального
    } else if (category === 'slow') {
        // Замедление
    } else if (category === 'shield') {
        const newMax = upg.base + (upg.lvl - 1) * upg.step;
        state.lives++; 
        if (state.lives > newMax) state.lives = newMax;
        updateLivesHUD();
    }
}



// --- СПАВН ОБЪЕКТОВ ---

export function spawnEgg() {
    const startY = state.gravityFlipped ? 440 : 40;
    // Отступ от краёв экрана, гарантирующий, что корзина волка физически
    // успевает дотянуться до ядра независимо от текущего направления волка.
    let x = 180 + gameRandom() * 600;

    if (state.activeEvent === 'laser') {
        for (let r = 0; r < 20; r++) {
            let safe = true;
            for (const laser of state.lasers) {
                if (Math.abs(x - laser.x) < 70) {
                    safe = false;
                    break;
                }
            }
            if (safe) break;
            x = 180 + ((x - 180 + 150) % 600);
        }
    }
    
    const randVirus = gameRandom();
    const randType = gameRandom();
    const randChoice = gameRandom();
    
    let type = 'standard';
    if (state.activeEvent === 'virus' && randVirus < 0.35) {
        type = 'virus';
    } else {
        if (randType < 0.66) {
            type = 'standard';
        } else if (randType < 0.74) {
            type = 'slow';
        } else if (randType < 0.82) {
            type = 'overclock';
        } else if (randType < 0.87) {
            type = 'freeze';
        } else if (randType < 0.92) {
            type = 'double';
        } else {
            const maxLives = state.upgrades.shield.base + (state.upgrades.shield.lvl - 1) * state.upgrades.shield.step;
            if (state.lives < maxLives) {
                type = 'repair';
            } else {
                type = randChoice > 0.5 ? 'standard' : 'double';
            }
        }
    }
    
    const wobbleVal = gameRandom();
    
    state.eggs.push({
        x: x,
        y: startY,
        angle: 0.0,
        wobbleTime: wobbleVal * 10,
        type: type,
        state: 'falling',
        isStormEgg: (state.activeEvent === 'storm'),
        // Направление падения фиксируется в момент спавна, чтобы уже летящие
        // ядра не "телепортировались" вверх/вниз при смене гравитации в полёте.
        gravityFlipped: state.gravityFlipped,
        // Порядковый номер спавна — привязывает записанное в реплей событие
        // "гарантированной поимки/пропуска" (см. resolveCatchInReplay/
        // resolveMissInReplay) к конкретному яйцу независимо от того, как
        // именно физика симуляции реплея расположит его на экране.
        spawnSeq: state.nextEggSpawnSeq++
    });
    
    sounds.playStep();
}

export function spawnExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 3,
            color: color,
            alpha: 1.0,
            decay: 0.03 + Math.random() * 0.04
        });
    }
}

export function spawnCatchFlash(x, y, color) {
    state.catchFlashes.push({
        x: x,
        y: y,
        radius: 5,
        alpha: 1.0,
        decay: 0.05,
        color: color
    });
}

// Всплывающий текст "+N" очков, поднимающийся вверх и угасающий
export function spawnScoreText(x, y, pts, color) {
    state.particles.push({
        x: x,
        y: y - 10,
        vx: 0,
        vy: -1.1,
        size: 24,
        text: `+${pts}`,
        isScoreText: true,
        color: color,
        alpha: 1.0,
        decay: 0.016
    });
}

// Небольшой всплеск пыли в точке приземления непойманного ядра
export function spawnImpactEffect(x, y) {
    for (let i = 0; i < 8; i++) {
        const angle = Math.PI + Math.random() * Math.PI; // веер вверх/в стороны от земли
        const speed = 0.5 + Math.random() * 1.8;
        state.particles.push({
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed * 0.6,
            size: 1.5 + Math.random() * 2,
            color: 'rgba(180, 180, 190, 0.8)',
            alpha: 0.8,
            decay: 0.045 + Math.random() * 0.03
        });
    }
}

export function spawnCoreLeak(x, y, color) {
    state.coreLeaks.push({
        x: x,
        y: y - 10,
        text: 'CORE_LEAK',
        color: color,
        alpha: 1.0,
        decay: 0.02,
        vy: -0.8
    });
}

// --- СОБЫТИЯ (EVENT MANAGER) ---

export function queueEvent() {
    const list = ['storm', 'blackout', 'virus', 'shift', 'laser', 'gravity'];
    const idx = Math.floor(gameRandom() * list.length);
    state.upcomingEvent = list[idx];
    state.eventWarningTimer = 6.0; // 6 секунд предупреждения!
}

export function triggerEvent(type) {
    state.activeEvent = type;
    state.upcomingEvent = null;
    
    let duration = 12.0;
    if (type === 'storm') {
        duration = 10.0;
        logSystemMessage('ВНИМАНИЕ: Информационный шторм! Ускоренное выпадение ядер. Очки удвоены!');
    } else if (type === 'blackout') {
        duration = 14.0;
        logSystemMessage('ВНИМАНИЕ: Авария энергосистемы! Видимость ограничена.');
    } else if (type === 'virus') {
        duration = 14.0;
        logSystemMessage('БЕЗОПАСНОСТЬ: Обнаружена вирусная атака! Избегайте зеленых вирусов.');
    } else if (type === 'shift') {
        state.controlInverted = true;
        duration = 12.0;
        logSystemMessage('ОШИБКА КВАНТОВОГО СДВИГА: Управление инвертировано!');
    } else if (type === 'laser') {
        duration = 15.0;
        state.lasers = [];
        state.lastLaserTime = 0;
        logSystemMessage('УГРОЗА: Атака лазеров! Не пересекайте красные маркеры прицелов.');
    } else if (type === 'gravity') {
        state.gravityFlipped = true;
        // Волк перемещается на "потолок" — ядра теперь спавнятся снизу и
        // летят вверх к нему, зеркально обычной раскладке (низ -> верх).
        state.wolf.y = 40;
        state.eggs = []; // clear all eggs on map when gravity anomaly starts
        duration = 14.0;
        logSystemMessage('ГРАВИТАЦИОННАЯ АНОМАЛИЯ: Волк на потолке! Ядра летят снизу вверх.');
    }
    
    state.eventTimer = duration;
}

// --- ФИЗИЧЕСКИЙ ЦИКЛ ОБНОВЛЕНИЯ (Fixed Timestep) ---

export function updatePhysicsStep(dt) {
    if (state.physicsTick === undefined) state.physicsTick = 0;
    state.physicsTick++;

    const startWolfX = state.wolf.x;
    state.playTime += dt / 1000;
    
    // Воспроизведение реплея
    if (state.isReplayPlayback) {
        const elapsed = state.playTime * 1000;
        while (state.replayIndex < state.replayInputs.length) {
            const input = state.replayInputs[state.replayIndex];
            const isMatch = (input.tick !== undefined) ? (input.tick <= state.physicsTick) : (input.time <= elapsed);
            if (!isMatch) break;
            
            if (input.type === 'upgrade') {
                applyUpgradeInReplay(input.category);
            } else if (input.type === 'input') {
                state.keysPressed['KeyA'] = input.left;
                state.keysPressed['ArrowLeft'] = input.left;
                state.keysPressed['KeyD'] = input.right;
                state.keysPressed['ArrowRight'] = input.right;
                // Всегда перезаписываем targetX, чтобы сбросить движение к координате при null
                state.targetX = input.targetX;
            } else if (input.x !== undefined) {
                // Легаси-поддержка старых реплеев
                state.wolf.x = input.x;
                state.wolf.direction = input.dir;
            }
            state.replayIndex++;
        }
        if (state.replayIndex >= state.replayInputs.length && state.eggs.length === 0) {
            gameOver();
            return;
        }
    }
    
    // Таймеры эффектов
    if (state.slowMotionTimer > 0) {
        state.slowMotionTimer -= dt / 1000;
        if (state.slowMotionTimer < 0) state.slowMotionTimer = 0;
    }
    if (state.freezeTimer > 0) {
        state.freezeTimer -= dt / 1000;
        if (state.freezeTimer < 0) state.freezeTimer = 0;
    }
    if (state.doublePointsTimer > 0) {
        state.doublePointsTimer -= dt / 1000;
        if (state.doublePointsTimer < 0) state.doublePointsTimer = 0;
    }
    
    // Обработка предупреждений событий
    if (state.upcomingEvent !== null) {
        state.eventWarningTimer -= dt / 1000;
        if (state.eventWarningTimer <= 0) {
            triggerEvent(state.upcomingEvent);
        }
    }
    
    // Обработка активного события
    if (state.activeEvent !== null) {
        state.eventTimer -= dt / 1000;
        
        if (state.activeEvent === 'laser') {
            state.lastLaserTime += dt;
            if (state.lastLaserTime >= 2000) {
                state.lastLaserTime = 0;
                const targetX = 80 + gameRandom() * 800;
                state.lasers.push({
                    x: targetX,
                    timer: 1.5,
                    active: false,
                    duration: 0.8
                });
                logSystemMessage('МАРКЕР: Обнаружено лазерное наведение!');
            }
            
            state.lasers.forEach((laser, idx) => {
                if (!laser.active) {
                    laser.timer -= dt / 1000;
                    if (laser.timer <= 0) {
                        laser.active = true;
                        sounds.playMiss();
                        state.screenShakeActive = true;
                        
                        // Проверка коллизии лазера с волком
                        const wolfMin = Math.round(state.wolf.x);
                        const wolfMax = Math.round(state.wolf.x) + state.wolf.width;
                        if (laser.x >= wolfMin && laser.x <= wolfMax) {
                            state.lives--;
                            updateLivesHUD();
                            logSystemMessage(`ПОВРЕЖДЕНИЕ: Волк попал под лазерный луч! Защита: ${state.lives}`);
                            if (state.lives <= 0) {
                                gameOver();
                            }
                        }
                    }
                } else {
                    laser.duration -= dt / 1000;
                }
            });
            state.lasers = state.lasers.filter(l => l.duration > 0);
        }
        
        if (state.eventTimer <= 0) {
            // Завершение события
            if (state.activeEvent === 'shift') {
                state.controlInverted = false;
            } else if (state.activeEvent === 'gravity') {
                state.gravityFlipped = false;
                state.wolf.y = 460 - state.wolf.height;
                state.eggs = []; // Очищаем оставшиеся яйца после инвертированной гравитации
            } else if (state.activeEvent === 'storm') {
                if (!state.isReplayPlayback) {
                    checkAchievement('storm_rider', state.livesLostInCurrentStorm === 0 ? 1 : 0);
                }
                state.livesLostInCurrentStorm = 0;
            }
            
            state.activeEvent = null;
            state.lasers = [];
            logSystemMessage('СТАТУС: Локальные аномалии устранены.');
        }
    } else {
        // Проверка запуска нового события
        state.eventIntervalTimer += dt;
        if (state.eventIntervalTimer >= 22000) {
            state.eventIntervalTimer = 0;
            if (gameRandom() < 0.85) {
                queueEvent();
            }
        }
    }
    
    // Спавн ядер
    if (state.freezeTimer <= 0) {
        state.spawnTimer += dt;
        
        let currentInterval = state.baseSpawnInterval - (state.level - 1) * 110;
        currentInterval = Math.max(550, currentInterval);
        
        if (state.activeEvent === 'storm') {
            currentInterval = 280; // Очень быстрый спавн при шторме!
        }
        if (state.slowMotionTimer > 0) {
            currentInterval *= 2.0;
        }
        
        if (state.spawnTimer >= currentInterval) {
            state.spawnTimer = 0;
            spawnEgg();
        }
    }
    
    // Движение волка
    let dx = 0;
    let leftPressed = state.keysPressed['KeyA'] || state.keysPressed['ArrowLeft'];
    let rightPressed = state.keysPressed['KeyD'] || state.keysPressed['ArrowRight'];
    
    if (state.controlInverted) {
        const temp = leftPressed;
        leftPressed = rightPressed;
        rightPressed = temp;
    }
    
    if (leftPressed) {
        dx = -1;
        state.wolf.direction = state.controlInverted ? 'RIGHT' : 'LEFT';
        state.targetX = null;
    } else if (rightPressed) {
        dx = 1;
        state.wolf.direction = state.controlInverted ? 'LEFT' : 'RIGHT';
        state.targetX = null;
    }
    
    if (dx !== 0) {
        state.wolf.x += dx * state.wolf.speed * (dt / 1000);
        const maxWolfX = canvas.width - state.wolf.width - 10;
        state.wolf.x = Math.max(10, Math.min(maxWolfX, state.wolf.x));
    }
    
    if (state.targetX !== null) {
        const diff = state.targetX - state.wolf.x;
        if (Math.abs(diff) > 8) {
            const moveStep = Math.sign(diff) * state.wolf.speed * (dt / 1000);
            if (Math.abs(moveStep) >= Math.abs(diff)) {
                state.wolf.x = state.targetX;
                state.targetX = null;
            } else {
                state.wolf.x += moveStep;
            }
            state.wolf.direction = diff > 0 ? 'RIGHT' : 'LEFT';
            const maxWolfX = canvas.width - state.wolf.width - 10;
            state.wolf.x = Math.max(10, Math.min(maxWolfX, state.wolf.x));
        } else {
            state.targetX = null;
        }
    }
    
    // Единый спавн следа при активном перемещении
    const moved = Math.abs(state.wolf.x - startWolfX) > 0.05;
    if (moved) {
        if (state.selectedTrail === 'binary' && Math.random() < 0.15) {
            const bskX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
            const bskY = state.wolf.y + state.wolf.height * 0.435;
            state.particles.push({
                x: bskX + (Math.random() - 0.5) * 15,
                y: bskY + (Math.random() - 0.5) * 15,
                vx: (Math.random() - 0.5) * 0.5,
                vy: state.gravityFlipped ? 0.8 : -0.8,
                size: 9 + Math.random() * 3,
                text: Math.random() > 0.5 ? '1' : '0',
                color: '#39ff14',
                alpha: 0.85,
                decay: 0.028
            });
        } else if (state.selectedTrail === 'sparks' && Math.random() < 0.28) {
            const bskX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
            const bskY = state.wolf.y + state.wolf.height * 0.435;
            state.particles.push({
                x: bskX + (Math.random() - 0.5) * 12,
                y: bskY + (Math.random() - 0.5) * 12,
                vx: (Math.random() - 0.5) * 2.5,
                vy: state.gravityFlipped ? (1 + Math.random() * 2) : -(1 + Math.random() * 2),
                size: 2 + Math.random() * 3,
                color: '#ff007f',
                alpha: 1.0,
                decay: 0.045
            });
        } else if (state.selectedTrail === 'sandevistan') {
            state.sandevistanSpawnTimer += dt;
            if (state.sandevistanSpawnTimer >= 100) {
                state.sandevistanSpawnTimer = 0;
                state.particles.push({
                    x: Math.round(state.wolf.x),
                    y: state.wolf.y,
                    width: state.wolf.width,
                    height: state.wolf.height,
                    direction: state.wolf.direction,
                    isGhostClone: true,
                    alpha: 0.55,
                    decay: 0.045
                });
            }
        } else if (state.selectedTrail === 'rain' && Math.random() < 0.25) {
            const bskX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
            const bskY = state.wolf.y + state.wolf.height * 0.435;
            state.particles.push({
                x: bskX + (Math.random() - 0.5) * 25,
                y: bskY + (Math.random() - 0.5) * 15,
                vx: 0,
                vy: state.gravityFlipped ? 3 : -3,
                size: 1 + Math.random() * 1.5,
                isRainDrop: true,
                color: '#00f0ff',
                alpha: 0.8,
                decay: 0.038
            });
        } else if (state.selectedTrail === 'rainbow' && Math.random() < 0.35) {
            const bskX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
            const bskY = state.wolf.y + state.wolf.height * 0.435;
            const hue = (Date.now() / 4) % 360;
            state.particles.push({
                x: bskX + (Math.random() - 0.5) * 15,
                y: bskY + (Math.random() - 0.5) * 15,
                vx: (Math.random() - 0.5) * 1.2,
                vy: state.gravityFlipped ? 1.5 : -1.5,
                size: 3 + Math.random() * 2,
                color: `hsla(${hue}, 100%, 65%, 0.9)`,
                alpha: 1.0,
                decay: 0.04
            });
        }
    }
    
    // Обновление физики ядер
    const basketX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
    const basketY = state.wolf.y + state.wolf.height * 0.435 + 16;
    const basketRadius = 16 + state.upgrades.hitbox.lvl * 2;

    for (let i = state.eggs.length - 1; i >= 0; i--) {
        const egg = state.eggs[i];
        // Направление падения/пол берутся из состояния ядра на момент спавна,
        // а не из текущего глобального флага — иначе гравитационная аномалия
        // разворачивает уже летящие ядра "телепортом" и делает их неуловимыми.
        const eggFloorY = egg.gravityFlipped ? 40 : 460;

        if (egg.state === 'falling' || egg.state === 'missed') {
            let eggSpeed = 160 + (state.level - 1) * 15;
            eggSpeed = Math.min(420, eggSpeed);

            if (egg.type === 'overclock') {
                eggSpeed *= 1.45;
            } else if (egg.type === 'virus') {
                eggSpeed *= 1.2;
            }

            if (state.slowMotionTimer > 0) {
                eggSpeed *= 0.5;
            }

            // Движение (ядра полностью замирают на время критической заморозки)
            if (state.freezeTimer <= 0) {
                egg.y += (egg.gravityFlipped ? -1 : 1) * eggSpeed * (dt / 1000);
                egg.wobbleTime += dt / 1000;
                // Лёгкое покачивание вместо непрерывного вращения
                egg.angle = Math.sin(egg.wobbleTime * 3) * 0.25;
            }
            
            // Естественная геометрическая проверка поимки/пропуска ниже
            // определяет очки и жизни только в LIVE-игре. Во время реплея
            // счёт и жизни управляются ИСКЛЮЧИТЕЛЬНО записанными событиями
            // 'catch'/'miss' (см. resolveCatchInReplay/resolveMissInReplay,
            // вызываемые в фазе обработки входных данных этого же тика) —
            // они привязаны к конкретному яйцу по spawnSeq и потому не
            // зависят от того, на каком именно тике/пикселе сходится физика
            // повторного прогона. Здесь ядро просто продолжает визуально
            // падать, пока не будет разрешено записанным событием.
            if (egg.state === 'falling') {
                // Проверка поимки (горизонтальная прямая линия)
                const verticalHit = Math.abs(egg.y - basketY) < 16;
                const horizontalHit = egg.x >= basketX - (basketRadius + 15) - 6 && egg.x <= basketX + (basketRadius + 15);
                if (verticalHit && horizontalHit) {
                    egg.state = 'caught';
                    sounds.playCatch();

                let pts = 1;
                // Цвет эффекта поимки должен совпадать с цветом самого ядра
                // (стандартные ядра рисуются голубыми/розовыми в зависимости от X).
                let particleColor = egg.x < canvas.width / 2 ? '#00f0ff' : '#ff007f';

                if (egg.type === 'slow') {
                    state.slowMotionTimer = state.upgrades.slow.base + (state.upgrades.slow.lvl - 1) * state.upgrades.slow.step;
                    particleColor = '#ffde00';
                    logSystemMessage(`СИСТЕМНЫЙ СБОЙ: Временная аномалия активирована на ${state.slowMotionTimer.toFixed(1)}с.`);
                } else if (egg.type === 'repair') {
                    const maxLives = state.upgrades.shield.base + (state.upgrades.shield.lvl - 1) * state.upgrades.shield.step;
                    state.lives++;
                    if (state.lives > maxLives) state.lives = maxLives;
                    particleColor = '#39ff14';
                    updateLivesHUD();
                    logSystemMessage('МАТРИЦА: Защитный сектор восстановлен.');
                } else if (egg.type === 'overclock') {
                    pts = 3;
                    particleColor = '#bd00ff';
                    logSystemMessage('ЯДРО-РАЗГОНЩИК: Получено +3 очка!');
                } else if (egg.type === 'freeze') {
                    state.freezeTimer = 1.2;
                    particleColor = '#70d8ff';
                    logSystemMessage('СИСТЕМНЫЙ ЗАМОРАЖИВАТЕЛЬ: Ядра заблокированы на 1.2с.');
                } else if (egg.type === 'double') {
                    state.doublePointsTimer = 8.0;
                    particleColor = '#ff6a00';
                    logSystemMessage('УДВОИТЕЛЬ ДАННЫХ: Очки увеличены вдвое на 8.0с.');
                } else if (egg.type === 'virus') {
                    state.lives--;
                    updateLivesHUD();
                    particleColor = '#39ff14';
                    logSystemMessage(`ВНИМАНИЕ: Сектор заражен вирусом! Защитные поля: ${state.lives}`);
                    if (state.lives <= 0) {
                        gameOver();
                        break;
                    }
                }
                
                if (egg.type !== 'virus') {
                    if (state.doublePointsTimer > 0 || state.activeEvent === 'storm') {
                        pts *= 2;
                    }
                    state.score += pts;
                    state.scoreInCurrentLevel += pts;

                    updateScoreHUD();
                    spawnScoreText(egg.x, egg.y, pts, particleColor);

                    // Общее накопление ачивки Data Grinder
                    let totalCollected = parseInt(localStorage.getItem('cybercatch_total_cores') || '0', 10);
                    if (!state.isReplayPlayback) {
                        totalCollected += pts;
                        localStorage.setItem('cybercatch_total_cores', totalCollected.toString());
                        checkAchievement('data_grinder', totalCollected);
                        
                        // Обновление прогресса контракта дня
                        if (state.dailyQuest.type === 'any') {
                            updateQuestProgress(1);
                        } else if (state.dailyQuest.type === 'score') {
                            updateQuestProgress(pts);
                        }
                    }
                    
                    if (egg.type === 'standard') {
                        state.streakCounter++;
                        updateStreakHUD();
                        if (!state.isReplayPlayback) {
                            checkAchievement('never_miss', state.streakCounter);
                            if (state.dailyQuest.type === 'standard') {
                                updateQuestProgress(1);
                            }
                        }
                    }

                    if (egg.type === 'double') {
                        state.goldenStreakCounter++;
                        if (!state.isReplayPlayback) {
                            checkAchievement('lucky_bastard', state.goldenStreakCounter);
                        }
                    } else {
                        state.goldenStreakCounter = 0;
                    }
                    
                    // Проверка рекордов Cyber God ачивки
                    if (!state.isReplayPlayback) {
                        checkAchievement('cyber_god', state.score);
                    }
                    
                    // Переход на следующий уровень
                    if (state.scoreInCurrentLevel >= state.scoreNeededForNextLevel && !state.isDailyRun) {
                        completeLevel();
                        break;
                    }
                }
                
                spawnExplosion(egg.x, egg.y, particleColor);
                spawnCatchFlash(egg.x, egg.y, particleColor);
            }
            
            // Проверка пропуска
            const isMissed = egg.gravityFlipped ? (egg.y < basketY - 20) : (egg.y > basketY + 20);
            if (isMissed) {
                if (egg.type !== 'virus') {
                    if (!egg.isStormEgg) {
                        state.lives--;
                        state.livesLostInCurrentStorm++;

                        updateLivesHUD();
                        state.streakCounter = 0; // Сброс ачивки
                        updateStreakHUD();

                        const maxLives = state.upgrades.shield.base + (state.upgrades.shield.lvl - 1) * state.upgrades.shield.step;
                        logSystemMessage(`ПРЕДУПРЕЖДЕНИЕ: Утечка! Защитные поля: ${state.lives}/${maxLives}`);

                        if (state.lives <= 0) {
                            gameOver();
                            break;
                        }
                    }
                }
                egg.state = 'missed';
            }
            }
        }

        // Достижение пола/потолка
        const reachedBoundary = egg.gravityFlipped ? (egg.y <= eggFloorY) : (egg.y >= eggFloorY);
        if (reachedBoundary || egg.state === 'caught') {
            if (reachedBoundary && egg.state === 'missed') {
                // Звук/текст "утечки" и облако пыли показываем ОДНОВРЕМЕННО и
                // ровно там, где ядро физически касается земли — раньше текст
                // "CORE_LEAK" появлялся в момент, когда ядро лишь миновало
                // волка (выше по экрану, ещё в полёте), а пылевой эффект уже
                // тогда стоял на истинной поверхности земли: со стороны
                // выглядело так, будто ядро "разбивается" намного раньше,
                // чем реально долетает до земли. Сама потеря жизни при этом
                // по-прежнему считается сразу, как только поимка стала
                // невозможна (см. isMissed выше) — меняется только момент
                // показа обратной связи, а не игровая логика/детерминизм.
                if (!egg.isStormEgg && egg.type !== 'virus') {
                    sounds.playMiss();
                    let fColor = egg.x < canvas.width / 2 ? '#00f0ff' : '#ff007f';
                    if (egg.type === 'slow') fColor = '#ffde00';
                    else if (egg.type === 'repair') fColor = '#39ff14';
                    else if (egg.type === 'overclock') fColor = '#bd00ff';
                    else if (egg.type === 'freeze') fColor = '#70d8ff';
                    else if (egg.type === 'double') fColor = '#ff6a00';
                    spawnCoreLeak(egg.x, eggFloorY, fColor);
                }
                spawnImpactEffect(egg.x, eggFloorY);
            }
            state.eggs.splice(i, 1);
        }
    }
    
    // Обновление частиц
    for (let i = state.particles.length - 1; i >= 0; i--) {
        const p = state.particles[i];
        p.alpha -= p.decay;
        if (p.isGhostClone) {
            // Голографический клон затухает на месте
        } else {
            p.x += p.vx;
            p.y += p.vy;
        }
        if (p.alpha <= 0) {
            state.particles.splice(i, 1);
        }
    }
    
    // Обновление утечек ядер
    for (let i = state.coreLeaks.length - 1; i >= 0; i--) {
        const cl = state.coreLeaks[i];
        cl.alpha -= cl.decay;
        cl.y += cl.vy;
        if (cl.alpha <= 0) {
            state.coreLeaks.splice(i, 1);
        }
    }
    
    // Обновление вспышек поимки
    for (let i = state.catchFlashes.length - 1; i >= 0; i--) {
        const cf = state.catchFlashes[i];
        cf.alpha -= cf.decay;
        cf.radius += 1.5;
        if (cf.alpha <= 0) {
            state.catchFlashes.splice(i, 1);
        }
    }

    // Запись реплея (сохраняем ввод игрока только при изменении состояния)
    if (!state.isReplayPlayback) {
        const left = !!(state.keysPressed['KeyA'] || state.keysPressed['ArrowLeft']);
        const right = !!(state.keysPressed['KeyD'] || state.keysPressed['ArrowRight']);
        const clickTargetX = state.newClickTargetX;
        state.newClickTargetX = null; // потребляем событие клика
        
        // Сверяем с последним записанным вводом
        const lastInput = state.replayInputs.length > 0 ? state.replayInputs[state.replayInputs.length - 1] : null;
        const keysChanged = !lastInput || lastInput.left !== left || lastInput.right !== right;
        const clicked = clickTargetX !== null && clickTargetX !== undefined;
        
        if (keysChanged || clicked) {
            state.replayInputs.push({
                tick: state.physicsTick,
                time: state.playTime * 1000,
                type: 'input',
                left: left,
                right: right,
                targetX: clickTargetX
            });
        }
    }
}

// Главный игровой цикл (Fixed Timestep)
let lastTime = 0;
export function update(time) {
    if (!lastTime) lastTime = time;
    let dt = time - lastTime;
    lastTime = time;
    
    if (dt > 100) dt = 100; // Cap
    
    if (state.gameState === 'PLAYING') {
        // Скорость воспроизведения реплея масштабирует, сколько игровых
        // тиков "проживается" за реальный кадр — сама физика (fixedDt)
        // остаётся неизменной и детерминированной.
        const speedMult = (state.isReplayPlayback && state.replaySpeed) ? state.replaySpeed : 1;
        state.accumulator += dt * speedMult;
        const fixedDt = 1000 / 60;
        while (state.accumulator >= fixedDt) {
            updatePhysicsStep(fixedDt);
            state.accumulator -= fixedDt;
        }
    }

    render();
    updateAchievementTracker();
    updateQuestTracker();
    updateReplayHUD();
    requestAnimationFrame(update);
}

window.startGame = startGame;
window.startStandardGame = startStandardGame;
window.startDailyGame = startDailyGame;
