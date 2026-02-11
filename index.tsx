/* tslint:disable */
import { GoogleGenAI } from '@google/genai';

// --- Global Types & Interfaces ---
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
    hasSelectedApiKey: () => Promise<boolean>;
  }
  interface Window {
    aistudio?: AIStudio;
    saveApiKey?: () => void;
  }
}

interface PromptData {
    mega: string;
    lighting: string;
    scene: string;
    view: string;
    inpaint: string;
    inpaintEnabled: boolean;
    cameraProjection: boolean;
}

interface ReferenceImage {
    file: File;
    data: string;
    mimeType: string;
}

// --- Initialization Logic ---
let userApiKey = localStorage.getItem('gemini_api_key') || '';

const showApiKeyModal = () => {
    // Check if modal already exists
    if (document.getElementById('api-key-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'api-key-modal';
    modal.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter: blur(5px);">
            <div style="background:#121214; padding:2rem; border-radius:16px; max-width:500px; width:90%; border: 1px solid rgba(255,255,255,0.1); box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                <h3 style="color:white; margin-bottom:1rem; font-weight: 800; font-size: 1.25rem; text-transform: uppercase; letter-spacing: 0.05em;">🔑 Cần Google Gemini API Key</h3>
                <p style="color:#9ca3af; margin-bottom:1.5rem; font-size: 0.875rem; line-height: 1.6;">
                    1. Vào <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#818cf8; text-decoration: none; font-weight: bold;">Google AI Studio</a><br>
                    2. Tạo API Key mới (miễn phí)<br>
                    3. Dán key vào đây:
                </p>
                <input type="password" id="api-key-input" placeholder="AIzaSy..." style="width:100%; padding:0.75rem; background:#09090a; border:1px solid #27272a; color:white; border-radius:8px; margin-bottom:1.5rem; outline: none; font-family: monospace; font-size: 0.875rem;">
                <div style="display:flex; gap:0.75rem; justify-content: flex-end;">
                    <button id="cancel-api-key" style="background:transparent; color:#9ca3af; padding:0.6rem 1.2rem; border:1px solid #27272a; border-radius:8px; cursor:pointer; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.2s;">Hủy</button>
                    <button onclick="saveApiKey()" style="background:#262380; color:white; padding:0.6rem 1.5rem; border:none; border-radius:8px; cursor:pointer; font-weight: 800; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; box-shadow: 0 4px 6px -1px rgba(38, 35, 128, 0.3); transition: all 0.2s;">Lưu Key</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    // Auto focus input
    setTimeout(() => {
        const input = document.getElementById('api-key-input') as HTMLInputElement;
        if(input) input.focus();
    }, 100);

    // Cancel button logic
    document.getElementById('cancel-api-key')?.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    window.saveApiKey = () => {
        const input = document.getElementById('api-key-input') as HTMLInputElement;
        const key = input.value.trim();
        if (key.length > 10) {
            userApiKey = key;
            localStorage.setItem('gemini_api_key', key);
            document.body.removeChild(modal);
            alert("✅ API Key đã được lưu! Bạn có thể sử dụng ứng dụng.");
        } else {
            alert("⚠️ Vui lòng nhập API Key hợp lệ");
        }
    };
};

const getGenAI = () => {
    if (!userApiKey) {
        showApiKeyModal();
        throw new Error("Vui lòng nhập API Key để tiếp tục");
    }
    return new GoogleGenAI({ apiKey: userApiKey });
};

// --- DOM Elements ---
const statusEl = document.querySelector('#status') as HTMLDivElement;
const outputContainer = document.querySelector('#output-container') as HTMLDivElement;
const outputImage = document.querySelector('#output-image') as HTMLImageElement;
const promptEl = document.querySelector('#prompt-manual') as HTMLTextAreaElement;
const sizeSelect = document.querySelector('#size-select') as HTMLSelectElement;
const generateButton = document.querySelector('#generate-button') as HTMLButtonElement;
const generateProgress = document.querySelector('#generate-progress') as HTMLDivElement;
const generateLabel = document.querySelector('#generate-label') as HTMLSpanElement;
const downloadButtonMain = document.querySelector('#download-button-main') as HTMLButtonElement;
const useAsMasterBtn = document.querySelector('#use-as-master') as HTMLButtonElement;
const closeOutputBtn = document.querySelector('#close-output-btn') as HTMLButtonElement;
const globalResetBtn = document.querySelector('#global-reset-btn') as HTMLButtonElement;
const historyList = document.querySelector('#history-list') as HTMLDivElement;
const miniGenerateBtn = document.querySelector('#mini-generate-btn') as HTMLButtonElement;

// API Key Button
const apiKeyBtn = document.querySelector('#api-key-btn') as HTMLButtonElement;

// Help Elements
const helpBtn = document.querySelector('#help-btn') as HTMLButtonElement;
const helpModal = document.querySelector('#help-modal') as HTMLDivElement;
const closeHelpBtn = document.querySelector('#close-help-btn') as HTMLButtonElement;

// Translation Buttons
const langBtnVn = document.querySelector('#lang-btn-vn') as HTMLButtonElement;
const langBtnEn = document.querySelector('#lang-btn-en') as HTMLButtonElement;

// Inpainting UI
const inpaintingPromptToggle = document.querySelector('#inpainting-prompt-toggle') as HTMLInputElement;
const inpaintingPromptText = document.querySelector('#inpainting-prompt-text') as HTMLTextAreaElement;
const dropZone = document.querySelector('#drop-zone') as HTMLDivElement;
const imageInput = document.querySelector('#image-input') as HTMLInputElement;
const uploadPlaceholder = document.querySelector('#upload-placeholder') as HTMLDivElement;
const inpaintingContainer = document.querySelector('#inpainting-container') as HTMLDivElement;
const uploadPreview = document.querySelector('#upload-preview') as HTMLImageElement;
const pasteImageBtn = document.querySelector('#paste-image-btn') as HTMLButtonElement;

// Canvas Elements
const maskCanvas = document.querySelector('#mask-canvas') as HTMLCanvasElement;
const guideCanvas = document.querySelector('#guide-canvas') as HTMLCanvasElement;
const maskPreviewCanvas = document.querySelector('#mask-preview-canvas') as HTMLCanvasElement;
const brushCursor = document.querySelector('#brush-cursor') as HTMLDivElement;
const canvasContainer = document.querySelector('.group\\/canvas-container') as HTMLDivElement;

// Zoom Elements
const zoomOverlay = document.querySelector('#zoom-overlay') as HTMLDivElement;
const zoomMasterBtn = document.querySelector('#zoom-master-btn') as HTMLButtonElement;
const zoomOutputBtn = document.querySelector('#zoom-output-btn') as HTMLButtonElement;
const closeZoomBtn = document.querySelector('#close-zoom') as HTMLButtonElement;
const zoomedImage = document.querySelector('#zoomed-image') as HTMLImageElement;
const zoomViewport = document.querySelector('#zoom-viewport') as HTMLDivElement;
const zoomContentWrapper = document.querySelector('#zoom-content-wrapper') as HTMLDivElement;
// Zoom Canvases
const zoomMaskCanvas = document.querySelector('#zoom-mask-canvas') as HTMLCanvasElement;
const zoomPreviewCanvas = document.querySelector('#zoom-preview-canvas') as HTMLCanvasElement;
const zoomGuideCanvas = document.querySelector('#zoom-guide-canvas') as HTMLCanvasElement;

// Zoom Toolbar
const zoomBrushPanel = document.querySelector('#zoom-brush-panel') as HTMLDivElement;
const zoomBrushSizeSlider = document.querySelector('#zoom-brush-size-slider') as HTMLInputElement;
const zoomBrushSizeVal = document.querySelector('#zoom-brush-size-val') as HTMLSpanElement;
const zoomClearMaskBtn = document.querySelector('#zoom-clear-mask') as HTMLButtonElement;

// Tools
const clearMaskBtn = document.querySelector('#clear-mask') as HTMLButtonElement;
const toolbarClearBtn = document.querySelector('#clear-mask-toolbar') as HTMLButtonElement;
const removeImageBtn = document.querySelector('#remove-image') as HTMLButtonElement;
const removeImageOverlayBtn = document.querySelector('#remove-image-overlay-btn') as HTMLButtonElement;
const brushSlider = document.querySelector('#brush-size-slider') as HTMLInputElement;
const brushSizeVal = document.querySelector('#brush-size-val') as HTMLSpanElement;
const toolBtns = document.querySelectorAll('.tool-btn') as NodeListOf<HTMLButtonElement>;

// Reference Images
const referenceDropZone = document.querySelector('#reference-drop-zone') as HTMLDivElement;
const referenceInput = document.querySelector('#reference-image-input') as HTMLInputElement;
const referencePlaceholder = document.querySelector('#reference-placeholder') as HTMLDivElement;
const referencePreviews = document.querySelector('#reference-previews') as HTMLDivElement;
const refCountEl = document.querySelector('#ref-count') as HTMLSpanElement;
const clearAllRefsBtn = document.querySelector('#clear-all-refs') as HTMLButtonElement;

// PNG Info
const pngInfoDropZone = document.querySelector('#png-info-drop-zone') as HTMLDivElement;
const pngInfoInput = document.querySelector('#png-info-input') as HTMLInputElement;
const pastePngInfoBtn = document.querySelector('#paste-png-info-btn') as HTMLButtonElement;

// Resolution Buttons
const resBtns = document.querySelectorAll('.res-btn') as NodeListOf<HTMLButtonElement>;

// Icon Buttons
const copyBtns = document.querySelectorAll('.copy-text-btn') as NodeListOf<HTMLButtonElement>;
const pasteBtns = document.querySelectorAll('.paste-text-btn') as NodeListOf<HTMLButtonElement>;
const clearTextBtns = document.querySelectorAll('.clear-text-btn') as NodeListOf<HTMLButtonElement>;
const exportBtns = document.querySelectorAll('.export-single-btn') as NodeListOf<HTMLButtonElement>;

// Text File Handling
const fileDisplaySlots = document.querySelectorAll('.file-display-slot') as NodeListOf<HTMLDivElement>;
const manualCtxEntries = document.querySelectorAll('.manual-ctx-entry') as NodeListOf<HTMLTextAreaElement>;

// Camera Toggle
const cameraProjToggle = document.querySelector('#camera-projection-toggle') as HTMLInputElement;

// History Label for Clear
const historyLabelContainer = document.querySelector('#history-label-container') as HTMLDivElement;

// --- State Variables ---
let referenceImages: ReferenceImage[] = [];
let uploadedImageData: { data: string; mimeType: string } | null = null;
let isDrawing = false;
let ctx: CanvasRenderingContext2D | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
let guideCtx: CanvasRenderingContext2D | null = null;

// Zoom Contexts
let zoomCtx: CanvasRenderingContext2D | null = null;
let zoomPreviewCtx: CanvasRenderingContext2D | null = null;
let zoomGuideCtx: CanvasRenderingContext2D | null = null;

let currentBrushSize = 30;
let activeTool: 'brush' | 'rect' | 'ellipse' | 'lasso' | 'eraser' | 'arrow' = 'brush';
let startX = 0;
let startY = 0;
let lassoPoints: { x: number; y: number }[] = [];
let isGenerating = false;
let currentProgressInterval: any = null;
let selectedResolution = '1K';
let cameraProjectionEnabled = false;
let abortController: AbortController | null = null;

// Zoom State
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

const loadedFilesContent: Record<string, string> = {
    'prompt-manual': '',
    'lighting-manual': '',
    'scene-manual': '',
    'view-manual': ''
};

// --- API Key Logic ---
if (apiKeyBtn) {
    apiKeyBtn.style.display = 'block'; // Ensure visible
    apiKeyBtn.addEventListener('click', () => {
        showApiKeyModal();
    });
}

// --- Helper Functions ---

function autoResize(el: HTMLTextAreaElement) {
    if (!el) return;
    el.style.height = 'auto'; 
    el.style.height = el.scrollHeight + 'px';
}

function setupAutoResize(el: HTMLTextAreaElement) {
    if (!el) return;
    el.addEventListener('input', () => autoResize(el));
    requestAnimationFrame(() => autoResize(el));
}

if (promptEl) setupAutoResize(promptEl);
if (inpaintingPromptText) setupAutoResize(inpaintingPromptText);
manualCtxEntries.forEach(el => setupAutoResize(el));

// --- Help Modal Logic ---
if (helpBtn && helpModal && closeHelpBtn) {
    helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
    closeHelpBtn.addEventListener('click', () => helpModal.classList.add('hidden'));
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.add('hidden');
    });
}

// --- Translation Logic ---
function updateLangButtonStyles(active: 'VN' | 'EN') {
    if (active === 'VN') {
        langBtnVn?.classList.remove('text-gray-500');
        langBtnVn?.classList.add('bg-[#262380]', 'text-white');
        
        langBtnEn?.classList.remove('bg-[#262380]', 'text-white');
        langBtnEn?.classList.add('text-gray-500');
    } else {
        langBtnEn?.classList.remove('text-gray-500');
        langBtnEn?.classList.add('bg-[#262380]', 'text-white');
        
        langBtnVn?.classList.remove('bg-[#262380]', 'text-white');
        langBtnVn?.classList.add('text-gray-500');
    }
}

async function translatePrompt(targetLang: 'VN' | 'EN') {
    // 1. UI Update
    updateLangButtonStyles(targetLang);

    // 2. Pre-check API Key to avoid error
    if (!userApiKey) {
        showApiKeyModal();
        if (statusEl) statusEl.innerText = "Please enter API Key to translate";
        return;
    }

    // 3. Gather inputs
    const megaEl = promptEl;
    const lightEl = document.getElementById('lighting-manual') as HTMLTextAreaElement;
    const sceneEl = document.getElementById('scene-manual') as HTMLTextAreaElement;
    const viewEl = document.getElementById('view-manual') as HTMLTextAreaElement;

    const dataToTranslate = {
        mega: megaEl?.value || "",
        lighting: lightEl?.value || "",
        scene: sceneEl?.value || "",
        view: viewEl?.value || ""
    };

    const hasContent = Object.values(dataToTranslate).some(v => v.trim() !== "");
    if (!hasContent) return;

    // 4. Prepare Translation
    const loadingText = targetLang === 'VN' ? "Đang dịch..." : "Translating...";
    if(statusEl) statusEl.innerText = loadingText;
    
    // Disable inputs
    if(megaEl) megaEl.disabled = true;
    if(lightEl) lightEl.disabled = true;
    if(sceneEl) sceneEl.disabled = true;
    if(viewEl) viewEl.disabled = true;

    try {
        const jsonStr = JSON.stringify(dataToTranslate);
        const systemPrompt = targetLang === 'VN' 
            ? `You are a professional translator. Translate the values in the provided JSON object to Vietnamese. Keep technical terms if appropriate. Return ONLY valid JSON.`
            : `You are a professional translator. Translate the values in the provided JSON object to English. Optimize for AI image generation. Return ONLY valid JSON.`;

        // Use local Helper to get Key
        const ai = getGenAI();

        // Using gemini-1.5-flash for free tier text tasks as requested
        const response = await ai.models.generateContent({
            model: 'gemini-1.5-flash', 
            contents: { parts: [{ text: `Translate this JSON: ${jsonStr}` }] },
            config: { 
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json'
            }
        });

        if (response.text) {
            const result = JSON.parse(response.text);
            if(megaEl && result.mega) { megaEl.value = result.mega; autoResize(megaEl); }
            if(lightEl && result.lighting) { lightEl.value = result.lighting; autoResize(lightEl); }
            if(sceneEl && result.scene) { sceneEl.value = result.scene; autoResize(sceneEl); }
            if(viewEl && result.view) { viewEl.value = result.view; autoResize(viewEl); }
        }
    } catch (e: any) {
        console.error("Translation failed", e);
        if (statusEl) statusEl.innerText = "Translation Error";
        if (e.message.includes("API Key") || e.message.includes("401")) {
             showApiKeyModal();
        }
    } finally {
        if(megaEl) megaEl.disabled = false;
        if(lightEl) lightEl.disabled = false;
        if(sceneEl) sceneEl.disabled = false;
        if(viewEl) viewEl.disabled = false;
        if(statusEl) statusEl.innerText = "System Standby";
    }
}

if (langBtnVn) langBtnVn.addEventListener('click', () => translatePrompt('VN'));
if (langBtnEn) langBtnEn.addEventListener('click', () => translatePrompt('EN'));

// --- Icon Button Logic ---

copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId!) as HTMLTextAreaElement;
        if (el && el.value) {
            navigator.clipboard.writeText(el.value);
            const originalColor = btn.style.color;
            btn.style.color = '#4ade80'; 
            setTimeout(() => btn.style.color = originalColor, 1000);
        }
    });
});

pasteBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId!) as HTMLTextAreaElement;
        if (el) {
            try {
                window.focus();
                const text = await navigator.clipboard.readText();
                el.value = text;
                autoResize(el);
            } catch (err) { console.error('Clipboard read failed', err); }
        }
    });
});

clearTextBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId!) as HTMLTextAreaElement;
        if (el) { el.value = ''; autoResize(el); }
    });
});

exportBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId!) as HTMLTextAreaElement;
        if (el && el.value) {
            const blob = new Blob([el.value], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${targetId || 'prompt'}-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }
    });
});

// --- Resolution Switching ---
resBtns.forEach(btn => {
    // Add Pro Badge Logic
    if (btn.getAttribute('data-value') === '2K' || btn.getAttribute('data-value') === '4K') {
        const badge = document.createElement('span');
        badge.className = "absolute -top-1 -right-1 bg-amber-500 text-black text-[6px] font-black px-1 rounded-sm shadow-sm pointer-events-none";
        badge.innerText = "PRO";
        btn.classList.add('relative');
        btn.appendChild(badge);
    }

    btn.addEventListener('click', async () => {
         const targetRes = btn.getAttribute('data-value');

         // --- PRO FEATURE CHECK (Immediate Feedback on Click) ---
         if (targetRes === '2K' || targetRes === '4K') {
             if (typeof window.aistudio !== 'undefined' && window.aistudio.hasSelectedApiKey) {
                 const hasPaid = await window.aistudio.hasSelectedApiKey();
                 // If no paid key is selected, we do NOT switch state
                 if (!hasPaid) {
                     // NO ALERT here as requested - we handle logic during generation or just fail silently/log
                     // But for UX, we probably shouldn't even let them select it visually if we want strictly strict.
                     // HOWEVER, request says "Thong bao tra phi... khong hien lai".
                     // And "Neu tai khoan Free tu dong mac dinh 1K".
                     // So here we can allow selection but it will auto-downgrade later, OR auto-downgrade now.
                     // Let's allow selection for now and handle "downgrade" at generation time as requested.
                     // OR we can just silently not switch.
                     // Let's proceed to switch UI state, but logic will catch it.
                 }
             }
         }

         // Switch Logic 
         resBtns.forEach(b => {
            b.classList.remove('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
            b.classList.add('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
         });
         btn.classList.add('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
         btn.classList.remove('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
         selectedResolution = targetRes || '1K';
         if(statusEl) statusEl.innerText = `Res set to ${selectedResolution}`;
    });
});

if (cameraProjToggle) cameraProjToggle.addEventListener('change', () => { cameraProjectionEnabled = cameraProjToggle.checked; });

// --- PNG Info Functions ---
const crcTable = new Int32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c;
}

function crc32(buf: Uint8Array) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xFF];
    return (c ^ -1) >>> 0;
}
function stringToUint8(str: string) { return new TextEncoder().encode(str); }
function uint8ToString(buf: Uint8Array) { return new TextDecoder().decode(buf); }

function convertToPngBase64(base64Data: string, mimeType: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject('No ctx'); return; }
            ctx.drawImage(img, 0, 0);
            try { resolve(canvas.toDataURL('image/png').split(',')[1]); } catch (e) { reject(e); }
        };
        img.onerror = reject;
        img.src = `data:${mimeType};base64,${base64Data}`;
    });
}

async function embedMetadata(base64Image: string, data: PromptData): Promise<string> {
    const binaryString = atob(base64Image);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);

    const jsonStr = JSON.stringify(data);
    const keyword = "BananaProData";
    const kBytes = stringToUint8(keyword);
    const tBytes = stringToUint8(jsonStr);
    
    const chunkData = new Uint8Array(kBytes.length + 1 + tBytes.length);
    chunkData.set(kBytes, 0); chunkData[kBytes.length] = 0; chunkData.set(tBytes, kBytes.length + 1);

    const length = chunkData.length;
    const type = stringToUint8("tEXt");
    const crcSrc = new Uint8Array(4 + length);
    crcSrc.set(type, 0); crcSrc.set(chunkData, 4);
    const crcVal = crc32(crcSrc);

    if (bytes[0] !== 137 || bytes[1] !== 80) return base64Image;

    const newBytes = new Uint8Array(bytes.length + 12 + length);
    const chunkHeader = new Uint8Array(8);
    new DataView(chunkHeader.buffer).setUint32(0, length);
    chunkHeader.set(type, 4);
    const chunkFooter = new Uint8Array(4);
    new DataView(chunkFooter.buffer).setUint32(0, crcVal);

    newBytes.set(bytes.subarray(0, 33), 0);
    newBytes.set(chunkHeader, 33);
    newBytes.set(chunkData, 33 + 8);
    newBytes.set(chunkFooter, 33 + 8 + length);
    newBytes.set(bytes.subarray(33), 33 + 8 + length + 4);

    let binary = '';
    const newLen = newBytes.length;
    for (let i = 0; i < newLen; i++) binary += String.fromCharCode(newBytes[i]);
    return btoa(binary);
}

async function extractMetadata(file: File): Promise<PromptData | null> {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);
    const uint8 = new Uint8Array(buffer);
    if (view.getUint32(0) !== 0x89504E47) return null;

    let offset = 8;
    while (offset < buffer.byteLength) {
        if (offset + 8 > buffer.byteLength) break;
        const length = view.getUint32(offset);
        const type = uint8ToString(uint8.subarray(offset + 4, offset + 8));
        if (type === 'tEXt') {
            const data = uint8.subarray(offset + 8, offset + 8 + length);
            let nullIndex = -1;
            for(let i=0; i<length; i++) if(data[i] === 0) { nullIndex = i; break; }
            if (nullIndex > 0) {
                const keyword = uint8ToString(data.subarray(0, nullIndex));
                if (keyword === 'BananaProData') {
                    try { return JSON.parse(uint8ToString(data.subarray(nullIndex + 1))); } 
                    catch(e) { console.error("JSON parse failed", e); }
                }
            }
        }
        offset += 12 + length;
        if (type === 'IEND') break;
    }
    return null;
}

function populateMetadata(data: PromptData) {
    if (promptEl) { promptEl.value = data.mega || ''; autoResize(promptEl); }
    const l = document.getElementById('lighting-manual') as HTMLTextAreaElement;
    if (l) { l.value = data.lighting || ''; autoResize(l); }
    const s = document.getElementById('scene-manual') as HTMLTextAreaElement;
    if (s) { s.value = data.scene || ''; autoResize(s); }
    const v = document.getElementById('view-manual') as HTMLTextAreaElement;
    if (v) { v.value = data.view || ''; autoResize(v); }
    
    if (cameraProjToggle) cameraProjToggle.checked = !!data.cameraProjection;
    cameraProjectionEnabled = !!data.cameraProjection;

    if (inpaintingPromptToggle && inpaintingPromptText) {
        inpaintingPromptToggle.checked = !!data.inpaintEnabled;
        inpaintingPromptText.value = data.inpaint || '';
        if (data.inpaintEnabled) inpaintingPromptText.classList.remove('hidden');
        else inpaintingPromptText.classList.add('hidden');
        autoResize(inpaintingPromptText);
    }
    if (statusEl) { statusEl.innerText = "Data Paste Success"; setTimeout(() => statusEl.innerText = "System Standby", 2000); }
}

if (inpaintingPromptToggle && inpaintingPromptText) {
    inpaintingPromptToggle.addEventListener('change', () => {
        if (inpaintingPromptToggle.checked) {
            inpaintingPromptText.classList.remove('hidden');
            if (!inpaintingPromptText.value.trim()) {
                inpaintingPromptText.value = `Phần bị che khuất hãy:\n" Chi tiết mới được tạo ra phải được phân tích và đồng bộ dựa theo các chi tiết đang có của hình ảnh, không được làm mất tính chất đồng bộ, chi tiết tạo ra phải cân đối thật chuẩn xác, Không được thay đổi bất kỳ chi tiết nào nằm ngoài vùng khoanh."`;
            }
            autoResize(inpaintingPromptText);
        } else { inpaintingPromptText.classList.add('hidden'); }
    });
}

// --- Main Image Handling ---

function setupCanvas() {
    if (!maskCanvas || !guideCanvas || !uploadPreview) return;
    maskCanvas.width = uploadPreview.naturalWidth;
    maskCanvas.height = uploadPreview.naturalHeight;
    guideCanvas.width = uploadPreview.naturalWidth;
    guideCanvas.height = uploadPreview.naturalHeight;
    if (maskPreviewCanvas) {
        maskPreviewCanvas.width = maskCanvas.width;
        maskPreviewCanvas.height = maskCanvas.height;
    }
    
    // Zoom Canvases
    if (zoomMaskCanvas) { zoomMaskCanvas.width = maskCanvas.width; zoomMaskCanvas.height = maskCanvas.height; }
    if (zoomPreviewCanvas) { zoomPreviewCanvas.width = maskCanvas.width; zoomPreviewCanvas.height = maskCanvas.height; }
    if (zoomGuideCanvas) { zoomGuideCanvas.width = maskCanvas.width; zoomGuideCanvas.height = maskCanvas.height; }

    ctx = maskCanvas.getContext('2d');
    previewCtx = maskPreviewCanvas?.getContext('2d') || null;
    guideCtx = guideCanvas.getContext('2d');
    
    zoomCtx = zoomMaskCanvas?.getContext('2d') || null;
    zoomPreviewCtx = zoomPreviewCanvas?.getContext('2d') || null;
    zoomGuideCtx = zoomGuideCanvas?.getContext('2d') || null;

    if(ctx) { ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = currentBrushSize; }
    
    // Sync Zoom Mask with Main Mask (Initial)
    if(zoomCtx) zoomCtx.drawImage(maskCanvas, 0, 0);
}

function handleMainImage(file: File) {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const result = e.target?.result as string;
        uploadedImageData = { data: result.split(',')[1], mimeType: file.type };
        if (uploadPreview) {
            uploadPreview.src = result;
            uploadPreview.onload = () => {
                 setupCanvas();
                 uploadPlaceholder?.classList.add('hidden');
                 inpaintingContainer?.classList.remove('hidden');
                 if(statusEl) statusEl.innerText = "Image Loaded";
            };
        }
    };
    reader.readAsDataURL(file);
}

if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('border-[#262380]'); });
    dropZone.addEventListener('dragleave', (e) => { dropZone.classList.remove('border-[#262380]'); });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('border-[#262380]');
        if (e.dataTransfer?.files?.[0]) handleMainImage(e.dataTransfer.files[0]);
    });
    dropZone.addEventListener('click', (e) => { 
        if ((e.target as HTMLElement).closest('.tool-btn') || (e.target as HTMLElement).closest('canvas') || (e.target as HTMLElement).closest('button')) return;
        if (!uploadedImageData) imageInput?.click(); 
    });
}
imageInput?.addEventListener('change', () => { if (imageInput.files?.[0]) handleMainImage(imageInput.files[0]); });

// Paste Image Button Handler
if (pasteImageBtn) {
    pasteImageBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        try {
            const clipboardItems = await navigator.clipboard.read();
            let foundImage = false;
            for (const item of clipboardItems) {
                const imageTypes = item.types.filter(type => type.startsWith('image/'));
                if (imageTypes.length > 0) {
                    // Get the first image type available
                    const blob = await item.getType(imageTypes[0]);
                    const file = new File([blob], "pasted_image.png", { type: imageTypes[0] });
                    handleMainImage(file);
                    foundImage = true;
                    break;
                }
            }
            if (!foundImage) {
                alert("Không tìm thấy hình ảnh trong bộ nhớ đệm (Clipboard)!");
            }
        } catch (err) {
            console.error('Paste failed:', err);
            alert("Lỗi: Không thể truy cập bộ nhớ đệm. Hãy đảm bảo bạn đã cấp quyền hoặc đang sử dụng trình duyệt hỗ trợ.");
        }
    });
}

function resetImage() {
    uploadedImageData = null;
    if (uploadPreview) uploadPreview.src = '';
    inpaintingContainer?.classList.add('hidden');
    uploadPlaceholder?.classList.remove('hidden');
    maskCanvas?.getContext('2d')?.clearRect(0,0,maskCanvas.width,maskCanvas.height);
    maskPreviewCanvas?.getContext('2d')?.clearRect(0,0,maskPreviewCanvas.width,maskPreviewCanvas.height);
    guideCanvas?.getContext('2d')?.clearRect(0,0,guideCanvas.width,guideCanvas.height);
    zoomMaskCanvas?.getContext('2d')?.clearRect(0,0,zoomMaskCanvas.width,zoomMaskCanvas.height);
    imageInput.value = '';
}
removeImageBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetImage(); });
removeImageOverlayBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetImage(); });

// --- Zoom Logic (Enhanced) ---

function updateZoomTransform() {
    if (zoomContentWrapper) {
        zoomContentWrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    }
}

if (zoomMasterBtn && zoomOverlay && zoomedImage && uploadPreview) {
    zoomMasterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (uploadPreview.src) {
            zoomedImage.src = uploadPreview.src;
            // Sync content
            if(zoomMaskCanvas) {
                const zc = zoomMaskCanvas.getContext('2d');
                zc?.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height);
                zc?.drawImage(maskCanvas, 0, 0);
                zoomMaskCanvas.classList.remove('hidden');
            }
            if(zoomGuideCanvas) {
                 const zgc = zoomGuideCanvas.getContext('2d');
                 zgc?.clearRect(0, 0, zoomGuideCanvas.width, zoomGuideCanvas.height);
                 zgc?.drawImage(guideCanvas, 0, 0);
                 zoomGuideCanvas.classList.remove('hidden');
            }

            zoomOverlay.classList.remove('hidden');
            setTimeout(() => { zoomOverlay.classList.remove('opacity-0'); }, 10);
            zoomBrushPanel?.classList.remove('hidden');
            
            // Show canvas overlays in zoom
            zoomPreviewCanvas?.classList.remove('hidden');

            // Reset Zoom/Pan
            zoomScale = 1; panX = 0; panY = 0;
            updateZoomTransform();
        }
    });

    closeZoomBtn?.addEventListener('click', () => {
        zoomOverlay.classList.add('opacity-0');
        setTimeout(() => { zoomOverlay.classList.add('hidden'); }, 300);
    });
    
    // Zoom Output Button Logic
    const openOutputZoom = () => {
        if (outputImage.src) {
            zoomedImage.src = outputImage.src;
            
            zoomOverlay.classList.remove('hidden');
            setTimeout(() => { zoomOverlay.classList.remove('opacity-0'); }, 10);
            
            // Hide editing tools for output view since it's a result
            zoomBrushPanel?.classList.add('hidden'); 
            zoomMaskCanvas?.classList.add('hidden');
            zoomGuideCanvas?.classList.add('hidden');
            zoomPreviewCanvas?.classList.add('hidden');

            // Reset Zoom/Pan
            zoomScale = 1; panX = 0; panY = 0;
            updateZoomTransform();
        }
    };

    if (zoomOutputBtn && outputImage) {
        zoomOutputBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openOutputZoom();
        });
        // Click on output image to zoom
        outputImage.addEventListener('click', (e) => {
            e.stopPropagation();
            openOutputZoom();
        });
    }

    // Click outside to close zoom
    zoomOverlay.addEventListener('click', (e) => {
        if (e.target === zoomViewport || e.target === zoomOverlay) {
             closeZoomBtn.click();
        }
    });

    // Zoom Wheel
    zoomOverlay.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY * -0.001; // Sensitivity
        const newScale = Math.min(Math.max(0.1, zoomScale + delta), 5);
        zoomScale = newScale;
        updateZoomTransform();
    });

    // Zoom Pan (Middle Mouse)
    zoomViewport?.addEventListener('mousedown', (e) => {
        if (e.button === 1) { // Middle click
            e.preventDefault();
            isPanning = true;
            panStartX = e.clientX - panX;
            panStartY = e.clientY - panY;
            zoomViewport.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            e.preventDefault();
            panX = e.clientX - panStartX;
            panY = e.clientY - panStartY;
            updateZoomTransform();
        }
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            zoomViewport.style.cursor = 'grab';
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !zoomOverlay.classList.contains('hidden')) {
            closeZoomBtn.click();
        }
        // Space to Exit Zoom
        if (e.key === ' ' && !zoomOverlay.classList.contains('hidden')) {
             e.preventDefault();
             closeZoomBtn.click();
        }
    });
}

// --- Keyboard Shortcuts ---
document.addEventListener('keydown', (e) => {
    // Priority check for Generate shortcut (Ctrl+Enter)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runGeneration();
        return;
    }

    const target = e.target as HTMLElement;
    // Block other shortcuts if editing text
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;

    // Clear Arrows Shortcut
    if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        document.getElementById('clear-arrows-btn')?.click();
        return;
    }

    switch(e.key.toLowerCase()) {
        case 'b': document.getElementById('tool-brush')?.click(); break;
        case 'e': document.getElementById('tool-eraser')?.click(); break;
        case 'l': document.getElementById('tool-lasso')?.click(); break;
        case 'r': document.getElementById('tool-rect')?.click(); break;
        case 'a': document.getElementById('tool-arrow')?.click(); break;
        case 'o': document.getElementById('tool-ellipse')?.click(); break; // O for Ellipse/Oval
        case 'x': document.getElementById('clear-mask')?.click(); break; // Reset
    }
});

// --- Reference Image Handling ---

function renderRefs() {
    if (!referencePreviews || !referencePlaceholder || !refCountEl) return;
    referencePreviews.innerHTML = '';
    if (referenceImages.length === 0) {
        referencePlaceholder.classList.remove('hidden');
        referencePreviews.classList.add('hidden');
        refCountEl.innerText = '0/5';
        return;
    }
    referencePlaceholder.classList.add('hidden');
    referencePreviews.classList.remove('hidden');
    refCountEl.innerText = `${referenceImages.length}/5`;

    referenceImages.forEach((img, index) => {
        const div = document.createElement('div');
        div.className = 'relative w-16 h-16 group shrink-0';
        const imageEl = document.createElement('img');
        imageEl.src = `data:${img.mimeType};base64,${img.data}`;
        imageEl.className = 'w-full h-full object-cover rounded border border-gray-600';
        const delBtn = document.createElement('button');
        delBtn.className = 'absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity';
        delBtn.innerText = '×';
        delBtn.onclick = (e) => { e.stopPropagation(); referenceImages.splice(index, 1); renderRefs(); };
        div.appendChild(imageEl); div.appendChild(delBtn); referencePreviews.appendChild(div);
    });
}
function handleRefFiles(files: FileList) {
    Array.from(files).forEach(f => {
        if (f.type.startsWith('image/') && referenceImages.length < 5) {
            const r = new FileReader();
            r.onload = (ev) => {
                referenceImages.push({ file: f, data: (ev.target?.result as string).split(',')[1], mimeType: f.type });
                renderRefs();
            };
            r.readAsDataURL(f);
        }
    });
}
if (referenceDropZone) {
    referenceDropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); referenceDropZone.classList.add('border-[#262380]'); });
    referenceDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); referenceDropZone.classList.remove('border-[#262380]'); });
    referenceDropZone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); referenceDropZone.classList.remove('border-[#262380]'); if (e.dataTransfer?.files) handleRefFiles(e.dataTransfer.files); });
    referenceDropZone.addEventListener('click', (e) => { if(!(e.target as HTMLElement).closest('button')) referenceInput?.click(); });
}
referenceInput?.addEventListener('change', () => { if(referenceInput.files) { handleRefFiles(referenceInput.files); referenceInput.value = ''; } });
clearAllRefsBtn?.addEventListener('click', (e) => { e.stopPropagation(); referenceImages = []; renderRefs(); });

// --- History Clear Logic ---
if (historyLabelContainer) {
    historyLabelContainer.addEventListener('click', () => {
        if (historyList) {
            historyList.innerHTML = '<div class="text-[9px] text-gray-700 font-bold uppercase tracking-widest px-4">No history yet</div>';
        }
    });
}

// --- PNG Info Logic ---
if (pngInfoDropZone) {
    pngInfoDropZone.addEventListener('click', () => pngInfoInput?.click());
    pngInfoDropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.add('border-[#262380]', 'bg-[#262380]/10'); });
    pngInfoDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.remove('border-[#262380]', 'bg-[#262380]/10'); });
    pngInfoDropZone.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.remove('border-[#262380]', 'bg-[#262380]/10');
        if (e.dataTransfer?.files?.[0]) {
            const data = await extractMetadata(e.dataTransfer.files[0]);
            if (data) populateMetadata(data); else alert("No BananaProData metadata found.");
        }
    });
}
if (pngInfoInput) {
    pngInfoInput.addEventListener('change', async () => {
        if (pngInfoInput.files?.[0]) {
            const data = await extractMetadata(pngInfoInput.files[0]);
            if (data) populateMetadata(data); else alert("No BananaProData metadata found.");
            pngInfoInput.value = '';
        }
    });
}

// --- Paste PNG Info Button (UPDATED to Read JSON Text) ---
if (pastePngInfoBtn) {
    pastePngInfoBtn.addEventListener('click', async () => {
        try {
            // Changed: Read text from clipboard instead of image
            window.focus();
            const text = await navigator.clipboard.readText();
            if (!text || !text.trim()) {
                alert("Clipboard is empty or does not contain text.");
                return;
            }

            try {
                // Attempt to parse text as JSON (Data PNG info format)
                const data = JSON.parse(text);
                
                // Basic validation to check if it looks like our metadata structure
                // PromptData interface: { mega, lighting, scene, view, inpaint, inpaintEnabled, cameraProjection }
                // We check for at least one known key to confirm it's likely the correct data
                const isPromptData = data && (
                    'mega' in data || 
                    'lighting' in data || 
                    'scene' in data || 
                    'view' in data ||
                    'BananaProData' in data // Just in case it's wrapped
                );

                if (isPromptData) {
                    populateMetadata(data);
                    if(statusEl) {
                        statusEl.innerText = "Data Paste Success";
                        setTimeout(() => statusEl.innerText = "System Standby", 2000);
                    }
                } else {
                    // Fallback: If it's JSON but not our structure, warn user
                    console.warn("Clipboard JSON does not match PromptData structure:", data);
                    alert("Clipboard JSON does not match the expected Data PNG Info format.");
                }
            } catch (jsonErr) {
                console.error("JSON Parse Error", jsonErr);
                alert("Clipboard text is not valid JSON Data.");
            }
        } catch (err) {
            console.error("Failed to read clipboard", err);
            alert("Unable to read from clipboard. Please allow clipboard access.");
        }
    });
}

// --- Text File Handling ---
fileDisplaySlots.forEach((slot) => {
    const input = slot.querySelector('input[type="file"]') as HTMLInputElement;
    const infoDiv = slot.querySelector('.loaded-file-info') as HTMLDivElement;
    const statusSpan = slot.querySelector('.file-status') as HTMLSpanElement;
    const nameSpan = slot.querySelector('.file-name') as HTMLSpanElement;
    const deleteBtn = slot.querySelector('.delete-file-btn') as HTMLButtonElement;
    const targetKey = input?.getAttribute('data-target');

    const updateFile = async (file: File) => {
        if (!file.name.endsWith('.txt')) return;
        try {
            const text = await file.text();
            if (targetKey) {
                loadedFilesContent[targetKey] = text;
                const textarea = document.getElementById(targetKey) as HTMLTextAreaElement;
                if (textarea) { textarea.value = text; autoResize(textarea); }
            }
            if (nameSpan) nameSpan.innerText = file.name;
            infoDiv?.classList.remove('hidden'); statusSpan?.classList.add('hidden');
            slot.classList.add('border-[#262380]/40', 'bg-[#262380]/5');
        } catch (err) { console.error("Error reading file:", err); }
    };
    const clearFile = (e?: Event) => {
        if(e) e.stopPropagation();
        if (targetKey) {
            loadedFilesContent[targetKey] = '';
             const textarea = document.getElementById(targetKey) as HTMLTextAreaElement;
             if (textarea) textarea.value = '';
        }
        if (input) input.value = '';
        infoDiv?.classList.add('hidden'); statusSpan?.classList.remove('hidden');
        slot.classList.remove('border-[#262380]/40', 'bg-[#262380]/5');
    };
    slot.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('.delete-file-btn')) return; input?.click(); });
    input?.addEventListener('change', () => { if (input.files && input.files[0]) updateFile(input.files[0]); });
    deleteBtn?.addEventListener('click', clearFile);
    slot.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.add('border-[#262380]', 'bg-[#262380]/10'); });
    slot.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.remove('border-[#262380]', 'bg-[#262380]/10'); });
    slot.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); slot.classList.remove('border-[#262380]', 'bg-[#262380]/10'); if (e.dataTransfer?.files?.[0]) updateFile(e.dataTransfer.files[0]); });
});
manualCtxEntries.forEach((el) => {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('border-[#262380]'); });
    el.addEventListener('dragleave', () => el.classList.remove('border-[#262380]'));
    el.addEventListener('drop', async (e) => {
        e.preventDefault(); el.classList.remove('border-[#262380]');
        if (e.dataTransfer?.files?.[0] && e.dataTransfer.files[0].name.endsWith('.txt')) {
             el.value = await e.dataTransfer.files[0].text(); autoResize(el);
        }
    });
});

// --- Canvas Drawing & Cursor ---

const pencilIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-2/3 w-2/3 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M14.083 2.506a2.898 2.898 0 014.09 4.089l-9.605 9.603-4.326.865.867-4.326 9.605-9.604-.63-.627zM16.902 8.01l-1.258-1.259 1.258 1.259zm-10.74 8.35l.432 2.155 2.154-.431-2.586-1.724z" /></svg>`;
const dotIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-2/3 w-2/3 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>`;
const circleIcon = `<div class="w-full h-full rounded-full border-2 border-white/80"></div>`; // Simplified for default

function updateBrushCursor(e: MouseEvent) {
    if (!brushCursor) return;
    brushCursor.style.left = `${e.clientX - (currentBrushSize / 2)}px`;
    brushCursor.style.top = `${e.clientY - (currentBrushSize / 2)}px`;
    brushCursor.style.width = `${currentBrushSize}px`;
    brushCursor.style.height = `${currentBrushSize}px`;
    
    // Icon switching based on tool
    if (activeTool === 'brush' || activeTool === 'eraser') {
        // Keeps the default CSS styling for circle, remove SVG
         brushCursor.innerHTML = '';
    } else if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'lasso') {
         brushCursor.innerHTML = pencilIcon;
    } else if (activeTool === 'arrow') {
         brushCursor.innerHTML = dotIcon;
    }
}

if (canvasContainer) {
    canvasContainer.addEventListener('mousemove', (e) => {
        brushCursor.classList.remove('hidden');
        updateBrushCursor(e as MouseEvent);
    });
    canvasContainer.addEventListener('mouseleave', () => { brushCursor.classList.add('hidden'); });
}

// Ensure zoom cursor consistency
if (zoomViewport) {
     zoomViewport.addEventListener('mousemove', (e) => {
        brushCursor.classList.remove('hidden');
        updateBrushCursor(e as MouseEvent);
    });
    zoomViewport.addEventListener('mouseleave', () => {
         brushCursor.classList.add('hidden');
    });
}

// Coordinate helper for Zoom Canvas
function getTransformedCanvasCoords(e: MouseEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    // In zoom mode, the rect already accounts for scale, but we need local coords relative to scale 1
    // The visual rect is W*Scale, H*Scale.
    // The canvas internal resolution is W, H.
    
    // If drawing on ZOOMED canvas:
    // 1. Mouse relative to viewport
    // 2. Adjust for pan
    // 3. Scale down
    if (canvas.id === 'zoom-mask-canvas') {
         // zoomContentWrapper rect includes transform
         const wrapRect = zoomContentWrapper.getBoundingClientRect();
         const offsetX = e.clientX - wrapRect.left;
         const offsetY = e.clientY - wrapRect.top;
         return { x: offsetX / zoomScale, y: offsetY / zoomScale };
    } else {
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    }
}

// Unified Draw Logic
function startDrawing(e: MouseEvent, targetCanvas: HTMLCanvasElement) {
    const contextToUse = (targetCanvas.id === 'zoom-mask-canvas') ? ctx : ctx; // Always draw to main ctx
    if (!contextToUse) return;

    isDrawing = true;
    const { x, y } = getTransformedCanvasCoords(e, targetCanvas);
    startX = x; startY = y;

    if (activeTool === 'brush' || activeTool === 'eraser') {
        contextToUse.beginPath();
        contextToUse.globalCompositeOperation = activeTool === 'eraser' ? 'destination-out' : 'source-over';
        contextToUse.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        contextToUse.fillStyle = 'rgba(255, 0, 0, 0.8)';
        contextToUse.moveTo(x, y); contextToUse.lineTo(x, y); contextToUse.stroke();
    } else if (activeTool === 'lasso') {
        lassoPoints = [{x, y}];
    }
}

function draw(e: MouseEvent, targetCanvas: HTMLCanvasElement) {
    if (!isDrawing) return;
    const { x, y } = getTransformedCanvasCoords(e, targetCanvas);
    const contextToUse = ctx; // Main ctx

    // For preview, decide which canvas to use
    const pCtx = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCtx : previewCtx;
    const pCanvas = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCanvas : maskPreviewCanvas;

    if (activeTool === 'brush' || activeTool === 'eraser') {
        if(contextToUse) { contextToUse.lineTo(x, y); contextToUse.stroke(); }
        // If zooming, update zoom canvas visualization too (simple sync)
        if(targetCanvas.id === 'zoom-mask-canvas' && zoomCtx) {
             zoomCtx.clearRect(0,0,zoomCtx.canvas.width, zoomCtx.canvas.height);
             zoomCtx.drawImage(maskCanvas, 0, 0);
        }
    } else {
        if (!pCtx || !pCanvas) return;
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        pCanvas.classList.remove('hidden');

        pCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        pCtx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        pCtx.lineWidth = activeTool === 'arrow' ? 5 : 2;

        if (activeTool === 'rect') {
            pCtx.fillRect(startX, startY, x - startX, y - startY);
            pCtx.strokeRect(startX, startY, x - startX, y - startY);
        } else if (activeTool === 'ellipse') {
            pCtx.beginPath();
            const radiusX = Math.abs(x - startX) / 2;
            const radiusY = Math.abs(y - startY) / 2;
            const centerX = startX + (x - startX) / 2;
            const centerY = startY + (y - startY) / 2;
            pCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            pCtx.fill(); pCtx.stroke();
        } else if (activeTool === 'lasso') {
            lassoPoints.push({x, y});
            pCtx.beginPath();
            pCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
            for (let i = 1; i < lassoPoints.length; i++) pCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
            pCtx.stroke(); pCtx.fillStyle = 'rgba(255, 0, 0, 0.1)'; pCtx.fill();
        } else if (activeTool === 'arrow') {
            const headlen = 30; // Increased size
            const angle = Math.atan2(y - startY, x - startX);
            pCtx.strokeStyle = 'cyan'; pCtx.lineWidth = 8; // Increased width
            pCtx.beginPath(); pCtx.moveTo(startX, startY); pCtx.lineTo(x, y); pCtx.stroke();
            pCtx.beginPath(); pCtx.moveTo(x, y);
            pCtx.lineTo(x - headlen * Math.cos(angle - Math.PI / 6), y - headlen * Math.sin(angle - Math.PI / 6));
            pCtx.lineTo(x - headlen * Math.cos(angle + Math.PI / 6), y - headlen * Math.sin(angle + Math.PI / 6));
            pCtx.lineTo(x, y); pCtx.fillStyle = 'cyan'; pCtx.fill();
        }
    }
}

function stopDrawing(e: MouseEvent, targetCanvas: HTMLCanvasElement) {
    if (!isDrawing) return;
    isDrawing = false;
    const { x, y } = getTransformedCanvasCoords(e, targetCanvas);
    const contextToUse = ctx;

    const pCtx = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCtx : previewCtx;
    const pCanvas = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCanvas : maskPreviewCanvas;

    if (activeTool === 'brush' || activeTool === 'eraser') {
        if (contextToUse) contextToUse.closePath();
    } else {
        if (!contextToUse || !pCtx || !pCanvas) return;
        pCanvas.classList.add('hidden');
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        
        contextToUse.globalCompositeOperation = 'source-over';
        contextToUse.fillStyle = 'rgba(255, 0, 0, 0.8)';
        contextToUse.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        contextToUse.lineWidth = currentBrushSize;

        if (activeTool === 'rect') {
            contextToUse.fillRect(startX, startY, x - startX, y - startY);
        } else if (activeTool === 'ellipse') {
            contextToUse.beginPath();
            const radiusX = Math.abs(x - startX) / 2;
            const radiusY = Math.abs(y - startY) / 2;
            const centerX = startX + (x - startX) / 2;
            const centerY = startY + (y - startY) / 2;
            contextToUse.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            contextToUse.fill();
        } else if (activeTool === 'lasso') {
            contextToUse.beginPath();
            contextToUse.moveTo(lassoPoints[0].x, lassoPoints[0].y);
            for (let i = 1; i < lassoPoints.length; i++) contextToUse.lineTo(lassoPoints[i].x, lassoPoints[i].y);
            contextToUse.closePath();
            contextToUse.fill();
        } else if (activeTool === 'arrow') {
            const headlen = 30; // Increased size
            const angle = Math.atan2(y - startY, x - startX);
            const gCtx = guideCtx; // Guide is always main guide ctx
            if (gCtx) {
                gCtx.strokeStyle = '#06b6d4'; gCtx.lineWidth = 10; gCtx.lineCap = 'round'; // Increased width
                gCtx.beginPath(); gCtx.moveTo(startX, startY); gCtx.lineTo(x, y); gCtx.stroke();
                gCtx.beginPath(); gCtx.moveTo(x, y);
                gCtx.lineTo(x - headlen * Math.cos(angle - Math.PI / 6), y - headlen * Math.sin(angle - Math.PI / 6));
                gCtx.lineTo(x - headlen * Math.cos(angle + Math.PI / 6), y - headlen * Math.sin(angle + Math.PI / 6));
                gCtx.lineTo(x, y); gCtx.fillStyle = '#06b6d4'; gCtx.fill();
                // Sync Zoom Guide
                if(zoomGuideCtx) {
                     zoomGuideCtx.clearRect(0,0,zoomGuideCanvas.width, zoomGuideCanvas.height);
                     zoomGuideCtx.drawImage(guideCanvas, 0, 0);
                }
            }
        }
    }
    
    // Sync zoom canvas if needed
    if(targetCanvas.id !== 'zoom-mask-canvas' && zoomCtx) {
        zoomCtx?.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height);
        zoomCtx?.drawImage(maskCanvas, 0, 0);
    } else if (targetCanvas.id === 'zoom-mask-canvas' && ctx) {
        if (zoomCtx) {
             zoomCtx.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height);
             zoomCtx.drawImage(maskCanvas, 0, 0);
        }
    }
}

// Attach listeners
function attachCanvasListeners(canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousedown', (e) => startDrawing(e, canvas));
    canvas.addEventListener('mousemove', (e) => draw(e, canvas));
    canvas.addEventListener('mouseup', (e) => stopDrawing(e, canvas));
    canvas.addEventListener('mouseout', (e) => stopDrawing(e, canvas));
}

if (maskCanvas) attachCanvasListeners(maskCanvas);
if (zoomMaskCanvas) {
    zoomMaskCanvas.addEventListener('mousedown', (e) => {
        if(activeTool !== 'brush' && activeTool !== 'eraser' && e.button !== 0) return; 
        startDrawing(e, zoomMaskCanvas);
    });
    // Global handlers for drag out
    window.addEventListener('mousemove', (e) => {
        if(isDrawing && !isPanning && !zoomOverlay.classList.contains('hidden')) {
             draw(e, zoomMaskCanvas);
        }
    });
    window.addEventListener('mouseup', (e) => {
        if(isDrawing && !isPanning && !zoomOverlay.classList.contains('hidden')) {
             stopDrawing(e, zoomMaskCanvas);
        }
    });
}

// --- History Logic ---
function addToHistory(imgSrc: string, promptData: PromptData) {
    if (!historyList) return;
    if (historyList.children.length === 1 && historyList.children[0].textContent === 'No history yet') { historyList.innerHTML = ''; }
    
    // Changed: Add click listener to item wrapper instead of img, and ensure item has cursor-pointer
    const item = document.createElement('div');
    item.className = 'relative w-16 h-16 shrink-0 group border border-white/10 rounded-lg overflow-hidden hover:border-[#262380] transition-colors cursor-pointer';
    
    // Attach click listener to the wrapper to capture clicks over the overlay
    item.addEventListener('click', (e) => { 
        // Ensure we don't trigger if the actual delete/download buttons were clicked (handled by stopPropagation, but extra safety)
        if((e.target as HTMLElement).closest('button')) return;
        
        populateMetadata(promptData);
        outputImage.src = imgSrc;
        outputContainer.classList.remove('hidden');
    });

    const img = document.createElement('img');
    img.src = imgSrc; 
    img.className = 'w-full h-full object-cover';
    
    // Icons Overlay: Top-Center
    // Changed: Added pointer-events-none to overlay so clicks can pass through to wrapper, 
    // but added pointer-events-auto to buttons to ensure they are clickable.
    const overlay = document.createElement('div');
    overlay.className = 'absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-start justify-center pt-1 gap-1 transition-opacity pointer-events-none';
    
    // Download Icon (Smaller)
    const dlBtn = document.createElement('button'); 
    dlBtn.className = 'w-4 h-4 flex items-center justify-center bg-[#262380] rounded hover:bg-[#1e1b66] text-white pointer-events-auto';
    dlBtn.innerHTML = '<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>';
    dlBtn.onclick = (e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = imgSrc; a.download = `banana-history-${Date.now()}.png`; a.click(); };
    
    // Delete Icon (Smaller)
    const delBtn = document.createElement('button'); 
    delBtn.className = 'w-4 h-4 flex items-center justify-center bg-red-600 rounded hover:bg-red-500 text-white pointer-events-auto';
    delBtn.innerHTML = '<svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';
    delBtn.onclick = (e) => { e.stopPropagation(); item.remove(); if (historyList.children.length === 0) { historyList.innerHTML = '<div class="text-[9px] text-gray-700 font-bold uppercase tracking-widest px-4">No history yet</div>'; } };
    
    overlay.appendChild(dlBtn); overlay.appendChild(delBtn); item.appendChild(img); item.appendChild(overlay);
    historyList.insertBefore(item, historyList.firstChild);
}

// --- Use As Master Logic ---
if (useAsMasterBtn) {
    useAsMasterBtn.addEventListener('click', async () => {
        if (!outputImage.src) return;
        try {
            const res = await fetch(outputImage.src); const blob = await res.blob();
            handleMainImage(new File([blob], "master_generated.png", { type: "image/png" }));
            outputContainer.classList.add('hidden'); if(statusEl) statusEl.innerText = "Set as Master";
        } catch (e) { console.error("Failed to set as master", e); }
    });
}

// --- Generate Logic ---

async function runGeneration() {
    if (isGenerating) {
        if (abortController) { abortController.abort(); abortController = null; }
        isGenerating = false; 
        clearInterval(currentProgressInterval);
        
        generateProgress.style.width = '0%';
        generateButton.classList.remove('bg-red-600'); generateButton.classList.add('bg-[#262380]');
        generateLabel.innerText = "GENERATE (PROCESS)";
        if (miniGenerateBtn) {
             miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
             miniGenerateBtn.classList.remove('bg-red-600'); miniGenerateBtn.classList.add('bg-[#262380]');
        }
        if(statusEl) statusEl.innerText = "Generation Stopped"; 
        return;
    }

    if (!uploadedImageData) { alert("Please upload a main image first."); return; }
    
    // 1. Check for API Key FIRST to avoid exception
    if (!userApiKey) {
        showApiKeyModal();
        if(statusEl) statusEl.innerText = "Please enter API Key to start";
        return;
    }

    // --- PRO FEATURE CHECK (Gatekeeper for 2K/4K) ---
    if (selectedResolution === '2K' || selectedResolution === '4K') {
        let hasPaidKey = false;
        
        // Check if environment has a selected key (AI Studio context)
        if (typeof window.aistudio !== 'undefined' && window.aistudio.hasSelectedApiKey) {
            try {
                hasPaidKey = await window.aistudio.hasSelectedApiKey();
            } catch (e) { console.warn("Key check failed", e); }
        } else {
            // Local fallback
            hasPaidKey = false; 
        }

        if (!hasPaidKey) {
            // User has Free account: Automatically downgrade to 1K (Silent, no alert)
            selectedResolution = '1K';
            
            // Update UI to reflect change silently
            resBtns.forEach(b => {
                if(b.getAttribute('data-value') === '1K') {
                    b.classList.add('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
                    b.classList.remove('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
                } else {
                    b.classList.remove('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
                    b.classList.add('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
                }
            });
            if(statusEl) statusEl.innerText = "Downgraded to 1K (Free)";
        }
    }

    isGenerating = true; abortController = new AbortController(); 
    generateButton.classList.remove('bg-[#262380]'); generateButton.classList.add('bg-red-600');
    generateLabel.innerText = "STOP GENERATING (0%)";
    if (miniGenerateBtn) {
        miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>`;
        miniGenerateBtn.classList.remove('bg-[#262380]'); miniGenerateBtn.classList.add('bg-red-600');
    }
    if(statusEl) statusEl.innerText = "Generating...";
    generateProgress.style.width = '0%'; let progressVal = 0;
    
    // Start Progress Interval
    currentProgressInterval = setInterval(() => {
        progressVal += 1; 
        if(progressVal > 95) progressVal = 95;
        generateProgress.style.width = `${progressVal}%`; 
        generateLabel.innerText = `STOP GENERATING (${progressVal}%)`;
    }, 100);

    try {
        const p = promptEl?.value || '';
        const l = (document.getElementById('lighting-manual') as HTMLTextAreaElement)?.value || '';
        const s = (document.getElementById('scene-manual') as HTMLTextAreaElement)?.value || '';
        const v = (document.getElementById('view-manual') as HTMLTextAreaElement)?.value || '';
        const i = inpaintingPromptToggle.checked ? inpaintingPromptText.value : '';
        const fullPrompt = `${p}\nLighting: ${l}\nScene: ${s}\nView: ${v}\n${i ? 'Inpainting Instructions: ' + i : ''}\n${cameraProjectionEnabled ? 'Apply Camera Projection correction.' : ''}`.trim();
        const parts: any[] = [];
        referenceImages.forEach(ref => { parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } }); });
        parts.push({ inlineData: { mimeType: uploadedImageData.mimeType, data: uploadedImageData.data } });
        parts.push({ text: fullPrompt });
        
        let modelId = 'gemini-2.5-flash-image'; // Default Free Model (1K)
        let imageConfig: any = { aspectRatio: sizeSelect.value || '1:1' };
        
        // Select Pro Model if Resolution > 1K
        if (selectedResolution === '2K' || selectedResolution === '4K') { 
            modelId = 'gemini-3-pro-image-preview'; 
            imageConfig.imageSize = selectedResolution; 
        }

        // Use local Helper (SDK Client)
        const ai = getGenAI();

        const result = await ai.models.generateContent({ model: modelId, contents: { parts: parts }, config: { imageConfig: imageConfig } });
        
        if (abortController.signal.aborted) return;
        
        // Success - Set 100% immediately
        clearInterval(currentProgressInterval); 
        generateProgress.style.width = '100%'; 
        generateLabel.innerText = "STOP GENERATING (100%)";

        const cand = result.candidates?.[0];
        if (cand) {
            for (const part of cand.content.parts) {
                if (part.inlineData) {
                    const promptData: PromptData = { mega: p, lighting: l, scene: s, view: v, inpaint: i, inpaintEnabled: inpaintingPromptToggle.checked, cameraProjection: cameraProjectionEnabled };
                    try {
                        const pngBase64 = await convertToPngBase64(part.inlineData.data, part.inlineData.mimeType);
                        const finalBase64 = await embedMetadata(pngBase64, promptData);
                        const src = `data:image/png;base64,${finalBase64}`;
                        outputImage.src = src; outputContainer.classList.remove('hidden'); addToHistory(src, promptData);
                    } catch (err) {
                        console.error("Image processing error", err);
                        outputImage.src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                        outputContainer.classList.remove('hidden');
                    }
                }
            }
        }
    } catch (e: any) { 
        if (!abortController?.signal.aborted) { 
            console.error(e); 
            if(statusEl) statusEl.innerText = "Error encountered"; 
            if (e.message.includes("429")) {
                alert("API Quota exceeded. Please try again later.");
            } else if (e.message.includes("API Key") || e.message.includes("401") || e.message.includes("403")) {
                // If we hit a permission error (likely Pro model access), prompt again
                if (selectedResolution === '2K' || selectedResolution === '4K') {
                     alert("Lỗi: Không thể truy cập model Pro (2K/4K). Vui lòng kiểm tra lại khóa API trả phí hoặc chuyển về chế độ 1K.");
                } else {
                     showApiKeyModal(); 
                }
            } else {
                alert(`Generation failed: ${e.message}`);
            }
        }
    } finally {
        // CRITICAL FIX: Ensure cleanup runs regardless of success or error
        clearInterval(currentProgressInterval);
        
        if (isGenerating && !abortController?.signal.aborted) {
            setTimeout(() => {
                isGenerating = false; 
                generateProgress.style.width = '0%';
                generateButton.classList.remove('bg-red-600'); generateButton.classList.add('bg-[#262380]');
                generateLabel.innerText = "GENERATE (PROCESS)";
                if (miniGenerateBtn) {
                     miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                     miniGenerateBtn.classList.remove('bg-red-600'); miniGenerateBtn.classList.add('bg-[#262380]');
                }
                if(statusEl) statusEl.innerText = "System Standby"; 
                abortController = null;
            }, 500); // Reduced timeout for snappier UI
        }
    }
}

generateButton?.addEventListener('click', runGeneration);
miniGenerateBtn?.addEventListener('click', runGeneration);

closeOutputBtn?.addEventListener('click', () => { outputContainer.classList.add('hidden'); });
downloadButtonMain?.addEventListener('click', () => { if (outputImage.src) { const a = document.createElement('a'); a.href = outputImage.src; a.download = `banana-pro-${Date.now()}.png`; a.click(); } });
globalResetBtn?.addEventListener('click', () => {
    if(promptEl) promptEl.value = ''; manualCtxEntries.forEach(e => { e.value = ''; autoResize(e); });
    inpaintingPromptText.value = ''; inpaintingPromptText.classList.add('hidden'); inpaintingPromptToggle.checked = false;
    referenceImages = []; renderRefs(); resetImage();
});

// --- Toolbar Buttons Wiring ---

if (clearMaskBtn) clearMaskBtn.addEventListener('click', () => { 
    ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height); 
    zoomCtx?.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height); 
});
if (toolbarClearBtn) toolbarClearBtn.addEventListener('click', () => clearMaskBtn.click());
document.getElementById('clear-arrows-btn')?.addEventListener('click', () => {
    guideCtx?.clearRect(0, 0, guideCanvas.width, guideCanvas.height);
    zoomGuideCtx?.clearRect(0, 0, zoomGuideCanvas.width, zoomGuideCanvas.height);
});

// Main Tool Buttons
toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        toolBtns.forEach(b => { b.classList.remove('active', 'bg-[#262380]', 'text-white'); b.classList.add('text-gray-400'); });
        btn.classList.add('active', 'bg-[#262380]', 'text-white'); btn.classList.remove('text-gray-400');
        if (btn.id.includes('brush')) activeTool = 'brush';
        else if (btn.id.includes('rect')) activeTool = 'rect';
        else if (btn.id.includes('ellipse')) activeTool = 'ellipse';
        else if (btn.id.includes('lasso')) activeTool = 'lasso';
        else if (btn.id.includes('arrow')) activeTool = 'arrow';
        else if (btn.id.includes('eraser')) activeTool = 'eraser';
        
        if(brushCursor) {
             brushCursor.classList.remove('hidden');
             const left = parseInt(brushCursor.style.left);
             const top = parseInt(brushCursor.style.top);
             if (!isNaN(left) && !isNaN(top)) {
                 const e = new MouseEvent('mousemove', {
                     clientX: left + (currentBrushSize / 2), 
                     clientY: top + (currentBrushSize / 2)
                 });
                 updateBrushCursor(e);
             }
        }
        
        // Sync Zoom Tools UI
        const zoomBtns = document.querySelectorAll('#zoom-brush-panel .tool-btn');
        zoomBtns.forEach(zb => {
             zb.classList.remove('active', 'bg-[#262380]', 'text-white'); 
             zb.classList.add('bg-white/5', 'text-gray-500');
             if(zb.id.replace('zoom-tool-', '') === btn.id.replace('tool-', '')) {
                  zb.classList.add('active', 'bg-[#262380]', 'text-white');
                  zb.classList.remove('bg-white/5', 'text-gray-500');
             }
        });
    });
});

// Zoom Tool Buttons Wiring
const zoomToolBtns = document.querySelectorAll('#zoom-brush-panel .tool-btn');
zoomToolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
         // Map click back to main toolbar to keep logic centralized
         const mainId = btn.id.replace('zoom-tool-', 'tool-');
         document.getElementById(mainId)?.click();
    });
});
if(zoomClearMaskBtn) zoomClearMaskBtn.addEventListener('click', () => clearMaskBtn.click());

if (brushSlider) {
    brushSlider.addEventListener('input', () => {
        currentBrushSize = parseInt(brushSlider.value);
        if (brushSizeVal) brushSizeVal.innerText = `${currentBrushSize}px`;
        if (ctx) ctx.lineWidth = currentBrushSize;
        if (zoomBrushSizeSlider) zoomBrushSizeSlider.value = brushSlider.value;
        if (zoomBrushSizeVal) zoomBrushSizeVal.innerText = brushSizeVal.innerText;
    });
}
if (zoomBrushSizeSlider) {
    zoomBrushSizeSlider.addEventListener('input', () => {
        brushSlider.value = zoomBrushSizeSlider.value;
        brushSlider.dispatchEvent(new Event('input'));
    });
}