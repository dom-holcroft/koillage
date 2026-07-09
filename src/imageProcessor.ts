import { getPaletteSync } from 'colorthief';

export interface TileAnalysis {
    centroidX: number;
    centroidY: number;
    primaryColor: number[];   // [r, g, b] normalized to 0.0 - 1.0 for WebGL shader
    secondaryColor: number[]; // [r, g, b] normalized to 0.0 - 1.0 for WebGL shader
    spotCoverage: number;     // Ratio driving shader mask distribution (0.0 - 1.0)
}

export class ImageProcessor {
    private static DEFAULT_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1920px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg";
    private static CORS_PROXY = "https://corsproxy.io/?";

    private static getTargetImageUrl(): string {
        const urlParams = new URLSearchParams(window.location.search);
        const imgParam = urlParams.get("img");

        if (!imgParam) {
            return this.DEFAULT_IMAGE;
        }

        try {
            return atob(imgParam);
        } catch {
            return imgParam;
        }
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
                fallbackImg.onerror = (err) => reject(new Error(`Failed to load cross-origin asset texture matrix: ${err}`));
            };
        });
    }

    public static async analyze(fishCount: number, screenW: number, screenH: number): Promise<TileAnalysis[]> {
        const targetUrl = this.getTargetImageUrl();
        const img = await this.loadImage(targetUrl);

        const columns = Math.ceil(Math.sqrt(fishCount));
        const rows = Math.ceil(fishCount / columns);

        const mainCanvas = document.createElement("canvas");
        const mainCtx = mainCanvas.getContext("2d");
        if (!mainCtx) throw new Error("Could not instantiate main 2D context");

        mainCanvas.width = screenW;
        mainCanvas.height = screenH;
        mainCtx.drawImage(img, 0, 0, screenW, screenH);

        const tileWidth = screenW / columns;
        const tileHeight = screenH / rows;
        const analyses: TileAnalysis[] = [];

        const tileCanvas = document.createElement("canvas");
        const tileCtx = tileCanvas.getContext("2d");
        if (!tileCtx) throw new Error("Could not instantiate tile 2D context");
        tileCanvas.width = Math.ceil(tileWidth);
        tileCanvas.height = Math.ceil(tileHeight);

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < columns; c++) {
                if (analyses.length >= fishCount) break;

                const startX = c * tileWidth;
                const startY = r * tileHeight;

                tileCtx.clearRect(0, 0, tileWidth, tileHeight);
                tileCtx.drawImage(
                    mainCanvas,
                    startX, startY, tileWidth, tileHeight,
                    0, 0, tileWidth, tileHeight
                );

                let primaryColor = [0.5, 0.5, 0.5];
                let secondaryColor = [0.6, 0.6, 0.6];
                let spotCoverage = 0.5;

                try {
                    const palette = getPaletteSync(tileCanvas, {
                        colorCount: 2,
                        quality: 2,
                        colorSpace: 'oklch'
                    });

                    if (palette && palette.length > 0) {
                        const pColor = palette[0];
                        primaryColor = [pColor.rgb().r / 255, pColor.rgb().g / 255, pColor.rgb().b / 255];

                        if (palette.length > 1) {
                            const sColor = palette[1];
                            secondaryColor = [sColor.rgb().r / 255, sColor.rgb().g / 255, sColor.rgb().b / 255];

                            const totalPop = pColor.proportion + sColor.proportion;
                            spotCoverage = totalPop > 0 ? pColor.proportion / totalPop : 0.5;
                        } else {
                            secondaryColor = [...primaryColor];
                            spotCoverage = 1.0;
                        }
                    }
                } catch {
                }

                analyses.push({
                    centroidX: startX + tileWidth / 2,
                    centroidY: startY + tileHeight / 2,
                    primaryColor,
                    secondaryColor,
                    spotCoverage: Math.max(0.1, Math.min(0.9, spotCoverage))
                });
            }
        }

        return analyses;
    }
}
