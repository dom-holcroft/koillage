import { Application } from "pixi.js";
import { Fish, type SegmentBlueprint, type FishConfig } from "./fish";
import { Vector2D } from "./vector";
import { ImageProcessor } from "./imageProcessor";

export class Pond {
    private app!: Application;
    private fishSchool: Fish[] = [];
    private mouse: Vector2D = new Vector2D(0, 0);

        private fishConfig: FishConfig = {
        visualRange: 20.0,
        protectedRange: 15.0,
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

    constructor() {
        this.mouse.set(window.innerWidth / 2, window.innerHeight / 2);
    }

    public async init() {
        const style = document.createElement("style");
        style.innerHTML = `
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body, html { width: 100%; height: 100%; overflow: hidden; background: #0b131a; }
            canvas { display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
        `;
        document.head.appendChild(style);

        this.app = new Application();
        await this.app.init({
            antialias: true,
            resizeTo: window,
            backgroundColor: 0x0b131a
        });
        document.body.appendChild(this.app.canvas);

        const defaultBlueprint: SegmentBlueprint[] = [];
        const totalSegments = 12;
        const biologicalWidths = [12.5, 14.5, 15.0, 14.8, 13.5, 11.5, 9.0, 7.0, 5.5, 3.5, 2.5, 1.0];

        for (let i = 0; i < totalSegments; i++) {
            const factor = i / (totalSegments - 1);
            const currentMaxAngle = 0.12 + factor * (0.28 - 0.12);

            defaultBlueprint.push({
                jointSpacing: 12,
                bodyWidth: biologicalWidths[i],
                maxAngle: currentMaxAngle
            });
        }

        const totalFishCount = 1000;
        const screenW = this.app.screen.width;
        const screenH = this.app.screen.height;

        const tileData = await ImageProcessor.analyze(totalFishCount, screenW, screenH);

        for (let i = 0; i < tileData.length; i++) {
            const tile = tileData[i];
            const displayScale = 0.4; 

            const fish = new Fish(
                tile.centroidX,
                tile.centroidY,
                defaultBlueprint,
                this.fishConfig, 
                {
                    body: tile.primaryColor,
                    fin: tile.secondaryColor,
                    coverage: 1.0 - tile.spotCoverage
                },
                displayScale 
            );

            const angle = fish.headingAngle;
            const joints = fish.joints;
            const spacing = 12 * displayScale; 

            for (let j = 1; j < joints.length; j++) {
                joints[j].x = joints[j - 1].x - Math.cos(angle) * spacing;
                joints[j].y = joints[j - 1].y - Math.sin(angle) * spacing;
            }

            this.fishSchool.push(fish);
            this.app.stage.addChild(fish.pixiMesh);
            fish.updateMeshGeometry();
        }

        this.setupListeners();
        this.setupSliders(); 
        this.app.ticker.add((ticker) => this.tick(ticker.deltaTime));
    }

    private setupListeners() {
        window.addEventListener("mousemove", (e) => {
            this.mouse.set(e.clientX, e.clientY);
        });
    }

    private setupSliders() {
        const properties: (keyof FishConfig)[] = [
            "visualRange",
            "protectedRange",
            "separationWeight",
            "alignmentWeight",
            "cohesionWeight",
            "maxSpeed",
            "minSpeed",
            "affinityStrength",
            "mosaicFocus"
        ];

        properties.forEach((key) => {
            const inputElement = document.getElementById(`slide-${key}`) as HTMLInputElement;
            const displayValue = document.getElementById(`val-${key}`);

            if (inputElement && displayValue) {
                inputElement.addEventListener("input", (e) => {
                    const numericValue = parseFloat((e.target as HTMLInputElement).value);
                    this.fishConfig[key] = numericValue;
                    displayValue.textContent = numericValue.toFixed(
                        key === "visualRange" || key === "protectedRange" || key === "affinityStrength" || key === "mosaicFocus" ? 0 : 2
                    );
                });
            }
        });
    }

    private tick(dt: number) {
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
