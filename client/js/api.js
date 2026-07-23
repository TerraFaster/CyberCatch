import { state } from './state.js';
import { sounds } from './sound.js';
import { logSystemMessage, computeSignature, decodeReplay, encodeReplay, showToast, showModal } from './utils.js';
import { SKINS, TRAILS, achievements, upgrades, dailyQuest } from './config.js';

const getApiBase = () => {
    const path = window.location.pathname;
    if (path.endsWith('.html') || path.split('/').pop().includes('.')) {
        return path.substring(0, path.lastIndexOf('/') + 1);
    }
    return path.endsWith('/') ? path : path + '/';
};
export const API_BASE = getApiBase();

export async function startSession() {
    try {
        const res = await fetch(`${API_BASE}api/game/start`, { method: 'POST' });
        const data = await res.json();
        state.sessionId = data.sessionId;
        state.sessionStartTime = Date.now();
        console.log('Backend session initiated:', state.sessionId);
    } catch (e) {
        console.error('Не удалось запустить защищенную сессию на сервере:', e);
        state.sessionId = null;
    }
}

export async function submitScore() {
    const nameInput = document.getElementById('player-name');
    const name = state.terraSiteUser ? state.terraSiteUser.username : (nameInput.value.trim().toUpperCase().replace(/[^A-ZА-Я0-9_ -]/g, '') || 'ANON');

    if (!state.terraSiteUser && nameInput && nameInput.value.trim()) {
        localStorage.setItem('cybercatch_player_name', nameInput.value.trim());
    }

    if (!state.sessionId) {
        showModal('СИСТЕМНАЯ ОШИБКА', 'Защищенная сессия отсутствует. Запись рекорда невозможна.', { type: 'error' });
        return;
    }

    const submitBtn = document.getElementById('submit-score-btn');
    if (submitBtn.disabled) return; // Отправка уже выполняется (или уже завершена)
    submitBtn.disabled = true;
    submitBtn.textContent = 'ОТПРАВКА...';

    const duration = Date.now() - state.sessionStartTime;
    const signature = await computeSignature(name, state.score, state.sessionId);
    
    let replayId = null;
    try {
        const compressedInputs = await encodeReplay(state.replayInputs);
        const replayRes = await fetch(`${API_BASE}api/replay/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                seed: state.replaySeed,
                inputs: compressedInputs,
                score: state.score,
                name: name,
                selectedSkin: state.selectedSkin,
                selectedTrail: state.selectedTrail
            })
        });
        const replayData = await replayRes.json();
        if (replayData.success) {
            replayId = replayData.id;
            logSystemMessage(`РЕПЛЕЙ ЗАПИСАН: ID ${replayId}`);
        }
    } catch (e) {
        console.error('Ошибка автоматического сохранения реплея:', e);
    }

    try {
        const res = await fetch(`${API_BASE}api/game/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                score: state.score,
                sessionId: state.sessionId,
                signature,
                duration,
                mode: state.isDailyRun ? 'daily' : 'standard',
                deviceId: state.deviceId,
                token: state.terraSiteToken || undefined,
                replayId: replayId
            })
        });
        
        const data = await res.json();
        if (data.error) {
            showModal('ОШИБКА ОТПРАВКИ', data.error, { type: 'error' });
            submitBtn.disabled = false;
            submitBtn.textContent = 'ЗАПИСАТЬ';
            const ccVal = document.getElementById('final-cc-earned');
            if (ccVal) ccVal.textContent = '0';
        } else {
            logSystemMessage(`РЕКОНСТРУКЦИЯ РЕКОРДА: ${name} // ${state.score}`);
            document.getElementById('score-submit-container').style.display = 'none';
            if (window.renderLeaderboard) {
                window.renderLeaderboard(data.leaderboard);
            }
            // Реальные CC, ачивки и прогресс контракта применяются только здесь,
            // на основе результата, проверенного сервером через симуляцию реплея.
            applyServerResults(data);
        }
    } catch (e) {
        console.error('Ошибка отправки рекорда:', e);
        showModal('ОШИБКА СЕТИ', 'Не удалось отправить результат на сервер.', { type: 'error' });
        submitBtn.disabled = false;
        submitBtn.textContent = 'ЗАПИСАТЬ';
        const ccVal = document.getElementById('final-cc-earned');
        if (ccVal) ccVal.textContent = '0';
    }
}

// Применение результата, проверенного сервером после симуляции реплея:
// CC-кредиты, разблокировки ачивок и прогресс контракта дня. Это единственное
// место, где эти значения по-настоящему сохраняются (localStorage выступает
// лишь кэшем последнего подтверждённого сервером состояния).
export function applyServerResults(data) {
    if (typeof data.credits === 'number') {
        state.cyberCredits = data.credits;
    }
    if (typeof data.personalBest === 'number') {
        state.personalBest = data.personalBest;
    }
    if (typeof data.creditsEarned === 'number') {
        const ccVal = document.getElementById('final-cc-earned');
        if (ccVal) ccVal.textContent = `+${data.creditsEarned}`;
    }

    if (data.achievements) {
        Object.keys(state.achievements).forEach(id => {
            if (data.achievements[id]) {
                state.achievements[id].unlocked = state.achievements[id].unlocked || data.achievements[id].unlocked || false;
                state.achievements[id].progress = Math.max(state.achievements[id].progress || 0, data.achievements[id].progress || 0);
            }
        });
    }

    if (typeof data.questProgress === 'number') {
        state.dailyQuest.progress = data.questProgress;
        localStorage.setItem('cybercatch_quest_progress', state.dailyQuest.progress.toString());
    }
    if (data.questCompleted) {
        localStorage.setItem('cybercatch_quest_completed', 'true');
        
        // Помечаем контракт дня как завершенный для стрика
        const todayStr = new Date().toDateString();
        const lastCompleted = localStorage.getItem('cybercatch_last_completed_date');
        if (lastCompleted !== todayStr) {
            localStorage.setItem('cybercatch_last_completed_date', todayStr);
            const currentStreak = parseInt(localStorage.getItem('cybercatch_quest_streak') || '0', 10);
            localStorage.setItem('cybercatch_quest_streak', (currentStreak + 1).toString());
        }
    }

    saveCosmetics();
    saveAchievements();

    if (data.newlyUnlocked && data.newlyUnlocked.length > 0) {
        data.newlyUnlocked.forEach(id => {
            const ach = state.achievements[id];
            if (ach) {
                state.achievementToastQueue.push(ach);
            }
        });
        sounds.playCatch();
        processToastQueue();
    }

    if (window.renderCustomizeUI) window.renderCustomizeUI();
    if (window.renderAchievementsList) window.renderAchievementsList();
    if (window.renderQuestMenu) window.renderQuestMenu();
    if (window.updateMenuStatsHUD) window.updateMenuStatsHUD();
}

export async function loadLeaderboard() {
    try {
        const res = await fetch(`${API_BASE}api/leaderboard?period=${window.currentPeriod || 'all'}&mode=${state.currentMode || 'standard'}`);
        const data = await res.json();
        if (window.renderLeaderboard) {
            window.renderLeaderboard(data.leaderboard);
        }
    } catch (e) {
        console.error('Ошибка загрузки лидерборда:', e);
        const tbodies = [
            document.getElementById('leaderboard-body'),
            document.getElementById('menu-leaderboard-body'),
            document.getElementById('game-leaderboard-body')
        ].filter(Boolean);
        tbodies.forEach(tbody => {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: #ff3131;">СБОЙ СВЯЗИ С БД РЕКОРДОВ</td></tr>';
        });
    }
}

// --- СОХРАНЕНИЕ / ЗАГРУЗКА КОСМЕТИКИ И ДОСТИЖЕНИЙ ---

export function updateCreditsHUD() {
    const el1 = document.getElementById('hud-cyber-credits');
    const el2 = document.getElementById('cyber-credits-val');
    if (el1) el1.textContent = state.cyberCredits;
    if (el2) el2.textContent = state.cyberCredits;

    const pbEls = [
        document.getElementById('side-personal-best'),
        document.getElementById('menu-side-personal-best'),
        document.getElementById('game-side-personal-best')
    ].filter(Boolean);
    pbEls.forEach(pbEl => {
        pbEl.textContent = state.personalBest;
    });
}

export function saveCosmetics() {
    const data = {
        cyberCredits: state.cyberCredits,
        personalBest: state.personalBest,
        unlockedSkins: state.unlockedSkins,
        unlockedTrails: state.unlockedTrails,
        selectedSkin: state.selectedSkin,
        selectedTrail: state.selectedTrail
    };
    localStorage.setItem(`cybercatch_cosmetics_${state.deviceId}`, JSON.stringify(data));
    updateCreditsHUD();
}

export function initCosmetics() {
    const saved = localStorage.getItem(`cybercatch_cosmetics_${state.deviceId}`);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            state.cyberCredits = data.cyberCredits || 0;
            state.personalBest = data.personalBest || 0;
            state.unlockedSkins = data.unlockedSkins || ['none'];
            state.unlockedTrails = data.unlockedTrails || ['none'];

            // Фильтр от сломанных старых значений
            state.selectedSkin = data.selectedSkin || 'none';
            state.selectedTrail = data.selectedTrail || 'none';

            state.previewSkin = state.selectedSkin;
            state.previewTrail = state.selectedTrail;
        } catch(e) {
            console.error('Ошибка инициализации косметики:', e);
        }
    } else {
        state.cyberCredits = 0;
        state.personalBest = 0;
        state.unlockedSkins = ['none'];
        state.unlockedTrails = ['none'];
        state.selectedSkin = 'none';
        state.selectedTrail = 'none';
        state.previewSkin = 'none';
        state.previewTrail = 'none';
    }
    updateCreditsHUD();
}
export function saveAchievements() {
    const data = {};
    Object.keys(state.achievements).forEach(id => {
        data[id] = {
            unlocked: state.achievements[id].unlocked,
            progress: state.achievements[id].progress || 0
        };
    });
    localStorage.setItem(`cybercatch_achievements_${state.deviceId}`, JSON.stringify(data));
}

export function loadAchievements() {
    const saved = localStorage.getItem(`cybercatch_achievements_${state.deviceId}`);
    if (saved) {
        try {
            const data = JSON.parse(saved);
            Object.keys(state.achievements).forEach(id => {
                if (data[id]) {
                    state.achievements[id].unlocked = data[id].unlocked || false;
                    state.achievements[id].progress = data[id].progress || 0;
                }
            });
        } catch(e) {
            console.error('Ошибка загрузки достижений:', e);
        }
    }
}

// Клиентское превью прогресса достижений (для мгновенной обратной связи в HUD
// и тостов во время игры). Ничего здесь не пишется в localStorage — реальный,
// подтверждённый прогресс достижений применяется только через
// applyServerResults() после проверки результата сервером.
export function showAchievementProgress(id, progress, target) {
    const ach = state.achievements[id];
    if (!ach) return;

    logSystemMessage(`ПРОГРЕСС ДОСТИЖЕНИЯ: ${ach.title} [${progress}/${target}]`);

    const toast = document.createElement('div');
    toast.className = 'achievement-toast progress-toast';
    toast.innerHTML = `
        <div class="achievement-toast-header" style="color: var(--neon-cyan);">[ ПРОГРЕСС ДОСТИЖЕНИЯ ]</div>
        <div class="achievement-toast-title">${ach.title}</div>
        <div class="achievement-toast-desc">Выполнено: ${progress} / ${target}</div>
    `;

    const viewport = document.querySelector('.game-viewport');
    if (viewport) {
        viewport.appendChild(toast);
    }

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 2500);
}

export function checkAchievement(id, currentProgress) {
    const ach = state.achievements[id];
    if (!ach || ach.unlocked) return;
    
    if (id === 'never_miss') {
        const oldVal = ach.progress || 0;
        ach.progress = Math.max(oldVal, currentProgress);
        if (ach.progress >= 150) {
            unlockAchievement(id);
        } else {
            const oldMilestone = Math.floor(oldVal / 25);
            const newMilestone = Math.floor(ach.progress / 25);
            if (newMilestone > oldMilestone && ach.progress > 0) {
                showAchievementProgress(id, ach.progress, 150);
            }
        }
    } else if (id === 'lucky_bastard') {
        const oldVal = ach.progress || 0;
        ach.progress = Math.max(oldVal, currentProgress);
        if (ach.progress >= 3) {
            unlockAchievement(id);
        } else {
            if (ach.progress > oldVal && ach.progress > 0) {
                showAchievementProgress(id, ach.progress, 3);
            }
        }
    } else if (id === 'cyber_god') {
        const oldVal = ach.progress || 0;
        ach.progress = Math.max(oldVal, currentProgress);
        if (ach.progress >= 5000) {
            unlockAchievement(id);
        } else {
            const oldMilestone = Math.floor(oldVal / 1000);
            const newMilestone = Math.floor(ach.progress / 1000);
            if (newMilestone > oldMilestone && ach.progress > 0) {
                showAchievementProgress(id, ach.progress, 5000);
            }
        }
    } else if (id === 'storm_rider') {
        if (currentProgress === 1) {
            unlockAchievement(id);
        }
    } else if (id === 'twitch_target') {
        if (currentProgress === 1) {
            unlockAchievement(id);
        }
    } else if (id === 'data_grinder') {
        const oldVal = ach.progress || 0;
        ach.progress = currentProgress;
        if (ach.progress >= 1000) {
            unlockAchievement(id);
        } else {
            const oldMilestone = Math.floor(oldVal / 100);
            const newMilestone = Math.floor(ach.progress / 100);
            if (newMilestone > oldMilestone && ach.progress > 0) {
                showAchievementProgress(id, ach.progress, 1000);
            }
        }
    } else if (id === 'hardcore_operator') {
        ach.progress = currentProgress;
        if (ach.progress >= 20) {
            unlockAchievement(id);
        }
    } else if (id === 'big_spender') {
        ach.progress = currentProgress;
        if (ach.progress >= 2000) {
            unlockAchievement(id);
        }
    }
}

// Разблокировка ачивки только как клиентское превью (немедленный тост для
// обратной связи игроку). Реальный прогресс сохраняется лишь через
// applyServerResults() на основе проверенного сервером результата.
export function unlockAchievement(id) {
    const ach = state.achievements[id];
    if (ach.unlocked) return;

    ach.unlocked = true;
    sounds.playCatch(); // Воспроизведение звука победы

    state.achievementToastQueue.push(ach);
    processToastQueue();
}

export function processToastQueue() {
    if (state.isDisplayingToast || state.achievementToastQueue.length === 0) return;
    
    state.isDisplayingToast = true;
    const ach = state.achievementToastQueue.shift();
    
    const toast = document.createElement('div');
    toast.className = 'achievement-toast';
    toast.innerHTML = `
        <div class="achievement-toast-header">[ ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО ]</div>
        <div class="achievement-toast-title">${ach.title}</div>
        <div class="achievement-toast-desc">${ach.desc}</div>
    `;
    
    const viewport = document.querySelector('.game-viewport');
    if (viewport) {
        viewport.appendChild(toast);
    }
    
    logSystemMessage(`ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО: ${ach.title}`);
    
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => {
            toast.remove();
            state.isDisplayingToast = false;
            processToastQueue();
        }, 400);
    }, 4000);
}

// --- ЕЖЕДНЕВНЫЕ КВЕСТЫ ---

export async function loadQuests() {
    try {
        const res = await fetch(`${API_BASE}api/daily/quest`);
        const quest = await res.json();
        state.dailyQuest.desc = quest.desc;
        state.dailyQuest.target = quest.target;
        state.dailyQuest.reward = quest.reward;
        state.dailyQuest.type = quest.type;
    } catch (e) {
        console.error('Ошибка загрузки ежедневного квеста с сервера:', e);
    }

    const today = new Date().toDateString();
    const savedDate = localStorage.getItem('cybercatch_quest_date');
    
    if (savedDate !== today) {
        // Новый день - новый квест
        localStorage.setItem('cybercatch_quest_date', today);
        localStorage.setItem('cybercatch_quest_completed', 'false');
        state.dailyQuest.progress = 0;
        localStorage.setItem('cybercatch_quest_progress', '0');

        // Проверка сброса стрика квестов:
        const lastCompletedStr = localStorage.getItem('cybercatch_last_completed_date');
        if (lastCompletedStr) {
            const lastCompletedDate = new Date(lastCompletedStr);
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            
            // Если дата последнего выполнения не сегодня и не вчера, то стрик сгорает
            if (lastCompletedDate.toDateString() !== today && lastCompletedDate.toDateString() !== yesterday.toDateString()) {
                localStorage.setItem('cybercatch_quest_streak', '0');
            }
        } else {
            localStorage.setItem('cybercatch_quest_streak', '0');
        }
    } else {
        state.dailyQuest.progress = parseInt(localStorage.getItem('cybercatch_quest_progress') || '0', 10);
    }
    
    if (window.renderQuestMenu) {
        window.renderQuestMenu();
    }
}

// Клиентское превью прогресса контракта дня (для прогресс-бара во время игры).
// Ничего не пишется в localStorage и CC не начисляются здесь — реальное
// выполнение контракта и награда засчитываются сервером после отправки
// результата (см. applyServerResults).
export function updateQuestProgress(amount) {
    const isCompleted = localStorage.getItem('cybercatch_quest_completed') === 'true';
    if (isCompleted) return;

    state.dailyQuest.progress += amount;

    if (window.renderQuestMenu) {
        window.renderQuestMenu();
    }
}

// --- СЕЗОНЫ ---

export function loadSeasonInfo() {
    const seasonProgressEl = document.getElementById('season-progress-bar');
    const seasonRemainingEl = document.getElementById('season-remaining-days');
    
    if (seasonProgressEl && seasonRemainingEl) {
        // Простой расчет дней до конца сезона
        const now = new Date();
        const seasonEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Конец месяца
        const diffDays = Math.ceil((seasonEnd - now) / (1000 * 60 * 60 * 24));
        
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const totalDays = Math.ceil((seasonEnd - startOfMonth) / (1000 * 60 * 60 * 24));
        const passedDays = totalDays - diffDays;
        
        const pct = (passedDays / totalDays) * 100;
        seasonProgressEl.style.width = `${pct}%`;
        seasonRemainingEl.textContent = `ДНЕЙ ОСТАЛОСЬ: ${diffDays}`;
    }
}

// --- TERRASITE АВТОРИЗАЦИЯ И ОБЛАЧНОЕ СОХРАНЕНИЕ ---

export function logoutTerraSite() {
    state.terraSiteToken = null;
    state.terraSiteUser = null;
    localStorage.removeItem('terrasite_access_token');
    
    const loggedOutEl = document.getElementById('terrasite-logged-out');
    const loggedInEl = document.getElementById('terrasite-logged-in');
    if (loggedOutEl) loggedOutEl.style.display = 'block';
    if (loggedInEl) loggedInEl.style.display = 'none';
    
    const nameInput = document.getElementById('player-name');
    if (nameInput) nameInput.value = '';

    initCosmetics();
    loadAchievements();
    if (window.renderCustomizeUI) window.renderCustomizeUI();
    if (window.renderAchievementsList) window.renderAchievementsList();
    
    logSystemMessage('Сессия TerraSite завершена.');
}

export async function loadTerraSiteProfile() {
    // Попробуем восстановить токен из localStorage, если в state его нет
    if (!state.terraSiteToken) {
        state.terraSiteToken = localStorage.getItem('terrasite_access_token') || '';
    }
    
    try {
        const headers = {};
        if (state.terraSiteToken) {
            headers['Authorization'] = `Bearer ${state.terraSiteToken}`;
        }
        
        const res = await fetch(`${API_BASE}api/terrasite/users/me`, {
            method: 'GET',
            headers: headers
        });
        
        if (res.status === 200) {
            const data = await res.json();
            state.terraSiteUser = data;
            
            // Если сервер вернул токен (авторизация по кукам), сохраняем его для совместимости
            if (data.access_token) {
                state.terraSiteToken = data.access_token;
                localStorage.setItem('terrasite_access_token', data.access_token);
            }
            
            const loggedOutEl = document.getElementById('terrasite-logged-out');
            const loggedInEl = document.getElementById('terrasite-logged-in');
            if (loggedOutEl) loggedOutEl.style.display = 'none';
            if (loggedInEl) loggedInEl.style.display = 'block';
            
            const userDisplay = document.getElementById('terrasite-user-display');
            if (userDisplay) userDisplay.textContent = data.username.toUpperCase();
            
            const nameInput = document.getElementById('player-name');
            if (nameInput) nameInput.value = data.username;
            
            const scoreSubmit = document.getElementById('score-submit-container');
            if (scoreSubmit) scoreSubmit.style.display = 'none';

            await syncCloudProfile();
        } else {
            // Если токен был невалиден или пользователь не вошел, сбрасываем состояние
            logoutTerraSite();
        }
    } catch(e) {
        console.error('Ошибка профиля:', e);
        logoutTerraSite();
    }
}

export async function saveCloudProfile() {
    if (!state.terraSiteToken) return;
    
    try {
        await fetch(`${API_BASE}api/user/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: state.terraSiteToken,
                achievements: {
                    never_miss: { unlocked: state.achievements.never_miss.unlocked, progress: state.achievements.never_miss.progress },
                    lucky_bastard: { unlocked: state.achievements.lucky_bastard.unlocked, progress: state.achievements.lucky_bastard.progress },
                    cyber_god: { unlocked: state.achievements.cyber_god.unlocked, progress: state.achievements.cyber_god.progress },
                    storm_rider: { unlocked: state.achievements.storm_rider.unlocked, progress: state.achievements.storm_rider.progress },
                    twitch_target: { unlocked: state.achievements.twitch_target.unlocked, progress: state.achievements.twitch_target.progress },
                    data_grinder: { unlocked: state.achievements.data_grinder.unlocked, progress: state.achievements.data_grinder.progress },
                    hardcore_operator: { unlocked: state.achievements.hardcore_operator.unlocked, progress: state.achievements.hardcore_operator.progress },
                    big_spender: { unlocked: state.achievements.big_spender.unlocked, progress: state.achievements.big_spender.progress }
                },
                credits: state.cyberCredits,
                unlockedSkins: state.unlockedSkins,
                unlockedTrails: state.unlockedTrails,
                selectedSkin: state.selectedSkin,
                selectedTrail: state.selectedTrail
            })
        });
        logSystemMessage('Облачный профиль сохранен.');
    } catch(e) {
        console.error('Ошибка облачного сохранения:', e);
    }
}

export async function loadServerConfig() {
    try {
        const res = await fetch(`${API_BASE}api/config`);
        const config = await res.json();
        
        // Очищаем и заполняем импортированные объекты config.js
        for (const key in upgrades) delete upgrades[key];
        for (const key in SKINS) delete SKINS[key];
        for (const key in TRAILS) delete TRAILS[key];
        for (const key in achievements) delete achievements[key];
        for (const key in dailyQuest) delete dailyQuest[key];
        
        Object.assign(upgrades, config.upgrades);
        Object.assign(SKINS, config.skins);
        Object.assign(TRAILS, config.trails);
        Object.assign(achievements, config.achievements);
        Object.assign(dailyQuest, config.dailyQuest);
        
        // Синхронизируем также копии в state
        if (!state.upgrades) state.upgrades = {};
        if (!state.achievements) state.achievements = {};
        if (!state.dailyQuest) state.dailyQuest = {};
        
        for (const key in state.upgrades) delete state.upgrades[key];
        for (const key in state.achievements) delete state.achievements[key];
        for (const key in state.dailyQuest) delete state.dailyQuest[key];
        
        Object.assign(state.upgrades, config.upgrades);
        Object.assign(state.achievements, config.achievements);
        Object.assign(state.dailyQuest, config.dailyQuest);
        
        console.log('Конфигурация сервера успешно загружена.');
    } catch (e) {
        console.error('Ошибка загрузки конфигурации сервера:', e);
    }
}

export async function syncCloudProfile() {
    try {
        const url = `${API_BASE}api/user/load?token=${state.terraSiteToken || ''}&deviceId=${state.deviceId || ''}`;
        const res = await fetch(url);
        const data = await res.json();
        
        if (data.profile) {
            const p = data.profile;
            state.cyberCredits = p.credits || 0;
            state.personalBest = p.personalBest || 0;
            state.unlockedSkins = p.unlockedSkins || ['none'];
            state.unlockedTrails = p.unlockedTrails || ['none'];

            // Если сейчас идёт просмотр реплея, облик/след уже выставлены из
            // самой записи реплея (см. checkUrlReplay) — их нельзя перетирать
            // собственными облачными настройками зрителя, иначе асинхронная
            // синхронизация профиля, завершившаяся уже после загрузки
            // реплея, молча подменит показанный облик на текущий зрителя.
            if (!state.isReplayPlayback) {
                state.selectedSkin = SKINS[p.selectedSkin] ? p.selectedSkin : 'none';
                state.selectedTrail = TRAILS[p.selectedTrail] ? p.selectedTrail : 'none';

                state.previewSkin = state.selectedSkin;
                state.previewTrail = state.selectedTrail;
            }
            
            if (p.achievements) {
                Object.keys(state.achievements).forEach(id => {
                    if (p.achievements[id]) {
                        state.achievements[id].unlocked = state.achievements[id].unlocked || p.achievements[id].unlocked || false;
                        state.achievements[id].progress = Math.max(state.achievements[id].progress || 0, p.achievements[id].progress || 0);
                    }
                });
            }
            
            // Аналогично — не сохраняем локально облик/след реплея как
            // будто это выбор зрителя.
            if (!state.isReplayPlayback) {
                saveCosmetics();
            }
            saveAchievements();
            if (window.renderCustomizeUI) window.renderCustomizeUI();
            if (window.renderAchievementsList) window.renderAchievementsList();
            if (window.updateMenuStatsHUD) window.updateMenuStatsHUD();
            logSystemMessage('Прогресс синхронизирован с сервером.');
        }
    } catch(e) {
        console.error('Ошибка синхронизации профиля с сервером:', e);
    }
}

// Покупка и выбор скинов/шлейфов. Списание CC и разблокировка предмета
// выполняются строго сервером (/api/user/buy) — клиент лишь отправляет
// запрос и применяет подтверждённый сервером профиль.
async function purchaseItem(itemType, id, catalog, catalogLabel) {
    const item = catalog[id];
    if (!item) return;

    if (state.cyberCredits < item.cost) {
        showToast('Недостаточно кредитов CC!', 'warning');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}api/user/buy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token: state.terraSiteToken || undefined,
                deviceId: state.deviceId,
                itemType,
                itemId: id
            })
        });
        const data = await res.json();

        if (!data.success) {
            showToast(data.error || 'Не удалось совершить покупку.', 'error');
            return;
        }

        const profile = data.profile;
        state.cyberCredits = profile.credits;
        state.unlockedSkins = profile.unlockedSkins || state.unlockedSkins;
        state.unlockedTrails = profile.unlockedTrails || state.unlockedTrails;
        if (profile.achievements && profile.achievements.big_spender) {
            state.achievements.big_spender.unlocked = profile.achievements.big_spender.unlocked || false;
            state.achievements.big_spender.progress = profile.achievements.big_spender.progress || 0;
        }

        saveCosmetics();
        saveAchievements();
        updateCreditsHUD();
        if (window.renderCustomizeUI) window.renderCustomizeUI();
        if (window.updateMenuStatsHUD) window.updateMenuStatsHUD();
        logSystemMessage(`${catalogLabel} ${item.name} успешно разблокирован!`);
    } catch (e) {
        console.error('Ошибка покупки:', e);
        showToast('Не удалось связаться с сервером для покупки.', 'error');
    }
}

export function buySkin(id) {
    purchaseItem('skin', id, SKINS, 'Скин');
}

export function equipSkin(id) {
    const isAchievementUnlocked = SKINS[id] && SKINS[id].rewardFor && state.achievements[SKINS[id].rewardFor] && state.achievements[SKINS[id].rewardFor].unlocked;
    if (state.unlockedSkins.includes(id) || isAchievementUnlocked || id === 'none') {
        state.selectedSkin = id;
        state.previewSkin = id;
        saveCosmetics();
        if (window.renderCustomizeUI) window.renderCustomizeUI();
        logSystemMessage(`Облик изменен на: ${SKINS[id].name}`);
    }
}

export function buyTrail(id) {
    purchaseItem('trail', id, TRAILS, 'След');
}

export function equipTrail(id) {
    if (state.unlockedTrails.includes(id) || id === 'none') {
        state.selectedTrail = id;
        state.previewTrail = id;
        saveCosmetics();
        if (window.renderCustomizeUI) window.renderCustomizeUI();
        logSystemMessage(`След изменен на: ${TRAILS[id].name}`);
    }
}

// Глобальные биндинги для вызова из HTML
window.logoutTerraSite = logoutTerraSite;
window.buySkin = buySkin;
window.equipSkin = equipSkin;
window.buyTrail = buyTrail;
window.equipTrail = equipTrail;

// Проверка URL на наличие реплея
export async function checkUrlReplay() {
    const params = new URLSearchParams(window.location.search);
    const replayParam = params.get('replay');
    if (replayParam) {
        if (replayParam.length > 20) {
            try {
                const decoded = JSON.parse(atob(replayParam));
                state.replayData = decoded;
                // Реплей должен показывать облик/след, которыми игрок
                // реально пользовался в той игре, а не текущие настройки
                // зрителя.
                state.selectedSkin = decoded.selectedSkin || 'none';
                state.selectedTrail = decoded.selectedTrail || 'none';
                state.replaySeed = decoded.seed;
                state.replayInputs = await decodeReplay(decoded.inputs);
                state.isReplayPlayback = true;
                state.isDailyRun = false;
                // Оценка полной длительности реплея (+3с запас на дожитие
                // оставшихся ядер после последнего записанного действия).
                const lastInput = state.replayInputs[state.replayInputs.length - 1];
                state.replayDurationMs = (lastInput ? lastInput.time : 0) + 3000;
                
                logSystemMessage(`Загружен реплей игрока ${decoded.name}! Счёт: ${decoded.score}`);
                
                document.getElementById('start-btn-content').textContent = 'СМОТРЕТЬ РЕПЛЕЙ';
                document.getElementById('menu-title').textContent = 'REPLAY SPECTATE';
                document.getElementById('menu-subtitle').textContent = `ЗАПИСЬ ОПЕРАТОРА: ${decoded.name}`;
                const replayPlayBtn = document.getElementById('replay-play-btn');
                if (replayPlayBtn) replayPlayBtn.style.display = 'flex';
            } catch(e) {
                console.error('Ошибка парсинга локального реплея:', e);
            }
        } else {
            try {
                const res = await fetch(`${API_BASE}api/replay/get?id=${replayParam}`);
                const decoded = await res.json();
                state.replayData = decoded;
                // Реплей должен показывать облик/след, которыми игрок
                // реально пользовался в той игре, а не текущие настройки
                // зрителя.
                state.selectedSkin = decoded.selectedSkin || 'none';
                state.selectedTrail = decoded.selectedTrail || 'none';
                state.replaySeed = decoded.seed;
                state.replayInputs = await decodeReplay(decoded.inputs);
                state.isReplayPlayback = true;
                state.isDailyRun = false;
                // Оценка полной длительности реплея (+3с запас на дожитие
                // оставшихся ядер после последнего записанного действия).
                const lastInput = state.replayInputs[state.replayInputs.length - 1];
                state.replayDurationMs = (lastInput ? lastInput.time : 0) + 3000;
                
                logSystemMessage(`Загружен реплей игрока ${decoded.name}! Счёт: ${decoded.score}`);
                
                document.getElementById('start-btn-content').textContent = 'СМОТРЕТЬ РЕПЛЕЙ';
                document.getElementById('menu-title').textContent = 'REPLAY SPECTATE';
                document.getElementById('menu-subtitle').textContent = `ЗАПИСЬ ОПЕРАТОРА: ${decoded.name}`;
                const replayPlayBtn = document.getElementById('replay-play-btn');
                if (replayPlayBtn) replayPlayBtn.style.display = 'flex';
            } catch (err) {
                console.error('Ошибка загрузки реплея с сервера:', err);
            }
        }
    }
}
