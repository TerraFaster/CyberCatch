import { state } from './state.js';

let randomSeed = 42;

export function seedRandom(seed) {
    randomSeed = seed;
}

export function seededRandom() {
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);
    randomSeed = (a * randomSeed + c) % m;
    return randomSeed / m;
}

export function gameRandom() {
    return seededRandom();
}

// Вычисление SHA-256 подписи в браузере
export async function computeSignature(name, score, sessionId) {
    const salt = 'CYBER_SECRET_SALT_2026';
    const msg = name + score + sessionId + salt;
    const encoder = new TextEncoder();
    const data = encoder.encode(msg);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Сжатие Uint8Array с помощью CompressionStream (gzip) и возврат Base64
export async function compressBytes(bytes) {
    const stream = new Response(bytes).body.pipeThrough(new CompressionStream('gzip'));
    const compressedBuffer = await new Response(stream).arrayBuffer();
    const compressedBytes = new Uint8Array(compressedBuffer);
    let binary = '';
    for (let i = 0; i < compressedBytes.byteLength; i++) {
        binary += String.fromCharCode(compressedBytes[i]);
    }
    return btoa(binary);
}

// Декомпрессия Base64 в Uint8Array
export async function decompressBytes(base64Str) {
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    const decompressedBuffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(decompressedBuffer);
}

// Спец-маркеры для событий "гарантированной поимки/пропуска" (см.
// decodeReplay) — значения 0x7FFB-0x7FFF уже заняты под апгрейды/nextLevel,
// берём соседние свободные значения. Такой xVal физически недостижим для
// обычных записей позиции волка (rawX волка никогда не приближается к ним).
const CATCH_MARKER = 0x7FFA;
const MISS_MARKER = 0x7FF9;

// Кодирование и сжатие replayInputs в компактную строку Base64.
// Обычные записи занимают один 4-байтовый блок (tick + xVal). События
// 'catch'/'miss' (см. resolveCatchInReplay/resolveMissInReplay в engine.js)
// занимают два блока подряд: [tick, MARKER] + [spawnSeq_hi16, spawnSeq_lo16],
// чтобы поместить 32-битный порядковый номер яйца. Формат остаётся обратно
// совместимым — старые сохранённые реплеи никогда не содержат эти маркеры.
export async function encodeReplay(inputs) {
    const units = [];

    for (const input of inputs) {
        const tick = Math.round(input.time / (1000 / 60));

        if (input.type === 'upgrade') {
            let xVal = 0;
            if (input.category === 'speed') xVal = 0x7FFE;
            else if (input.category === 'hitbox') xVal = 0x7FFD;
            else if (input.category === 'slow') xVal = 0x7FFC;
            else if (input.category === 'shield') xVal = 0x7FFB;
            units.push(tick, xVal);
        } else if (input.type === 'input') {
            // Это событие ввода (input)
            let val = 0;
            if (input.left) val |= 1;
            if (input.right) val |= 2;
            if (input.targetX !== null && input.targetX !== undefined) {
                val |= 4;
                const roundedTargetX = Math.round(input.targetX);
                units.push(tick, val, roundedTargetX, 0);
            } else {
                units.push(tick, val);
            }
        }
    }

    const buffer = new ArrayBuffer(units.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < units.length; i++) {
        view.setUint16(i * 2, units[i], true);
    }

    return await compressBytes(new Uint8Array(buffer));
}

// Декомпрессия и декодирование replayInputs из строки Base64
export async function decodeReplay(base64Str) {
    const decompressedBytes = await decompressBytes(base64Str);
    const buffer = decompressedBytes.buffer;
    const view = new DataView(buffer);
    const inputs = [];
    const count = decompressedBytes.byteLength / 4;

    let i = 0;
    while (i < count) {
        const tick = view.getUint16(i * 4, true);
        const val = view.getUint16(i * 4 + 2, true);
        const time = tick * (1000 / 60);

        if (val === 0x7FFE) {
            inputs.push({ tick, time, type: 'upgrade', category: 'speed' });
            i += 1;
        } else if (val === 0x7FFD) {
            inputs.push({ tick, time, type: 'upgrade', category: 'hitbox' });
            i += 1;
        } else if (val === 0x7FFC) {
            inputs.push({ tick, time, type: 'upgrade', category: 'slow' });
            i += 1;
        } else if (val === 0x7FFB) {
            inputs.push({ tick, time, type: 'upgrade', category: 'shield' });
            i += 1;
        } else if (val === 0x7FFF) {
            i += 1;
        } else {
            // Событие ввода
            const left = (val & 1) !== 0;
            const right = (val & 2) !== 0;
            let targetX = null;
            if ((val & 4) !== 0) {
                if (i + 1 < count) {
                    targetX = view.getUint16((i + 1) * 4, true);
                }
                i += 2;
            } else {
                i += 1;
            }
            inputs.push({ tick, time, type: 'input', left, right, targetX });
        }
    }
    return inputs;
}

// Инициализация/генерация Device ID
export function initDeviceId() {
    let id = localStorage.getItem('cybercatch_device_id');
    if (!id) {
        id = 'DEV_' + Math.random().toString(36).substr(2, 9).toUpperCase();
        localStorage.setItem('cybercatch_device_id', id);
    }
    state.deviceId = id;
}

// Логирование событий в системный оверлей консоли
export function logSystemMessage(msg) {
    const consoleLog = document.getElementById('system-log-content');
    if (!consoleLog) return;
    
    const time = new Date().toLocaleTimeString();
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `<span class="log-time">[${time}]</span> <span class="log-msg">${msg}</span>`;
    
    consoleLog.appendChild(line);
    consoleLog.scrollTop = consoleLog.scrollHeight;
}

export function getQuestTimeLeft() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const diff = midnight - now;
    const hrs = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function showToast(message, type = 'info', duration = 4000) {
    let container = document.getElementById('cyber-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'cyber-toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `cyber-toast toast-${type}`;

    let iconText = '[i]';
    if (type === 'success') iconText = '[✓]';
    if (type === 'error') iconText = '[✗]';
    if (type === 'warning') iconText = '[!]';

    toast.innerHTML = `
        <div class="cyber-toast-icon">${iconText}</div>
        <div class="cyber-toast-content">${message}</div>
        <div class="cyber-toast-progress" style="animation-duration: ${duration}ms"></div>
    `;

    container.appendChild(toast);

    const timeoutId = setTimeout(() => {
        toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, duration);

    toast.addEventListener('click', () => {
        clearTimeout(timeoutId);
        toast.style.animation = 'toast-slide-out 0.3s cubic-bezier(0.6, -0.28, 0.735, 0.045) forwards';
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    });
}

export function showModal(title, message, options = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'cyber-modal-overlay';
        
        const typeClass = options.type ? `modal-${options.type}` : '';
        const modalId = `cyber-modal-${Date.now()}`;
        overlay.id = modalId;

        let inputHtml = '';
        if (options.inputVal !== undefined) {
            inputHtml = `
                <div class="cyber-modal-input-container">
                    <input type="text" readonly value="${options.inputVal}" class="cyber-modal-input" id="${modalId}-input" />
                </div>
            `;
        }

        let buttonsHtml = '';
        const buttons = options.buttons || [{ text: 'OK', type: 'cyan', value: true }];
        
        buttons.forEach((btn, index) => {
            const btnType = btn.type || 'cyan';
            buttonsHtml += `
                <button class="cyber-modal-btn btn-${btnType}" data-index="${index}">${btn.text}</button>
            `;
        });

        overlay.innerHTML = `
            <div class="cyber-modal-card ${typeClass}">
                <div class="cyber-modal-header">
                    <div class="cyber-modal-title glitch" data-text="${title}">${title}</div>
                </div>
                <div class="cyber-modal-body">
                    ${message}
                    ${inputHtml}
                </div>
                <div class="cyber-modal-buttons">
                    ${buttonsHtml}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        if (options.inputVal !== undefined) {
            const input = document.getElementById(`${modalId}-input`);
            if (input) {
                input.addEventListener('click', () => {
                    input.select();
                    try {
                        navigator.clipboard.writeText(input.value);
                        showToast('Ссылка скопирована в буфер!', 'success', 2000);
                    } catch (err) {
                        console.error('Failed to copy', err);
                    }
                });
            }
        }

        setTimeout(() => {
            overlay.classList.add('active');
        }, 10);

        const close = (val) => {
            overlay.classList.remove('active');
            overlay.addEventListener('transitionend', () => {
                overlay.remove();
                resolve(val);
            });
        };

        const buttonEls = overlay.querySelectorAll('.cyber-modal-btn');
        buttonEls.forEach(btnEl => {
            btnEl.addEventListener('click', () => {
                const idx = parseInt(btnEl.getAttribute('data-index'));
                const btnConfig = buttons[idx];
                
                if (btnConfig.onClick) {
                    btnConfig.onClick(close);
                } else {
                    close(btnConfig.value !== undefined ? btnConfig.value : btnConfig.text);
                }
            });
        });
    });
}

