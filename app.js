(function () {
    "use strict";

    /* ======================================================================
       1. ЭЛЕМЕНТЫ И СОСТОЯНИЕ
       ====================================================================== */
    const root = document.documentElement;
    const body = document.body;
    const themeMeta = document.getElementById("themeColorMeta");
    const themeSeg = document.getElementById("themeSeg");
    const segBtns = Array.from(themeSeg.querySelectorAll(".seg-btn"));

    const soundBtn = document.getElementById("soundBtn");
    const soundIconOn = document.getElementById("soundIconOn");
    const soundIconOff = document.getElementById("soundIconOff");

    const instrument = document.getElementById("instrument");
    const led = document.getElementById("led");
    const needleGroup = document.getElementById("needleGroup");
    const verdictText = document.getElementById("verdictText");
    const scanBtn = document.getElementById("scanBtn");
    const scanBtnLabel = document.getElementById("scanBtnLabel");

    const sectorEls = {
        peremoga: document.getElementById("sector-peremoga"),
        zrada: document.getElementById("sector-zrada"),
        zadnitsa: document.getElementById("sector-zadnitsa")
    };
    const labelEls = {
        peremoga: document.getElementById("lbl-peremoga"),
        zrada: document.getElementById("lbl-zrada"),
        zadnitsa: document.getElementById("lbl-zadnitsa")
    };

    const THEME_META_COLORS = {
        light: "#8cc5f8",
        dark: "#05070b"
    };

    let isSoundOn = true;
    let isScanning = false;

    function tryVibrate(pattern) {
        try {
            if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
                navigator.vibrate(pattern);
            }
        } catch (_) {}
    }

    function safeGetStorage(key, fallback) {
        try {
            const val = localStorage.getItem(key);
            return val === null ? fallback : val;
        } catch (_) {
            return fallback;
        }
    }

    function safeSetStorage(key, val) {
        try {
            localStorage.setItem(key, val);
        } catch (_) {}
    }

    /* ======================================================================
       2. ГЕОМЕТРИЯ АНАЛОГОВОЙ ШКАЛЫ (SVG)
       ====================================================================== */
    const CX = 180;
    const CY = 178;

    function polar(deg, r) {
        const rad = (deg * Math.PI) / 180;
        return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
    }

    function makeArc(startDeg, endDeg, r) {
        const [x1, y1] = polar(startDeg, r);
        const [x2, y2] = polar(endDeg, r);
        const large = endDeg - startDeg > 180 ? 1 : 0;
        return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
    }

    function makeSector(startDeg, endDeg, rIn, rOut) {
        const [x1, y1] = polar(startDeg, rOut);
        const [x2, y2] = polar(endDeg, rOut);
        const [x3, y3] = polar(endDeg, rIn);
        const [x4, y4] = polar(startDeg, rIn);
        const large = endDeg - startDeg > 180 ? 1 : 0;
        return (
            `M ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
            `A ${rOut} ${rOut} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
            `L ${x3.toFixed(2)} ${y3.toFixed(2)} ` +
            `A ${rIn} ${rIn} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`
        );
    }

    (function buildDial() {
        document.getElementById("outerArc").setAttribute("d", makeArc(-90, 90, 148));
        document.getElementById("innerArc").setAttribute("d", makeArc(-90, 90, 82));

        sectorEls.peremoga.setAttribute("d", makeSector(-90, -30.5, 84, 134));
        sectorEls.zrada.setAttribute("d", makeSector(-29.5, 29.5, 84, 134));
        sectorEls.zadnitsa.setAttribute("d", makeSector(30.5, 90, 84, 134));

        document.getElementById("tp-peremoga").setAttribute("d", makeArc(-87, -33, 109));
        document.getElementById("tp-zrada").setAttribute("d", makeArc(-27, 27, 109));
        document.getElementById("tp-zadnitsa").setAttribute("d", makeArc(33, 87, 109));

        const dividers = document.getElementById("sectorDividers");
        [-30, 30].forEach((deg) => {
            const [x1, y1] = polar(deg, 82);
            const [x2, y2] = polar(deg, 148);
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", x1.toFixed(2));
            line.setAttribute("y1", y1.toFixed(2));
            line.setAttribute("x2", x2.toFixed(2));
            line.setAttribute("y2", y2.toFixed(2));
            dividers.appendChild(line);
        });

        const ticksGroup = document.getElementById("dialTicks");
        for (let step = 0; step <= 72; step++) {
            const deg = -90 + step * 2.5;
            const isMajor = step % 6 === 0;
            const isMed = !isMajor && step % 2 === 0;

            const rOut = 146;
            const rIn = isMajor ? 136 : (isMed ? 140 : 142.5);
            const [x1, y1] = polar(deg, rIn);
            const [x2, y2] = polar(deg, rOut);

            const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
            tick.setAttribute("x1", x1.toFixed(2));
            tick.setAttribute("y1", y1.toFixed(2));
            tick.setAttribute("x2", x2.toFixed(2));
            tick.setAttribute("y2", y2.toFixed(2));
            tick.setAttribute("stroke", isMajor ? "var(--dial-tick-major)" : "var(--dial-tick)");
            tick.setAttribute("stroke-width", isMajor ? "1.6" : (isMed ? "1.1" : "0.75"));
            tick.setAttribute("stroke-linecap", "round");
            ticksGroup.appendChild(tick);
        }
    })();

    /* ======================================================================
       3. ЗВУКОВОЙ СИНТЕЗАТОР (WEB AUDIO API)
       ====================================================================== */
    let audioCtx = null;
    let masterBus = null;
    let fxBus = null;
    let humNodes = null;

    function ensureAudio() {
        if (!isSoundOn) return false;
        try {
            if (!audioCtx) {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC) return false;
                audioCtx = new AC();

                const compressor = audioCtx.createDynamicsCompressor();
                compressor.threshold.value = -14;
                compressor.knee.value = 18;
                compressor.ratio.value = 4;
                compressor.attack.value = 0.003;
                compressor.release.value = 0.16;

                masterBus = audioCtx.createGain();
                masterBus.gain.value = 0.85;
                masterBus.connect(compressor);
                compressor.connect(audioCtx.destination);

                const delay = audioCtx.createDelay(0.5);
                delay.delayTime.value = 0.085;
                const fb = audioCtx.createGain();
                fb.gain.value = 0.22;
                const lp = audioCtx.createBiquadFilter();
                lp.type = "lowpass";
                lp.frequency.value = 1900;
                const wet = audioCtx.createGain();
                wet.gain.value = 0.18;

                fxBus = audioCtx.createGain();
                fxBus.connect(delay);
                delay.connect(lp);
                lp.connect(fb);
                fb.connect(delay);
                lp.connect(wet);
                wet.connect(masterBus);
            }
            if (audioCtx.state === "suspended") {
                audioCtx.resume();
            }
            return true;
        } catch (_) {
            return false;
        }
    }

    function playGlassTap() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1420, now);
        osc.frequency.exponentialRampToValueAtTime(1920, now + 0.018);

        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.032);

        osc.connect(gain);
        gain.connect(masterBus);
        gain.connect(fxBus);
        osc.start(now);
        osc.stop(now + 0.035);
    }

    function playSwitchClick() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;

        const thump = audioCtx.createOscillator();
        const tGain = audioCtx.createGain();
        thump.type = "sine";
        thump.frequency.setValueAtTime(210, now);
        thump.frequency.exponentialRampToValueAtTime(58, now + 0.042);
        tGain.gain.setValueAtTime(0.22, now);
        tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        thump.connect(tGain);
        tGain.connect(masterBus);
        thump.start(now);
        thump.stop(now + 0.048);

        const len = Math.floor(audioCtx.sampleRate * 0.014);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.22));
        }
        const src = audioCtx.createBufferSource();
        src.buffer = buf;

        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1650;
        bp.Q.value = 2.2;

        const nGain = audioCtx.createGain();
        nGain.gain.setValueAtTime(0.16, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.014);

        src.connect(bp);
        bp.connect(nGain);
        nGain.connect(masterBus);
        src.start(now);
    }

    function startScanHum() {
        if (!ensureAudio() || humNodes) return;
        const now = audioCtx.currentTime;

        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const lp = audioCtx.createBiquadFilter();
        const gain = audioCtx.createGain();

        osc1.type = "triangle";
        osc1.frequency.value = 58;
        osc2.type = "sine";
        osc2.frequency.value = 116;

        lp.type = "lowpass";
        lp.frequency.value = 230;

        gain.gain.setValueAtTime(0.0005, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.14);

        osc1.connect(lp);
        osc2.connect(lp);
        lp.connect(gain);
        gain.connect(masterBus);

        osc1.start(now);
        osc2.start(now);
        humNodes = { osc1, osc2, gain };
    }

    function stopScanHum() {
        if (!humNodes || !audioCtx) return;
        const now = audioCtx.currentTime;
        const { osc1, osc2, gain } = humNodes;
        humNodes = null;
        try {
            gain.gain.cancelScheduledValues(now);
            gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.001), now);
            gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.12);
            osc1.stop(now + 0.14);
            osc2.stop(now + 0.14);
        } catch (_) {}
    }

    function playGeigerTick(velocityNorm) {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;

        const len = Math.floor(audioCtx.sampleRate * 0.012);
        const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.18));
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buf;

        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1950 + velocityNorm * 1100 + Math.random() * 500;
        bp.Q.value = 3.8;

        const gain = audioCtx.createGain();
        const amp = 0.12 + Math.min(velocityNorm, 1) * 0.10;
        gain.gain.setValueAtTime(amp, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.012);

        noise.connect(bp);
        bp.connect(gain);
        gain.connect(masterBus);
        noise.start(now);
    }

    function playNeedleLatch() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(125, now);
        osc.frequency.exponentialRampToValueAtTime(52, now + 0.04);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
        osc.connect(gain);
        gain.connect(masterBus);
        osc.start(now);
        osc.stop(now + 0.05);
    }

    function playPeremoga() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;
        const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];

        chord.forEach((freq, i) => {
            const t = now + i * 0.068;
            [-3, 3].forEach((cents) => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = i === 0 ? "triangle" : "sine";
                osc.frequency.setValueAtTime(freq, t);
                osc.detune.value = cents;

                gain.gain.setValueAtTime(0.0008, t);
                gain.gain.linearRampToValueAtTime(0.085, t + 0.018);
                gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.72);

                osc.connect(gain);
                gain.connect(masterBus);
                gain.connect(fxBus);
                osc.start(t);
                osc.stop(t + 0.75);
            });
        });
    }

    function playZrada() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;

        [0, 0.21].forEach((offset) => {
            const t = now + offset;
            const osc1 = audioCtx.createOscillator();
            const osc2 = audioCtx.createOscillator();
            const filter = audioCtx.createBiquadFilter();
            const gain = audioCtx.createGain();

            osc1.type = "triangle";
            osc2.type = "sawtooth";

            osc1.frequency.setValueAtTime(640, t);
            osc1.frequency.exponentialRampToValueAtTime(450, t + 0.14);
            osc2.frequency.setValueAtTime(905, t);
            osc2.frequency.exponentialRampToValueAtTime(636, t + 0.14);

            filter.type = "lowpass";
            filter.frequency.setValueAtTime(2200, t);
            filter.frequency.exponentialRampToValueAtTime(900, t + 0.15);
            filter.Q.value = 3.2;

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(0.12, t + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.165);

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(masterBus);
            gain.connect(fxBus);

            osc1.start(t);
            osc2.start(t);
            osc1.stop(t + 0.175);
            osc2.stop(t + 0.175);
        });
    }

    function playZadnitsa() {
        if (!ensureAudio()) return;
        const now = audioCtx.currentTime;
        const steps = [
            { freq: 146.83, dur: 0.20, gap: 0.00 },
            { freq: 138.59, dur: 0.20, gap: 0.22 },
            { freq: 130.81, dur: 0.20, gap: 0.44 },
            { freq: 123.47, dur: 0.72, gap: 0.66, slideTo: 103.83 }
        ];

        steps.forEach((step) => {
            const t = now + step.gap;
            const oscSaw = audioCtx.createOscillator();
            const oscSub = audioCtx.createOscillator();
            const formant = audioCtx.createBiquadFilter();
            const gain = audioCtx.createGain();

            oscSaw.type = "sawtooth";
            oscSub.type = "triangle";

            oscSaw.frequency.setValueAtTime(step.freq, t);
            oscSub.frequency.setValueAtTime(step.freq * 0.5, t);

            if (step.slideTo) {
                oscSaw.frequency.linearRampToValueAtTime(step.slideTo, t + step.dur);
                oscSub.frequency.linearRampToValueAtTime(step.slideTo * 0.5, t + step.dur);

                const lfo = audioCtx.createOscillator();
                const lfoGain = audioCtx.createGain();
                lfo.frequency.value = 5.6;
                lfoGain.gain.value = 3.2;
                lfo.connect(lfoGain);
                lfoGain.connect(oscSaw.frequency);
                lfo.start(t + 0.14);
                lfo.stop(t + step.dur);
            }

            formant.type = "lowpass";
            formant.Q.value = 2.9;
            formant.frequency.setValueAtTime(280, t);
            formant.frequency.exponentialRampToValueAtTime(920, t + 0.07);
            formant.frequency.exponentialRampToValueAtTime(300, t + step.dur);

            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(0.15, t + 0.03);
            gain.gain.setValueAtTime(0.14, t + step.dur * 0.72);
            gain.gain.exponentialRampToValueAtTime(0.0008, t + step.dur);

            oscSaw.connect(formant);
            oscSub.connect(formant);
            formant.connect(gain);
            gain.connect(masterBus);
            gain.connect(fxBus);

            oscSaw.start(t);
            oscSub.start(t);
            oscSaw.stop(t + step.dur + 0.02);
            oscSub.stop(t + step.dur + 0.02);
        });
    }

    /* ======================================================================
       4. ТЕМЫ И ЗВУК
       ====================================================================== */
    function applyTheme(theme, playFeedback) {
        if (!THEME_META_COLORS[theme]) theme = "dark";
        root.setAttribute("data-theme", theme);
        if (themeMeta) themeMeta.setAttribute("content", THEME_META_COLORS[theme]);

        segBtns.forEach((btn) => {
            const active = btn.dataset.theme === theme;
            btn.setAttribute("aria-pressed", active ? "true" : "false");
            if (active) {
                themeSeg.style.setProperty("--seg-idx", btn.dataset.idx);
            }
        });

        safeSetStorage("zrada-glass-theme", theme);
        if (playFeedback) playGlassTap();
    }

    function applySoundState(enabled, playFeedback) {
        isSoundOn = enabled;
        soundBtn.classList.toggle("active", isSoundOn);
        soundBtn.setAttribute("aria-pressed", isSoundOn ? "true" : "false");
        soundIconOn.style.display = isSoundOn ? "block" : "none";
        soundIconOff.style.display = isSoundOn ? "none" : "block";
        safeSetStorage("zrada-sound", isSoundOn ? "1" : "0");
        if (isSoundOn && playFeedback) playGlassTap();
    }

    segBtns.forEach((btn) => {
        btn.addEventListener("click", () => applyTheme(btn.dataset.theme, true));
    });

    soundBtn.addEventListener("click", () => {
        applySoundState(!isSoundOn, true);
    });

    const initialTheme = root.getAttribute("data-theme") === "light" ? "light" : "dark";
    applyTheme(initialTheme, false);
    applySoundState(safeGetStorage("zrada-sound", "1") !== "0", false);

    /* ======================================================================
       5. МЯГКИЙ ОПТИЧЕСКИЙ БЛИК НА ГРАНЯХ СТЕКЛА
       ====================================================================== */
    let pointerRaf = null;
    let lastPx = 0.28;
    let lastPy = 0.16;

    function updateGlassLight() {
        pointerRaf = null;
        instrument.style.setProperty("--gx", `${(lastPx * 100).toFixed(1)}%`);
        instrument.style.setProperty("--gy", `${(lastPy * 100).toFixed(1)}%`);
        instrument.style.setProperty("--rim-angle", `${Math.round(122 + (lastPx - 0.5) * 44)}deg`);
    }

    window.addEventListener("pointermove", (e) => {
        const rect = instrument.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        lastPx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        lastPy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        if (!pointerRaf) pointerRaf = requestAnimationFrame(updateGlassLight);
    }, { passive: true });

    /* ======================================================================
       6. ПРУЖИННАЯ ФИЗИКА СТРЕЛКИ
       ====================================================================== */
    const physics = {
        angle: 0,
        velocity: 0,
        target: 0,
        mode: "idle",
        lastTs: 0,
        lastTickBucket: 0,
        lastTickAudioTs: 0,
        rafId: null,
        onSettled: null
    };

    function renderNeedle(deg) {
        needleGroup.setAttribute("transform", `rotate(${deg.toFixed(2)} ${CX} ${CY})`);
    }

    function stepPhysics(ts) {
        if (!physics.lastTs) physics.lastTs = ts;
        const dt = Math.min((ts - physics.lastTs) / 1000, 0.04);
        physics.lastTs = ts;

        if (physics.mode !== "idle") {
            const stiffness = physics.mode === "scanning" ? 225 : 138;
            const damping = physics.mode === "scanning" ? 11.5 : 13.8;

            const accel = (physics.target - physics.angle) * stiffness - physics.velocity * damping;
            physics.velocity += accel * dt;
            physics.angle += physics.velocity * dt;

            if (physics.angle < -92) {
                physics.angle = -92;
                physics.velocity = Math.abs(physics.velocity) * 0.42;
            } else if (physics.angle > 92) {
                physics.angle = 92;
                physics.velocity = -Math.abs(physics.velocity) * 0.42;
            }

            renderNeedle(physics.angle);

            if (physics.mode === "scanning") {
                const bucket = Math.round(physics.angle / 8);
                if (bucket !== physics.lastTickBucket && ts - physics.lastTickAudioTs > 46) {
                    physics.lastTickBucket = bucket;
                    physics.lastTickAudioTs = ts;
                    playGeigerTick(Math.abs(physics.velocity) / 420);
                    tryVibrate(4);
                }
            }

            if (
                physics.mode === "settling" &&
                Math.abs(physics.angle - physics.target) < 0.28 &&
                Math.abs(physics.velocity) < 1.1
            ) {
                physics.angle = physics.target;
                physics.velocity = 0;
                physics.mode = "idle";
                renderNeedle(physics.angle);
                physics.rafId = null;
                if (typeof physics.onSettled === "function") {
                    const cb = physics.onSettled;
                    physics.onSettled = null;
                    cb();
                }
                return;
            }
        }

        physics.rafId = requestAnimationFrame(stepPhysics);
    }

    function ensurePhysicsLoop() {
        if (!physics.rafId) {
            physics.lastTs = 0;
            physics.rafId = requestAnimationFrame(stepPhysics);
        }
    }

    /* ======================================================================
       7. ЛОГИКА ЗАМЕРА
       ====================================================================== */
    function clearSectorHighlight() {
        Object.keys(sectorEls).forEach((k) => {
            sectorEls[k].classList.remove("active");
            labelEls[k].classList.remove("active");
        });
    }

    function startAnalysis() {
        if (isScanning) return;
        isScanning = true;

        ensureAudio();
        playSwitchClick();
        startScanHum();

        clearSectorHighlight();
        body.removeAttribute("data-verdict");
        instrument.classList.add("shaking");
        led.classList.add("scanning");

        scanBtn.disabled = true;
        scanBtn.classList.add("loading");
        scanBtnLabel.textContent = "Сканирую…";

        verdictText.textContent = "Идёт замер…";
        verdictText.style.color = "var(--text-primary)";

        physics.mode = "scanning";
        ensurePhysicsLoop();

        let swingDir = physics.angle >= 0 ? -1 : 1;
        const swingTimer = setInterval(() => {
            const magnitude = 35 + Math.random() * 54;
            physics.target = swingDir * magnitude;
            swingDir = -swingDir;
        }, 135);

        physics.target = swingDir * (58 + Math.random() * 28);

        setTimeout(() => {
            clearInterval(swingTimer);
            stopScanHum();

            instrument.classList.remove("shaking");
            led.classList.remove("scanning");

            const finalAngle = Math.round((Math.random() * 176 - 88) * 10) / 10;
            let settleDone = false;

            const finalize = () => {
                if (settleDone) return;
                settleDone = true;
                revealVerdict(finalAngle);
            };

            physics.mode = "settling";
            physics.target = finalAngle;
            physics.onSettled = finalize;

            setTimeout(() => {
                if (!settleDone) {
                    physics.mode = "idle";
                    physics.angle = finalAngle;
                    physics.velocity = 0;
                    renderNeedle(finalAngle);
                    finalize();
                }
            }, 1150);
        }, 1600);
    }

    function revealVerdict(angle) {
        isScanning = false;
        playNeedleLatch();

        let zone = "zrada";
        let title = "ТРЕВОГА: ЗРАДА! 😱";
        let colorVar = "var(--zone-zrada)";

        if (angle <= -30) {
            zone = "peremoga";
            title = "ЕСТЬ ПЕРЕМОГА! 😎";
            colorVar = "var(--zone-peremoga)";
            playPeremoga();
        } else if (angle >= 30) {
            zone = "zadnitsa";
            title = "ПОЛНАЯ ЗАДНИЦА 🍑";
            colorVar = "var(--zone-zadnitsa)";
            playZadnitsa();
        } else {
            playZrada();
        }

        body.setAttribute("data-verdict", zone);
        sectorEls[zone].classList.add("active");
        labelEls[zone].classList.add("active");

        verdictText.classList.remove("pop");
        void verdictText.offsetWidth;
        verdictText.classList.add("pop");
        verdictText.textContent = title;
        verdictText.style.color = colorVar;

        tryVibrate([55, 35, 70]);

        scanBtn.disabled = false;
        scanBtn.classList.remove("loading");
        scanBtnLabel.textContent = "Замерить ещё";
    }

    scanBtn.addEventListener("click", startAnalysis);

    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" || e.code === "Enter") {
            if (document.activeElement && document.activeElement.tagName === "A") return;
            if (document.activeElement && document.activeElement.closest(".seg-control, .sound-btn")) return;
            e.preventDefault();
            startAnalysis();
        } else if (e.key && e.key.toLowerCase() === "m") {
            applySoundState(!isSoundOn, true);
        }
    });

    renderNeedle(0);
})();
