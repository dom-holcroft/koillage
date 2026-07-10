import { MeshGeometry, Mesh, Shader, GlProgram } from "pixi.js";
import { Vector2D } from "./vector";

export interface FishConfig {
    visualRange: number;
    protectedRange: number;
    separationWeight: number;
    alignmentWeight: number;
    cohesionWeight: number;
    maxSpeed: number;
    minSpeed: number;
    maxForce: number;

    noiseScale: number;
    latencyInterval: number;
    affinityStrength: number;
    mosaicFocus: number;
}

export const DEFAULT_FISH_CONFIG: FishConfig = {
    visualRange: 45.0,
    protectedRange: 20.0,
    separationWeight: 1.5,
    alignmentWeight: 0.4,
    cohesionWeight: 0.1,
    maxSpeed: 8.0,
    minSpeed: 3.0,
    maxForce: 0.1,
    noiseScale: 0.12,
    latencyInterval: 4,
    affinityStrength: 50.0,
    mosaicFocus: 0.0
};

export interface SegmentBlueprint {
    jointSpacing: number;
    bodyWidth: number;
    maxAngle: number;
}

const vertexSrc = `#version 300 es
    in vec2 aPosition;
    in vec2 aUV;
    in float aType; 
    
    out vec2 vUV;
    out float vType;
    
    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;

    void main() {
        vUV = aUV;
        vType = aType;
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
    }
`;

const fragmentSrc = `#version 300 es
    precision highp float;

    in vec2 vUV;
    in float vType;
    out vec4 fragColor;

    uniform vec3 uBodyColor;
    uniform vec3 uFinColor;
    uniform float uSpotCoverage;
    uniform vec2 uPatternOffset;

    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0,0.0)), hash(i + vec2(1.0,0.0)), u.x),
                   mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);
    }

    void main() {
        vec2 patternUV = (vUV * vec2(4.0, 8.0)) + uPatternOffset;
        float n = noise(patternUV);
        float spotMask = smoothstep(uSpotCoverage - 0.05, uSpotCoverage + 0.05, n);
        vec3 baseColor = mix(uBodyColor, uFinColor, spotMask);

        float outline = 0.0;
        
        if (vType == 0.0) {
            float edgeDist = min(vUV.x, 1.0 - vUV.x);
            outline = smoothstep(0.05, 0.0, edgeDist);
        } else if (vType == 1.0 || vType == 3.0) {
            float edgeDist = 1.0 - vUV.x;
            outline = smoothstep(0.12, 0.0, edgeDist);
            baseColor = mix(baseColor, uFinColor * 1.2, vUV.x * 0.4);
        } else if (vType == 2.0) {
            float edgeDist = 1.0 - vUV.x;
            outline = smoothstep(0.15, 0.0, edgeDist);
            baseColor = mix(baseColor, vec3(1.0), 0.15);
        }

        vec3 finalColor = mix(baseColor, vec3(0.16, 0.18, 0.22), outline);
        fragColor = vec4(finalColor, 1.0);
    }
`;

const SHARED_GL_PROGRAM = new GlProgram({ vertex: vertexSrc, fragment: fragmentSrc });

export class Fish {
    private circles: Vector2D[] = [];
    public velocity: Vector2D = new Vector2D(0, 0);
    private acceleration: Vector2D = new Vector2D(0, 0);
    private config: FishConfig;
    private headAngle: number = 0.0;
    private currentScale: number;
    private pond: any;

    private jointSpacings: number[];
    private bodyWidths: number[];
    private maxAngles: number[];
    private segmentAngles: number[];

    public homePos: Vector2D;
    public bodyColor: number[];
    public finColor: number[];
    public spotCoverage: number;

    // Split State Affiliation Parameters
    public isForeground: boolean = false;

    private latencyCounter: number = 0;
    private latencyInterval: number;
    private cachedGroupForce: Vector2D = new Vector2D(0, 0);

    public pixiMesh: Mesh<MeshGeometry, Shader>;
    private geometry: MeshGeometry;
    private positionBuffer: Float32Array;

    private readonly VIRTUAL_COUNT = 32;

    constructor(
        startX: number,
        startY: number,
        segmentBlueprint: SegmentBlueprint[],
        config: FishConfig,
        colors: { body: number[], fin: number[], coverage: number },
        scale: number,
        pondInstance: any
    ) {
        const radiiCount = segmentBlueprint.length;
        this.config = config;
        this.pond = pondInstance;
        this.jointSpacings = new Array(radiiCount);
        this.bodyWidths = new Array(radiiCount);
        this.maxAngles = new Array(radiiCount);
        this.segmentAngles = new Array(radiiCount).fill(0);
        this.currentScale = scale;

        this.homePos = new Vector2D(startX, startY);
        this.bodyColor = colors.body;
        this.finColor = colors.fin;
        this.spotCoverage = colors.coverage;

        this.latencyInterval = Math.floor(Math.random() * config.latencyInterval) + 1;

        this.headAngle = Math.random() * Math.PI * 2;
        this.velocity.set(Math.cos(this.headAngle) * config.maxSpeed, Math.sin(this.headAngle) * config.maxSpeed);

        for (let i = 0; i < radiiCount; i++) {
            this.circles.push(new Vector2D(startX, startY));
            this.jointSpacings[i] = segmentBlueprint[i].jointSpacing * scale;
            this.bodyWidths[i] = segmentBlueprint[i].bodyWidth * scale;
            this.maxAngles[i] = segmentBlueprint[i].maxAngle;
        }

        const bodyVertices = 5 + (this.VIRTUAL_COUNT - 1) * 2;
        const finVertices = 8;
        const dorsalVertices = 6;
        const caudalVertices = 2;

        const totalVertices = bodyVertices + finVertices + dorsalVertices + caudalVertices;
        this.positionBuffer = new Float32Array(totalVertices * 2);
        const uvBuffer = new Float32Array(totalVertices * 2);
        const typeBuffer = new Float32Array(totalVertices);

        const bodyTriangles = 2 + 2 + (this.VIRTUAL_COUNT - 2) * 2;
        const finTriangles = 2 * 4;
        const dorsalTriangles = 5 * 2;
        const caudalTriangles = 2;

        const totalIndices = (bodyTriangles + finTriangles + dorsalTriangles + caudalTriangles) * 3;
        const indexBuffer = new Uint32Array(totalIndices);

        for (let i = 0; i < 5; i++) {
            uvBuffer[i * 2 + 0] = i / 4.0; uvBuffer[i * 2 + 1] = 0.0;
            typeBuffer[i] = 0.0;
        }

        for (let i = 1; i < this.VIRTUAL_COUNT; i++) {
            const vCoord = i / (this.VIRTUAL_COUNT - 1);
            const vIdx = 5 + (i - 1) * 2;
            uvBuffer[vIdx * 2 + 0] = 0.0; uvBuffer[vIdx * 2 + 1] = vCoord;
            uvBuffer[(vIdx + 1) * 2 + 0] = 1.0; uvBuffer[(vIdx + 1) * 2 + 1] = vCoord;
            typeBuffer[vIdx] = 0.0; typeBuffer[vIdx + 1] = 0.0;
        }

        const finStart = bodyVertices;
        for (let i = 0; i < 8; i++) {
            uvBuffer[(finStart + i) * 2 + 0] = 1.0;
            uvBuffer[(finStart + i) * 2 + 1] = i < 4 ? 0.25 : 0.65;
            typeBuffer[finStart + i] = 1.0;
        }

        const dorsalStart = finStart + finVertices;
        for (let i = 0; i < 6; i++) {
            uvBuffer[(dorsalStart + i) * 2 + 0] = 1.0;
            uvBuffer[(dorsalStart + i) * 2 + 1] = 0.35 + (i * 0.08);
            typeBuffer[dorsalStart + i] = 2.0;
        }

        const caudalStart = dorsalStart + dorsalVertices;
        uvBuffer[caudalStart * 2 + 0] = 1.0; uvBuffer[caudalStart * 2 + 1] = 0.92;
        uvBuffer[(caudalStart + 1) * 2 + 0] = 1.0; uvBuffer[(caudalStart + 1) * 2 + 1] = 1.0;
        typeBuffer[caudalStart] = 3.0; typeBuffer[caudalStart + 1] = 3.0;

        let idx = 0;
        indexBuffer[idx++] = 2; indexBuffer[idx++] = 1; indexBuffer[idx++] = 0;
        indexBuffer[idx++] = 2; indexBuffer[idx++] = 3; indexBuffer[idx++] = 1;
        indexBuffer[idx++] = 2; indexBuffer[idx++] = 4; indexBuffer[idx++] = 3;
        indexBuffer[idx++] = 0; indexBuffer[idx++] = 1; indexBuffer[idx++] = 5;
        indexBuffer[idx++] = 1; indexBuffer[idx++] = 3; indexBuffer[idx++] = 5;
        indexBuffer[idx++] = 3; indexBuffer[idx++] = 6; indexBuffer[idx++] = 5;
        indexBuffer[idx++] = 3; indexBuffer[idx++] = 4; indexBuffer[idx++] = 6;

        for (let i = 1; i < this.VIRTUAL_COUNT - 1; i++) {
            const cL = 5 + (i - 1) * 2; const cR = cL + 1;
            const nL = 5 + i * 2; const nR = nL + 1;
            indexBuffer[idx++] = cL; indexBuffer[idx++] = cR; indexBuffer[idx++] = nL;
            indexBuffer[idx++] = cR; indexBuffer[idx++] = nR; indexBuffer[idx++] = nL;
        }

        const idxPec = 5 + Math.floor(0.25 * (this.VIRTUAL_COUNT - 1)) * 2;
        const idxVen = 5 + Math.floor(0.60 * (this.VIRTUAL_COUNT - 1)) * 2;

        indexBuffer[idx++] = idxPec; indexBuffer[idx++] = finStart + 0; indexBuffer[idx++] = finStart + 1;
        indexBuffer[idx++] = idxPec; indexBuffer[idx++] = finStart + 1; indexBuffer[idx++] = idxPec + 2;
        indexBuffer[idx++] = idxPec + 1; indexBuffer[idx++] = idxPec + 3; indexBuffer[idx++] = finStart + 2;
        indexBuffer[idx++] = idxPec + 3; indexBuffer[idx++] = finStart + 3; indexBuffer[idx++] = finStart + 2;
        indexBuffer[idx++] = idxVen; indexBuffer[idx++] = finStart + 4; indexBuffer[idx++] = finStart + 5;
        indexBuffer[idx++] = idxVen; indexBuffer[idx++] = finStart + 5; indexBuffer[idx++] = idxVen + 2;
        indexBuffer[idx++] = idxVen + 1; indexBuffer[idx++] = idxVen + 3; indexBuffer[idx++] = finStart + 6;
        indexBuffer[idx++] = idxVen + 3; indexBuffer[idx++] = finStart + 7; indexBuffer[idx++] = finStart + 6;

        const idxDorStart = Math.floor(0.35 * (this.VIRTUAL_COUNT - 1));
        for (let i = 0; i < 5; i++) {
            const currentFlank = 5 + (idxDorStart + i) * 2;
            const nextFlank = currentFlank + 2;
            const cD = dorsalStart + i;
            const nD = cD + 1;
            indexBuffer[idx++] = currentFlank; indexBuffer[idx++] = cD; indexBuffer[idx++] = nD;
            indexBuffer[idx++] = currentFlank; indexBuffer[idx++] = nD; indexBuffer[idx++] = nextFlank;
        }

        const tailL = 5 + (this.VIRTUAL_COUNT - 2) * 2;
        const tailR = tailL + 1;
        indexBuffer[idx++] = tailL; indexBuffer[idx++] = caudalStart + 0; indexBuffer[idx++] = tailR;
        indexBuffer[idx++] = tailR; indexBuffer[idx++] = caudalStart + 0; indexBuffer[idx++] = caudalStart + 1;

        this.geometry = new MeshGeometry({
            positions: this.positionBuffer,
            uvs: uvBuffer,
            indices: indexBuffer
        });
        this.geometry.addAttribute("aType", typeBuffer);

        const customShader = new Shader({
            glProgram: SHARED_GL_PROGRAM,
            resources: {
                koiUniforms: {
                    uBodyColor: { value: colors.body, type: 'vec3<f32>' },
                    uFinColor: { value: colors.fin, type: 'vec3<f32>' },
                    uSpotCoverage: { value: colors.coverage, type: 'f32' },
                    uPatternOffset: { value: [Math.random() * 500, Math.random() * 500], type: 'vec2<f32>' }
                }
            }
        });

        this.pixiMesh = new Mesh({ geometry: this.geometry, shader: customShader });
    }

    public get headPos(): Vector2D { return this.circles[0]; }
    public get headingAngle(): number { return this.headAngle; }
    public get joints(): Vector2D[] { return this.circles; }
    public applyForce(forceVector: Vector2D) { this.acceleration.add(forceVector); }

    private getSplinePoint(joints: Vector2D[], t: number): { x: number, y: number } {
        const count = joints.length;
        const p = t * (count - 1);
        const intPart = Math.floor(p);
        const fracPart = p - intPart;

        const i0 = Math.max(0, intPart - 1);
        const i1 = intPart;
        const i2 = Math.min(count - 1, intPart + 1);
        const i3 = Math.min(count - 1, intPart + 2);

        const p0 = joints[i0]; const p1 = joints[i1];
        const p2 = joints[i2]; const p3 = joints[i3];

        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * fracPart +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * fracPart * fracPart +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * fracPart * fracPart * fracPart); 

        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * fracPart +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * fracPart * fracPart +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * fracPart * fracPart * fracPart);

        return { x, y };
    }

    updateSpine(dt: number = 1.0) {
        if (this.velocity.magnitude() > 0.1) {
            const movingAngle = Math.atan2(this.velocity.y, this.velocity.x);
            let turnDelta = movingAngle - this.headAngle;

            while (turnDelta > Math.PI) turnDelta -= Math.PI * 2;
            while (turnDelta < -Math.PI) turnDelta += Math.PI * 2;

            this.headAngle += turnDelta * 0.065 * dt;
        }
        this.segmentAngles[0] = this.headAngle;

        for (let i = 1; i < this.circles.length; i++) {
            const dx = this.circles[i - 1].x - this.circles[i].x;
            const dy = this.circles[i - 1].y - this.circles[i].y;
            const currentAngle = Math.atan2(dy, dx);
            const referenceAngle = i === 1 ? this.headAngle : this.segmentAngles[i - 1];

            let angleDiff = currentAngle - referenceAngle;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            angleDiff = Math.max(-this.maxAngles[i], Math.min(this.maxAngles[i], angleDiff));

            const targetAngle = referenceAngle + angleDiff;
            this.segmentAngles[i] = targetAngle;
            this.circles[i].x = this.circles[i - 1].x - Math.cos(targetAngle) * this.jointSpacings[i];
            this.circles[i].y = this.circles[i - 1].y - Math.sin(targetAngle) * this.jointSpacings[i];
        }
    }

    public updateMeshGeometry() {
        const count = this.circles.length;
        let bIdx = 0;

        const vPositions: { x: number, y: number }[] = [];
        const vAngles: number[] = [];
        const vWidths: number[] = [];

        for (let i = 0; i < this.VIRTUAL_COUNT; i++) {
            const t = i / (this.VIRTUAL_COUNT - 1);
            vPositions.push(this.getSplinePoint(this.circles, t));

            const p = t * (count - 1);
            const idx = Math.floor(p);
            const frac = p - idx;

            const nextIdx = Math.min(count - 1, idx + 1);
            vAngles.push(this.segmentAngles[idx] + (this.segmentAngles[nextIdx] - this.segmentAngles[idx]) * frac);
            vWidths.push(this.bodyWidths[idx] + (this.bodyWidths[nextIdx] - this.bodyWidths[idx]) * frac);
        }

        const hPos = vPositions[0];
        const hAng = vAngles[0];
        const hW = vWidths[0];

        const projectFanPt = (offset: number, left: boolean) => {
            const finalAng = hAng + (left ? -offset : offset);
            return { x: hPos.x + Math.cos(finalAng) * hW, y: hPos.y + Math.sin(finalAng) * hW };
        };

        const leftCorner = projectFanPt(Math.PI / 2, true); this.positionBuffer[bIdx++] = leftCorner.x; this.positionBuffer[bIdx++] = leftCorner.y;
        const leftDiag = projectFanPt(Math.PI / 4, true); this.positionBuffer[bIdx++] = leftDiag.x; this.positionBuffer[bIdx++] = leftDiag.y;
        this.positionBuffer[bIdx++] = hPos.x + Math.cos(hAng) * hW;
        this.positionBuffer[bIdx++] = hPos.y + Math.sin(hAng) * hW;
        const rightDiag = projectFanPt(Math.PI / 4, false); this.positionBuffer[bIdx++] = rightDiag.x; this.positionBuffer[bIdx++] = rightDiag.y;
        const rightCorner = projectFanPt(Math.PI / 2, false); this.positionBuffer[bIdx++] = rightCorner.x; this.positionBuffer[bIdx++] = rightCorner.y;

        for (let i = 1; i < this.VIRTUAL_COUNT; i++) {
            const perpAng = vAngles[i] + Math.PI / 2;
            const width = vWidths[i];
            this.positionBuffer[bIdx++] = vPositions[i].x - Math.cos(perpAng) * width;
            this.positionBuffer[bIdx++] = vPositions[i].y - Math.sin(perpAng) * width;
            this.positionBuffer[bIdx++] = vPositions[i].x + Math.cos(perpAng) * width;
            this.positionBuffer[bIdx++] = vPositions[i].y + Math.sin(perpAng) * width;
        }

        const tPec = Math.floor(0.25 * (this.VIRTUAL_COUNT - 1));
        const tVen = Math.floor(0.60 * (this.VIRTUAL_COUNT - 1));

        const pL = { x: this.positionBuffer[(5 + (tPec - 1) * 2) * 2], y: this.positionBuffer[(5 + (tPec - 1) * 2) * 2 + 1] };
        const pLAngLead = vAngles[tPec] - (Math.PI * 4.2) / 6;
        const pLAngTrail = vAngles[tPec] - (Math.PI * 5.4) / 6;
        this.positionBuffer[bIdx++] = pL.x + Math.cos(pLAngLead) * (36.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pL.y + Math.sin(pLAngLead) * (36.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pL.x + Math.cos(pLAngTrail) * (26.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pL.y + Math.sin(pLAngTrail) * (26.0 * this.currentScale);

        const pR = { x: this.positionBuffer[(5 + (tPec - 1) * 2 + 1) * 2], y: this.positionBuffer[(5 + (tPec - 1) * 2 + 1) * 2 + 1] };
        const pRAngLead = vAngles[tPec] + (Math.PI * 4.2) / 6;
        const pRAngTrail = vAngles[tPec] + (Math.PI * 5.4) / 6;
        this.positionBuffer[bIdx++] = pR.x + Math.cos(pRAngLead) * (36.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pR.y + Math.sin(pRAngLead) * (36.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pR.x + Math.cos(pRAngTrail) * (26.0 * this.currentScale);
        this.positionBuffer[bIdx++] = pR.y + Math.sin(pRAngTrail) * (26.0 * this.currentScale);

        const vL = { x: this.positionBuffer[(5 + (tVen - 1) * 2) * 2], y: this.positionBuffer[(5 + (tVen - 1) * 2) * 2 + 1] };
        const vLAngLead = vAngles[tVen] - (Math.PI * 4.5) / 6;
        const vLAngTrail = vAngles[tVen] - (Math.PI * 5.5) / 6;
        this.positionBuffer[bIdx++] = vL.x + Math.cos(vLAngLead) * (22.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vL.y + Math.sin(vLAngLead) * (22.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vL.x + Math.cos(vLAngTrail) * (14.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vL.y + Math.sin(vLAngTrail) * (14.0 * this.currentScale);

        const vR = { x: this.positionBuffer[(5 + (tVen - 1) * 2 + 1) * 2], y: this.positionBuffer[(5 + (tVen - 1) * 2 + 1) * 2 + 1] };
        const vRAngLead = vAngles[tVen] + (Math.PI * 4.5) / 6;
        const vRAngTrail = vAngles[tVen] + (Math.PI * 5.5) / 6;
        this.positionBuffer[bIdx++] = vR.x + Math.cos(vRAngLead) * (22.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vR.y + Math.sin(vRAngLead) * (22.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vR.x + Math.cos(vRAngTrail) * (14.0 * this.currentScale);
        this.positionBuffer[bIdx++] = vR.y + Math.sin(vRAngTrail) * (14.0 * this.currentScale);

        let headToMid1 = this.segmentAngles[0] - this.segmentAngles[5];
        while (headToMid1 > Math.PI) headToMid1 -= Math.PI * 2;
        while (headToMid1 < -Math.PI) headToMid1 += Math.PI * 2;
        let mid1ToTail = this.segmentAngles[5] - this.segmentAngles[11];
        while (mid1ToTail > Math.PI) mid1ToTail -= Math.PI * 2;
        while (mid1ToTail < -Math.PI) mid1ToTail += Math.PI * 2;
        const headToTail = headToMid1 + mid1ToTail;

        const idxDorStart = Math.floor(0.35 * (this.VIRTUAL_COUNT - 1));
        for (let i = 0; i < 6; i++) {
            const vIdx = idxDorStart + i;
            const swayFactor = (i === 0 || i === 5) ? 5.0 : 11.0;
            const lateralSway = headToMid1 * swayFactor * this.currentScale;
            const perpAng = vAngles[vIdx] + Math.PI / 2;
            this.positionBuffer[bIdx++] = vPositions[vIdx].x + Math.cos(perpAng) * lateralSway;
            this.positionBuffer[bIdx++] = vPositions[vIdx].y + Math.sin(perpAng) * lateralSway;
        }

        const tailWidthFactor = Math.max(-2.5, Math.min(2.5, headToTail * 1.5)) * this.currentScale;
        const finalVirtualIdx = this.VIRTUAL_COUNT - 1;
        const tailAng = vAngles[finalVirtualIdx];
        const tailPos = vPositions[finalVirtualIdx];

        const upperTailAngle = tailAng + Math.PI - 0.42;
        this.positionBuffer[bIdx++] = tailPos.x + Math.cos(upperTailAngle) * (22.0 * this.currentScale) + Math.cos(tailAng + Math.PI / 2) * tailWidthFactor;
        this.positionBuffer[bIdx++] = tailPos.y + Math.sin(upperTailAngle) * (22.0 * this.currentScale) + Math.sin(tailAng + Math.PI / 2) * tailWidthFactor;

        const lowerTailAngle = tailAng + Math.PI + 0.42;
        this.positionBuffer[bIdx++] = tailPos.x + Math.cos(lowerTailAngle) * (22.0 * this.currentScale) - Math.cos(tailAng + Math.PI / 2) * tailWidthFactor;
        this.positionBuffer[bIdx++] = tailPos.y + Math.sin(lowerTailAngle) * (22.0 * this.currentScale) - Math.sin(tailAng + Math.PI / 2) * tailWidthFactor;

        this.geometry.getBuffer("aPosition").update();
    }

    public schooling(grid: Fish[][], width: number, height: number) {
        this.handleBoundaries(width, height);

        const fieldData = this.getBilinearField(this.headPos.x, this.headPos.y);
        const sepForce = new Vector2D(0, 0);
        let sepCount = 0;

        const visualRange = this.config.visualRange;
        const protectedRange = this.config.protectedRange * this.currentScale;

        const visualRangeSq = visualRange * visualRange;
        const protectedRangeSq = protectedRange * protectedRange;
        const MAX_RGB_DIST = Math.sqrt(3);

        const dxHome = this.homePos.x - this.headPos.x;
        const dyHome = this.homePos.y - this.headPos.y;
        const distToHome = Math.sqrt(dxHome * dxHome + dyHome * dyHome);

        // Keep muscle pool full and dynamic everywhere
        let maxForceScaled = this.config.maxForce;

        const focusScalar = this.config.mosaicFocus / 100.0;
        let boidShroudFactor = 1.0 - (focusScalar * 0.82);
        
        // Suppress schooling weights for typography layer to keep contours sharp
        if (this.isForeground) {
            boidShroudFactor *= 0.15;
        }

        const cellSize = visualRange;
        const cols = Math.ceil(width / cellSize);
        const rows = Math.ceil(height / cellSize);

        const myCellX = Math.max(0, Math.min(cols - 1, Math.floor(this.headPos.x / cellSize)));
        const myCellY = Math.max(0, Math.min(rows - 1, Math.floor(this.headPos.y / cellSize)));

        this.latencyCounter++;
        const isCognitiveFrame = this.latencyCounter >= this.latencyInterval;

        const alignSum = new Vector2D(0, 0);
        const cohSum = new Vector2D(0, 0);
        let neighborWeightTotal = 0;

        if (isCognitiveFrame) {
            this.latencyCounter = 0;
            this.cachedGroupForce.set(0, 0);
        }

        for (let ccY = myCellY - 1; ccY <= myCellY + 1; ccY++) {
            if (ccY < 0 || ccY >= rows) continue;
            for (let ccX = myCellX - 1; ccX <= myCellX + 1; ccX++) {
                if (ccX < 0 || ccX >= cols) continue;

                const cellNeighbors = grid[ccX + ccY * cols];
                if (!cellNeighbors) continue;

                for (let i = 0; i < cellNeighbors.length; i++) {
                    const other = cellNeighbors[i];
                    if (other === this) continue;

                    const dx = other.headPos.x - this.headPos.x;
                    const dy = other.headPos.y - this.headPos.y;
                    const distSq = dx * dx + dy * dy;

                    if (distSq > 0) {
                        const dR1 = this.bodyColor[0] - other.bodyColor[0];
                        const dG1 = this.bodyColor[1] - other.bodyColor[1];
                        const dB1 = this.bodyColor[2] - other.bodyColor[2];
                        const bodyMatch = 1.0 - (Math.sqrt(dR1 * dR1 + dG1 * dG1 + dB1 * dB1) / MAX_RGB_DIST);

                        const dR2 = this.finColor[0] - other.finColor[0];
                        const dG2 = this.finColor[1] - other.finColor[1];
                        const dB2 = this.finColor[2] - other.finColor[2];
                        const finMatch = 1.0 - (Math.sqrt(dR2 * dR2 + dG2 * dG2 + dB2 * dB2) / MAX_RGB_DIST);

                        const totalColorMatch = (bodyMatch * (1.0 - this.spotCoverage)) + (finMatch * this.spotCoverage);
                        const colorMismatch = 1.0 - totalColorMatch;

                        // Phase separation - push back violently against foreign color matrices
                        const dynamicProtectedRangeSq = protectedRangeSq * (1.0 + colorMismatch * 3.0 * focusScalar);

                        if (distSq < dynamicProtectedRangeSq) {
                            const distance = Math.sqrt(distSq);
                            const pushVector = new Vector2D(this.headPos.x - other.headPos.x, this.headPos.y - other.headPos.y);
                            pushVector.normalise().scale(1.0 / distance);
                            
                            if (colorMismatch > 0.2) {
                                pushVector.scale(1.0 + colorMismatch * 2.0 * focusScalar);
                            }
                            
                            sepForce.add(pushVector);
                            sepCount++;
                        }

                        if (isCognitiveFrame && distSq < visualRangeSq) {
                            const affinity = Math.pow(totalColorMatch, 1.0 + (this.config.affinityStrength / 100.0) * 6.0);

                            if (affinity > 0.01) {
                                alignSum.add(new Vector2D(other.velocity.x * affinity, other.velocity.y * affinity));
                                cohSum.add(new Vector2D(other.headPos.x * affinity, other.headPos.y * affinity));
                                neighborWeightTotal += affinity;
                            }
                        }
                    }
                }
            }
        }

        if (sepCount > 0) {
            sepForce.scale(1.0 / sepCount);
            if (sepForce.magnitude() > 0) {
                sepForce.normalise().scale(this.config.maxSpeed * this.currentScale);
                const steerSep = sepForce.sub(this.velocity).limit(maxForceScaled * this.config.separationWeight);
                this.applyForce(steerSep);
            }
        }

        if (isCognitiveFrame) {
            if (neighborWeightTotal > 0) {
                alignSum.scale(1.0 / neighborWeightTotal);
                if (alignSum.magnitude() > 0) {
                    alignSum.normalise().scale(this.config.maxSpeed * this.currentScale);
                    const steerAlign = alignSum.sub(this.velocity).limit(maxForceScaled * this.config.alignmentWeight * boidShroudFactor);
                    this.cachedGroupForce.add(steerAlign);
                }

                cohSum.scale(1.0 / neighborWeightTotal);
                const desireCoh = cohSum.sub(this.headPos);
                const centerDist = desireCoh.magnitude();

                if (centerDist > 0) {
                    const easeFactor = Math.min(1.0, centerDist / visualRange);
                    desireCoh.normalise().scale(this.config.maxSpeed * this.currentScale * easeFactor);
                    const steerCoh = desireCoh.sub(this.velocity).limit(maxForceScaled * this.config.cohesionWeight * boidShroudFactor);
                    this.cachedGroupForce.add(steerCoh);
                }
            } else {
                this.cachedGroupForce.scale(0.9);
            }
        }

        this.applyForce(this.cachedGroupForce);

        if (this.config.mosaicFocus > 0 && distToHome > 4.0) {
            const homeTargetDir = new Vector2D(dxHome, dyHome);
            
            let tetherFactor = 0.0;
            if (this.isForeground) {
                // Dual-role text steering constraint: if outside character stroke, pull back instantly.
                // If safe inside, apply a very soft ambient nudge to evenly populate text geometry.
                tetherFactor = fieldData.distance > 0.0 ? focusScalar : focusScalar * 0.15;
            } else {
                // Background landscape nodes enjoy open-sandbox cubic roaming
                tetherFactor = Math.pow(Math.min(1.0, distToHome / 45.0), 3) * focusScalar;
            }

            const steerHome = homeTargetDir.normalise().scale(this.config.maxSpeed * this.currentScale).sub(this.velocity).limit(maxForceScaled * 4.0 * tetherFactor);
            this.applyForce(steerHome);
        }

        if (this.config.noiseScale > 0 && this.velocity.magnitude() > 0.1) {
            const noiseMultiplier = (Math.random() - 0.5) * this.config.noiseScale;
            const lateralWeaveForce = new Vector2D(-this.velocity.y, this.velocity.x);
            const noiseDampener = 1.0 - focusScalar;
            lateralWeaveForce.normalise().scale(this.config.maxSpeed * this.currentScale * noiseMultiplier * noiseDampener);
            this.applyForce(lateralWeaveForce);
        }


        const flowVec = new Vector2D(Math.cos(fieldData.angle), Math.sin(fieldData.angle));
        let maxSpeedScaled = this.config.maxSpeed * this.currentScale;
        flowVec.scale(maxSpeedScaled);
        const flowForce = flowVec.sub(this.velocity).limit(maxForceScaled * 1.8 * focusScalar);
        this.applyForce(flowForce);

        // Universalized 6th-power potential field edge bounce
        if (fieldData.distance > 0.0) {
            const homeDir = new Vector2D(this.homePos.x - this.headPos.x, this.homePos.y - this.headPos.y);
            if (homeDir.magnitude() > 0) {
                homeDir.normalise();
                const edgePush = Math.pow(fieldData.distance, 6) * 6.0 * focusScalar;
                const fenceForce = homeDir.scale(maxSpeedScaled * edgePush).sub(this.velocity).limit(maxForceScaled * 4.0);
                this.applyForce(fenceForce);
            }
        }
    }

    private handleBoundaries(width: number, height: number): void {
        const borderPadding = 120 * this.currentScale;
        const bounceFactor = this.config.maxForce * 1.5;
        const boundaryDampener = this.config.mosaicFocus > 50 ? 0.1 : 1.0;

        if (this.headPos.x < borderPadding) {
            const depth = (borderPadding - this.headPos.x) / borderPadding;
            this.applyForce(new Vector2D(bounceFactor * (depth * depth) * boundaryDampener, 0));
        } else if (this.headPos.x > width - borderPadding) {
            const distanceToWall = width - this.headPos.x;
            const depth = (borderPadding - distanceToWall) / borderPadding;
            this.applyForce(new Vector2D(-bounceFactor * (depth * depth) * boundaryDampener, 0));
        }

        if (this.headPos.y < borderPadding) {
            const depth = (borderPadding - this.headPos.y) / borderPadding;
            this.applyForce(new Vector2D(0, bounceFactor * (depth * depth) * boundaryDampener));
        } else if (this.headPos.y > height - borderPadding) {
            const distanceToWall = height - this.headPos.y;
            const depth = (borderPadding - distanceToWall) / borderPadding;
            this.applyForce(new Vector2D(0, -bounceFactor * (depth * depth) * boundaryDampener));
        }
    }

    private getBilinearField(screenX: number, screenY: number): { angle: number; distance: number } {
        const grid = this.pond.fieldGrid;
        if (!grid) return { angle: 0, distance: 0 };

        const normX = (screenX / this.pond.fieldGrid.virtualW) * (grid.cols - 1);
        const normY = (screenY / this.pond.fieldGrid.virtualH) * (grid.rows - 1);

        const x0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(normX)));
        const x1 = Math.max(0, Math.min(grid.cols - 1, x0 + 1));
        const y0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(normY)));
        const y1 = Math.max(0, Math.min(grid.rows - 1, y0 + 1));

        const tx = normX - x0; const ty = normY - y0;

        const idx00 = y0 * grid.cols + x0; const idx10 = y0 * grid.cols + x1;
        const idx01 = y1 * grid.cols + x0; const idx11 = y1 * grid.cols + x1;

        const distArr = this.isForeground ? grid.fgDistances : grid.bgDistances;
        const angleArr = this.isForeground ? grid.fgAngles : grid.bgAngles;

        const d00 = distArr[idx00]; const d10 = distArr[idx10];
        const d01 = distArr[idx01]; const d11 = distArr[idx11];
        const distance = (1 - tx) * (1 - ty) * d00 + tx * (1 - ty) * d10 + (1 - tx) * ty * d01 + tx * ty * d11;

        const a00 = angleArr[idx00]; const a10 = angleArr[idx10];
        const a01 = angleArr[idx01]; const a11 = angleArr[idx11];

        const sinTotal = (1 - tx) * (1 - ty) * Math.sin(a00) + tx * (1 - ty) * Math.sin(a10) + (1 - tx) * ty * Math.sin(a01) + tx * ty * Math.sin(a11);
        const cosTotal = (1 - tx) * (1 - ty) * Math.cos(a00) + tx * (1 - ty) * Math.cos(a10) + (1 - tx) * ty * Math.cos(a01) + tx * ty * Math.cos(a11);

        return { angle: Math.atan2(sinTotal, cosTotal), distance };
    }

    move(dt: number = 1.0) {
        this.velocity.add(this.acceleration);
        this.velocity.scale(1.0 - 0.04 * dt);

        const currentSpeed = this.velocity.magnitude();

        let maxSpeedScaled = this.config.maxSpeed * this.currentScale;
        let minSpeedScaled = this.config.minSpeed * this.currentScale;

        let maxForceScaled = this.config.maxForce;

        // Bypass velocity damping adjustments for text layer to avoid particle freeze
        if (this.config.mosaicFocus > 0 && !this.isForeground) {
            const dx = this.homePos.x - this.headPos.x;
            const dy = this.homePos.y - this.headPos.y;
            const distToHome = Math.sqrt(dx * dx + dy * dy);

            if (distToHome < 40.0) {
                const closeFactor = distToHome / 40.0;
                const microMax = 0.8 * this.currentScale;
                const microMin = 0.2 * this.currentScale;
                const focusScalar = this.config.mosaicFocus / 100.0;

                const targetMax = microMax + (maxSpeedScaled - microMax) * (1.0 - focusScalar);
                const targetMin = microMin + (minSpeedScaled - microMin) * (1.0 - focusScalar);

                maxSpeedScaled = targetMax + (maxSpeedScaled - targetMax) * closeFactor;
                minSpeedScaled = targetMin + (minSpeedScaled - targetMin) * closeFactor;
                maxForceScaled = this.config.maxForce * (minSpeedScaled / (this.config.minSpeed * this.currentScale));
            }
        }

        if (currentSpeed > maxSpeedScaled) {
            this.velocity.normalise().scale(maxSpeedScaled);
        } else if (currentSpeed < minSpeedScaled && currentSpeed > 0) {
            this.velocity.normalise().scale(minSpeedScaled);
        }

        this.headPos.x += this.velocity.x * dt;
        this.headPos.y += this.velocity.y * dt;

        this.acceleration.set(0, 0);
        this.updateSpine(dt);
        this.updateMeshGeometry();
    }
}
