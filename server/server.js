const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = parseInt(process.argv[2]) || process.env.PORT || 7995;
const HOST = process.env.HOST || '0.0.0.0';
const SECRET_SALT = 'CYBER_SECRET_SALT_2026';

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.txt': 'text/plain',
    '.ico': 'image/x-icon'
};

// Сессии игроков для защиты от спама рекордов
const sessions = new Map();

// Подключение SQLite базы данных (Node.js 22.5.0+)
const { DatabaseSync } = require('node:sqlite');
const DB_FILE = path.join(__dirname, 'database.db');
const db = new DatabaseSync(DB_FILE);

// Инициализация структуры базы данных
db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    date TEXT NOT NULL,
    mode TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    ip TEXT NOT NULL,
    replayId TEXT
  );
  
  CREATE TABLE IF NOT EXISTS user_profiles (
    username_or_device TEXT PRIMARY KEY,
    credits INTEGER DEFAULT 0,
    personal_best INTEGER DEFAULT 0,
    unlocked_skins TEXT NOT NULL,
    unlocked_trails TEXT NOT NULL,
    selected_skin TEXT DEFAULT 'none',
    selected_trail TEXT DEFAULT 'none',
    achievements TEXT NOT NULL,
    quest_progress INTEGER DEFAULT 0,
    quest_completed_today INTEGER DEFAULT 0,
    quest_date TEXT DEFAULT ''
  );
  
  CREATE TABLE IF NOT EXISTS replays (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
`);

// Инициализация дефолтных рекордов если таблица пуста
const countLeaderboard = db.prepare('SELECT COUNT(*) as count FROM leaderboard').get().count;
if (countLeaderboard === 0) {
    const insertLeaderboard = db.prepare(`
        INSERT INTO leaderboard (name, score, timestamp, date, mode, deviceId, ip) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const defaultRecords = [
        { name: 'NEO_CATCHER', score: 45, date: '2026-07-19' },
        { name: 'TRINITY', score: 38, date: '2026-07-19' },
        { name: 'MORPHEUS', score: 25, date: '2026-07-19' },
        { name: 'CYPHER', score: 12, date: '2026-07-19' }
    ];
    defaultRecords.forEach(item => {
        const timestamp = new Date(item.date).getTime();
        insertLeaderboard.run(item.name, item.score, timestamp, item.date, 'standard', 'legacy', '127.0.0.1');
    });
}

// Загрузка кэша рекордов из базы при старте
let leaderboard = [];
try {
    leaderboard = db.prepare('SELECT name, score, timestamp, date, mode, deviceId, ip, replayId FROM leaderboard ORDER BY score DESC, timestamp ASC').all();
} catch (e) {
    console.error('Ошибка загрузки таблицы рекордов:', e);
}

// Текущий сезон
const CURRENT_SEASON = {
    number: 1,
    endDate: "2026-08-31T23:59:59Z"
};

// Очистка старых неактивных сессий раз в 5 минут
setInterval(() => {
    const now = Date.now();
    for (const [id, sess] of sessions.entries()) {
        if (now - sess.startTime > 30 * 60 * 1000) { // 30 минут таймаут
            sessions.delete(id);
        }
    }
}, 5 * 60 * 1000);

// Вспомогательные функции для парсинга куки и резолва токена
function getCookieValue(cookieHeader, name) {
    if (!cookieHeader) return null;
    const value = `; ${cookieHeader}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

function resolveToken(req, bodyToken) {
    if (bodyToken) return bodyToken;
    const cookieHeader = req.headers['cookie'];
    return getCookieValue(cookieHeader, 'access_token');
}

// Вспомогательная функция для получения профиля по токену TerraSite
async function getTerraSiteUsername(token) {
    try {
        const response = await fetch('http://localhost:8000/api/users/me', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 200) {
            const user = await response.json();
            return user.username;
        }
    } catch (e) {
        console.error('Ошибка проверки токена TerraSite:', e);
    }
    return null;
}

// Вспомогательная функция для автоматического продления токенов
async function getValidAccessToken(req, res, bodyToken) {
    const cookieHeader = req.headers['cookie'];
    let accessToken = getCookieValue(cookieHeader, 'access_token');
    const refreshToken = getCookieValue(cookieHeader, 'refresh_token');

    // 1. Если токен в куках есть, проверяем его валидность
    if (accessToken) {
        const username = await getTerraSiteUsername(accessToken);
        if (username) {
            return accessToken;
        }
    }

    // 2. Если токен истек или отсутствует, но есть рефреш-токен, пробуем сделать ротацию токенов
    if (refreshToken) {
        try {
            const refreshResponse = await fetch('http://localhost:8000/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: refreshToken })
            });
            if (refreshResponse.status === 200) {
                const newTokens = await refreshResponse.json();
                
                // Проставляем куки с флагом Domain для поддержки субдоменов
                const host = req.headers['host'] || '';
                const domain = host.includes('yourdomain.com') ? '; Domain=.yourdomain.com' : '';
                const secure = host.includes('localhost') ? '' : '; Secure';
                
                res.setHeader('Set-Cookie', [
                    `access_token=${newTokens.access_token}; Path=/; Max-Age=86400; SameSite=Lax${domain}${secure}`,
                    `refresh_token=${newTokens.refresh_token}; Path=/; Max-Age=2592000; SameSite=Lax${domain}${secure}`
                ]);

                return newTokens.access_token;
            }
        } catch (e) {
            console.error('Ошибка авто-рефреша токена в wolknewalk:', e);
        }
    }

    // 3. Fallback к токену из localStorage/body, если куки недоступны или рефреш не сработал
    if (bodyToken) {
        const username = await getTerraSiteUsername(bodyToken);
        if (username) {
            return bodyToken;
        }
    }

    return null;
}

// Должно точно соответствовать SKINS / TRAILS из client/js/config.js
const SKINS_METADATA = {
    none: { name: 'Original Wolf', color: '#ffffff', cost: 0, type: 'none' },
    classic: { name: 'Classic Cyan Glow', color: '#00f0ff', cost: 150, type: 'outline' },
    outline_pink: { name: 'Neon Pink Glow', color: '#ff007f', cost: 250, type: 'outline' },
    outline_gold: { name: 'Gold Cyber Glow', color: '#ffde00', cost: 350, type: 'outline' },
    glitch: { name: 'Glitch Entity', color: '#39ff14', cost: 500, type: 'glitch' },
    retro: { name: 'Synthwave Retro', color: '#ff007f', cost: 750, type: 'retro' },
    holo: { name: 'Matrix Hologram', color: '#00f0ff', cost: 1000, type: 'holo' },
    matrix_overlord: { name: 'Matrix Overlord (Reward)', color: '#39ff14', cost: 0, type: 'holo', rewardFor: 'cyber_god' },
    neon_sentinel: { name: 'Neon Sentinel (Reward)', color: '#ffde00', cost: 0, type: 'outline', rewardFor: 'never_miss' },
    quantum_ghost: { name: 'Quantum Ghost (Reward)', color: '#bd00ff', cost: 0, type: 'glitch', rewardFor: 'data_grinder' }
};

const TRAILS_METADATA = {
    none: { name: 'Без следа', cost: 0 },
    binary: { name: 'Binary Trail', cost: 100 },
    sparks: { name: 'Cyber Sparks', cost: 200 },
    sandevistan: { name: 'Sandevistan Clone', cost: 400 },
    rain: { name: 'Matrix Rain', cost: 150 },
    rainbow: { name: 'Spectrum Split', cost: 280 }
};

const UPGRADES_CONFIG = {
    speed: { lvl: 1, max: 5, base: 650, step: 65, title: 'ДВИГАТЕЛЬ (СКОРОСТЬ)' },
    hitbox: { lvl: 1, max: 5, base: 75, step: 12, title: 'ПРИЕМНИК (ХИТБОКС)' },
    slow: { lvl: 1, max: 5, base: 5.0, step: 1.5, title: 'ЯКОРЬ (ЗАМЕДЛЕНИЕ)' },
    shield: { lvl: 1, max: 5, base: 3, step: 1, title: 'МАТРИЦА (ЩИТЫ)' }
};

const ACHIEVEMENTS_CONFIG = {
    never_miss: { unlocked: false, progress: 0, title: 'Без пропусков', desc: 'Поймать 150 ядер подряд без пропусков', scope: 'single_run', target: 150 },
    lucky_bastard: { unlocked: false, progress: 0, title: 'Везунчик', desc: 'Собрать 3 редких золотых ядра подряд', scope: 'single_run', target: 3 },
    cyber_god: { unlocked: false, progress: 0, title: 'Кибербог', desc: 'Набрать 5000 очков в игре', scope: 'single_run', target: 5000 },
    storm_rider: { unlocked: false, progress: 0, title: 'Грозовой гонщик', desc: 'Выжить в Data Storm без потерь жизней', scope: 'single_run', target: 1 },
    twitch_target: { unlocked: false, progress: 0, title: 'Цель Twitch', desc: 'Сыграть с подключенным Twitch-чатом', scope: 'single_run', target: 1 },
    data_grinder: { unlocked: false, progress: 0, title: 'Сборщик данных', desc: 'Собрать 1000 ядер суммарно за все игры', scope: 'cumulative', target: 1000 },
    hardcore_operator: { unlocked: false, progress: 0, title: 'Закаленный оператор', desc: 'Сыграть 20 игровых сессий', scope: 'cumulative', target: 20 },
    big_spender: { unlocked: false, progress: 0, title: 'Расточитель', desc: 'Потратить 2000 CC кредитов в кастомизации', scope: 'cumulative', target: 2000 }
};

function saveProfileToDb(usernameOrGuestId, p) {
    try {
        db.prepare(`
            INSERT INTO user_profiles (
                username_or_device, credits, personal_best, unlocked_skins, unlocked_trails,
                selected_skin, selected_trail, achievements, quest_progress, quest_completed_today, quest_date
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(username_or_device) DO UPDATE SET
                credits = excluded.credits,
                personal_best = excluded.personal_best,
                unlocked_skins = excluded.unlocked_skins,
                unlocked_trails = excluded.unlocked_trails,
                selected_skin = excluded.selected_skin,
                selected_trail = excluded.selected_trail,
                achievements = excluded.achievements,
                quest_progress = excluded.quest_progress,
                quest_completed_today = excluded.quest_completed_today,
                quest_date = excluded.quest_date
        `).run(
            usernameOrGuestId,
            p.credits,
            p.personalBest,
            JSON.stringify(p.unlockedSkins),
            JSON.stringify(p.unlockedTrails),
            p.selectedSkin,
            p.selectedTrail,
            JSON.stringify(p.achievements),
            p.questProgress,
            p.questCompletedToday ? 1 : 0,
            p.questDate
        );
    } catch (e) {
        console.error('Ошибка сохранения профиля в БД:', e);
    }
}

function getOrCreateProfile(usernameOrGuestId) {
    let p = null;
    try {
        const row = db.prepare('SELECT * FROM user_profiles WHERE username_or_device = ?').get(usernameOrGuestId);
        if (row) {
            p = {
                credits: row.credits,
                personalBest: row.personal_best,
                unlockedSkins: JSON.parse(row.unlocked_skins),
                unlockedTrails: JSON.parse(row.unlocked_trails),
                selectedSkin: row.selected_skin,
                selectedTrail: row.selected_trail,
                achievements: JSON.parse(row.achievements),
                questProgress: row.quest_progress,
                questCompletedToday: row.quest_completed_today === 1,
                questDate: row.quest_date
            };
        }
    } catch (e) {
        console.error('Ошибка чтения профиля из БД:', e);
    }

    if (!p) {
        p = {
            credits: 0,
            personalBest: 0,
            unlockedSkins: ['none'],
            unlockedTrails: ['none'],
            selectedSkin: 'none',
            selectedTrail: 'none',
            achievements: {
                never_miss: { unlocked: false, progress: 0 },
                lucky_bastard: { unlocked: false, progress: 0 },
                cyber_god: { unlocked: false, progress: 0 },
                storm_rider: { unlocked: false, progress: 0 },
                twitch_target: { unlocked: false, progress: 0 },
                data_grinder: { unlocked: false, progress: 0 },
                hardcore_operator: { unlocked: false, progress: 0 },
                big_spender: { unlocked: false, progress: 0 }
            },
            questProgress: 0,
            questCompletedToday: false,
            questDate: ''
        };
        saveProfileToDb(usernameOrGuestId, p);
    }
    
    // Обеспечиваем совместимость структуры
    if (p.personalBest === undefined) p.personalBest = 0;
    if (!p.achievements) p.achievements = {};
    const achs = ['never_miss', 'lucky_bastard', 'cyber_god', 'storm_rider', 'twitch_target', 'data_grinder', 'hardcore_operator', 'big_spender'];
    achs.forEach(id => {
        if (!p.achievements[id]) {
            p.achievements[id] = { unlocked: false, progress: 0 };
        }
    });
    if (p.questProgress === undefined) p.questProgress = 0;
    if (p.questCompletedToday === undefined) p.questCompletedToday = false;
    if (p.questDate === undefined) p.questDate = '';
    
    return { profiles: null, profile: p };
}

// Маркеры "гарантированной поимки/пропуска" — см. CATCH_MARKER/MISS_MARKER в
// client/js/utils.js. Сервер их намеренно ИГНОРИРУЕТ для симуляции (иначе
// клиент мог бы просто дописать себе поимки в поток и обмануть проверку), но
// обязан правильно распознать и пропустить занимаемый ими второй 4-байтовый
// блок (spawnSeq) — иначе весь дальнейший поток данных читается со сдвигом и
// симуляция полностью ломается.
const CATCH_MARKER = 0x7FFA;
const MISS_MARKER = 0x7FF9;
const WOLF_WIDTH = 206.74479166666666;

function decodeReplayServer(base64Str) {
    if (!base64Str) return [];
    try {
        const compressed = Buffer.from(base64Str, 'base64');
        const buffer = zlib.gunzipSync(compressed);
        const inputs = [];
        const count = buffer.length / 4;
        let i = 0;
        while (i < count) {
            const tick = buffer.readUInt16LE(i * 4);
            const val = buffer.readUInt16LE(i * 4 + 2);

            if (val === 0x7FFE) {
                inputs.push({ tick, type: 'upgrade', action: 'speed' });
                i += 1;
            } else if (val === 0x7FFD) {
                inputs.push({ tick, type: 'upgrade', action: 'hitbox' });
                i += 1;
            } else if (val === 0x7FFC) {
                inputs.push({ tick, type: 'upgrade', action: 'slow' });
                i += 1;
            } else if (val === 0x7FFB) {
                inputs.push({ tick, type: 'upgrade', action: 'shield' });
                i += 1;
            } else if (val === 0x7FFF) {
                i += 1;
            } else {
                const left = (val & 1) !== 0;
                const right = (val & 2) !== 0;
                let targetX = null;
                if ((val & 4) !== 0) {
                    if (i + 1 < count) {
                        targetX = buffer.readUInt16LE((i + 1) * 4);
                    }
                    i += 2;
                } else {
                    i += 1;
                }
                inputs.push({ tick, type: 'input', left, right, targetX });
            }
        }
        return inputs;
    } catch(e) {
        console.error('Ошибка декодирования реплея на сервере:', e);
        return [];
    }
}

function decodeFullReplayServer(base64Str) {
    return decodeReplayServer(base64Str);
}

function simulateGame(seed, decodedInputs, mode, replayId, fullDecodedInputs) {
    let randomSeed = seed;
    function seededRandom() {
        const a = 1664525;
        const c = 1013904223;
        const m = Math.pow(2, 32);
        randomSeed = (a * randomSeed + c) % m;
        return randomSeed / m;
    }

    const logLines = [];
    logLines.push(`=== Replay Validation Log ===`);
    logLines.push(`Replay ID: ${replayId || 'unknown'}`);
    logLines.push(`Seed: ${seed}`);
    logLines.push(`Mode: ${mode}`);
    logLines.push(`Inputs count: ${decodedInputs.length}`);
    if (fullDecodedInputs) {
        logLines.push(`Full inputs count: ${fullDecodedInputs.length}`);
    }

    function writeLogFile() {
        if (!replayId) return;
        try {
            const logsDir = path.join(__dirname, 'validation_logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const logFile = path.join(logsDir, `replay_${replayId}_validation.log`);
            fs.writeFileSync(logFile, logLines.join('\n'), 'utf8');
        } catch (e) {
            console.error('Ошибка записи файла лога валидации:', e);
        }
    }

    const clientEvents = {};
    if (fullDecodedInputs) {
        for (const inp of fullDecodedInputs) {
            if (inp.type === 'catch' || inp.type === 'miss') {
                clientEvents[inp.spawnSeq] = inp;
            }
        }
    }

    let score = 0;
    let level = 1;
    let lives = 3;
    let streakCounter = 0;
    let maxStreak = 0;
    let goldenStreakCounter = 0;
    let maxGoldenStreak = 0;
    let totalCores = 0;
    let standardCores = 0;
    let slowMotionTimer = 0;
    let freezeTimer = 0;
    let doublePointsTimer = 0;
    let eggs = [];
    let scoreNeededForNextLevel = 15;
    const isDailyRun = mode === 'daily';

    let activeEvent = null;
    let eventTimer = 0;
    let eventIntervalTimer = 0;
    let upcomingEvent = null;
    let eventWarningTimer = 0;
    let gravityFlipped = false;
    let controlInverted = false;
    let wolfY = 290;
    let lasers = [];
    let lastLaserTime = 0;

    let upgrades = {
        speed: { lvl: 1, base: UPGRADES_CONFIG.speed.base, step: UPGRADES_CONFIG.speed.step },
        hitbox: { lvl: 1 },
        slow: { lvl: 1, base: UPGRADES_CONFIG.slow.base, step: UPGRADES_CONFIG.slow.step },
        shield: { lvl: 1, base: UPGRADES_CONFIG.shield.base, step: UPGRADES_CONFIG.shield.step }
    };

    let spawnTimer = 0;
    const baseSpawnInterval = 1800;
    let scoreInCurrentLevel = 0;
    let nextEggSpawnSeq = 0;
    
    const inputsMap = {};
    for (const inp of decodedInputs) {
        (inputsMap[inp.tick] = inputsMap[inp.tick] || []).push(inp);
    }

    let lastX = 385;
    let lastDir = 'RIGHT';
    let leftPressed = false;
    let rightPressed = false;
    let targetX = null;

    const maxTick = decodedInputs.length > 0 ? decodedInputs[decodedInputs.length - 1].tick + 180 : 5000;
    const dt = 1000 / 60;

    for (let tick = 0; tick <= maxTick; tick++) {
        const inputsAtTick = inputsMap[tick];
        if (inputsAtTick) {
            for (const input of inputsAtTick) {
                if (input.type === 'upgrade') {
                    const cat = input.action;
                    if (upgrades[cat]) {
                        upgrades[cat].lvl++;
                        if (cat === 'shield') {
                            lives++;
                            logLines.push(`[Tick ${tick}] Upgrade shield bought. Remaining lives: ${lives}`);
                        } else {
                            logLines.push(`[Tick ${tick}] Upgrade ${cat} bought.`);
                        }
                    }
                } else if (input.type === 'input') {
                    leftPressed = input.left;
                    rightPressed = input.right;
                    targetX = input.targetX;
                    logLines.push(`[Tick ${tick}] Input state left=${leftPressed}, right=${rightPressed}, targetX=${targetX}`);
                }
            }
        }

        // Движение волка
        let dx = 0;
        let finalLeftPressed = leftPressed;
        let finalRightPressed = rightPressed;
        if (controlInverted) {
            finalLeftPressed = rightPressed;
            finalRightPressed = leftPressed;
        }

        if (finalLeftPressed) {
            dx = -1;
            lastDir = controlInverted ? 'RIGHT' : 'LEFT';
            targetX = null;
        } else if (finalRightPressed) {
            dx = 1;
            lastDir = controlInverted ? 'LEFT' : 'RIGHT';
            targetX = null;
        }

        const speed = upgrades.speed.base + (upgrades.speed.lvl - 1) * upgrades.speed.step;
        const maxWolfX = 960 - WOLF_WIDTH - 10;

        if (dx !== 0) {
            lastX += dx * speed * (dt / 1000);
            lastX = Math.max(10, Math.min(maxWolfX, lastX));
        }

        if (targetX !== null) {
            const diff = targetX - lastX;
            if (Math.abs(diff) > 8) {
                const moveStep = Math.sign(diff) * speed * (dt / 1000);
                if (Math.abs(moveStep) >= Math.abs(diff)) {
                    lastX = targetX;
                    targetX = null;
                } else {
                    lastX += moveStep;
                }
                lastDir = diff > 0 ? 'RIGHT' : 'LEFT';
                lastX = Math.max(10, Math.min(maxWolfX, lastX));
            } else {
                targetX = null;
            }
        }

        if (slowMotionTimer > 0) slowMotionTimer -= dt / 1000;
        if (freezeTimer > 0) freezeTimer -= dt / 1000;
        if (doublePointsTimer > 0) doublePointsTimer -= dt / 1000;

        if (upcomingEvent !== null) {
            eventWarningTimer -= dt / 1000;
            if (eventWarningTimer <= 0) {
                activeEvent = upcomingEvent;
                upcomingEvent = null;
                logLines.push(`[Tick ${tick}] Event started: ${activeEvent}`);
                if (activeEvent === 'storm') eventTimer = 10.0;
                else if (activeEvent === 'blackout') eventTimer = 14.0;
                else if (activeEvent === 'virus') eventTimer = 14.0;
                else if (activeEvent === 'shift') { eventTimer = 12.0; controlInverted = true; }
                else if (activeEvent === 'laser') { eventTimer = 15.0; lasers = []; lastLaserTime = 0; }
                else if (activeEvent === 'gravity') { gravityFlipped = true; wolfY = 40; eventTimer = 14.0; eggs = []; }
                else eventTimer = 12.0;
            }
        }

        if (activeEvent !== null) {
            eventTimer -= dt / 1000;

            if (activeEvent === 'laser') {
                lastLaserTime += dt;
                if (lastLaserTime >= 2000) {
                    lastLaserTime = 0;
                    const targetX = 80 + seededRandom() * 800;
                    lasers.push({ x: targetX, timer: 1.5, active: false, duration: 0.8 });
                    logLines.push(`[Tick ${tick}] Spawning laser targetX=${targetX.toFixed(2)}`);
                }
                for (const laser of lasers) {
                    if (!laser.active) {
                        laser.timer -= dt / 1000;
                        if (laser.timer <= 0) {
                            laser.active = true;
                            const wolfMin = lastX;
                            const wolfMax = lastX + WOLF_WIDTH;
                            logLines.push(`[Tick ${tick}] Laser active at x=${laser.x.toFixed(2)}. Wolf range=[${wolfMin}, ${wolfMax}]`);
                            if (laser.x >= wolfMin && laser.x <= wolfMax) {
                                lives--;
                                logLines.push(`[Tick ${tick}] Laser hit wolf! Remaining lives: ${lives}`);
                                if (lives <= 0) {
                                    logLines.push(`[Tick ${tick}] Game over (laser)`);
                                    writeLogFile();
                                    return { score, level, maxStreak, maxGoldenStreak, totalCores, standardCores };
                                }
                            }
                        }
                    } else {
                        laser.duration -= dt / 1000;
                    }
                }
                lasers = lasers.filter(l => l.duration > 0);
            }

            if (eventTimer <= 0) {
                logLines.push(`[Tick ${tick}] Event ended: ${activeEvent}`);
                if (activeEvent === 'gravity') {
                    gravityFlipped = false;
                    wolfY = 460 - 170;
                    eggs = []; // Очищаем оставшиеся яйца после инвертированной гравитации
                }
                if (activeEvent === 'shift') {
                    controlInverted = false;
                }
                activeEvent = null;
                lasers = [];
            }
        } else {
            eventIntervalTimer += dt;
            if (eventIntervalTimer >= 22000) {
                eventIntervalTimer = 0;
                if (seededRandom() < 0.85) {
                    const list = ['storm', 'blackout', 'virus', 'shift', 'laser', 'gravity'];
                    const idx = Math.floor(seededRandom() * list.length);
                    upcomingEvent = list[idx];
                    eventWarningTimer = 6.0;
                    logLines.push(`[Tick ${tick}] Upcoming event warning: ${upcomingEvent}`);
                }
            }
        }

        if (freezeTimer <= 0) {
            spawnTimer += dt;

            let currentInterval = Math.max(550, baseSpawnInterval - (level - 1) * 110);
            if (activeEvent === 'storm') currentInterval = 280;
            if (slowMotionTimer > 0) currentInterval *= 2.0;

            if (spawnTimer >= currentInterval) {
                spawnTimer = 0;

                const startY = gravityFlipped ? 440 : 40;
                let eggX = 180 + seededRandom() * 600;

                if (activeEvent === 'laser') {
                    for (let r = 0; r < 20; r++) {
                        let safe = true;
                        for (const laser of lasers) {
                            if (Math.abs(eggX - laser.x) < 70) { safe = false; break; }
                        }
                        if (safe) break;
                        eggX = 180 + ((eggX - 180 + 150) % 600);
                    }
                }

                const randVirus = seededRandom();
                const randType = seededRandom();
                const randChoice = seededRandom();

                let eggType = 'standard';
                if (activeEvent === 'virus' && randVirus < 0.35) {
                    eggType = 'virus';
                } else {
                    if (randType < 0.66) eggType = 'standard';
                    else if (randType < 0.74) eggType = 'slow';
                    else if (randType < 0.82) eggType = 'overclock';
                    else if (randType < 0.87) eggType = 'freeze';
                    else if (randType < 0.92) eggType = 'double';
                    else {
                        const maxLives = upgrades.shield.base + (upgrades.shield.lvl - 1) * upgrades.shield.step;
                        if (lives < maxLives) eggType = 'repair';
                        else eggType = randChoice > 0.5 ? 'standard' : 'double';
                    }
                }
                seededRandom(); // "wobbleTime" ядра на клиенте

                const spawnedSeqVal = nextEggSpawnSeq++;
                eggs.push({
                    x: eggX,
                    y: startY,
                    type: eggType,
                    state: 'falling',
                    isStormEgg: (activeEvent === 'storm'),
                    gravityFlipped: gravityFlipped,
                    spawnSeq: spawnedSeqVal
                });
                logLines.push(`[Tick ${tick}] Spawned egg ${spawnedSeqVal} (${eggType}) at x=${eggX.toFixed(2)}, y=${startY}`);
            }
        }

        const basketX = (lastDir === 'LEFT') ? lastX + WOLF_WIDTH * 0.16 : lastX + WOLF_WIDTH * 0.84;
        const basketY = wolfY + 170 * 0.435 + 16;
        const basketRadius = 16 + upgrades.hitbox.lvl * 2;

        for (let i = eggs.length - 1; i >= 0; i--) {
            const egg = eggs[i];
            const eggFloorY = egg.gravityFlipped ? 40 : 460;

            let eggSpeed = 160 + (level - 1) * 15;
            eggSpeed = Math.min(420, eggSpeed);
            if (egg.type === 'overclock') eggSpeed *= 1.45;
            else if (egg.type === 'virus') eggSpeed *= 1.2;
            if (slowMotionTimer > 0) eggSpeed *= 0.5;

            if (freezeTimer <= 0) {
                egg.y += (egg.gravityFlipped ? -1 : 1) * eggSpeed * (dt / 1000);
            }

            if (egg.state === 'falling') {
                const verticalHit = Math.abs(egg.y - basketY) < 16;
                const horizontalHit = egg.x >= basketX - (basketRadius + 15) - 6 && egg.x <= basketX + (basketRadius + 15);
                if (verticalHit && horizontalHit) {
                    egg.state = 'caught';
                    let pts = 1;

                    const clientEv = clientEvents[egg.spawnSeq];
                    logLines.push(`[Tick ${tick}] Egg ${egg.spawnSeq} (${egg.type}) CAUGHT at y=${egg.y.toFixed(2)}, x=${egg.x.toFixed(2)}. BasketX=${basketX.toFixed(2)}. Client: ${clientEv ? clientEv.type.toUpperCase() : 'NONE'}`);

                    if (egg.type === 'slow') {
                        slowMotionTimer = upgrades.slow.base + (upgrades.slow.lvl - 1) * upgrades.slow.step;
                    } else if (egg.type === 'repair') {
                        const maxLives = upgrades.shield.base + (upgrades.shield.lvl - 1) * upgrades.shield.step;
                        lives++;
                        if (lives > maxLives) lives = maxLives;
                    } else if (egg.type === 'overclock') {
                        pts = 3;
                    } else if (egg.type === 'freeze') {
                        freezeTimer = 1.2;
                    } else if (egg.type === 'double') {
                        doublePointsTimer = 8.0;
                    } else if (egg.type === 'virus') {
                        lives--;
                        logLines.push(`[Tick ${tick}] Virus damage! Remaining lives: ${lives}`);
                        if (lives <= 0) {
                            logLines.push(`[Tick ${tick}] Game over (virus caught)`);
                            writeLogFile();
                            return { score, level, maxStreak, maxGoldenStreak, totalCores, standardCores };
                        }
                    }

                    if (egg.type !== 'virus') {
                        totalCores++;
                        if (doublePointsTimer > 0 || activeEvent === 'storm') pts *= 2;
                        score += pts;
                        scoreInCurrentLevel += pts;

                        if (egg.type === 'standard') {
                            standardCores++;
                            streakCounter++;
                            maxStreak = Math.max(maxStreak, streakCounter);
                        }
                        if (egg.type === 'double') {
                            goldenStreakCounter++;
                            maxGoldenStreak = Math.max(maxGoldenStreak, goldenStreakCounter);
                        } else {
                            goldenStreakCounter = 0;
                        }

                        if (scoreInCurrentLevel >= scoreNeededForNextLevel && !isDailyRun) {
                            level++;
                            logLines.push(`[Tick ${tick}] Level completed. Now level ${level}`);
                            scoreInCurrentLevel = 0;
                            scoreNeededForNextLevel = level * 10 + 5;
                            eggs = [];
                            break;
                        }
                    }
                } else {
                    const isMissed = egg.gravityFlipped ? (egg.y < basketY - 20) : (egg.y > basketY + 20);
                    if (isMissed) {
                        egg.state = 'missed';
                        const clientEv = clientEvents[egg.spawnSeq];
                        logLines.push(`[Tick ${tick}] Egg ${egg.spawnSeq} (${egg.type}) MISSED at y=${egg.y.toFixed(2)}, x=${egg.x.toFixed(2)}. BasketX=${basketX.toFixed(2)}. Client: ${clientEv ? clientEv.type.toUpperCase() : 'NONE'}`);
                        
                        if (egg.type !== 'virus' && !egg.isStormEgg) {
                            lives--;
                            streakCounter = 0;
                            logLines.push(`[Tick ${tick}] Life lost. Remaining lives: ${lives}`);
                            if (lives <= 0) {
                                logLines.push(`[Tick ${tick}] Game over (lives <= 0)`);
                                writeLogFile();
                                return { score, level, maxStreak, maxGoldenStreak, totalCores, standardCores };
                            }
                        }
                    }
                }
            }

            const reachedBoundary = egg.gravityFlipped ? (egg.y <= eggFloorY) : (egg.y >= eggFloorY);
            if (reachedBoundary || egg.state === 'caught') {
                eggs.splice(i, 1);
            }
        }
    }

    logLines.push(`Simulation ended. Score: ${score}, Level: ${level}, MaxStreak: ${maxStreak}`);
    writeLogFile();
    return { score, level, maxStreak, maxGoldenStreak, totalCores, standardCores };
}

const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = decodeURIComponent(parsedUrl.pathname);
    
    // Очистка префикса подпапки проксирования (например, /cybercatch/)
    if (pathname.startsWith('/cybercatch')) {
        pathname = pathname.substring('/cybercatch'.length);
        if (pathname === '') pathname = '/';
    }
    
    // API ЭНДПОИНТЫ
    
    // TerraSite прокси авторизации
    if (req.method === 'POST' && pathname === '/api/terrasite/auth/login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const response = await fetch('http://localhost:8000/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body
                });
                const resData = await response.json();
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resData));
            } catch (e) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка подключения к TerraSite.' }));
            }
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/terrasite/users/me') {
        const bodyToken = req.headers['authorization']?.startsWith('Bearer ') ? req.headers['authorization'].substring(7) : null;
        getValidAccessToken(req, res, bodyToken).then(async token => {
            if (!token) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Необходима авторизация.' }));
                return;
            }
            
            fetch('http://localhost:8000/api/users/me', {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(async response => {
                const resData = await response.json();
                // Backfill access_token in JSON response body so client updates its state
                resData.access_token = token;
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resData));
            })
            .catch(e => {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка подключения к TerraSite.' }));
            });
        });
        return;
    }

    // Покупка скинов и шлейфов строго на сервере
    if (req.method === 'POST' && pathname === '/api/user/buy') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { token, deviceId, itemType, itemId } = data;
                
                let finalName = null;
                const resolvedToken = await getValidAccessToken(req, res, token);
                if (resolvedToken) {
                    finalName = await getTerraSiteUsername(resolvedToken);
                }
                const profileId = resolvedToken ? finalName : `guest_${deviceId}`;
                if (!profileId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Неверные параметры.' }));
                    return;
                }
                
                const { profiles, profile } = getOrCreateProfile(profileId);
                
                let cost = 0;
                if (itemType === 'skin') {
                    if (!SKINS_METADATA[itemId]) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Скин не найден.' }));
                        return;
                    }
                    cost = SKINS_METADATA[itemId].cost;
                } else if (itemType === 'trail') {
                    if (!TRAILS_METADATA[itemId]) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Шлейф не найден.' }));
                        return;
                    }
                    cost = TRAILS_METADATA[itemId].cost;
                } else {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Неверный тип предмета.' }));
                    return;
                }
                
                if (profile.credits < cost) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Недостаточно кредитов CC!' }));
                    return;
                }
                
                profile.credits -= cost;
                
                // Достижение Big Spender
                const spent = (profile.achievements.big_spender.progress || 0) + cost;
                profile.achievements.big_spender.progress = spent;
                if (spent >= 2000) {
                    profile.achievements.big_spender.unlocked = true;
                }
                
                if (itemType === 'skin') {
                    if (!profile.unlockedSkins.includes(itemId)) {
                        profile.unlockedSkins.push(itemId);
                    }
                } else if (itemType === 'trail') {
                    if (!profile.unlockedTrails.includes(itemId)) {
                        profile.unlockedTrails.push(itemId);
                    }
                }
                
                saveProfileToDb(profileId, profile);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, profile }));
            } catch(e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка обработки покупки.' }));
            }
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/user/save') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { token, deviceId, selectedSkin, selectedTrail } = data;
                
                let finalName = null;
                const resolvedToken = await getValidAccessToken(req, res, token);
                if (resolvedToken) {
                    finalName = await getTerraSiteUsername(resolvedToken);
                }
                const profileId = resolvedToken ? finalName : `guest_${deviceId}`;
                if (!profileId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Неверный идентификатор.' }));
                    return;
                }
                
                const { profiles, profile } = getOrCreateProfile(profileId);
                
                profile.selectedSkin = selectedSkin || 'none';
                profile.selectedTrail = selectedTrail || 'none';
                profile.updatedAt = Date.now();
                
                saveProfileToDb(profileId, profile);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка сохранения данных профиля.' }));
            }
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/user/load') {
        const rawToken = parsedUrl.searchParams.get('token') || '';
        getValidAccessToken(req, res, rawToken).then(resolvedToken => {
            const deviceId = parsedUrl.searchParams.get('deviceId') || '';

            const respondWithProfile = (profileId) => {
                const { profiles, profile } = getOrCreateProfile(profileId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ username: profileId, profile }));
            };

            if (resolvedToken) {
                getTerraSiteUsername(resolvedToken).then(username => {
                    if (username) {
                        respondWithProfile(username);
                    } else if (deviceId) {
                        respondWithProfile(`guest_${deviceId}`);
                    } else {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Неавторизованный запрос.' }));
                    }
                }).catch(e => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Внутренняя ошибка сервера.' }));
                });
            } else if (deviceId) {
                respondWithProfile(`guest_${deviceId}`);
            } else {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Укажите token или deviceId.' }));
            }
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/music/list') {
        const musicDir = path.join(__dirname, '..', 'client', 'assets', 'music');
        if (!fs.existsSync(musicDir)) {
            fs.mkdirSync(musicDir, { recursive: true });
        }
        
        fs.readdir(musicDir, (err, files) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Не удалось прочитать музыкальную папку.' }));
                return;
            }
            const audioFiles = files.filter(file => {
                const ext = path.extname(file).toLowerCase();
                return ['.mp3', '.ogg', '.wav', '.m4a'].includes(ext);
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(audioFiles));
        });
        return;
    }

    if (req.method === 'GET' && pathname === '/api/config') {
        let hashQ = 0;
        const todayStrQ = new Date().toISOString().split('T')[0];
        for (let i = 0; i < todayStrQ.length; i++) {
            hashQ = todayStrQ.charCodeAt(i) + ((hashQ << 5) - hashQ);
        }
        const activeQuestIndex = Math.abs(hashQ) % 3;
        const questsList = [
            { desc: 'Соберите 100 стандартных ядер за день', target: 100, reward: 40, type: 'standard' },
            { desc: 'Соберите 120 ядер любого типа', target: 120, reward: 50, type: 'any' },
            { desc: 'Наберите 800 очков в игре за день', target: 800, reward: 60, type: 'score' }
        ];
        const activeQuest = questsList[activeQuestIndex];

        const config = {
            upgrades: UPGRADES_CONFIG,
            skins: SKINS_METADATA,
            trails: TRAILS_METADATA,
            achievements: ACHIEVEMENTS_CONFIG,
            dailyQuest: activeQuest
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        return;
    }

    // Сохранение и получение коротких ссылок реплеев
    if (req.method === 'POST' && pathname === '/api/replay/save') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const id = crypto.randomBytes(4).toString('hex'); // 8 символов
                
                db.prepare('INSERT INTO replays (id, data) VALUES (?, ?)').run(id, JSON.stringify(data));
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, id }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка сохранения реплея.' }));
            }
        });
        return;
    }
    
    if (req.method === 'GET' && pathname === '/api/replay/get') {
        const id = parsedUrl.searchParams.get('id') || '';
        
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Неверный идентификатор.' }));
            return;
        }

        try {
            const row = db.prepare('SELECT data FROM replays WHERE id = ?').get(id);
            if (row) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(row.data);
            } else {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Реплей не найден.' }));
            }
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Ошибка базы данных при поиске реплея.' }));
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/api/game/start') {
        // Создание сессии для новой игры
        const sessionId = crypto.randomBytes(16).toString('hex');
        sessions.set(sessionId, {
            id: sessionId,
            startTime: Date.now(),
            submitted: false
        });
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessionId }));
        return;
    }
    
    if (req.method === 'GET' && pathname === '/api/leaderboard') {
        const period = parsedUrl.searchParams.get('period') || 'all';
        const mode = parsedUrl.searchParams.get('mode') || 'standard';
        
        let filtered = leaderboard.filter(item => item.mode === mode);
        
        if (mode === 'daily') {
            const todayStr = new Date().toISOString().split('T')[0];
            filtered = filtered.filter(item => item.date === todayStr);
        } else {
            const now = Date.now();
            if (period === 'today') {
                filtered = filtered.filter(item => now - item.timestamp < 24 * 60 * 60 * 1000);
            } else if (period === 'week') {
                filtered = filtered.filter(item => now - item.timestamp < 7 * 24 * 60 * 60 * 1000);
            } else if (period === 'month') {
                filtered = filtered.filter(item => now - item.timestamp < 30 * 24 * 60 * 60 * 1000);
            }
        }
        
        // Сортировка по убыванию
        filtered.sort((a, b) => b.score - a.score);
        const top10 = filtered.slice(0, 10);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ leaderboard: top10 }));
        return;
    }
    
    if (req.method === 'GET' && pathname === '/api/season') {
        const msLeft = new Date(CURRENT_SEASON.endDate).getTime() - Date.now();
        const daysLeft = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            season: CURRENT_SEASON.number,
            daysLeft,
            endDate: CURRENT_SEASON.endDate
        }));
        return;
    }
    
    if (req.method === 'GET' && pathname === '/api/daily/quest') {
        const todayStr = new Date().toISOString().split('T')[0];
        let hash = 0;
        for (let i = 0; i < todayStr.length; i++) {
            hash = todayStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        const questIndex = Math.abs(hash) % 3;
        const quests = [
            { desc: 'Соберите 100 стандартных ядер за день', target: 100, reward: 40, type: 'standard' },
            { desc: 'Соберите 120 ядер любого типа', target: 120, reward: 50, type: 'any' },
            { desc: 'Наберите 800 очков в игре за день', target: 800, reward: 60, type: 'score' }
        ];
        const quest = quests[questIndex];
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(quest));
        return;
    }
    
    if (req.method === 'GET' && pathname === '/api/daily/seed') {
        const todayStr = new Date().toISOString().split('T')[0];
        const deviceId = parsedUrl.searchParams.get('deviceId') || '';
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        
        // Вычисление сида от даты
        let hash = 0;
        for (let i = 0; i < todayStr.length; i++) {
            hash = todayStr.charCodeAt(i) + ((hash << 5) - hash);
        }
        const seed = Math.abs(hash);
        
        // Проверка играл ли уже сегодня
        const hasPlayed = leaderboard.some(item => 
            item.mode === 'daily' && 
            item.date === todayStr && 
            (item.deviceId === deviceId || item.ip === ip)
        );
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ seed, date: todayStr, hasPlayed }));
        return;
    }
    
    if (req.method === 'POST' && pathname === '/api/game/submit') {
        // Публикация рекорда с защитой от накрутки
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { name, score, sessionId, signature, duration, mode, deviceId, token, replayId } = data;
                
                // 1. Проверка сессии
                if (!sessionId || !sessions.has(sessionId)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Сессия не найдена. Начните игру заново.' }));
                    return;
                }
                
                const session = sessions.get(sessionId);
                if (session.submitted) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Этот результат сессии уже был отправлен.' }));
                    return;
                }
                
                // Проверяем токен TerraSite
                let finalName = name;
                const resolvedToken = await getValidAccessToken(req, res, token);
                if (resolvedToken) {
                    const verifiedUsername = await getTerraSiteUsername(resolvedToken);
                    if (verifiedUsername) {
                        finalName = verifiedUsername;
                    }
                }
                
                // Проверки сигнатуры, лимита скорости и валидация симуляции отключены по запросу пользователя.
                // Оставляем только базовые сессионные проверки и логику Daily Run.

                const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                const todayStr = new Date().toISOString().split('T')[0];
                
                if (mode === 'daily') {
                    const alreadyPlayed = leaderboard.some(item => 
                        item.mode === 'daily' && 
                        item.date === todayStr && 
                        (item.deviceId === deviceId || item.ip === ip)
                    );
                    
                    if (alreadyPlayed) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Вы уже сыграли Daily Run сегодня!' }));
                        return;
                    }
                }
                
                session.submitted = true;
                let verifiedScore = parseInt(score);
                console.log(`[Validation Disabled] Trusting client score: ${verifiedScore} for session ${sessionId}`);

                // Пытаемся запустить симуляцию реплея в фоновом режиме для начисления прогресса квестов/достижений
                let replaySeedForSim;
                let replayInputsRaw;
                if (replayId) {
                    if (!/^[a-zA-Z0-9_-]+$/.test(replayId)) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Неверный формат ID реплея.' }));
                        return;
                    }
                    try {
                        const row = db.prepare('SELECT data FROM replays WHERE id = ?').get(replayId);
                        if (row) {
                            const savedReplay = JSON.parse(row.data);
                            replaySeedForSim = savedReplay.seed;
                            replayInputsRaw = savedReplay.inputs;
                        }
                    } catch (e) {
                        console.error('Ошибка чтения сохранённого реплея для фоновой симуляции:', e);
                    }
                }
                if (replaySeedForSim === undefined) replaySeedForSim = data.seed;
                if (!replayInputsRaw) replayInputsRaw = data.inputs;

                let sim = {
                    score: verifiedScore,
                    maxStreak: 0,
                    maxGoldenStreak: 0,
                    totalCores: 0,
                    standardCores: 0
                };

                if (replaySeedForSim !== undefined && replayInputsRaw) {
                    try {
                        const decodedInputs = decodeReplayServer(replayInputsRaw);
                        const simulated = simulateGame(replaySeedForSim, decodedInputs, mode === 'daily' ? 'daily' : 'standard', replayId);
                        if (simulated) {
                            sim = simulated;
                        }
                    } catch (err) {
                        console.error('Ошибка фоновой симуляции:', err);
                    }
                }
                
                // Получаем/создаем профиль
                const profileId = resolvedToken ? finalName : `guest_${deviceId}`;
                const { profiles, profile } = getOrCreateProfile(profileId);
                
                // Начисление CC (10 очков = 1 CC)
                const newCredits = Math.floor(verifiedScore / 10);
                profile.credits = (profile.credits || 0) + newCredits;

                // Личный рекорд
                profile.personalBest = Math.max(profile.personalBest || 0, verifiedScore);

                // Квест дня
                const todayQuestDate = new Date().toDateString();
                if (profile.questDate !== todayQuestDate) {
                    profile.questDate = todayQuestDate;
                    profile.questProgress = 0;
                    profile.questCompletedToday = false;
                }
                
                let hashQ = 0;
                const todayStrQ = new Date().toISOString().split('T')[0];
                for (let i = 0; i < todayStrQ.length; i++) {
                    hashQ = todayStrQ.charCodeAt(i) + ((hashQ << 5) - hashQ);
                }
                const activeQuestIndex = Math.abs(hashQ) % 3;
                const questsList = [
                    { desc: 'Соберите 100 стандартных ядер за день', target: 100, reward: 40, type: 'standard' },
                    { desc: 'Соберите 120 ядер любого типа', target: 120, reward: 50, type: 'any' },
                    { desc: 'Наберите 800 очков в игре за день', target: 800, reward: 60, type: 'score' }
                ];
                const activeQuest = questsList[activeQuestIndex];
                
                if (!profile.questCompletedToday) {
                    let earned = 0;
                    if (activeQuest.type === 'standard') earned = sim.standardCores;
                    else if (activeQuest.type === 'any') earned = sim.totalCores;
                    else if (activeQuest.type === 'score') earned = verifiedScore;
                    
                    profile.questProgress += earned;
                    if (profile.questProgress >= activeQuest.target) {
                        profile.questProgress = activeQuest.target;
                        profile.questCompletedToday = true;
                        profile.credits += activeQuest.reward;
                    }
                }
                
                // Ачивки
                const newlyUnlocked = [];
                const checkAndUnlock = (id, progress) => {
                    const ach = profile.achievements[id];
                    if (!ach.unlocked) {
                        ach.progress = Math.max(ach.progress || 0, progress);
                        let target = 0;
                        if (id === 'never_miss') target = 150;
                        else if (id === 'lucky_bastard') target = 3;
                        else if (id === 'cyber_god') target = 5000;
                        else if (id === 'data_grinder') target = 1000;
                        else if (id === 'hardcore_operator') target = 20;
                        else if (id === 'big_spender') target = 2000;
                        
                        if (target > 0 && ach.progress >= target) {
                            ach.unlocked = true;
                            newlyUnlocked.push(id);
                        }
                    }
                };
                
                checkAndUnlock('never_miss', sim.maxStreak);
                checkAndUnlock('lucky_bastard', sim.maxGoldenStreak);
                checkAndUnlock('cyber_god', verifiedScore);
                checkAndUnlock('data_grinder', (profile.achievements.data_grinder.progress || 0) + verifiedScore);
                
                const newGamesCount = (profile.achievements.hardcore_operator.progress || 0) + 1;
                checkAndUnlock('hardcore_operator', newGamesCount);
                
                saveProfileToDb(profileId, profile);
                
                // Фильтрация имени от спецсимволов и ограничение до 12 символов
                const cleanName = finalName.substring(0, 12).toUpperCase().replace(/[^A-ZА-Я0-9_ -]/g, '') || 'ANON';
                const scoreMode = mode === 'daily' ? 'daily' : 'standard';
                
                try {
                    // Ищем существующую запись для этого игрока и режима в БД
                    const existing = db.prepare('SELECT id, score FROM leaderboard WHERE UPPER(name) = ? AND mode = ?').get(cleanName.trim().toUpperCase(), scoreMode);

                    if (existing) {
                        // Переписываем запись только если новый счёт лучше
                        if (verifiedScore > existing.score) {
                            db.prepare(`
                                UPDATE leaderboard 
                                SET score = ?, timestamp = ?, date = ?, deviceId = ?, ip = ?, replayId = ?
                                WHERE id = ?
                            `).run(verifiedScore, Date.now(), todayStr, deviceId || 'unknown', ip, replayId || null, existing.id);
                        }
                    } else {
                        // Добавление рекорда в БД
                        db.prepare(`
                            INSERT INTO leaderboard (name, score, timestamp, date, mode, deviceId, ip, replayId)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(cleanName, verifiedScore, Date.now(), todayStr, scoreMode, deviceId || 'unknown', ip, replayId || null);
                    }

                    // Ограничиваем общий размер таблицы 2000 записей
                    db.exec(`
                        DELETE FROM leaderboard 
                        WHERE id NOT IN (
                            SELECT id FROM leaderboard 
                            ORDER BY score DESC, timestamp ASC 
                            LIMIT 2000
                        )
                    `);

                    // Перезагружаем кэш рекордов
                    leaderboard = db.prepare('SELECT name, score, timestamp, date, mode, deviceId, ip, replayId FROM leaderboard ORDER BY score DESC, timestamp ASC').all();
                } catch (e) {
                    console.error('Ошибка записи рекорда в БД:', e);
                }
                
                // Возвращаем отфильтрованный топ-10 для клиента
                let clientLeaderboard = leaderboard.filter(item => item.mode === (mode === 'daily' ? 'daily' : 'standard'));
                if (mode === 'daily') {
                    clientLeaderboard = clientLeaderboard.filter(item => item.date === todayStr);
                } else {
                    // по умолчанию отдаем all-time
                    clientLeaderboard = clientLeaderboard;
                }
                clientLeaderboard = clientLeaderboard.slice(0, 10);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    leaderboard: clientLeaderboard,
                    verifiedScore,
                    credits: profile.credits,
                    creditsEarned: newCredits,
                    personalBest: profile.personalBest,
                    achievements: profile.achievements,
                    questProgress: profile.questProgress,
                    questCompleted: profile.questCompletedToday,
                    newlyUnlocked
                }));
                
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Ошибка обработки данных.' }));
            }
        });
        return;
    }
    
    // РАЗДАЧА СТАТИЧЕСКИХ ФАЙЛОВ
    const clientDir = path.resolve(__dirname, '..', 'client');
    let filePath = path.join(clientDir, pathname === '/' ? 'index.html' : pathname);
    filePath = filePath.split('?')[0].split('#')[0];
    
    // Предотвращение Directory Traversal (выход за пределы папки client)
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(clientDir)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden: Path traversal detected.');
        return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('404 Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 
                'Content-Type': contentType,
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(content);
        }
    });
});

if (require.main === module) {
    server.listen(PORT, HOST, () => {
        console.log(`[CyberCatch Server] Запущен на http://${HOST}:${PORT}/`);
    });
} else {
    module.exports = { simulateGame, UPGRADES_CONFIG };
}
