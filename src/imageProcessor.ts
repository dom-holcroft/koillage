import { getPaletteSync } from 'colorthief';

export interface TileAnalysis {
    centroidX: number;
    centroidY: number;
    primaryColor: number[];
    secondaryColor: number[];
    spotCoverage: number;
    isEmptySpace: boolean;
}

export interface FieldGrid {
    bgAngles: Float32Array;
    bgDistances: Float32Array;
    fgAngles: Float32Array;
    fgDistances: Float32Array;
    cols: number;
    rows: number;
    virtualW: number;  
    virtualH: number;  
}

export interface AnalysisResult {
    bgAnalyses: TileAnalysis[];
    fgAnalyses: TileAnalysis[];
    fieldGrid: FieldGrid;
}

export class ImageProcessor {
    private static DEFAULT_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1920px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg";

    public static getTargetQuerySource(): {
        type: 'image' | 'text' | 'composite';
        value: string;
        colorMode: 'koi' | 'gradient';
        gradStart: string;
        gradEnd: string;
    } {
        const urlParams = new URLSearchParams(window.location.search);
        const textParam = urlParams.get("text");
        const modeParam = urlParams.get("mode");

        let mode: 'image' | 'text' | 'composite' = 'image';
        if (modeParam === 'composite' || (textParam && urlParams.has("img"))) mode = 'composite';
        else if (textParam) mode = 'text';

        return {
            type: mode,
            value: textParam ? decodeURIComponent(textParam) : (urlParams.get("img") ? this.decodeImgParam(urlParams.get("img")!) : this.DEFAULT_IMAGE),
            colorMode: (urlParams.get("colorMode") as 'koi' | 'gradient') || 'koi',
            gradStart: urlParams.get("gradStart") || "#ff7700",
            gradEnd: urlParams.get("gradEnd") || "#00bfff"
        };
    }

    private static decodeImgParam(param: string): string {
        try { return atob(param); } catch { return param; }
    }

    private static loadImage(url: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => resolve(img);
            img.onerror = () => {
                const fallbackImg = new Image();
                fallbackImg.crossOrigin = "anonymous";
                fallbackImg.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                fallbackImg.onload = () => resolve(fallbackImg);
                fallbackImg.onerror = (err) => reject(new Error(`Asset failed to load over network: ${err}`));
            };
        });
    }

    private static hexToRgb(hex: string): number[] {
        const c = hex.replace(/^#/, "");
        const num = parseInt(c, 16);
        return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
    }

    private static getChroma(r: number, g: number, b: number): number {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (l > 240 || l < 15) return 0;
        return max - min;
    }

    public static async analyze(
        bgCount: number,
        fgCount: number,
        windowW: number, 
        windowH: number, 
        source: { type: string, value: string, textValue: string, colorMode: string, gradStart: string, gradEnd: string, textSizeMultiplier: number }
    ): Promise<AnalysisResult> {
        const hasBgImage = source.type === 'image' || source.type === 'composite';
        const hasFgText = source.type === 'text' || source.type === 'composite';

        // Establish uniform default layout coordinate spaces
        let virtualW = 1920;
        let virtualH = 1080;
        let img: HTMLImageElement | null = null;

        if (hasBgImage) {
            const imgUrl = (source.value && source.value.startsWith('http')) ? source.value : this.DEFAULT_IMAGE;
            img = await this.loadImage(imgUrl);

            const maxResolutionCeiling = 2000;
            virtualW = img.naturalWidth;
            virtualH = img.naturalHeight;

            if (virtualW > maxResolutionCeiling || virtualH > maxResolutionCeiling) {
                const scaleFactor = maxResolutionCeiling / Math.max(virtualW, virtualH);
                virtualW = Math.round(virtualW * scaleFactor);
                virtualH = Math.round(virtualH * scaleFactor);
            }
        }

        const bgCanvas = document.createElement("canvas");
        bgCanvas.width = virtualW; bgCanvas.height = virtualH;
        const bgCtx = bgCanvas.getContext("2d", { willReadFrequently: true })!;

        if (hasBgImage && img) {
            bgCtx.drawImage(img, 0, 0, virtualW, virtualH);
        } else {
            bgCtx.fillStyle = "#0b131a";
            bgCtx.fillRect(0, 0, virtualW, virtualH);
        }
        const highResBgData = bgCtx.getImageData(0, 0, virtualW, virtualH).data;

        // 2. Build Virtual Centered Typography Mask Layer
        const textCanvas = document.createElement("canvas");
        textCanvas.width = virtualW; textCanvas.height = virtualH;
        const textCtx = textCanvas.getContext("2d", { willReadFrequently: true })!;
        textCtx.fillStyle = "#000000";
        textCtx.fillRect(0, 0, virtualW, virtualH);

        if (hasFgText) {
            textCtx.fillStyle = "#ffffff";
            const textString = source.textValue || "KOI";
            const lines = textString.split("\\n");
            const maxLineLen = Math.max(...lines.map(l => l.length), 1);
            
            const optimalAutoFontSize = Math.min((virtualW / maxLineLen) * 1.2, (virtualH / (lines.length * 1.4)) * 0.75);
            const fontSize = optimalAutoFontSize * source.textSizeMultiplier;

            textCtx.font = `bold ${fontSize}px sans-serif, monospace`;
            textCtx.textAlign = "center";
            textCtx.textBaseline = "middle";

            const lineHeight = fontSize * 1.2;
            const startY = (virtualH / 2) - ((lines.length - 1) * lineHeight) / 2;
            lines.forEach((line, index) => {
                textCtx.fillText(line, virtualW / 2, startY + index * lineHeight);
            });
        }
        const highResTextData = textCtx.getImageData(0, 0, virtualW, virtualH).data;

        const fCols = 128, fRows = 128;
        
        const lowResBgCanvas = document.createElement("canvas");
        lowResBgCanvas.width = fCols; lowResBgCanvas.height = fRows;
        const lowResBgCtx = lowResBgCanvas.getContext("2d")!;
        lowResBgCtx.drawImage(bgCanvas, 0, 0, virtualW, virtualH, 0, 0, fCols, fRows);
        const fBgData = lowResBgCtx.getImageData(0, 0, fCols, fRows).data;

        const lowResTextCanvas = document.createElement("canvas");
        lowResTextCanvas.width = fCols; lowResTextCanvas.height = fRows;
        const lowResTextCtx = lowResTextCanvas.getContext("2d")!;
        lowResTextCtx.drawImage(textCanvas, 0, 0, virtualW, virtualH, 0, 0, fCols, fRows);
        const fTextData = lowResTextCtx.getImageData(0, 0, fCols, fRows).data;

        const bgAngles = new Float32Array(fCols * fRows);
        const bgDistances = new Float32Array(fCols * fRows);
        const fgAngles = new Float32Array(fCols * fRows);
        const fgDistances = new Float32Array(fCols * fRows);
        const isTextEdge = new Uint8Array(fCols * fRows);

        const getLuminance = (offset: number, data: Uint8ClampedArray) => {
            return (0.299 * data[offset]) + (0.587 * data[offset + 1]) + (0.114 * data[offset + 2]);
        };

        for (let r = 0; r < fRows; r++) {
            for (let c = 0; c < fCols; c++) {
                const idx = r * fCols + c;
                const cLeft  = c > 0 ? (r * fCols + (c - 1)) * 4 : idx * 4;
                const cRight = c < fCols - 1 ? (r * fCols + (c + 1)) * 4 : idx * 4;
                const rTop   = r > 0 ? ((r - 1) * fCols + c) * 4 : idx * 4;
                const rBot   = r < fRows - 1 ? ((r + 1) * fCols + c) * 4 : idx * 4;

                const gradX = getLuminance(cRight, fBgData) - getLuminance(cLeft, fBgData);
                const gradY = getLuminance(rBot, fBgData) - getLuminance(rTop, fBgData);
                
                bgAngles[idx] = Math.atan2(gradX, -gradY);
                bgDistances[idx] = 0;
                isTextEdge[idx] = fTextData[idx * 4] > 100 ? 1 : 0;
            }
        }

        for (let r = 0; r < fRows; r++) {
            for (let c = 0; c < fCols; c++) {
                const idx = r * fCols + c;
                if (isTextEdge[idx] === 1) {
                    fgDistances[idx] = 0;
                    continue;
                }
                let minDist = 99999;
                for (let dr = -14; dr <= 14; dr++) {
                    const nr = r + dr; if (nr < 0 || nr >= fRows) continue;
                    for (let dc = -14; dc <= 14; dc++) {
                        const nc = c + dc; if (nc < 0 || nc >= fCols) continue;
                        if (isTextEdge[nr * fCols + nc] === 1) {
                            const d = dr * dr + dc * dc;
                            if (d < minDist) minDist = d;
                        }
                    }
                }
                fgDistances[idx] = Math.sqrt(minDist);
            }
        }

        for (let r = 0; r < fRows; r++) {
            for (let c = 0; c < fCols; c++) {
                const idx = r * fCols + c;
                const cLeft  = c > 0 ? (r * fCols + (c - 1)) : idx;
                const cRight = c < fCols - 1 ? (r * fCols + (c + 1)) : idx;
                const rTop   = r > 0 ? ((r - 1) * fCols + c) : idx;
                const rBot   = r < fRows - 1 ? ((r + 1) * fCols + c) : idx;

                const gradX = fgDistances[cRight] - fgDistances[cLeft];
                const gradY = fgDistances[rBot] - fgDistances[rTop];
                
                const continuousDoubledAngle = Math.atan2(gradX, -gradY) * 2.0;
                let sinSum = Math.sin(continuousDoubledAngle), cosSum = Math.cos(continuousDoubledAngle);
                fgAngles[idx] = Math.atan2(sinSum, cosSum) / 2.0;
            }
        }

        const bgAnalyses: TileAnalysis[] = [];
        const fgAnalyses: TileAnalysis[] = [];
        const rStart = this.hexToRgb(source.gradStart);
        const rEnd = this.hexToRgb(source.gradEnd);

        if (hasBgImage) {
            const columns = Math.ceil(Math.sqrt(bgCount));
            const rows = Math.ceil(bgCount / columns);
            const tileW = virtualW / columns; const tileH = virtualH / rows;

            const sliceCanvas = document.createElement("canvas");
            sliceCanvas.width = Math.ceil(tileW); sliceCanvas.height = Math.ceil(tileH);
            const sliceCtx = sliceCanvas.getContext("2d")!;

            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < columns; c++) {
                    if (bgAnalyses.length >= bgCount) break;
                    const sx = c * tileW; const sy = r * tileH;
                    const cx = sx + tileW / 2; const cy = sy + tileH / 2;
                    const hIdx = (Math.floor(cy) * virtualW + Math.floor(cx)) * 4;

                    if (highResBgData[hIdx + 3] < 50) continue;

                    let pCol = [0.5, 0.5, 0.5], sCol = [0.25, 0.25, 0.25];
                    try {
                        sliceCtx.clearRect(0, 0, tileW, tileH);
                        sliceCtx.drawImage(bgCanvas, sx, sy, tileW, tileH, 0, 0, tileW, tileH);
                        const palette = getPaletteSync(sliceCanvas, { colorCount: 5, quality: 2, colorSpace: 'oklch' });
                        if (palette && palette.length > 0) {
                            const scored = palette.map(sw => {
                                const chroma = this.getChroma(sw.rgb().r, sw.rgb().g, sw.rgb().b);
                                return { sw, score: chroma * Math.log1p(sw.proportion * 120.0) };
                            }).sort((a, b) => b.score - a.score);

                            pCol = [scored[0].sw.rgb().r / 255, scored[0].sw.rgb().g / 255, scored[0].sw.rgb().b / 255];
                            sCol = scored.length > 1 
                                ? [scored[1].sw.rgb().r / 255, scored[1].sw.rgb().g / 255, scored[1].sw.rgb().b / 255]
                                : [pCol[0] * 0.45, pCol[1] * 0.45, pCol[2] * 0.45];
                        }
                    } catch {
                        pCol = [highResBgData[hIdx] / 255, highResBgData[hIdx + 1] / 255, highResBgData[hIdx + 2] / 255];
                        sCol = [pCol[0] * 0.45, pCol[1] * 0.45, pCol[2] * 0.45];
                    }

                    bgAnalyses.push({ centroidX: cx, centroidY: cy, primaryColor: pCol, secondaryColor: sCol, spotCoverage: 0.55, isEmptySpace: false });
                }
            }
        }

        if (hasFgText) {
            const validTextCoords: { x: number, y: number }[] = [];
            for (let y = 0; y < virtualH; y += 4) {
                for (let x = 0; x < virtualW; x += 4) {
                    if (highResTextData[(y * virtualW + x) * 4] > 120) {
                        validTextCoords.push({ x, y });
                    }
                }
            }
            if (validTextCoords.length === 0) validTextCoords.push({ x: virtualW / 2, y: virtualH / 2 });

            for (let i = 0; i < fgCount; i++) {
                const coord = validTextCoords[Math.floor(Math.random() * validTextCoords.length)];
                const cx = coord.x + (Math.random() - 0.5) * 4;
                const cy = coord.y + (Math.random() - 0.5) * 4;

                let pCol = [1.0, 0.42, 0.05], sCol = [0.95, 0.82, 0.11];
                if (source.colorMode === 'gradient') {
                    const t = cx / virtualW;
                    pCol = [rStart[0] + (rEnd[0] - rStart[0]) * t, rStart[1] + (rEnd[1] - rStart[1]) * t, rStart[2] + (rEnd[2] - rStart[2]) * t];
                    const invT = 1.0 - t;
                    sCol = [rStart[0] + (rEnd[0] - rStart[0]) * invT, rStart[1] + (rEnd[1] - rStart[1]) * invT, rStart[2] + (rEnd[2] - rStart[2]) * invT];
                }

                fgAnalyses.push({ centroidX: cx, centroidY: cy, primaryColor: pCol, secondaryColor: sCol, spotCoverage: 0.55, isEmptySpace: false });
            }
        }

        return {
            bgAnalyses, fgAnalyses,
            fieldGrid: { bgAngles, bgDistances, fgAngles, fgDistances, cols: fCols, rows: fRows, virtualW, virtualH }
        };
    }
}
