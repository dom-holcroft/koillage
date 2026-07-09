import { Pond } from "./pond";

async function run() {
    const pond = new Pond();
    await pond.init();

    const modeSelect = document.getElementById('asset-mode-select') as HTMLSelectElement;
    const inputImage = document.getElementById('input-image-url') as HTMLInputElement;
    const inputText = document.getElementById('input-text-string') as HTMLInputElement;
    const colorStyleSelect = document.getElementById('text-color-style-select') as HTMLSelectElement;
    const pickerStart = document.getElementById('picker-grad-start') as HTMLInputElement;
    const pickerEnd = document.getElementById('picker-grad-end') as HTMLInputElement;

    const triggerHotUpdate = () => {
        pond.respawnSchool().catch(err => console.error("Hot update failed:", err));
    };

    // Hook inputs to instant input events
    if (modeSelect) modeSelect.addEventListener('change', triggerHotUpdate);
    if (colorStyleSelect) colorStyleSelect.addEventListener('change', triggerHotUpdate);
    
    if (inputImage) inputImage.addEventListener('input', triggerHotUpdate);
    if (inputText) inputText.addEventListener('input', triggerHotUpdate);
    if (pickerStart) pickerStart.addEventListener('input', triggerHotUpdate);
    if (pickerEnd) pickerEnd.addEventListener('input', triggerHotUpdate);
}

run();
