import { upgrades, achievements, dailyQuest, images } from './config.js';

export const state = {
    // Assets
    images,
    
    // Core game state
    gameState: 'START', // START, PLAYING, SHOP, PAUSED, GAMEOVER, CUSTOMIZE
    score: 0,
    lives: 3,
    level: 1,
    upgradePoints: 0,
    scoreInCurrentLevel: 0,
    scoreNeededForNextLevel: 15,
    slowMotionTimer: 0,
    freezeTimer: 0,
    doublePointsTimer: 0,
    
    // Upgrades config
    upgrades,
    
    // Player / Wolf state
    wolf: {
        x: 380,
        y: 290,
        width: 206,
        height: 170,
        speed: 650,
        direction: 'RIGHT'
    },
    
    // Arrays
    eggs: [],
    particles: [],
    catchFlashes: [],
    coreLeaks: [],
    
    // Event Manager states
    activeEvent: null,
    eventTimer: 0,
    eventIntervalTimer: 0,
    screenShakeActive: false,
    lasers: [],
    lastLaserTime: 0,
    controlInverted: false,
    gravityFlipped: false,
    livesLostInCurrentStorm: 0,
    upcomingEvent: null,
    eventWarningTimer: 0,
    
    // Achievements & Quest
    achievements,
    streakCounter: 0,
    goldenStreakCounter: 0,
    dailyQuest,
    isDisplayingToast: false,
    achievementToastQueue: [],
    
    // Twitch states
    twitchSocket: null,
    twitchConnected: false,
    twitchCooldowns: {},
    
    // Replay states
    isReplayPlayback: false,
    replaySeed: 0,
    replayInputs: [],
    replayIndex: 0,
    replayStartMs: 0,
    replaySpeed: 1,
    replayDurationMs: 0,
    sessionStartTime: 0,
    sessionId: null,
    nextEggSpawnSeq: 0,
    
    // Daily Run
    isDailyRun: false,
    dailySeed: 0,
    
    // Diagnostics / device
    deviceId: null,
    
    // Cosmetics Shop / customization
    selectedSkin: 'none',
    selectedTrail: 'none',
    previewSkin: 'none',
    previewTrail: 'none',
    unlockedSkins: ['none'],
    unlockedTrails: ['none'],
    currentSkinFilter: 'all',
    
    // TerraSite auth
    terraSiteToken: null,
    terraSiteUser: null,
    cyberCredits: 0,
    personalBest: 0,
    
    // Sandevistan & preview loop
    sandevistanSpawnTimer: 0,
    previewAnimId: null,
    
    // Timings
    playTime: 0,
    accumulator: 0,
    spawnTimer: 0,
    baseSpawnInterval: 1800,
    speedMultiplier: 1.0,
    lastTime: 0,
    targetX: null,
    newClickTargetX: null,
    showColliders: false
};
