import { Application } from "pixi.js";
import { Fish, type SegmentBlueprint, type FishConfig } from "./fish";
import { Vector2D } from "./vector";
import { ImageProcessor } from "./imageProcessor";

interface TrackTimeline {
    curve: 'none' | 'linear' | 'cubic' | 'exponential';
    startVal: number;
    endVal: number;
    duration: number;
    elapsed: number;
}

export class Pond {
    private app!: Application;
    private fishSchool: Fish[] = [];
    private mouse: Vector2D = new Vector2D(0, 0);
    private defaultBlueprint: SegmentBlueprint[] = [];
    public fieldGrid!: { bgAngles: Float32Array; bgDistances: Float32Array; fgAngles: Float32Array; fgDistances: Float32Array; cols: number; rows: number };

    private fishConfig: FishConfig = {
        visualRange: 45.0,
        protectedRange: 20.0,
        separationWeight: 1.6,
        alignmentWeight: 0.6,
        cohesionWeight: 1.35,
        maxSpeed: 8.0,
        minSpeed: 3.0,
        maxForce: 0.05,
        noiseScale: 0.12,
        latencyInterval: 4,
        affinityStrength: 50.0,
        mosaicFocus: 0.0
    };

    private timelines: { [key: string]: TrackTimeline } = {};

    private readonly tokenMap: { [key: string]: string } = {
        visualRange: 'v', protectedRange: 'p', separationWeight: 'w',
        alignmentWeight: 'a', cohesionWeight: 'c', maxSpeed: 's',
        minSpeed: 'n', affinityStrength: 'y', mosaicFocus: 'k'
    };

    constructor() {
        this.mouse.set(window.innerWidth / 2, window.innerHeight / 2);
        
        // Initialize tracks with configuration constants
        Object.keys(this.tokenMap).forEach(key => {
            this.timelines[key] = { curve: 'none', startVal: this.fishConfig[key as keyof FishConfig], endVal: this.fishConfig[key as keyof FishConfig], duration: 4.0, elapsed: 0 };
        });
    }

    public async init() {
        this.app = new Application();
        await this.app.init({
            antialias: true,
            resizeTo: window,
            backgroundColor: 0x0b131a
        });
        document.body.appendChild(this.app.canvas);

        const totalSegments = 12;
        const biologicalWidths = [12.5, 14.5, 15.0, 14.8, 13.5, 11.5, 9.0, 7.0, 5.5, 3.5, 2.5, 1.0];

        for (let i = 0; i < totalSegments; i++) {
            const factor = i / (totalSegments - 1);
            this.defaultBlueprint.push({
                jointSpacing: 12,
                bodyWidth: biologicalWidths[i],
                maxAngle: 0.12 + factor * (0.28 - 0.12)
            });
        }

        // =================================================================
        // DECODE COMPACT PARAMETER STRINGS FROM SHARED INCOMING LINKS
        // =================================================================
        const urlParams = new URLSearchParams(window.location.search);
        
        Object.entries(this.tokenMap).forEach(([key, token]) => {
            if (urlParams.has(token)) {
                const rawQuadruplet = urlParams.get(token)!;
                const parts = rawQuadruplet.split(',');

                if (parts.length === 2) {
                    const constantVal = parseFloat(parts[0]);
                    this.timelines[key] = { curve: 'none', startVal: constantVal, endVal: constantVal, duration: 4.0, elapsed: 0 };
                } else if (parts.length === 4) {
                    const s = parseFloat(parts[0]);
                    const e = parseFloat(parts[1]);
                    const d = parseFloat(parts[2]);
                    const cShort = parts[3];

                    let curve: 'none' | 'linear' | 'cubic' | 'exponential' = 'none';
                    if (cShort === 'l') curve = 'linear';
                    else if (cShort === 'c') curve = 'cubic';
                    else if (cShort === 'e') curve = 'exponential';

                    this.timelines[key] = { curve, startVal: s, endVal: e, duration: d, elapsed: 0 };
                }
            }
        });

        // Hydrate asset selection controls
        if (urlParams.has("m")) (document.getElementById('asset-mode-select') as HTMLSelectElement).value = urlParams.get("m")!;
        if (urlParams.has("o")) (document.getElementById('text-color-style-select') as HTMLSelectElement).value = urlParams.get("o")!;
        if (urlParams.has("t")) (document.getElementById('input-text-string') as HTMLInputElement).value = decodeURIComponent(urlParams.get("t")!);
        if (urlParams.has("i")) (document.getElementById('input-image-url') as HTMLInputElement).value = atob(urlParams.get("i")!);
        if (urlParams.get("r") === "1") (document.getElementById('check-randomSpawn') as HTMLInputElement).checked = true;

        const elementsMap = { b: "slide-bgCount", x: "slide-bgScale", f: "slide-fgCount", z: "slide-fgScale", g: "slide-fontSize" };
        Object.entries(elementsMap).forEach(([token, id]) => {
            if (urlParams.has(token)) {
                const el = document.getElementById(id) as HTMLInputElement;
                const textEl = document.getElementById(`val-${id.split('-')[1]}`);
                if (el) {
                    el.value = urlParams.get(token)!;
                    if (textEl) textEl.textContent = parseFloat(el.value).toFixed(id.includes('Scale') || id.includes('Size') ? 2 : 0);
                }
            }
        });

        // Sync inputs with parsed configurations
        Object.keys(this.tokenMap).forEach(key => this.syncTimelineStateToDOM(key));

        await this.respSchoolWithSliders();
        this.setupListeners();
        this.setupSliders();
        this.setupMnemonicShareEngine();

        window.addEventListener('timeline-control-update', (e: any) => {
            this.syncDOMStateToTimeline(e.detail.key);
        });

        this.app.ticker.add((ticker) => this.tick(ticker.deltaTime));
    }

    private syncTimelineStateToDOM(key: string) {
        const track = this.timelines[key];
        if (!track) return;

        const cacheInput = document.getElementById(`cache-${key}-curve`) as HTMLInputElement;
        if (cacheInput) cacheInput.value = track.curve;

        const btn = document.getElementById(`btn-${key}-${track.curve}`);
        if (btn) {
            const block = document.getElementById(`block-${key}`);
            if (block) block.querySelectorAll('.curve-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        const lblStart = document.getElementById(`lbl-${key}-start`);
        const fieldEnd = document.getElementById(`field-${key}-end`);
        const fieldDur = document.getElementById(`field-${key}-dur`);

        if (track.curve === 'none') {
            if (lblStart) lblStart.textContent = "Constant";
            if (fieldEnd) fieldEnd.style.display = "none";
            if (fieldDur) fieldDur.style.display = "none";
        } else {
            if (lblStart) lblStart.textContent = "Start Val";
            if (fieldEnd) fieldEnd.style.display = "flex";
            if (fieldDur) fieldDur.style.display = "flex";
        }

        const inputStart = document.getElementById(`input-${key}-start`) as HTMLInputElement;
        const inputEnd = document.getElementById(`input-${key}-end`) as HTMLInputElement;
        const inputDur = document.getElementById(`input-${key}-dur`) as HTMLInputElement;

        if (inputStart) inputStart.value = track.startVal.toString();
        if (inputEnd) inputEnd.value = track.endVal.toString();
        if (inputDur) inputDur.value = track.duration.toString();
    }

    private syncDOMStateToTimeline(key: string) {
        const cacheEl = document.getElementById(`cache-${key}-curve`) as HTMLInputElement;
        if (!cacheEl) return;
        
        const curve = cacheEl.value as any;
        const startVal = parseFloat((document.getElementById(`input-${key}-start`) as HTMLInputElement).value || "0");
        const endVal = parseFloat((document.getElementById(`input-${key}-end`) as HTMLInputElement).value || "0");
        const duration = parseFloat((document.getElementById(`input-${key}-dur`) as HTMLInputElement).value || "4.0");

        this.timelines[key] = { curve, startVal, endVal, duration, elapsed: 0 };
    }

    public async respawnSchool() {
        await this.respSchoolWithSliders();
    }

    private async respSchoolWithSliders() {
        for (const fish of this.fishSchool) {
            this.app.stage.removeChild(fish.pixiMesh);
            fish.pixiMesh.destroy({ children: true, texture: false });
        }
        this.fishSchool = [];

        const mode = (document.getElementById('asset-mode-select') as HTMLSelectElement).value;
        const textVal = (document.getElementById('input-text-string') as HTMLInputElement).value;
        const imgVal = (document.getElementById('input-image-url') as HTMLInputElement).value;
        const colorMode = (document.getElementById('text-color-style-select') as HTMLSelectElement).value;
        const gradStart = (document.getElementById('picker-grad-start') as HTMLInputElement).value;
        const gradEnd = (document.getElementById('picker-grad-end') as HTMLInputElement).value;

        const bgCount = parseInt((document.getElementById('slide-bgCount') as HTMLInputElement)?.value || "1200");
        const fgCount = parseInt((document.getElementById('slide-fgCount') as HTMLInputElement)?.value || "600");
        const bgScale = parseFloat((document.getElementById('slide-bgScale') as HTMLInputElement)?.value || "0.38");
        const fgScale = parseFloat((document.getElementById('slide-fgScale') as HTMLInputElement)?.value || "0.22");
        const textSizeMultiplier = parseFloat((document.getElementById('slide-fontSize') as HTMLInputElement)?.value || "1.00");
        const randomSpawnActive = (document.getElementById('check-randomSpawn') as HTMLInputElement).checked;

        // Reset track timelines to zero progress
        Object.keys(this.tokenMap).forEach(key => this.syncDOMStateToTimeline(key));

        const source = {
            type: mode,
            value: imgVal,
            textValue: textVal,
            colorMode, gradStart, gradEnd,
            textSizeMultiplier
        };

        const result = await ImageProcessor.analyze(bgCount, fgCount, this.app.screen.width, this.app.screen.height, source);
        this.fieldGrid = result.fieldGrid;

        // Spawning: Background Raster Image School
        result.bgAnalyses.forEach(tile => {
            const fish = new Fish(tile.centroidX, tile.centroidY, this.defaultBlueprint, this.fishConfig,
                { body: tile.primaryColor, fin: tile.secondaryColor, coverage: tile.spotCoverage }, bgScale, this);
            fish.isForeground = false;
            
            // Randomize position vectors if checkbox is active
            if (randomSpawnActive) {
                const rx = Math.random() * this.app.screen.width;
                const ry = Math.random() * this.app.screen.height;
                fish.joints.forEach(j => { j.x = rx; j.y = ry; });
            }
            
            this.fishSchool.push(fish);
            this.app.stage.addChild(fish.pixiMesh);
        });

        // Spawning: Foreground Typography School
        result.fgAnalyses.forEach(tile => {
            const fish = new Fish(tile.centroidX, tile.centroidY, this.defaultBlueprint, this.fishConfig,
                { body: tile.primaryColor, fin: tile.secondaryColor, coverage: tile.spotCoverage }, fgScale, this);
            fish.isForeground = true;

            if (randomSpawnActive) {
                const rx = Math.random() * this.app.screen.width;
                const ry = Math.random() * this.app.screen.height;
                fish.joints.forEach(j => { j.x = rx; j.y = ry; });
            }

            this.fishSchool.push(fish);
            this.app.stage.addChild(fish.pixiMesh);
        });

        this.fishSchool.forEach(fish => {
            fish.updateMeshGeometry();
        });
    }

    private setupListeners() {
        window.addEventListener("mousemove", (e) => {
            this.mouse.set(e.clientX, e.clientY);
        });
    }

    private setupSliders() {
        Object.keys(this.tokenMap).forEach(key => {
            ['start', 'end', 'dur'].forEach(field => {
                document.getElementById(`input-${key}-${field}`)?.addEventListener('input', () => {
                    this.syncDOMStateToTimeline(key);
                });
            });
        });

        ['bgCount', 'bgScale', 'fgCount', 'fgScale', 'fontSize'].forEach(id => {
            document.getElementById(`slide-${id}`)?.addEventListener('change', () => {
                this.respSchoolWithSliders().catch(e => console.error("Hot update error:", e));
            });
        });
        
        document.getElementById('check-randomSpawn')?.addEventListener('change', () => {
            this.respSchoolWithSliders().catch(e => console.error("Spawn mutation breakdown:", e));
        });
    }

    private setupMnemonicShareEngine() {
        document.getElementById('btn-generate-url')?.addEventListener('click', () => {
            const params = new URLSearchParams();
            params.set('view', 'art');

            const mode = (document.getElementById('asset-mode-select') as HTMLSelectElement).value;
            const textVal = (document.getElementById('input-text-string') as HTMLInputElement).value.trim();
            const imgVal = (document.getElementById('input-image-url') as HTMLInputElement).value.trim();
            const colorMode = (document.getElementById('text-color-style-select') as HTMLSelectElement).value;
            const randomSpawnActive = (document.getElementById('check-randomSpawn') as HTMLInputElement).checked;

            params.set('m', mode);
            if (textVal) params.set('t', encodeURIComponent(textVal));
            if (imgVal)  params.set('i', btoa(imgVal)); 
            params.set('o', colorMode);
            params.set('r', randomSpawnActive ? "1" : "0");

            params.set('b', (document.getElementById('slide-bgCount') as HTMLInputElement).value);
            params.set('x', (document.getElementById('slide-bgScale') as HTMLInputElement).value);
            params.set('f', (document.getElementById('slide-fgCount') as HTMLInputElement).value);
            params.set('z', (document.getElementById('slide-fgScale') as HTMLInputElement).value);
            params.set('g', (document.getElementById('slide-fontSize') as HTMLInputElement).value);

            Object.entries(this.tokenMap).forEach(([key, token]) => {
                const curve = (document.getElementById(`cache-${key}-curve`) as HTMLInputElement).value;
                const startVal = (document.getElementById(`input-${key}-start`) as HTMLInputElement).value;
                const endVal = (document.getElementById(`input-${key}-end`) as HTMLInputElement).value;
                const duration = (document.getElementById(`input-${key}-dur`) as HTMLInputElement).value;

                if (curve === 'none') {
                    params.set(token, `${startVal},none`);
                } else {
                    const cShort = curve === 'linear' ? 'l' : (curve === 'cubic' ? 'c' : 'e');
                    params.set(token, `${startVal},${endVal},${duration},${cShort}`);
                }
            });

            const shareLink = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
            navigator.clipboard.writeText(shareLink).then(() => {
                alert("✨ Multi-Track Animation Packaged URL Copied!");
                window.location.href = shareLink;
            });
        });
    }

    private tick(dt: number) {
        const timeDeltaSeconds = dt / 60.0;

        // =================================================================
        // INDEPENDENT TIMELINE VELOCITY INTERPOLATION LIFECYCLE
        // =================================================================
        Object.keys(this.tokenMap).forEach(key => {
            const track = this.timelines[key];
            if (!track) return;

            if (track.curve === 'none') {
                this.fishConfig[key as keyof FishConfig] = track.startVal;
            } else {
                track.elapsed += timeDeltaSeconds;
                const progress = Math.min(1.0, track.elapsed / track.duration);
                let easeFactor = progress;

                if (track.curve === 'cubic') {
                    easeFactor = progress * progress * (3.0 - 2.0 * progress);
                } else if (track.curve === 'exponential') {
                    easeFactor = progress === 1.0 ? 1.0 : 1.0 - Math.pow(2, -10 * progress);
                }

                const blendedVal = track.startVal + (track.endVal - track.startVal) * easeFactor;
                this.fishConfig[key as keyof FishConfig] = blendedVal;
            }

            const textDisplay = document.getElementById(`live-val-${key}`);
            if (textDisplay) {
                textDisplay.textContent = this.fishConfig[key as keyof FishConfig].toFixed(
                    key === 'visualRange' || key === 'protectedRange' || key === 'affinityStrength' || key === 'mosaicFocus' ? 0 : 2
                );
            }
        });

        const screenW = this.app.screen.width;
        const screenH = this.app.screen.height;
        
        const cellSize = this.fishConfig.visualRange;
        const cols = Math.ceil(screenW / cellSize);
        const rows = Math.ceil(screenH / cellSize);

        const grid: Fish[][] = Array.from({ length: cols * rows }, () => []);

        for (let i = 0; i < this.fishSchool.length; i++) {
            const fish = this.fishSchool[i];
            const cellX = Math.max(0, Math.min(cols - 1, Math.floor(fish.headPos.x / cellSize)));
            const cellY = Math.max(0, Math.min(rows - 1, Math.floor(fish.headPos.y / cellSize)));
            grid[cellX + cellY * cols].push(fish);
        }

        for (let i = 0; i < this.fishSchool.length; i++) {
            const fish = this.fishSchool[i];
            fish.schooling(grid, screenW, screenH);
            fish.move(dt);
        }
    }
}
