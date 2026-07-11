// Lobby commander portrait carousel. Keeps animation and image-preload state out of main.js.
import { allCommanders } from '../commander/index.js';

const DEFAULT_COMMANDERS = [
    'tianyan', 'paladin', 'fallenAngel', 'vampire', 'berserker', 'magician',
    'advisor', 'ironGuard', 'centurion', 'staller', 'martyr', 'priest',
    'minister', 'necromancer', 'astrologer', 'diplomat', 'colonel'
];

export function createHeroCarousel({ onReady }) {
    let commanders = [...DEFAULT_COMMANDERS];
    let currentIndex = 0;
    let timer = null;
    let hasAnimatedEntrance = false;

    function filterAvailableCommanders() {
        return new Promise((resolve) => {
            if (commanders.length === 0) {
                resolve([]);
                return;
            }

            const valid = [];
            let pending = commanders.length;
            for (const commanderId of commanders) {
                const config = allCommanders[commanderId];
                const name = config ? config.name : commanderId;
                const image = new Image();
                image.onload = () => {
                    valid.push(commanderId);
                    if (--pending === 0) resolve(valid);
                };
                image.onerror = () => {
                    console.warn(`[轮播] 将领立绘不存在，跳过：${commanderId}`);
                    if (--pending === 0) resolve(valid);
                };
                image.src = `img/commander/${name}.webp`;
            }
        });
    }

    function updateDots() {
        document.querySelectorAll('#heroCarouselDots .hdot').forEach((dot, index) => {
            dot.classList.toggle('active', index === currentIndex);
        });
    }

    function showSlide(index, animate) {
        if (commanders.length === 0) return;
        const commanderId = commanders[index];
        const config = allCommanders[commanderId];
        const name = config ? config.name : commanderId;
        const imageA = document.getElementById('heroPortraitA');
        const imageB = document.getElementById('heroPortraitB');
        if (!imageA || !imageB) return;

        const source = `img/commander/${name}.webp`;
        const activeImage = imageA.classList.contains('active') ? imageA : imageB;
        const idleImage = imageA.classList.contains('active') ? imageB : imageA;
        if (!animate) {
            activeImage.src = source;
            activeImage.classList.add('active');
            idleImage.classList.remove('active');
            return;
        }

        const preload = new Image();
        preload.onload = () => {
            idleImage.src = source;
            idleImage.classList.add('active');
            activeImage.classList.remove('active');
        };
        preload.onerror = () => {
            console.warn(`[轮播] 切换立绘失败：${commanderId}`);
            const nextIndex = (index + 1) % commanders.length;
            if (nextIndex !== index) {
                currentIndex = nextIndex;
                showSlide(nextIndex, true);
                updateDots();
            }
        };
        preload.src = source;
    }

    function scheduleRotation() {
        if (timer) clearInterval(timer);
        timer = setInterval(() => {
            if (commanders.length === 0) return;
            currentIndex = (currentIndex + 1) % commanders.length;
            showSlide(currentIndex, true);
            updateDots();
        }, 4500);
    }

    function jumpTo(index) {
        if (!commanders.length) return;
        currentIndex = index;
        showSlide(index, true);
        updateDots();
        scheduleRotation();
    }

    function animateEntrance() {
        if (typeof gsap === 'undefined') return;
        const timeline = gsap.timeline();
        const box = document.querySelector('.lobby-box');
        const portrait = document.querySelector('.hero-portrait-frame');
        const title = document.querySelector('.hero-title-block');
        const buttons = document.querySelectorAll('.hero-btn');
        const dots = document.getElementById('heroCarouselDots');
        timeline.fromTo(box, { opacity: 0, scale: 0.96, y: 12 }, { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'power3.out' });
        timeline.fromTo(portrait, { opacity: 0, x: 40, scale: 0.95 }, { opacity: 1, x: 0, scale: 1, duration: 0.7, ease: 'power2.out' }, '-=0.15');
        timeline.fromTo(title, { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.55, ease: 'power2.out' }, '-=0.3');
        timeline.fromTo(buttons, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, stagger: 0.08, ease: 'back.out(1.2)' }, '-=0.2');
        timeline.fromTo(dots, { opacity: 0 }, { opacity: 1, duration: 0.3 }, '-=0.1');
    }

    async function start() {
        const frame = document.querySelector('.hero-portrait-frame');
        const dotsContainer = document.getElementById('heroCarouselDots');
        if (!frame || !dotsContainer) {
            onReady();
            return;
        }

        commanders = await filterAvailableCommanders();
        if (commanders.length === 0) {
            console.warn('[轮播] 所有将领立绘均缺失，停止轮播');
            onReady();
            return;
        }

        currentIndex = 0;
        dotsContainer.innerHTML = '';
        commanders.forEach((_commanderId, index) => {
            const dot = document.createElement('span');
            dot.className = 'hdot' + (index === currentIndex ? ' active' : '');
            dot.addEventListener('click', () => jumpTo(index));
            dotsContainer.appendChild(dot);
        });

        showSlide(currentIndex, false);
        const firstImage = document.getElementById('heroPortraitA');
        if (firstImage?.complete && firstImage.naturalWidth > 0) {
            onReady();
        } else if (firstImage) {
            firstImage.addEventListener('load', onReady, { once: true });
            firstImage.addEventListener('error', onReady, { once: true });
        } else {
            onReady();
        }

        if (!hasAnimatedEntrance) {
            hasAnimatedEntrance = true;
            animateEntrance();
        }
        scheduleRotation();
    }

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    return { start, stop };
}
