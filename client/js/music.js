import { state } from './state.js';
import { API_BASE } from './api.js';

export class BackgroundMusicManager {
    constructor() {
        this.audio = null;
        this.playlist = [];
        this.currentTrackIndex = -1;
        this.targetVolume = 0.05; // Громкость по умолчанию (10%)
        this.isFading = false;
        this.fadeInterval = null;
        
        // Восстановление громкости из localStorage
        const savedVol = localStorage.getItem('cybercatch_music_volume');
        if (savedVol !== null) {
            this.targetVolume = parseFloat(savedVol);
        }
        state.musicVolume = this.targetVolume;
    }
    
    async init() {
        try {
            const res = await fetch(`${API_BASE}api/music/list`);
            if (res.status === 200) {
                const list = await res.json();
                if (list && list.length > 0) {
                    this.playlist = list;
                    this.shufflePlaylist();
                    this.createAudioElement();
                    this.playNext();
                } else {
                    console.log('Папка с музыкой пуста. Добавьте треки в client/assets/music/');
                }
            }
        } catch(e) {
            console.warn('Не удалось загрузить плейлист музыки:', e);
        }
    }
    
    shufflePlaylist() {
        if (this.playlist.length === 0) return;
        // Fisher-Yates shuffle
        for (let i = this.playlist.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.playlist[i], this.playlist[j]] = [this.playlist[j], this.playlist[i]];
        }
        this.currentTrackIndex = -1;
    }
    
    createAudioElement() {
        this.audio = new Audio();
        this.audio.volume = 0; // Начинаем с нуля для плавного нарастания
        this.audio.preload = 'auto';
        
        this.audio.addEventListener('ended', () => {
            this.playNext();
        });
        
        // Запуск затухания незадолго до конца трека
        this.audio.addEventListener('timeupdate', () => {
            if (this.audio.duration && !this.isFading) {
                const timeLeft = this.audio.duration - this.audio.currentTime;
                if (timeLeft <= 2.5) { // За 2.5 секунды до конца
                    this.fadeOutAndNext();
                }
            }
        });
    }
    
    playNext() {
        if (this.playlist.length === 0 || !this.audio) return;
        
        this.currentTrackIndex++;
        if (this.currentTrackIndex >= this.playlist.length) {
            this.shufflePlaylist();
            this.currentTrackIndex = 0;
        }
        
        const track = this.playlist[this.currentTrackIndex];
        const trackUrl = `${API_BASE}assets/music/${track}`;
        
        this.audio.src = trackUrl;
        this.audio.volume = 0;
        this.isFading = false;
        
        // Воспроизведение после клика пользователя (требование автоплея в браузерах)
        this.audio.play()
            .then(() => {
                this.fadeIn();
            })
            .catch(e => {
                const playOnInteraction = () => {
                    if (this.audio) {
                        this.audio.play().then(() => {
                            this.fadeIn();
                            window.removeEventListener('click', playOnInteraction);
                            window.removeEventListener('keydown', playOnInteraction);
                        }).catch(() => {});
                    }
                };
                window.addEventListener('click', playOnInteraction);
                window.addEventListener('keydown', playOnInteraction);
            });
    }
    
    fadeIn() {
        if (!this.audio) return;
        clearInterval(this.fadeInterval);
        this.isFading = false;
        
        const step = 0.05;
        const duration = 2000; // 2 секунды
        const intervalTime = duration * step;
        
        this.fadeInterval = setInterval(() => {
            if (!this.audio) return;
            if (state.muted) {
                this.audio.volume = 0;
                clearInterval(this.fadeInterval);
                return;
            }
            
            let nextVol = this.audio.volume + step * this.targetVolume;
            if (nextVol >= this.targetVolume) {
                this.audio.volume = this.targetVolume;
                clearInterval(this.fadeInterval);
            } else {
                this.audio.volume = nextVol;
            }
        }, intervalTime);
    }
    
    fadeOutAndNext() {
        if (!this.audio || this.isFading) return;
        this.isFading = true;
        clearInterval(this.fadeInterval);
        
        const step = 0.05;
        const duration = 2500; // 2.5 секунды
        const intervalTime = duration * step;
        
        this.fadeInterval = setInterval(() => {
            if (!this.audio) return;
            let nextVol = this.audio.volume - step * this.targetVolume;
            if (nextVol <= 0) {
                this.audio.volume = 0;
                clearInterval(this.fadeInterval);
            } else {
                this.audio.volume = nextVol;
            }
        }, intervalTime);
    }
    
    setVolume(volume) {
        this.targetVolume = volume;
        state.musicVolume = volume;
        localStorage.setItem('cybercatch_music_volume', volume.toString());
        
        if (this.audio && !this.isFading) {
            if (state.muted) {
                this.audio.volume = 0;
            } else {
                this.audio.volume = volume;
            }
        }
    }
    
    updateMuteState(isMuted) {
        if (this.audio) {
            if (isMuted) {
                this.audio.volume = 0;
            } else {
                this.audio.volume = this.targetVolume;
            }
        }
    }
}

export const bgMusic = new BackgroundMusicManager();
