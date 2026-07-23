import { state } from './state.js';
import { SKINS, TRAILS } from './config.js';
import { RainShader } from './rain.js';

let rainShader = null;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

// Кэш переиспользуемых оффскрин-канвасов для эффектов скинов/следов.
// Раньше drawRetroWolf/drawHoloWolf/ghost-clone создавали новый <canvas>
// через document.createElement на КАЖДОМ кадре (до 60 раз в секунду), что
// давало постоянную нагрузку на GC — переиспользуем один и тот же элемент.
const offscreenCanvasCache = {};
function getOffscreenCanvas(key, w, h) {
    let entry = offscreenCanvasCache[key];
    if (!entry) {
        const canvasEl = document.createElement('canvas');
        entry = { canvas: canvasEl, ctx: canvasEl.getContext('2d') };
        offscreenCanvasCache[key] = entry;
    }
    if (entry.canvas.width !== w || entry.canvas.height !== h) {
        entry.canvas.width = w;
        entry.canvas.height = h;
    } else {
        entry.ctx.clearRect(0, 0, w, h);
    }
    return entry;
}

// Тонированный клон-волк для следа "Sandevistan" не меняется от кадра к
// кадру (тот же спрайт, тот же оттенок), поэтому вычисляем его один раз и
// переиспользуем для ВСЕХ активных клонов вместо пересоздания канваса на
// каждую частицу на каждом кадре.
let ghostCloneCanvasCache = null;
function getGhostCloneCanvas(img, w, h) {
    if (!ghostCloneCanvasCache || ghostCloneCanvasCache.img !== img || ghostCloneCanvasCache.w !== w || ghostCloneCanvasCache.h !== h) {
        const canvasEl = document.createElement('canvas');
        canvasEl.width = w;
        canvasEl.height = h;
        const cctx = canvasEl.getContext('2d');
        cctx.drawImage(img, 0, 0, w, h);
        cctx.save();
        cctx.globalCompositeOperation = 'source-atop';
        cctx.fillStyle = '#00f0ff';
        cctx.globalAlpha = 0.55;
        cctx.fillRect(0, 0, w, h);
        cctx.restore();
        ghostCloneCanvasCache = { img, w, h, canvas: canvasEl };
    }
    return ghostCloneCanvasCache.canvas;
}

// Отрисовка процедурной сетки пола и горизонта
export function drawProceduralBackdrop(ctx) {
    const width = canvas.width;
    const height = canvas.height;
    
    ctx.save();
    const horizon = 220;
    
    // Сетка
    for (let y = horizon; y < height; y += 15) {
        const ratio = (y - horizon) / (height - horizon);
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.01 + ratio * 0.12})`;
        ctx.lineWidth = 1 + ratio * 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }
    
    const vanishingX = width / 2;
    for (let x = -width; x < width * 2; x += 50) {
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(vanishingX, horizon);
        ctx.stroke();
    }
    ctx.restore();
    
    // Силуэт города
    ctx.save();
    ctx.fillStyle = 'rgba(6, 4, 18, 0.85)';
    ctx.fillRect(0, horizon - 40, width, 40);
    ctx.restore();
}

// Рендеринг процедурного волка
export function drawProceduralWolf(ctx) {
    const isLeft = state.wolf.direction === 'LEFT';
    const x = state.wolf.x;
    const y = state.wolf.y;
    
    const skinData = (SKINS && SKINS[state.selectedSkin]) || (SKINS && SKINS.classic) || { color: '#ffffff', type: 'none' };
    const skinColor = skinData.color;
    
    // 1. Корпус
    ctx.save();
    ctx.lineWidth = 2.5;
    
    let xOffset = 0;
    let yOffset = 0;
    if (state.selectedSkin === 'glitch') {
        xOffset = (Math.random() - 0.5) * 4;
        yOffset = (Math.random() - 0.5) * 4;
        ctx.strokeStyle = Math.random() > 0.5 ? '#ff007f' : '#00f0ff';
    } else {
        ctx.strokeStyle = skinColor;
    }
    
    ctx.fillStyle = '#0f0c24';
    ctx.shadowBlur = 12;
    ctx.shadowColor = skinColor;
    
    ctx.beginPath();
    ctx.moveTo(x + state.wolf.width * 0.34 + xOffset, y + 40 + yOffset);
    ctx.lineTo(x + state.wolf.width * 0.66 + xOffset, y + 40 + yOffset);
    ctx.lineTo(x + state.wolf.width * 0.60 + xOffset, y + 115 + yOffset);
    ctx.lineTo(x + state.wolf.width * 0.40 + xOffset, y + 115 + yOffset);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Реактор
    ctx.beginPath();
    ctx.arc(x + state.wolf.width * 0.5 + xOffset, y + 75 + yOffset, 7, 0, Math.PI * 2);
    ctx.fillStyle = state.selectedSkin === 'classic' ? '#ff007f' : '#ffffff';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();
    
    // 2. Голова
    ctx.save();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = state.selectedSkin === 'glitch' ? (Math.random() > 0.5 ? '#00f0ff' : '#ff007f') : skinColor;
    ctx.fillStyle = '#0f0c24';
    ctx.shadowBlur = 12;
    ctx.shadowColor = skinColor;
    
    ctx.beginPath();
    if (isLeft) {
        ctx.moveTo(x + state.wolf.width * 0.45 + xOffset, y + 40 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.25 + xOffset, y + 20 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.32 + xOffset, y + 3 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.52 + xOffset, y + 12 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.55 + xOffset, y + 40 + yOffset);
    } else {
        ctx.moveTo(x + state.wolf.width * 0.55 + xOffset, y + 40 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.75 + xOffset, y + 20 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.68 + xOffset, y + 3 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.48 + xOffset, y + 12 + yOffset);
        ctx.lineTo(x + state.wolf.width * 0.45 + xOffset, y + 40 + yOffset);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

// Отрисовка корзины поверх спрайта с динамическим радиусом
export function drawCatcherBasket(ctx) {
    // Вспомогательный хитбокс больше не отображается на экране
}

// Логика отрисовки Волка
export function drawWolf(ctx) {
    let img = null;
    if (state.images.wolf.loaded && state.images.wolf.element) {
        img = state.images.wolf.element;
    }
    
    const skinData = (SKINS && SKINS[state.selectedSkin]) || (SKINS && SKINS.classic) || { color: '#ffffff', type: 'none' };
    const skinColor = skinData.color;
    
    const rx = Math.round(state.wolf.x);
    const ry = Math.round(state.wolf.y);
    const rw = Math.round(state.wolf.width);
    const rh = Math.round(state.wolf.height);
    
    if (img) {
        if (skinData.type === 'none') {
            ctx.save();
            if (state.wolf.direction === 'LEFT') {
                ctx.translate(rx + rw / 2, 0);
                ctx.scale(-1, 1);
                ctx.translate(-(rx + rw / 2), 0);
            }
            ctx.drawImage(img, rx, ry, rw, rh);
            ctx.restore();
        } else if (skinData.type === 'outline') {
            ctx.save();
            if (state.wolf.direction === 'LEFT') {
                ctx.translate(rx + rw / 2, 0);
                ctx.scale(-1, 1);
                ctx.translate(-(rx + rw / 2), 0);
            }
            ctx.shadowColor = skinColor;
            ctx.shadowBlur = 15;
            ctx.drawImage(img, rx, ry, rw, rh);
            ctx.restore();
        } else if (skinData.type === 'glitch') {
            drawGlitchWolf(ctx, img, rx, ry, rw, rh, state.wolf.direction);
        } else if (skinData.type === 'retro') {
            drawRetroWolf(ctx, img, rx, ry, rw, rh, state.wolf.direction);
        } else if (skinData.type === 'holo') {
            drawHoloWolf(ctx, img, rx, ry, rw, rh, state.wolf.direction);
        }
        
        drawCatcherBasket(ctx);
    } else {
        drawProceduralWolf(ctx);
        drawCatcherBasket(ctx);
    }
}

// Эффект 1: Глитч-волк (RGB-сдвиг и горизонтальные смещения слоев)
export function drawGlitchWolf(ctx, img, x, y, w, h, direction) {
    const time = Date.now();
    const isGlitching = Math.sin(time * 0.05) > 0.65;
    
    ctx.save();
    if (direction === 'LEFT') {
        ctx.translate(x + w / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + w / 2), 0);
    }
    
    if (!isGlitching) {
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 12;
        ctx.drawImage(img, x, y, w, h);
        ctx.restore();
        return;
    }
    
    const slices = 6;
    const sliceH = h / slices;
    for (let i = 0; i < slices; i++) {
        const offset = (Math.random() - 0.5) * 14;
        const sy = i * sliceH;
        ctx.drawImage(img, 0, (sy / h) * img.height, img.width, img.height / slices, x + offset, y + sy, w, sliceH);
    }
    ctx.restore();
}

// Эффект 2: Ретро-волк (Синтвейв окантовка и сканирующий лазерный луч)
export function drawRetroWolf(ctx, img, x, y, w, h, direction) {
    const { canvas: offCanvas, ctx: offCtx } = getOffscreenCanvas(`retro-${w}x${h}`, w, h);
    offCtx.drawImage(img, 0, 0, w, h);
    
    offCtx.save();
    offCtx.globalCompositeOperation = 'source-atop';
    
    offCtx.strokeStyle = 'rgba(255, 0, 127, 0.45)';
    offCtx.lineWidth = 1.5;
    for (let sy = 0; sy < h; sy += 5) {
        offCtx.beginPath();
        offCtx.moveTo(0, sy);
        offCtx.lineTo(w, sy);
        offCtx.stroke();
    }
    
    const scanY = (Date.now() / 12) % (h * 2) - h;
    if (scanY > 0 && scanY < h) {
        offCtx.fillStyle = 'rgba(255, 0, 127, 0.3)';
        offCtx.fillRect(0, scanY, w, 6);
    }
    offCtx.restore();
    
    ctx.save();
    if (direction === 'LEFT') {
        ctx.translate(x + w / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + w / 2), 0);
    }
    ctx.shadowColor = '#ff007f';
    ctx.shadowBlur = 12;
    ctx.drawImage(offCanvas, x, y);
    ctx.restore();
}

// Эффект 3: Матричный голографический волк
export function drawHoloWolf(ctx, img, x, y, w, h, direction) {
    const { canvas: offCanvas, ctx: offCtx } = getOffscreenCanvas(`holo-${w}x${h}`, w, h);
    offCtx.drawImage(img, 0, 0, w, h);
    
    offCtx.save();
    offCtx.globalCompositeOperation = 'source-atop';
    
    offCtx.fillStyle = '#00f0ff';
    offCtx.globalAlpha = 0.22;
    offCtx.fillRect(0, 0, w, h);
    
    offCtx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
    offCtx.lineWidth = 1.2;
    for (let sy = 0; sy < h; sy += 4) {
        offCtx.beginPath();
        offCtx.moveTo(0, sy);
        offCtx.lineTo(w, sy);
        offCtx.stroke();
    }
    offCtx.restore();
    
    ctx.save();
    if (direction === 'LEFT') {
        ctx.translate(x + w / 2, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + w / 2), 0);
    }
    ctx.shadowColor = '#00f0ff';
    ctx.shadowBlur = 12;
    ctx.drawImage(offCanvas, x, y);
    ctx.restore();
}

// Рисование шлейфа (трейла) яйца (градиентный волюметрический шлейф)
function drawEggTrail(ctx, egg, color) {
    const trailLength = 170; // 170px — чуть больше трети экрана (450px)
    const tailYOffset = egg.gravityFlipped ? -trailLength : trailLength;
    const tipY = egg.y - tailYOffset;
    
    // Вспомогательная функция для конвертации HEX в RGBA
    const hexToRgba = (hex, alpha) => {
        if (hex.startsWith('#')) {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        return hex;
    };
    
    ctx.save();
    
    // 1. Внешнее широкое неоновое свечение (ширина 32px в начале, на всю ширину яйца)
    const grad1 = ctx.createLinearGradient(egg.x, egg.y, egg.x, tipY);
    grad1.addColorStop(0, hexToRgba(color, 0.16));
    grad1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.beginPath();
    ctx.moveTo(egg.x - 16, egg.y);
    ctx.lineTo(egg.x + 16, egg.y);
    ctx.lineTo(egg.x, tipY);
    ctx.closePath();
    ctx.fillStyle = grad1;
    ctx.fill();
    
    // 2. Средний пучок свечения (ширина 16px в начале)
    const grad2 = ctx.createLinearGradient(egg.x, egg.y, egg.x, tipY);
    grad2.addColorStop(0, hexToRgba(color, 0.38));
    grad2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    
    ctx.beginPath();
    ctx.moveTo(egg.x - 8, egg.y);
    ctx.lineTo(egg.x + 8, egg.y);
    ctx.lineTo(egg.x, tipY);
    ctx.closePath();
    ctx.fillStyle = grad2;
    ctx.fill();
    
    // 3. Белое ядро шлейфа (ширина 6px в начале)
    const grad3 = ctx.createLinearGradient(egg.x, egg.y, egg.x, tipY);
    grad3.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
    grad3.addColorStop(1, 'rgba(255, 255, 255, 0)');
    
    ctx.beginPath();
    ctx.moveTo(egg.x - 3, egg.y);
    ctx.lineTo(egg.x + 3, egg.y);
    ctx.lineTo(egg.x, tipY);
    ctx.closePath();
    ctx.fillStyle = grad3;
    ctx.fill();
    
    ctx.restore();
}

// Отрисовка Яйца (Cyber Core)
export function drawEgg(ctx, egg) {
    const radius = 16;
    
    let color;
    if (egg.type === 'standard') {
        color = egg.x < canvas.width / 2 ? '#00f0ff' : '#ff007f';
    } else if (egg.type === 'slow') {
        color = '#ffde00';
    } else if (egg.type === 'repair') {
        color = '#39ff14';
    } else if (egg.type === 'freeze') {
        color = '#70d8ff';
    } else if (egg.type === 'double') {
        color = '#ff6a00';
    } else if (egg.type === 'virus') {
        color = '#39ff14';
    } else {
        color = '#bd00ff';
    }
    
    // Отрисовываем неоновый трейл за яйцом перед рисованием самого яйца
    drawEggTrail(ctx, egg, color);
    
    ctx.save();
    
    let renderX = egg.x;
    let renderY = egg.y;
    
    if (egg.type === 'overclock' || egg.type === 'virus') {
        renderX += (Math.random() - 0.5) * 4;
        renderY += (Math.random() - 0.5) * 4;
    }
    
    ctx.translate(renderX, renderY);
    ctx.rotate(egg.angle);
    
    if (state.images.egg.loaded && state.images.egg.element) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        
        const aspect = state.images.egg.element.width / state.images.egg.element.height;
        const eggWidth = radius * 2 * aspect;
        
        ctx.drawImage(state.images.egg.element, -eggWidth / 2, -radius, eggWidth, radius * 2);
    } else {
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 0.85, radius * 1.1, 0, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -radius * 1.1);
        ctx.lineTo(0, radius * 1.1);
        ctx.moveTo(-radius * 0.85, 0);
        ctx.lineTo(radius * 0.85, 0);
        ctx.stroke();
        
        if (egg.type === 'repair') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(-6, 0); ctx.lineTo(6, 0);
            ctx.moveTo(0, -6); ctx.lineTo(0, 6);
            ctx.stroke();
        } else if (egg.type === 'slow') {
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffde00';
            ctx.fill();
        } else if (egg.type === 'freeze') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -6); ctx.lineTo(5, 0); ctx.lineTo(0, 6); ctx.lineTo(-5, 0);
            ctx.closePath();
            ctx.stroke();
        } else if (egg.type === 'double') {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px "Share Tech Mono"';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('x2', 0, 0);
            ctx.stroke();
        } else if (egg.type === 'overclock') {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(0, -7);
            ctx.lineTo(-6, 4);
            ctx.lineTo(6, 4);
            ctx.closePath();
            ctx.fill();
        } else if (egg.type === 'virus') {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(-6, -6); ctx.lineTo(6, 6);
            ctx.moveTo(6, -6); ctx.lineTo(-6, 6);
            ctx.stroke();
        } else {
            ctx.beginPath();
            ctx.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 6;
            ctx.fill();
        }
    }
    
    // Ауры
    if (egg.type === 'slow') {
        ctx.strokeStyle = 'rgba(255, 222, 0, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.5, 0, Math.PI * 2);
        ctx.stroke();
    } else if (egg.type === 'overclock') {
        ctx.strokeStyle = 'rgba(189, 0, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.3, radius * 0.7, Math.PI/4, 0, Math.PI * 2);
        ctx.stroke();
    } else if (egg.type === 'freeze') {
        ctx.strokeStyle = 'rgba(112, 216, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.4, 0, Math.PI * 2);
        ctx.stroke();
    } else if (egg.type === 'double') {
        ctx.strokeStyle = 'rgba(255, 106, 0, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.4, 0, Math.PI * 2);
        ctx.stroke();
    } else if (egg.type === 'virus') {
        ctx.strokeStyle = 'rgba(57, 255, 20, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 1.4, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();
}

// Отрисовка превью волка в окне кастомизации
export function drawPreview(skinId, trailId) {
    const previewCanvas = document.getElementById('previewCanvas');
    if (!previewCanvas) return;
    const pctx = previewCanvas.getContext('2d');
    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    
    pctx.save();
    
    const prevWolf = {
        x: previewCanvas.width / 2 - 135,
        y: previewCanvas.height / 2 - 94,
        width: 270,
        height: 189,
        direction: 'RIGHT'
    };
    
    const skinData = (SKINS && SKINS[skinId]) || (SKINS && SKINS.none) || { color: '#ffffff', type: 'none' };
    const skinColor = skinData.color;
    
    let img = null;
    if (state.images.wolf.loaded && state.images.wolf.element) {
        img = state.images.wolf.element;
    }
    
    if (trailId === 'sandevistan') {
        pctx.save();
        pctx.globalAlpha = 0.35;
        if (img) {
            const cloneCanvas = getGhostCloneCanvas(img, prevWolf.width, prevWolf.height);

            pctx.shadowColor = '#00f0ff';
            pctx.shadowBlur = 6;
            pctx.drawImage(cloneCanvas, prevWolf.x - 45, prevWolf.y);
        } else {
            pctx.fillStyle = 'rgba(0, 240, 255, 0.2)';
            pctx.fillRect(prevWolf.x - 45, prevWolf.y, prevWolf.width, prevWolf.height);
        }
        pctx.restore();
    }
    
    if (img) {
        if (skinData.type === 'none') {
            pctx.save();
            pctx.drawImage(img, prevWolf.x, prevWolf.y, prevWolf.width, prevWolf.height);
            pctx.restore();
        } else if (skinData.type === 'outline') {
            pctx.save();
            pctx.shadowColor = skinColor;
            pctx.shadowBlur = 10;
            pctx.drawImage(img, prevWolf.x, prevWolf.y, prevWolf.width, prevWolf.height);
            pctx.restore();
        } else if (skinData.type === 'glitch') {
            drawGlitchWolf(pctx, img, prevWolf.x, prevWolf.y, prevWolf.width, prevWolf.height, prevWolf.direction);
        } else if (skinData.type === 'retro') {
            drawRetroWolf(pctx, img, prevWolf.x, prevWolf.y, prevWolf.width, prevWolf.height, prevWolf.direction);
        } else if (skinData.type === 'holo') {
            drawHoloWolf(pctx, img, prevWolf.x, prevWolf.y, prevWolf.width, prevWolf.height, prevWolf.direction);
        }
    } else {
        pctx.save();
        pctx.lineWidth = 1.8;
        pctx.strokeStyle = skinColor;
        pctx.fillStyle = '#0f0c24';
        pctx.shadowBlur = 8;
        pctx.shadowColor = skinColor;
        pctx.beginPath();
        pctx.moveTo(prevWolf.x + prevWolf.width * 0.34, prevWolf.y + 30);
        pctx.lineTo(prevWolf.x + prevWolf.width * 0.66, prevWolf.y + 30);
        pctx.lineTo(prevWolf.x + prevWolf.width * 0.60, prevWolf.y + 82);
        pctx.lineTo(prevWolf.x + prevWolf.width * 0.40, prevWolf.y + 82);
        pctx.closePath();
        pctx.fill();
        pctx.stroke();
        pctx.restore();
    }
    
    if (trailId === 'binary') {
        pctx.save();
        pctx.fillStyle = 'rgba(57, 255, 20, 0.7)';
        pctx.font = '10px "Share Tech Mono"';
        pctx.fillText('0101', prevWolf.x - 30, prevWolf.y + 40);
        pctx.fillText('1010', prevWolf.x - 22, prevWolf.y + 65);
        pctx.restore();
    } else if (trailId === 'sparks') {
        pctx.save();
        pctx.fillStyle = 'rgba(255, 0, 127, 0.7)';
        pctx.fillRect(prevWolf.x - 22, prevWolf.y + 30, 4, 4);
        pctx.fillRect(prevWolf.x - 38, prevWolf.y + 52, 3, 3);
        pctx.fillRect(prevWolf.x - 15, prevWolf.y + 68, 4, 4);
        pctx.restore();
    } else if (trailId === 'rain') {
        pctx.save();
        pctx.strokeStyle = 'rgba(0, 240, 255, 0.6)';
        pctx.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) {
            const dx = prevWolf.x - 15 + Math.random() * 45;
            const dy = prevWolf.y + 30 + Math.random() * 60;
            pctx.beginPath();
            pctx.moveTo(dx, dy);
            pctx.lineTo(dx, dy + 9);
            pctx.stroke();
        }
        pctx.restore();
    } else if (trailId === 'rainbow') {
        pctx.save();
        for (let i = 0; i < 5; i++) {
            const hue = (Date.now() / 4 + i * 60) % 360;
            pctx.fillStyle = `hsla(${hue}, 100%, 65%, 0.7)`;
            pctx.fillRect(prevWolf.x - 22 + Math.random() * 38, prevWolf.y + 22 + Math.random() * 68, 4, 4);
        }
        pctx.restore();
    }
    pctx.restore();
}

// Главный рендер кадра
export function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Фон
    if (state.images.background.loaded && state.images.background.element) {
        ctx.drawImage(state.images.background.element, 0, 0, canvas.width, canvas.height);
    } else {
        drawProceduralBackdrop(ctx);
    }
    
    // WebGL шейдер дождя поверх бэкграунда
    if (!rainShader && canvas) {
        rainShader = new RainShader(canvas);
    }
    if (rainShader) {
        rainShader.update();
        rainShader.draw();
        ctx.drawImage(rainShader.getCanvas(), 0, 0);
    }
    
    // Рисуем верхнюю линию интерфейса
    if (state.images.background.loaded && state.images.background.element) {
        ctx.save();
        ctx.strokeStyle = '#ff007f';
        ctx.shadowColor = '#ff007f';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(50, 40);
        ctx.lineTo(910, 40);
        ctx.stroke();
        ctx.restore();
    }
    
    let hudY = 75;
    
    // Предупреждения об ивенте
    if (state.upcomingEvent !== null) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 49, 49, 0.15)';
        ctx.fillRect(0, 40, canvas.width, 30);
        ctx.strokeStyle = '#ff3131';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 40); ctx.lineTo(canvas.width, 40);
        ctx.moveTo(0, 70); ctx.lineTo(canvas.width, 70);
        ctx.stroke();
        
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillStyle = '#ff3131';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff3131';
        ctx.shadowBlur = 8;
        
        let nameRu = '';
        if (state.upcomingEvent === 'storm') nameRu = 'ИНФОРМАЦИОННЫЙ ШТОРМ';
        else if (state.upcomingEvent === 'blackout') nameRu = 'СБОЙ ЭНЕРГОСЕТИ';
        else if (state.upcomingEvent === 'virus') nameRu = 'ВИРУСНАЯ АТАКА';
        else if (state.upcomingEvent === 'shift') nameRu = 'КВАНТОВЫЙ СДВИГ';
        else if (state.upcomingEvent === 'laser') nameRu = 'ХАКЕРСКАЯ АТАКА';
        else if (state.upcomingEvent === 'gravity') nameRu = 'ГРАВИТАЦИОННЫЙ СДВИГ';
        
        ctx.fillText(`⚠️ ВНИМАНИЕ: ЗАПУСК [${nameRu}] ЧЕРЕЗ ${state.eventWarningTimer.toFixed(1)}с ⚠️`, canvas.width / 2, 59);
        ctx.restore();
        hudY = 95;
    }
    
    // Активное событие
    if (state.activeEvent) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 0, 127, 0.15)';
        ctx.fillRect(0, 40, canvas.width, 30);
        ctx.strokeStyle = '#ff007f';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 40); ctx.lineTo(canvas.width, 40);
        ctx.moveTo(0, 70); ctx.lineTo(canvas.width, 70);
        ctx.stroke();
        
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillStyle = '#ff007f';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff007f';
        ctx.shadowBlur = 8;
        
        let eventLabel = '';
        if (state.activeEvent === 'storm') eventLabel = 'ВНИМАНИЕ: ИНФОРМАЦИОННЫЙ ШТОРМ (УДВОЕНИЕ ОЧКОВ)';
        else if (state.activeEvent === 'blackout') eventLabel = 'ВНИМАНИЕ: АВАРИЯ ЭНЕРГОСИСТЕМЫ - ОСВЕЩЕНИЕ ОТКЛЮЧЕНО';
        else if (state.activeEvent === 'virus') eventLabel = 'УГРОЗА БЕЗОПАСНОСТИ: ВИРУСНАЯ АТАКА - ИЗБЕГАЙТЕ ЗЕЛЕНЫХ ВИРУСОВ';
        else if (state.activeEvent === 'shift') eventLabel = 'ОШИБКА: КВАНТОВЫЙ СДВИГ - УПРАВЛЕНИЕ ИНВЕРТИРОВАНО';
        else if (state.activeEvent === 'laser') eventLabel = 'ТРЕВОГА: ХАКЕРСКАЯ АТАКА - ИЗБЕГАЙТЕ ЛАЗЕРНЫХ ЛУЧЕЙ';
        else if (state.activeEvent === 'gravity') eventLabel = 'ГРАВИТАЦИОННАЯ АНОМАЛИЯ - ЯДРА ЛЕТЯТ СНИЗУ ВВЕРХ';
        
        ctx.fillText(`[ ${eventLabel} // ТАЙМЕР: ${state.eventTimer.toFixed(1)}с ]`, canvas.width / 2, 59);
        ctx.restore();
        hudY = 95;
    }
    
    if (state.slowMotionTimer > 0 && state.activeEvent !== 'storm') {
        ctx.save();
        ctx.font = 'bold 14px "Share Tech Mono"';
        ctx.fillStyle = '#ffde00';
        ctx.shadowColor = '#ffde00';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.fillText(`[ ВРЕМЕННАЯ АНОМАЛИЯ // ЗАМЕДЛЕНИЕ: ${state.slowMotionTimer.toFixed(1)}с ]`, canvas.width / 2, hudY);
        ctx.restore();
        hudY += 22;
    }
    if (state.doublePointsTimer > 0 && state.activeEvent !== 'storm') {
        ctx.save();
        ctx.font = 'bold 14px "Share Tech Mono"';
        ctx.fillStyle = '#ff6a00';
        ctx.shadowColor = '#ff6a00';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.fillText(`[ DOUBLE_DATA // УДВОЕНИЕ: ${state.doublePointsTimer.toFixed(1)}с ]`, canvas.width / 2, hudY);
        ctx.restore();
        hudY += 22;
    }
    if (state.freezeTimer > 0) {
        ctx.save();
        ctx.font = 'bold 14px "Share Tech Mono"';
        ctx.fillStyle = '#70d8ff';
        ctx.shadowColor = '#70d8ff';
        ctx.shadowBlur = 10;
        ctx.textAlign = 'center';
        ctx.fillText(`[ CRITICAL_FREEZE // ЗАМОРОЗКА: ${state.freezeTimer.toFixed(1)}с ]`, canvas.width / 2, hudY);
        ctx.restore();
    }
    
    if (state.isDailyRun) {
        ctx.save();
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillStyle = 'var(--neon-yellow)';
        ctx.textAlign = 'right';
        ctx.shadowColor = 'var(--neon-yellow)';
        ctx.shadowBlur = 5;
        ctx.fillText('[ DAILY CHALLENGE RUN ]', canvas.width - 25, 26);
        ctx.restore();
    }
    
    // 2. Частицы (текст "+N" рисуется отдельным проходом поверх всего —
    // см. шаг 8.5 — чтобы не прятаться за волком/яйцами)
    state.particles.forEach(p => {
        if (p.isScoreText) return;
        if (p.isGhostClone) {
            let img = null;
            if (state.images.wolf.loaded && state.images.wolf.element) {
                img = state.images.wolf.element;
            }
            ctx.save();
            ctx.globalAlpha = p.alpha;
            
            if (p.direction === 'LEFT') {
                ctx.translate(p.x + p.width / 2, 0);
                ctx.scale(-1, 1);
                ctx.translate(-(p.x + p.width / 2), 0);
            }
            
            if (img) {
                const offCanvas = getGhostCloneCanvas(img, p.width, p.height);

                ctx.shadowColor = '#00f0ff';
                ctx.shadowBlur = 10;
                ctx.drawImage(offCanvas, p.x, p.y);
            } else {
                ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
                ctx.fillRect(p.x, p.y, p.width, p.height);
            }
            ctx.restore();
        } else {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            if (p.isRainDrop) {
                ctx.strokeStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 6;
                ctx.lineWidth = p.size;
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x, p.y + (state.gravityFlipped ? -8 : 8));
                ctx.stroke();
            } else {
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                if (p.text !== undefined) {
                    ctx.fillStyle = p.color;
                    if (p.isScoreText) {
                        ctx.font = `bold ${p.size}px "Share Tech Mono"`;
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                    } else {
                        ctx.font = `${p.size}px "Share Tech Mono"`;
                    }
                    ctx.fillText(p.text, p.x, p.y);
                } else {
                    ctx.fillStyle = p.color;
                    ctx.fillRect(p.x, p.y, p.size, p.size);
                }
            }
            ctx.restore();
        }
    });
    
    // 3. Утечки ядер
    state.coreLeaks.forEach(cl => {
        ctx.save();
        ctx.globalAlpha = cl.alpha;
        ctx.fillStyle = cl.color;
        ctx.shadowColor = cl.color;
        ctx.shadowBlur = 8;
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillText(cl.text, cl.x - 55, cl.y);
        
        ctx.strokeStyle = cl.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cl.x - 70, cl.y - 10);
        ctx.lineTo(cl.x - 62, cl.y + 2);
        ctx.lineTo(cl.x - 78, cl.y + 2);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
    });
    
    // 4. Волк (с лёгким парением вверх-вниз для "живости", не влияющим на хитбокс)
    ctx.save();
    if (state.gameState === 'PLAYING' || state.gameState === 'PAUSED') {
        const bobOffset = Math.round(Math.sin(Date.now() / 480) * 4);
        ctx.translate(0, bobOffset);
    }
    drawWolf(ctx);
    ctx.restore();

    // 5. Ядра
    state.eggs.forEach(egg => {
        drawEgg(ctx, egg);
    });
    
    // 6. Лазеры
    state.lasers.forEach(laser => {
        ctx.save();
        if (laser.active) {
            ctx.strokeStyle = '#ff003c';
            ctx.shadowColor = '#ff003c';
            ctx.shadowBlur = 15;
            ctx.lineWidth = 12 + Math.sin(Date.now() * 0.05) * 4;
            ctx.beginPath();
            ctx.moveTo(laser.x, 40);
            ctx.lineTo(laser.x, 460);
            ctx.stroke();
            
            ctx.strokeStyle = '#ffffff';
            ctx.shadowBlur = 0;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(laser.x, 40);
            ctx.lineTo(laser.x, 460);
            ctx.stroke();
        } else {
            ctx.strokeStyle = 'rgba(255, 0, 60, 0.4)';
            ctx.shadowColor = '#ff003c';
            ctx.shadowBlur = 4;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(laser.x, 40);
            ctx.lineTo(laser.x, 460);
            ctx.stroke();
        }
        ctx.restore();
    });
    
    // 7. Сбой энергосети (Blackout)
    if (state.activeEvent === 'blackout') {
        ctx.save();
        ctx.fillStyle = 'rgba(4, 3, 12, 0.76)';
        ctx.fillRect(0, 40, canvas.width, 420);
        ctx.restore();
    }
    
    // 8. Волны поимки
    state.catchFlashes.forEach(cf => {
        ctx.save();
        ctx.globalAlpha = cf.alpha;
        ctx.beginPath();
        ctx.arc(cf.x, cf.y, cf.radius, 0, Math.PI * 2);
        ctx.strokeStyle = cf.color;
        ctx.shadowColor = cf.color;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    });
    
    // 8.5. Текст "+N" очков — отдельный проход ПОВЕРХ ВСЕГО (волка, скинов,
    // следов, яиц), иначе он терялся за ними, особенно на скинах/следах с
    // непрозрачной заливкой. Тёмная обводка держит контраст на любом фоне.
    state.particles.forEach(p => {
        if (!p.isScoreText) return;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.font = `900 ${p.size}px "Share Tech Mono"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(4, 3, 12, 0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    });

    // 9. Оверлей реплея
    if (state.isReplayPlayback) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
        ctx.fillRect(0, canvas.height - 35, canvas.width, 35);
        ctx.font = 'bold 12px "Share Tech Mono"';
        ctx.fillStyle = 'var(--neon-cyan)';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'var(--neon-cyan)';
        ctx.shadowBlur = 5;
        ctx.fillText(`[ РЕЖИМ ПРОСМОТРА РЕПЛЕЯ // ЗАПИСЬ ОПЕРАТОРА: ${state.replayData?.name || 'ANON'} // СЧЕТ: ${state.replayData?.score} ]`, canvas.width / 2, canvas.height - 12);
        ctx.restore();
    }
    
    // 10. Меню паузы
    if (state.gameState === 'PAUSED') {
        ctx.save();
        ctx.fillStyle = 'rgba(8, 6, 18, 0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Размытие и сетка
        ctx.fillStyle = 'rgba(0, 240, 255, 0.05)';
        for (let i = 0; i < canvas.width; i += 20) {
            ctx.fillRect(i, 0, 1, canvas.height);
        }
        for (let j = 0; j < canvas.height; j += 20) {
            ctx.fillRect(0, j, canvas.width, 1);
        }
        
        // Текст паузы
        ctx.font = 'bold 36px "Orbitron"';
        ctx.fillStyle = 'var(--neon-pink)';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'var(--neon-pink)';
        ctx.shadowBlur = 15;
        ctx.fillText('SYSTEM PAUSED', canvas.width / 2, canvas.height / 2 - 20);
        
        ctx.font = '14px "Share Tech Mono"';
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#ffffff';
        ctx.fillText('[ НАЖМИТЕ ESC, ЧТОБЫ ВОЗОБНОВИТЬ СОЕДИНЕНИЕ ]', canvas.width / 2, canvas.height / 2 + 30);
        
        ctx.restore();
    }

    // 11. Отладка коллайдеров
    if (state.showColliders) {
        ctx.save();
        
        // Рисуем коллайдер корзины волка (плоский прямоугольник, соответствующий реальной физике)
        const basketX = (state.wolf.direction === 'LEFT') ? Math.round(state.wolf.x) + state.wolf.width * 0.16 : Math.round(state.wolf.x) + state.wolf.width * 0.84;
        const basketY = state.wolf.y + state.wolf.height * 0.435 + 16;
        const hitboxLvl = (state.upgrades && state.upgrades.hitbox && state.upgrades.hitbox.lvl) || 1;
        const basketRadius = 16 + hitboxLvl * 2;
        
        const rectW = 2 * (basketRadius + 15) + 6;
        const rectH = 32;
        const rectX = basketX - (basketRadius + 15) - 6;
        const rectY = basketY - 16;
        
        ctx.strokeStyle = '#39ff14'; // Ярко-зеленый
        ctx.fillStyle = 'rgba(57, 255, 20, 0.2)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.rect(rectX, rectY, rectW, rectH);
        ctx.fill();
        ctx.stroke();

        // Рисуем границы самого волка (физический спрайт-бокс для лазера)
        ctx.strokeStyle = '#ff007f'; // Ярко-розовый
        ctx.fillStyle = 'rgba(255, 0, 127, 0.1)';
        ctx.shadowColor = '#ff007f';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.rect(state.wolf.x, state.wolf.y, state.wolf.width, state.wolf.height);
        ctx.fill();
        ctx.stroke();

        // Рисуем коллайдеры яиц (круги)
        ctx.strokeStyle = '#00f0ff'; // Голубой
        ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 8;
        state.eggs.forEach(egg => {
            ctx.beginPath();
            ctx.rect(egg.x - 15, egg.y - 16, 30, 32);
            ctx.fill();
            ctx.stroke();
        });

        // Рисуем линии наведения и поражения лазеров
        state.lasers.forEach(laser => {
            ctx.strokeStyle = '#ff2a00'; // Красный
            ctx.lineWidth = 1.5;
            ctx.shadowColor = '#ff2a00';
            ctx.shadowBlur = 5;
            ctx.beginPath();
            ctx.moveTo(laser.x, 0);
            ctx.lineTo(laser.x, canvas.height);
            ctx.stroke();
        });

        ctx.restore();
    }
}

// Обновление HUD-панели управления реплеем (оставшееся время + скорость)
export function updateReplayHUD() {
    const panel = document.getElementById('replay-controls');
    const infoPanel = document.getElementById('replay-info-panel');
    if (!panel) return;

    const active = state.isReplayPlayback && (state.gameState === 'PLAYING' || state.gameState === 'PAUSED');

    if (active) {
        panel.style.display = 'flex';

        const remainingMs = Math.max(0, (state.replayDurationMs || 0) - state.playTime * 1000);
        const totalSec = Math.floor(remainingMs / 1000);
        const mm = Math.floor(totalSec / 60).toString().padStart(2, '0');
        const ss = (totalSec % 60).toString().padStart(2, '0');
        const timeEl = document.getElementById('replay-time-remaining');
        if (timeEl) timeEl.textContent = `${mm}:${ss}`;
    } else {
        panel.style.display = 'none';
    }

    if (infoPanel) {
        if (active) {
            infoPanel.style.display = 'block';

            const nameEl = document.getElementById('replay-info-name');
            if (nameEl) nameEl.textContent = (state.replayData && state.replayData.name) ? state.replayData.name : 'ANON';

            const categories = ['speed', 'hitbox', 'slow', 'shield'];
            categories.forEach(cat => {
                const el = document.getElementById(`replay-upg-${cat}`);
                if (el && state.upgrades && state.upgrades[cat]) {
                    el.textContent = `${state.upgrades[cat].lvl}/${state.upgrades[cat].max}`;
                }
            });
        } else {
            infoPanel.style.display = 'none';
        }
    }
}

// Управление циклом превью в кастомизации
export function startPreviewLoop() {
    if (state.previewAnimId) cancelAnimationFrame(state.previewAnimId);
    function tickPreview() {
        if (state.gameState !== 'CUSTOMIZE') return;
        drawPreview(state.previewSkin, state.previewTrail);
        state.previewAnimId = requestAnimationFrame(tickPreview);
    }
    state.previewAnimId = requestAnimationFrame(tickPreview);
}

export function stopPreviewLoop() {
    if (state.previewAnimId) {
        cancelAnimationFrame(state.previewAnimId);
        state.previewAnimId = null;
    }
}

// Рендеринг UI кастомизации
export function renderCustomizeUI() {
    const skinsGrid = document.getElementById('skins-grid');
    const trailsGrid = document.getElementById('trails-grid');
    
    skinsGrid.innerHTML = '';
    trailsGrid.innerHTML = '';
    
    // Скины
    Object.keys(SKINS).forEach(id => {
        const skin = SKINS[id];
        
        if (skin.rewardFor && state.currentSkinFilter !== 'all') return;
        if (state.currentSkinFilter === 'free' && skin.cost > 0) return;
        if (state.currentSkinFilter === 'cc300' && (skin.cost === 0 || skin.cost >= 300)) return;
        if (state.currentSkinFilter === 'expensive' && skin.cost < 300) return;
        
        const isAchievementUnlocked = skin.rewardFor && state.achievements[skin.rewardFor] && state.achievements[skin.rewardFor].unlocked;
        const isUnlocked = state.unlockedSkins.includes(id) || isAchievementUnlocked || id === 'none';
        const isActive = state.selectedSkin === id;
        const isPreview = state.previewSkin === id;
        
        const div = document.createElement('div');
        div.className = `cosmetic-item ${isPreview ? 'active' : ''}`;
        div.style.cursor = 'pointer';
        
        const typeLabels = { none: 'ОРИГ', outline: 'КОНТУР', glitch: 'ГЛИТЧ', retro: 'РЕТРО', holo: 'ГОЛО' };
        const typeLabel = typeLabels[skin.type] || '';
        
        let actionHtml = '';
        if (isActive) {
            actionHtml = id !== 'none' ? `<button class="cosmetic-unequip-btn" onclick="equipSkin('none')">СНЯТЬ</button>` : '<span class="cosmetic-status" style="color: var(--neon-cyan)">ЭКИПИРОВАН</span>';
        } else if (isUnlocked) {
            actionHtml = `<button class="cosmetic-equip-btn" onclick="equipSkin('${id}')">ВЫБРАТЬ</button>`;
        } else if (skin.rewardFor) {
            const reqAchTitle = state.achievements[skin.rewardFor] ? state.achievements[skin.rewardFor].title : 'Достижение';
            actionHtml = `<span class="cosmetic-status" style="color: var(--neon-pink); font-size: 0.6rem; font-weight: bold; border: 1px dashed var(--neon-pink); padding: 2px 4px;">🏆 ${reqAchTitle}</span>`;
        } else {
            actionHtml = `<button class="cosmetic-buy-btn" onclick="buySkin('${id}')">${skin.cost} CC</button>`;
        }
        
        div.innerHTML = `
            <div class="cosmetic-details">
                <span class="cosmetic-title" style="color: ${skin.color}">${skin.name}</span>
                <span class="cosmetic-type-badge">${typeLabel}</span>
            </div>
            <div class="cosmetic-action">${actionHtml}</div>
        `;
        
        div.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            state.previewSkin = id;
            renderCustomizeUI();
        };
        
        skinsGrid.appendChild(div);
    });
    
    // Следы
    Object.keys(TRAILS).forEach(id => {
        const trail = TRAILS[id];
        const isUnlocked = state.unlockedTrails.includes(id);
        const isActive = state.selectedTrail === id;
        const isPreview = state.previewTrail === id;
        
        const div = document.createElement('div');
        div.className = `cosmetic-item ${isPreview ? 'active' : ''}`;
        div.style.cursor = 'pointer';
        
        let actionHtml = '';
        if (isActive && id !== 'none') {
            actionHtml = `<button class="cosmetic-unequip-btn" onclick="equipTrail('none')">СНЯТЬ</button>`;
        } else if (isActive) {
            actionHtml = '<span class="cosmetic-status" style="color: var(--neon-cyan)">ЭКИПИРОВАН</span>';
        } else if (isUnlocked) {
            actionHtml = `<button class="cosmetic-equip-btn" onclick="equipTrail('${id}')">ВЫБРАТЬ</button>`;
        } else {
            actionHtml = `<button class="cosmetic-buy-btn" onclick="buyTrail('${id}')">${trail.cost} CC</button>`;
        }
        
        div.innerHTML = `
            <div class="cosmetic-details">
                <span class="cosmetic-title">${trail.name}</span>
            </div>
            <div class="cosmetic-action">${actionHtml}</div>
        `;
        
        div.onclick = (e) => {
            if (e.target.tagName === 'BUTTON') return;
            state.previewTrail = id;
            renderCustomizeUI();
        };
        
        trailsGrid.appendChild(div);
    });

    drawPreview(state.previewSkin, state.previewTrail);
    
    const balanceEl = document.getElementById('cyber-credits-val');
    if (balanceEl) balanceEl.textContent = state.cyberCredits;
}

export function renderAchievementsList() {
    const list = document.getElementById('menu-achievements-list');
    if (!list) return;
    list.innerHTML = '';
    
    Object.keys(state.achievements).forEach(id => {
        const ach = state.achievements[id];
        const div = document.createElement('div');
        div.className = 'achievement-menu-item';
        div.style.flexDirection = 'column';
        div.style.alignItems = 'flex-start';
        div.style.padding = '6px 0';
        div.style.borderBottom = '1px solid rgba(0, 240, 255, 0.1)';
        
        let progressText = '';
        const target = ach.target || 1;
        const currentProgress = Math.min(ach.progress || 0, target);
        const label = (ach.scope === 'single_run') ? 'Рекорд' : 'Прогресс';
        progressText = ` (${label}: ${currentProgress}/${target})`;
        
        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                <span class="achievement-menu-name ${ach.unlocked ? 'unlocked' : ''}" style="font-weight: bold;">${ach.title}${progressText}</span>
                <span class="achievement-menu-status ${ach.unlocked ? 'unlocked' : ''}" style="font-weight: bold;">${ach.unlocked ? 'РАЗБЛОКИРОВАНО' : 'ЗАБЛОКИРОВАНО'}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">${ach.desc}</div>
        `;
        list.appendChild(div);
    });
}

export function updateMenuStatsHUD() {
    const gamesPlayed = state.achievements?.hardcore_operator?.progress || 0;
    const totalEggs = state.achievements?.data_grinder?.progress || 0;
    const personalBest = state.personalBest || 0;
    const dailyStreak = localStorage.getItem('cybercatch_quest_streak') || '0';
    const operatorName = state.terraSiteUser ? state.terraSiteUser.username : (localStorage.getItem('cybercatch_player_name') || 'GUEST');
    
    const gamesPlayedEl = document.getElementById('hud-stat-games');
    const totalEggsEl = document.getElementById('hud-stat-eggs');
    const pbEl = document.getElementById('hud-stat-pb');
    const streakEl = document.getElementById('hud-stat-streak');
    const operatorEl = document.getElementById('hud-stat-operator-name');
    
    if (gamesPlayedEl) gamesPlayedEl.textContent = gamesPlayed;
    if (totalEggsEl) totalEggsEl.textContent = totalEggs;
    if (pbEl) pbEl.textContent = personalBest;
    if (streakEl) streakEl.textContent = dailyStreak;
    if (operatorEl) {
        operatorEl.textContent = operatorName;
        operatorEl.parentElement.title = operatorName; // Подсказка при наведении при усечении текста
    }
}

export function toggleHUDMode(isGameplay) {
    const scoreBoard = document.querySelector('.hud-score-board');
    const upgradeBoard = document.querySelector('.hud-upgrade-board');
    const livesBoard = document.querySelector('.hud-lives-board');
    
    const menuEggsSessions = document.getElementById('hud-menu-eggs-sessions');
    const menuPbStreak = document.getElementById('hud-menu-pb-streak');
    const menuOperator = document.getElementById('hud-menu-operator');
    const hudStreakBoard = document.querySelector('.hud-streak-board');
    
    if (isGameplay) {
        if (scoreBoard) scoreBoard.style.display = 'block';
        if (upgradeBoard) upgradeBoard.style.display = 'flex';
        if (livesBoard) livesBoard.style.display = 'flex';
        if (hudStreakBoard) hudStreakBoard.style.display = 'flex';
        
        if (menuEggsSessions) menuEggsSessions.style.display = 'none';
        if (menuPbStreak) menuPbStreak.style.display = 'none';
        if (menuOperator) menuOperator.style.display = 'none';
    } else {
        if (scoreBoard) scoreBoard.style.display = 'none';
        if (upgradeBoard) upgradeBoard.style.display = 'none';
        if (livesBoard) livesBoard.style.display = 'none';
        if (hudStreakBoard) hudStreakBoard.style.display = 'none';
        
        if (menuEggsSessions) menuEggsSessions.style.display = 'flex';
        if (menuPbStreak) menuPbStreak.style.display = 'flex';
        if (menuOperator) menuOperator.style.display = 'flex';
        
        updateMenuStatsHUD();
    }
}

window.updateMenuStatsHUD = updateMenuStatsHUD;
window.toggleHUDMode = toggleHUDMode;

export function renderLeaderboard(list) {
    if (list) {
        state.leaderboardData = list;
    }
    const tbodies = [
        document.getElementById('leaderboard-body'),
        document.getElementById('menu-leaderboard-body'),
        document.getElementById('game-leaderboard-body')
    ].filter(Boolean);
    
    if (tbodies.length === 0) return;

    let currentList = state.leaderboardData ? [...state.leaderboardData] : [];
    const isPlayingOrOver = ['PLAYING', 'SHOP', 'PAUSED', 'GAMEOVER'].includes(state.gameState);
    const playerName = (localStorage.getItem('cybercatch_player_name') || 'OPERATOR').trim().toUpperCase();

    if (isPlayingOrOver) {
        const playerIndex = currentList.findIndex(item => item.name.trim().toUpperCase() === playerName);
        if (playerIndex !== -1) {
            currentList[playerIndex] = {
                ...currentList[playerIndex],
                score: Math.max(currentList[playerIndex].score, state.score)
            };
        } else {
            currentList.push({
                name: localStorage.getItem('cybercatch_player_name') || 'OPERATOR',
                score: state.score,
                isLivePlayer: true
            });
        }
    }

    // Дедупликация по имени и сортировка
    const seenNames = new Set();
    const uniqueList = [];
    for (const item of currentList) {
        const upperName = item.name.trim().toUpperCase();
        if (!seenNames.has(upperName)) {
            seenNames.add(upperName);
            uniqueList.push(item);
        }
    }
    uniqueList.sort((a, b) => b.score - a.score);

    tbodies.forEach(tbody => {
        tbody.innerHTML = '';
        if (uniqueList.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">База данных рекордов пуста</td></tr>';
            return;
        }

        // Ограничиваем топ-10, но если текущий игрок не в топе, принудительно выводим его 11-й строчкой внизу
        let renderList = uniqueList.slice(0, 10);
        const isPlayerInTop10 = renderList.some(item => item.name.trim().toUpperCase() === playerName);
        if (isPlayingOrOver && !isPlayerInTop10) {
            const playerItem = uniqueList.find(item => item.name.trim().toUpperCase() === playerName);
            if (playerItem) {
                renderList.push(playerItem);
            }
        }

        renderList.forEach(item => {
            const tr = document.createElement('tr');
            
            // Находим настоящий ранг игрока в отсортированной таблице
            const realRank = uniqueList.findIndex(x => x.name.trim().toUpperCase() === item.name.trim().toUpperCase());
            
            let rankColor = 'var(--text-muted)';
            let nameColor = 'var(--text-primary)';
            
            if (realRank === 0) {
                rankColor = '#ffd700'; // Золото для 1 места
                nameColor = '#ffd700';
            } else if (realRank === 1) {
                rankColor = '#00f0ff'; // Серебро для 2 места
                nameColor = '#00f0ff';
            } else if (realRank === 2) {
                rankColor = '#ff007f'; // Бронза для 3 места
                nameColor = '#ff007f';
            } else if (item.name.trim().toUpperCase() === playerName) {
                nameColor = '#39ff14'; // Неоново-зеленый для активного игрока
            }

            tr.innerHTML = `
                <td style="color: ${rankColor}; font-weight: bold;">
                    ${realRank + 1}
                </td>
                <td style="font-weight: bold; color: ${nameColor}; max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${item.name} ${item.replayId ? `<span onclick="watchReplay('${item.replayId}')" title="Смотреть реплей" style="color: var(--neon-cyan); cursor: pointer; margin-left: 4px; text-shadow: 0 0 5px var(--neon-cyan);">▶</span>` : ''}
                </td>
                <td style="text-align: right; color: var(--neon-pink); font-weight: bold;">
                    ${item.score}
                </td>
            `;
            tbody.appendChild(tr);
        });
    });
}

window.watchReplay = function(replayId) {
    window.location.href = `${window.location.origin}${window.location.pathname}?replay=${replayId}`;
};

export function updateAchievementTracker() {
    const tracker = document.getElementById('achievement-tracker');
    if (!tracker) return;
    
    if (state.gameState !== 'PLAYING' || state.streakCounter < 100 || state.isReplayPlayback) {
        tracker.classList.remove('show');
        return;
    }
    
    tracker.classList.add('show');
    
    const nameEl = document.getElementById('ach-tracker-name');
    const ratioEl = document.getElementById('ach-tracker-ratio');
    const fillEl = document.getElementById('ach-tracker-bar');
    
    if (nameEl) nameEl.textContent = state.achievements['never_miss'] ? state.achievements['never_miss'].title.toUpperCase() : 'NEVER MISS';
    if (ratioEl) ratioEl.textContent = `${state.streakCounter} / 150`;
    
    const pct = Math.min(100, (state.streakCounter / 150) * 100);
    if (fillEl) fillEl.style.width = `${pct}%`;
}

export function updateQuestTracker() {
    const qTracker = document.getElementById('quest-tracker');
    if (!qTracker) return;
    
    if (state.gameState !== 'PLAYING' || state.isReplayPlayback) {
        qTracker.classList.remove('show');
        return;
    }
    
    const isCompleted = localStorage.getItem('cybercatch_quest_completed') === 'true';
    qTracker.classList.add('show');
    
    document.getElementById('quest-tracker-name').textContent = state.dailyQuest.desc;
    if (isCompleted) {
        document.getElementById('quest-tracker-bar').style.width = '100%';
        document.getElementById('quest-tracker-ratio').textContent = 'ВЫПОЛНЕНО';
    } else {
        const pct = Math.min(100, (state.dailyQuest.progress / state.dailyQuest.target) * 100);
        document.getElementById('quest-tracker-bar').style.width = `${pct}%`;
        document.getElementById('quest-tracker-ratio').textContent = `${state.dailyQuest.progress} / ${state.dailyQuest.target}`;
    }
}

// Фильтрация скинов по стоимости
window.filterSkins = function(filterType) {
    state.currentSkinFilter = filterType;
    document.querySelectorAll('.filter-bar button').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`filter-skin-${filterType}`);
    if (activeBtn) activeBtn.classList.add('active');
    renderCustomizeUI();
};

window.renderLeaderboard = renderLeaderboard;
window.renderCustomizeUI = renderCustomizeUI;
window.renderAchievementsList = renderAchievementsList;

export function renderQuestMenu() {
    const descEl = document.getElementById('quest-desc');
    const barEl = document.getElementById('quest-progress-bar');
    if (!descEl || !barEl) return;
    
    descEl.textContent = state.dailyQuest.desc;
    
    const isCompleted = localStorage.getItem('cybercatch_quest_completed') === 'true';
    if (isCompleted) {
        barEl.textContent = '[██████████] ВЫПОЛНЕНО (+40 CC)';
        barEl.style.color = 'var(--neon-green)';
    } else {
        const total = 10;
        const filled = Math.min(total, Math.floor((state.dailyQuest.progress / state.dailyQuest.target) * total));
        let bar = '';
        for (let i = 0; i < total; i++) {
            bar += (i < filled) ? '█' : '░';
        }
        barEl.textContent = `[${bar}] ${state.dailyQuest.progress}/${state.dailyQuest.target}`;
        barEl.style.color = 'var(--neon-yellow)';
    }
}

window.renderQuestMenu = renderQuestMenu;

