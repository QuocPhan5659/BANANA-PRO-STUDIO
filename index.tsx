/* tslint:disable */
import { GoogleGenAI } from '@google/genai';
import * as genai from '@google/genai';
const ThinkingLevel = (genai as any).ThinkingLevel || { LOW: 'LOW' };
import exifr from 'exifr';

// --- Global Types & Interfaces ---
declare global {
  interface AIStudio {
    openSelectKey: () => Promise<void>;
    hasSelectedApiKey: () => Promise<boolean>;
  }
  interface Window {
    aistudio?: AIStudio;
    saveApiKey?: () => void;
    sketchup?: {
        dialog_ready: () => void;
        save_image?: (data: string, filename: string) => void;
    };
  }
}

// --- SketchUp Integration ---
document.addEventListener("DOMContentLoaded", function () {
  console.log("DOM Content Loaded");
  
  // Set default tool to Select
  setTimeout(() => {
    console.log("Setting default tool to Select");
    const toolSelect = document.getElementById('tool-select');
    if (toolSelect) toolSelect.click();
  }, 500);

  // Add pulse effect to copy-all-btn on load
  const applyPulseEffect = () => {
      const copyAllBtn = document.getElementById('copy-all-btn');
      if (copyAllBtn) {
          copyAllBtn.classList.add('pulse-ring');
      } else {
          // Retry if not found yet
          setTimeout(applyPulseEffect, 500);
      }
  };
  applyPulseEffect();

  // Global paste listener for PNG Info
  window.addEventListener('paste', async (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
          try {
              const trimmedText = text.trim();
              if (trimmedText.startsWith('{') || trimmedText.startsWith('[')) {
                  const data = JSON.parse(text);
                  // Check if it's actually our metadata structure
                  const isPromptData = data && (
                      'mega' in data || 
                      'lighting' in data || 
                      'scene' in data || 
                      'view' in data ||
                      'BananaProData' in data
                  );
                  
                  if (isPromptData) {
                      e.preventDefault();
                      await applyMetadata(data);
                      return;
                  }
              }
          } catch (jsonErr) {
              // Not JSON, ignore and let default paste happen
          }
      }
  });
});

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

function updateBrushSizeVisibility() {
    const brushSizeContainer = document.getElementById('zoom-brush-size-container');
    if (brushSizeContainer) {
        if (activeTool === 'brush') {
            brushSizeContainer.classList.remove('hidden');
        } else {
            brushSizeContainer.classList.add('hidden');
        }
    }
}

// --- Global State Variables ---
let uploadedImageData: { data: string; mimeType: string } | null = null;
let referenceImages: ReferenceImage[] = [];
let loadedFilesContent: Record<string, string> = {};
let selectedResolution = '1K';
let imageCount = 1;
let generatedImages: string[] = [];
let currentImageIndex = 0;
let cameraProjectionEnabled = false;
let isGenerating = false;
let abortController: AbortController | null = null;
let currentProgressInterval: any = null;

// --- Undo/Redo State ---
type CanvasState = {
    mask: ImageData | null;
    text: Array<{ text: string, x: number, y: number, w: number, h: number, color: string, size: number }>;
};
let canvasHistory: CanvasState[] = [];
let canvasHistoryStep = -1;
const MAX_HISTORY = 30;

// --- Canvas Contexts ---
let ctx: CanvasRenderingContext2D | null = null;
let previewCtx: CanvasRenderingContext2D | null = null;
let guideCtx: CanvasRenderingContext2D | null = null;
let zoomCtx: CanvasRenderingContext2D | null = null;
let zoomPreviewCtx: CanvasRenderingContext2D | null = null;
let zoomGuideCtx: CanvasRenderingContext2D | null = null;

// --- Drawing State ---
let isDrawing = false;
let startX = 0;
let startY = 0;
let currentBrushSize = 30; // Reduced default size to 30
let activeTool = 'select';
let isAddingTextMode = false;
let isTextEraserMode = false;
let addTextBtn: HTMLButtonElement | null = null;
let mainAddTextBtn: HTMLButtonElement | null = null;
let eraserTextBtn: HTMLButtonElement | null = null;
let mainEraserTextBtn: HTMLButtonElement | null = null;
let textOverlayInput: HTMLInputElement | null = null;
let zoomTextCanvas: HTMLCanvasElement | null = null;
let zoomTextCtx: CanvasRenderingContext2D | null = null;
let mainTextCanvas: HTMLCanvasElement | null = null;
let mainTextCtx: CanvasRenderingContext2D | null = null;
let mainTextOverlayInput: HTMLInputElement | null = null;
let mainTextColorInput: HTMLInputElement | null = null;
let mainTextSizeInput: HTMLInputElement | null = null;
let mainDeleteTextBtn: HTMLButtonElement | null = null;
let mainResetTextBtn: HTMLButtonElement | null = null;
let deleteTextBtn: HTMLButtonElement | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let textElements: Array<{ text: string, x: number, y: number, w: number, h: number, color: string, size: number }> = [];
let draggedTextIndex = -1;
let isTextDragged = false;
let editingTextIndex = -1;
let selectedTextIndex = -1;
let isCopying = false;
let toggleAddingTextMode: (mode?: boolean) => void = () => {};
let toggleTextEraserMode: (mode?: boolean) => void = () => {};

function redrawText() {
    if (!zoomTextCtx || !mainTextCtx || !zoomTextCanvas || !mainTextCanvas) return;
    zoomTextCtx.clearRect(0, 0, zoomTextCanvas.width, zoomTextCanvas.height);
    mainTextCtx.clearRect(0, 0, mainTextCanvas.width, mainTextCanvas.height);
    
    textElements.forEach((el, index) => {
        // Draw on Zoom Canvas
        zoomTextCtx.font = `bold ${el.size}px Arial`;
        zoomTextCtx.fillStyle = el.color;
        zoomTextCtx.textBaseline = 'top';
        zoomTextCtx.fillText(el.text, el.x, el.y);
        
        if (index === draggedTextIndex || index === editingTextIndex || index === selectedTextIndex) {
            zoomTextCtx.strokeStyle = index === selectedTextIndex ? '#f59e0b' : 'rgba(255,255,255,0.5)';
            zoomTextCtx.lineWidth = 2;
            zoomTextCtx.strokeRect(el.x - 2, el.y - 2, el.w + 4, el.h + 4);
        }

        // Draw on Main Canvas
        mainTextCtx.font = `bold ${el.size}px Arial`;
        mainTextCtx.fillStyle = el.color;
        mainTextCtx.textBaseline = 'top';
        mainTextCtx.fillText(el.text, el.x, el.y);

        if (index === selectedTextIndex) {
            mainTextCtx.strokeStyle = '#f59e0b';
            mainTextCtx.lineWidth = 2;
            mainTextCtx.strokeRect(el.x - 2, el.y - 2, el.w + 4, el.h + 4);
        }
    });

    // Update delete button visibility
    if (selectedTextIndex !== -1) {
        deleteTextBtn?.classList.remove('hidden');
        mainDeleteTextBtn?.classList.remove('hidden');
    } else {
        deleteTextBtn?.classList.add('hidden');
        mainDeleteTextBtn?.classList.add('hidden');
    }
}

let lassoPoints: Array<{ x: number; y: number }> = [];
let polygonPoints: Array<{ x: number; y: number }> = [];
let isDrawingPolygon = false;
let drawRequest: number | null = null;

// --- Screenshot State ---
let snapshotImage: ImageBitmap | null = null;
let isSnipping = false;
let snipStartX = 0;
let snipStartY = 0;

// --- Zoom State ---
let zoomScale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

// --- Mouse Tracking for Shortcuts ---
let globalMouseX = 0;
let globalMouseY = 0;

function resetDraggable() {
    if (uploadPreview) uploadPreview.draggable = false;
    if (outputImage) outputImage.draggable = false;
    if (zoomedImage) {
        zoomedImage.draggable = false;
        zoomedImage.style.pointerEvents = 'none';
    }
    if (canvasContainer) canvasContainer.classList.remove('select-mode');
    if (zoomOverlay) zoomOverlay.classList.remove('select-mode');
    if (maskCanvas) maskCanvas.style.pointerEvents = 'auto';
    if (zoomMaskCanvas) zoomMaskCanvas.style.pointerEvents = 'auto';
}

// Initialize default tool state (Select)
setTimeout(() => {
    if (activeTool === 'select') {
        if (brushCursor) brushCursor.classList.add('hidden');
        if (uploadPreview) uploadPreview.draggable = true;
        if (outputImage) outputImage.draggable = true;
        if (zoomedImage) {
            zoomedImage.draggable = true;
            zoomedImage.style.pointerEvents = 'auto';
        }
        if (canvasContainer) canvasContainer.classList.add('select-mode');
        if (zoomOverlay) zoomOverlay.classList.add('select-mode');
        if (maskCanvas) maskCanvas.style.pointerEvents = 'none';
        if (zoomMaskCanvas) zoomMaskCanvas.style.pointerEvents = 'none';
    }
}, 500);

window.addEventListener('mousemove', (e) => {
    globalMouseX = e.clientX;
    globalMouseY = e.clientY;
});

// --- Comparison Logic ---
let isComparisonMode = false;

function updateComparisonImages() {
    if (isComparisonMode) {
        if (uploadedImageData) {
            compareImg1.src = `data:${uploadedImageData.mimeType};base64,${uploadedImageData.data}`;
        }
        if (generatedImages.length > 0 && currentImageIndex >= 0 && currentImageIndex < generatedImages.length) {
            compareImg2.src = generatedImages[currentImageIndex];
        } else if (generatedImages.length > 0) {
            compareImg2.src = generatedImages[generatedImages.length - 1];
        }
    }
}

const getGenAI = () => {
    // Priority: Manual Key -> Selected Key (API_KEY) -> Default Key (GEMINI_API_KEY)
    const keyToUse = manualApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
    return new GoogleGenAI({ apiKey: keyToUse });
};

async function translateText(text: string, targetLang: string): Promise<string> {
    if (!text || !text.trim()) return text;
    
    // Simple local check to skip translation if already in target language
    const hasVietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
    if (targetLang === 'vi' && hasVietnamese) return text;
    if (targetLang === 'en' && !hasVietnamese && /^[a-z0-9\s.,!?-]+$/i.test(text)) return text;

    try {
        const ai = getGenAI();
        const targetName = targetLang === 'vi' ? 'Vietnamese' : 'English';
        const prompt = `Task: Translate to ${targetName}.
If the text is already in ${targetName}, return it exactly as is.
If the text is in another language, translate it to ${targetName}.
Only return the result text, no explanations.

Text: ${text}`;
        
        console.log(`Translating to ${targetName}...`);
        // @ts-ignore
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: { parts: [{ text: prompt }] },
            config: {
                // @ts-ignore
                thinkingConfig: { thinkingLevel: ThinkingLevel?.LOW || 'LOW' }
            }
        });
        
        const result = response.text?.trim() || text;
        console.log("Translation result:", result);
        return result;
    } catch (err) {
        console.error("Translation failed:", err);
        return text;
    }
}

async function translateMetadata(data: any, targetLang: string) {
    if (!data) return data;
    
    console.log(`translateMetadata called for ${targetLang}`);
    const targetName = targetLang === 'vi' ? 'Vietnamese' : 'English';
    
    // Prepare data for translation
    const dataToTranslate = {
        mega: data.mega || "",
        lighting: data.lighting || "",
        scene: data.scene || "",
        view: data.view || ""
    };

    // Skip if no content
    const hasContent = Object.values(dataToTranslate).some(v => v && v.trim() !== "");
    if (!hasContent) return data;

    try {
        const ai = getGenAI();
        const jsonStr = JSON.stringify(dataToTranslate);
        const systemPrompt = targetLang === 'vi' 
            ? `You are a professional translator. Translate the values in the provided JSON object to Vietnamese. Keep technical terms if appropriate. Return ONLY valid JSON.`
            : `You are a professional translator. Translate the values in the provided JSON object to English. Optimize for AI image generation. Return ONLY valid JSON.`;

        console.log("Sending metadata for translation...");
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: `Translate this JSON: ${jsonStr}` }] },
            config: { 
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
                // @ts-ignore
                thinkingConfig: { thinkingLevel: ThinkingLevel?.LOW || 'LOW' }
            }
        });

        if (response.text) {
            let cleanText = response.text.trim();
            if (cleanText.startsWith('```json')) {
                cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanText.startsWith('```')) {
                cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            const result = JSON.parse(cleanText);
            const translatedData = { ...data, ...result };
            console.log("Metadata translation successful");
            return translatedData;
        }
    } catch (err) {
        console.error("Metadata translation failed:", err);
    }
    
    return data;
}

// --- DOM Elements ---
const statusEl = document.querySelector('#status') as HTMLDivElement;
const outputContainer = document.querySelector('#output-container') as HTMLDivElement;
const outputImage = document.querySelector('#output-image') as HTMLImageElement;
const zoomedImage = document.querySelector('#zoomed-image') as HTMLImageElement;

outputImage.addEventListener('dragstart', (e) => {
    if (activeTool !== 'select') {
        // Allow dragging output image even if not in select mode? 
        // Usually output images are for downloading/sharing.
        // But let's follow the "select tool" logic for consistency.
    }
});

zoomedImage.addEventListener('dragstart', (e) => {
    if (activeTool !== 'select') {
        e.preventDefault();
        return;
    }
});
const promptEl = document.querySelector('#prompt-manual') as HTMLTextAreaElement;
const sizeSelect = document.querySelector('#size-select') as HTMLSelectElement;
const generateButton = document.querySelector('#generate-button') as HTMLButtonElement;
const generateProgress = document.querySelector('#generate-progress') as HTMLDivElement;
const generateLabel = document.querySelector('#generate-label') as HTMLSpanElement;
const downloadButtonMain = document.querySelector('#download-button-main') as HTMLButtonElement;
const downloadUploadBtn = document.querySelector('#download-upload-btn') as HTMLButtonElement;
const useAsMasterBtn = document.querySelector('#use-as-master') as HTMLButtonElement;
const closeOutputBtn = document.querySelector('#close-output-btn') as HTMLButtonElement;
const globalResetBtn = document.querySelector('#global-reset-btn') as HTMLButtonElement;
const historyList = document.querySelector('#history-list') as HTMLDivElement;
const miniGenerateBtn = document.querySelector('#mini-generate-btn') as HTMLButtonElement;
const zoomGenerateBtn = document.querySelector('#zoom-generate-btn') as HTMLButtonElement;

// Image Count & Navigation
const countBtns = document.querySelectorAll('.count-btn') as NodeListOf<HTMLButtonElement>;
const prevImageBtn = document.querySelector('#prev-image-btn') as HTMLButtonElement;
const nextImageBtn = document.querySelector('#next-image-btn') as HTMLButtonElement;
const prevZoomBtn = document.querySelector('#prev-zoom-btn') as HTMLButtonElement;
const nextZoomBtn = document.querySelector('#next-zoom-btn') as HTMLButtonElement;
const imageCounterBadge = document.querySelector('#image-counter-badge') as HTMLDivElement;

// Image Count Tracking
const costDisplayEl = document.querySelector('#cost-display') as HTMLDivElement;
const totalImagesValEl = document.querySelector('#total-images-val') as HTMLSpanElement;
const todayImagesValEl = document.querySelector('#today-images-val') as HTMLSpanElement;

let totalImagesGenerated = parseInt(localStorage.getItem('total_images_generated') || '0');
let imagesGeneratedToday = parseInt(localStorage.getItem(`images_generated_${new Date().toISOString().split('T')[0]}`) || '0');

const updateImageCountDisplay = (addedCount: number = 0) => {
    totalImagesGenerated += addedCount;
    imagesGeneratedToday += addedCount;
    
    localStorage.setItem('total_images_generated', totalImagesGenerated.toString());
    localStorage.setItem(`images_generated_${new Date().toISOString().split('T')[0]}`, imagesGeneratedToday.toString());
    
    if (totalImagesValEl) {
        totalImagesValEl.innerText = `Total: ${totalImagesGenerated}`;
    }
    if (todayImagesValEl) {
        todayImagesValEl.innerText = `Today: ${imagesGeneratedToday}`;
    }
};

const resetImageCount = () => {
    totalImagesGenerated = 0;
    imagesGeneratedToday = 0;
    localStorage.setItem('total_images_generated', '0');
    localStorage.setItem(`images_generated_${new Date().toISOString().split('T')[0]}`, '0');
    updateImageCountDisplay(0);
};

// Initialize Image Count Display
updateImageCountDisplay(0);

// API Key UI Elements
let manualApiKey = localStorage.getItem('manualApiKey') || '';
const apiKeyBtn = document.querySelector('#api-key-btn') as HTMLButtonElement;
const apiKeyModal = document.querySelector('#api-key-modal') as HTMLDivElement;
const closeApiKeyBtn = document.querySelector('#close-api-key-btn') as HTMLButtonElement;
const saveApiKeyBtn = document.querySelector('#save-api-key-btn') as HTMLButtonElement;
const manualApiKeyInput = document.querySelector('#manual-api-key-input') as HTMLInputElement;
const accountTierBadge = document.querySelector('#account-tier-badge') as HTMLDivElement;

// --- Custom Modal Logic ---
const customAlertModal = document.querySelector('#custom-alert-modal') as HTMLDivElement;
const customAlertTitle = document.querySelector('#custom-alert-title') as HTMLHeadingElement;
const customAlertMessage = document.querySelector('#custom-alert-message') as HTMLParagraphElement;
const customAlertOk = document.querySelector('#custom-alert-ok') as HTMLButtonElement;

// --- Comparison Elements ---
const compareToggleBtn = document.querySelector('#compare-toggle-btn') as HTMLButtonElement;
const comparisonContainer = document.querySelector('#comparison-container') as HTMLDivElement;
const compareSlider = document.querySelector('#compare-slider') as HTMLInputElement;
const compareImg1 = document.querySelector('#compare-img-1') as HTMLImageElement;
const compareImg2 = document.querySelector('#compare-img-2') as HTMLImageElement;
const compareImg2Wrapper = document.querySelector('#compare-img-2-wrapper') as HTMLDivElement;

const customConfirmModal = document.querySelector('#custom-confirm-modal') as HTMLDivElement;
const customConfirmTitle = document.querySelector('#custom-confirm-title') as HTMLHeadingElement;
const customConfirmMessage = document.querySelector('#custom-confirm-message') as HTMLParagraphElement;
const customConfirmOk = document.querySelector('#custom-confirm-ok') as HTMLButtonElement;
const customConfirmCancel = document.querySelector('#custom-confirm-cancel') as HTMLButtonElement;

const customPasteModal = document.querySelector('#custom-paste-modal') as HTMLDivElement;
const customPasteTextarea = document.querySelector('#custom-paste-textarea') as HTMLTextAreaElement;
const customPasteSubmit = document.querySelector('#custom-paste-submit') as HTMLButtonElement;
const closePasteModal = document.querySelector('#close-paste-modal') as HTMLButtonElement;
const modalCopyBtn = document.querySelector('#modal-copy-btn') as HTMLButtonElement;
const copyAllBtn = document.querySelector('#copy-all-btn') as HTMLButtonElement;
const modalPasteBtn = document.querySelector('#modal-paste-btn') as HTMLButtonElement;

const batchReplaceModal = document.querySelector('#batch-replace-modal') as HTMLDivElement;
const replaceFindInput = document.querySelector('#replace-find-input') as HTMLInputElement;
const replaceWithInput = document.querySelector('#replace-with-input') as HTMLInputElement;
const batchReplaceSubmit = document.querySelector('#batch-replace-submit') as HTMLButtonElement;
const closeReplaceModal = document.querySelector('#close-replace-modal') as HTMLButtonElement;
const batchReplaceBtn = document.querySelector('#batch-replace-btn') as HTMLButtonElement;

// --- PNG Info Viewport Elements ---
const pngInfoTabBtn = document.querySelector('#png-info-tab-btn') as HTMLButtonElement;
const pngInfoViewport = document.querySelector('#png-info-viewport') as HTMLDivElement;
const pngInfoViewportTop = document.querySelector('#png-info-viewport-top') as HTMLDivElement;
const pngInfoViewportBottom = document.querySelector('#png-info-viewport-bottom') as HTMLDivElement;
const pngInfoContentTop = document.querySelector('#png-info-content-top') as HTMLDivElement;
const pngInfoContentBottom = document.querySelector('#png-info-content-bottom') as HTMLDivElement;
const pngInfoCopyBtnTop = document.querySelector('#png-info-copy-btn-top') as HTMLButtonElement;
const pngInfoReplaceBtnTop = document.querySelector('#png-info-replace-btn-top') as HTMLButtonElement;
const pngInfoPasteBtnTop = document.querySelector('#png-info-paste-btn-top') as HTMLButtonElement;
const pngInfoClearBtnTop = document.querySelector('#png-info-clear-btn-top') as HTMLButtonElement;
const pngInfoCopyBtnBottom = document.querySelector('#png-info-copy-btn-bottom') as HTMLButtonElement;
const pngInfoReplaceBtnBottom = document.querySelector('#png-info-replace-btn-bottom') as HTMLButtonElement;
const pngInfoPasteBtnBottom = document.querySelector('#png-info-paste-btn-bottom') as HTMLButtonElement;
const pngInfoClearBtnBottom = document.querySelector('#png-info-clear-btn-bottom') as HTMLButtonElement;
const pngInfoCloseBtn = document.querySelector('#png-info-close-btn') as HTMLButtonElement;
const pngInfoSendBtn = document.querySelector('#png-info-send-btn') as HTMLButtonElement;
const pngInfoTemplateBtnTop = document.querySelector('#png-info-template-btn-top') as HTMLButtonElement;
const pngInfoTemplateBtnBottom = document.querySelector('#png-info-template-btn-bottom') as HTMLButtonElement;
const pngInfoFontSelect = document.querySelector('#png-info-font-select') as HTMLSelectElement;
const pngInfoSizeInput = document.querySelector('#png-info-size-input') as HTMLInputElement;
const pngInfoDownloadDataBtn = document.querySelector('#png-info-download-data-btn') as HTMLButtonElement;
const pngInfoDownloadTxtBtn = document.querySelector('#png-info-download-txt-btn') as HTMLButtonElement;
const pngInfoDropZoneTop = document.querySelector('#png-info-drop-zone-top') as HTMLDivElement;
const pngInfoFileInputTop = document.querySelector('#png-info-file-input-top') as HTMLInputElement;

// --- Collage Extract Elements ---
const collageExtractToggle = document.querySelector('#collage-extract-toggle') as HTMLInputElement;
const collageExtractControls = document.querySelector('#collage-extract-controls') as HTMLDivElement;
const collagePositionSelect = document.querySelector('#collage-position-select') as HTMLSelectElement;
const extractViewBtn = document.querySelector('#extract-view-btn') as HTMLButtonElement;

function showBatchReplace(): Promise<{find: string, replace: string} | null> {
    if (!batchReplaceModal) return Promise.resolve(null);
    replaceFindInput.value = '';
    replaceWithInput.value = '';
    batchReplaceModal.classList.remove('hidden');
    
    // Small delay to ensure focus works after modal transition
    setTimeout(() => {
        replaceFindInput.focus();
    }, 150);
    
    return new Promise((resolve) => {
        const handleSubmit = () => {
            const find = replaceFindInput.value;
            const replace = replaceWithInput.value;
            if (!find) {
                showCustomAlert("Vui lòng nhập nội dung cần tìm.", "Missing Input");
                return;
            }
            
            // Perform replacement immediately
            batchReplaceModal.classList.add('hidden');
            cleanup();
            resolve({find, replace});
        };
        const handleClose = () => {
            batchReplaceModal.classList.add('hidden');
            cleanup();
            resolve(null);
        };
        const cleanup = () => {
            batchReplaceSubmit.removeEventListener('click', handleSubmit);
            closeReplaceModal.removeEventListener('click', handleClose);
        };
        
        batchReplaceSubmit.addEventListener('click', handleSubmit);
        closeReplaceModal.addEventListener('click', handleClose);
    });
}

batchReplaceBtn.addEventListener('click', async () => {
    const result = await showBatchReplace();
    if (result) {
        const {find, replace} = result;
        const fields = [
            document.querySelector('#prompt-manual') as HTMLTextAreaElement,
            document.querySelector('#lighting-manual') as HTMLTextAreaElement,
            document.querySelector('#scene-manual') as HTMLTextAreaElement,
            document.querySelector('#view-manual') as HTMLTextAreaElement,
            document.querySelector('#inpainting-prompt-text') as HTMLTextAreaElement
        ];
        
        let count = 0;
        fields.forEach(field => {
            if (field && field.value.includes(find)) {
                field.value = field.value.split(find).join(replace);
                count++;
            }
        });
        
        if (count > 0) {
            // No alert as requested
        }
    }
});

const COLLAGE_EXTRACT_PROMPT_TEMPLATE = `This image is a multi-frame collage. First detect the full collage layout and identify the exact rectangular boundary of every frame, whether the frames are separated by visible borders, thin gaps, or no visible dividing lines at all. Determine boundaries only from the overall collage structure, panel alignment, and layout geometry, not from the visual content inside the images. Then extract only the [ TARGET POSITION ] frame as one complete rectangular image. Strictly exclude all neighboring frames and do not include any pixels, objects, edges, or partial areas from adjacent images. Do not merge across frame boundaries even if colors, lines, or objects visually continue. Preserve the extracted frame exactly at its original internal resolution and original quality, with no resizing, no recompression, no denoise, no blur, no sharpening, no enhancement, and no content alteration.`;

function showCustomAlert(message: string, title: string = "SUCCESS") {
    if (!customAlertModal) return;
    
    // Update icon to green tick
    const iconContainer = document.getElementById('custom-alert-icon');
    if (iconContainer) {
        iconContainer.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`;
    }
    
    customAlertTitle.innerText = title;
    customAlertTitle.classList.add('text-amber-500');
    customAlertTitle.classList.remove('text-white');
    
    customAlertMessage.innerText = message;
    customAlertMessage.classList.add('text-amber-400');
    customAlertMessage.classList.remove('text-gray-400');
    
    customAlertModal.classList.remove('hidden');
    
    return new Promise<void>((resolve) => {
        const handleOk = () => {
            customAlertModal.classList.add('hidden');
            customAlertOk.removeEventListener('click', handleOk);
            
            // Reset to default styles for next time
            customAlertTitle.classList.remove('text-amber-500');
            customAlertTitle.classList.add('text-white');
            customAlertMessage.classList.remove('text-amber-400');
            customAlertMessage.classList.add('text-gray-400');
            
            resolve();
        };
        customAlertOk.addEventListener('click', handleOk);
    });
}

function showCustomConfirm(message: string, title: string = "Confirmation"): Promise<boolean> {
    if (!customConfirmModal) return Promise.resolve(false);
    customConfirmTitle.innerText = title;
    customConfirmMessage.innerText = message;
    customConfirmModal.classList.remove('hidden');
    
    return new Promise<boolean>((resolve) => {
        const handleOk = () => {
            customConfirmModal.classList.add('hidden');
            cleanup();
            resolve(true);
        };
        const handleCancel = () => {
            customConfirmModal.classList.add('hidden');
            cleanup();
            resolve(false);
        };
        const cleanup = () => {
            customConfirmOk.removeEventListener('click', handleOk);
            customConfirmCancel.removeEventListener('click', handleCancel);
        };
        customConfirmOk.addEventListener('click', handleOk);
        customConfirmCancel.addEventListener('click', handleCancel);
    });
}

function showCustomPaste(): Promise<string | null> {
    if (!customPasteModal) return Promise.resolve(null);
    customPasteTextarea.value = '';
    customPasteModal.classList.remove('hidden');
    
    // Try to pre-fill from clipboard if API is available and granted
    // This is a "nice to have" but we don't block on it
    if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        navigator.clipboard.readText().then(text => {
            if (text && text.trim()) {
                customPasteTextarea.value = text;
                // If we pre-filled, we might want to wait for the promise to be set up
                // but since we return the promise after this, we'll handle it inside the promise
            }
        }).catch(() => {
            // Ignore errors, user will paste manually
        });
    }

    // Small delay to ensure focus works after modal transition
    setTimeout(() => {
        customPasteTextarea.focus();
    }, 150);
    
    return new Promise<string | null>((resolve) => {
        let isSubmitted = false;
        const handleSubmit = () => {
            if (isSubmitted) return;
            isSubmitted = true;
            const val = customPasteTextarea.value;
            customPasteModal.classList.add('hidden');
            cleanup();
            resolve(val);
        };
        const handleClose = () => {
            if (isSubmitted) return;
            isSubmitted = true;
            customPasteModal.classList.add('hidden');
            cleanup();
            resolve(null);
        };
        const handleModalPaste = async () => {
            try {
                window.focus();
                if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    const text = await navigator.clipboard.readText();
                    customPasteTextarea.value = text;
                    // Trigger auto-submit check after manual paste button click
                    checkAndSubmit(true);
                } else {
                    throw new Error("Clipboard API not available");
                }
            } catch (err) {
                console.error('Modal clipboard read failed', err);
                showCustomAlert("Không thể đọc Clipboard tự động. Vui lòng sử dụng Ctrl+V để dán trực tiếp vào ô.", "Paste Blocked");
            }
        };
        
        const checkAndSubmit = (force: boolean = false) => {
            if (isSubmitted) return;
            const val = customPasteTextarea.value.trim();
            if (!val) return;

            const isJson = (val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'));
            
            if (force || isJson) {
                // Visual feedback
                customPasteSubmit.innerText = "Đang xử lý...";
                customPasteSubmit.classList.add('bg-emerald-600');
                // Auto-submit
                setTimeout(handleSubmit, 100);
            }
        };

        // Auto-submit on paste
        const handleAutoPaste = (e: ClipboardEvent) => {
            // We wait a bit for the value to be populated
            setTimeout(() => checkAndSubmit(true), 50);
        };

        // Also listen to input and keyup for maximum compatibility
        const handleInput = () => {
            checkAndSubmit(false); // Only auto-submit if it looks like JSON when typing
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            // If user pressed Ctrl+V, we might want to force it if the paste event didn't catch it
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                setTimeout(() => checkAndSubmit(true), 100);
            } else {
                checkAndSubmit(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                // We don't submit here because the value hasn't been pasted yet
                // but we can ensure the next check is forced
            }
        };

        const cleanup = () => {
            customPasteSubmit.removeEventListener('click', handleSubmit);
            closePasteModal.removeEventListener('click', handleClose);
            if (modalPasteBtn) modalPasteBtn.removeEventListener('click', handleModalPaste);
            customPasteTextarea.removeEventListener('paste', handleAutoPaste);
            customPasteTextarea.removeEventListener('input', handleInput);
            customPasteTextarea.removeEventListener('keyup', handleKeyUp);
            customPasteTextarea.removeEventListener('keydown', handleKeyDown);
            // Reset button text
            customPasteSubmit.innerText = "Thực thi (OK)";
            customPasteSubmit.classList.remove('bg-emerald-600');
        };
        
        customPasteSubmit.addEventListener('click', handleSubmit);
        closePasteModal.addEventListener('click', handleClose);
        if (modalPasteBtn) modalPasteBtn.addEventListener('click', handleModalPaste);
        customPasteTextarea.addEventListener('paste', handleAutoPaste);
        customPasteTextarea.addEventListener('input', handleInput);
        customPasteTextarea.addEventListener('keyup', handleKeyUp);
        customPasteTextarea.addEventListener('keydown', handleKeyDown);

        // Check immediately in case it was pre-filled
        setTimeout(() => checkAndSubmit(false), 400);
    });
}

// --- Helper Functions ---

// Tier UI Update Function
async function updateAccountStatusUI() {
    if (!accountTierBadge) return;
    
    // Check if key is selected via manual input
    manualApiKey = localStorage.getItem('manualApiKey') || '';
    
    let isPro = !!(manualApiKey && manualApiKey.length > 10);
    
    // Update Cost Display Visibility - Only show if using a paid tier (Pro/Ultra)
    if (costDisplayEl) {
        if (isPro) {
            costDisplayEl.classList.remove('hidden');
            costDisplayEl.classList.add('flex');
        } else {
            costDisplayEl.classList.add('hidden');
            costDisplayEl.classList.remove('flex');
        }
    }

    // Clear previous styles
    accountTierBadge.className = '';
    accountTierBadge.classList.remove('hidden', 'blink-red');
    accountTierBadge.innerHTML = ''; 

    if (isPro) {
        // PRO STATE - Blue/Purple Pill
        accountTierBadge.className = 'flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#4f46e5]/50 bg-[#1e1b4b]/60 text-white shadow-[0_0_15px_rgba(79,70,229,0.25)] cursor-pointer hover:bg-[#1e1b4b]/80 transition-all group';
        accountTierBadge.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-cyan-400 drop-shadow-[0_0_2px_rgba(34,211,238,0.8)]" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            <span class="text-[10px] font-black tracking-[0.2em] text-[#e0e7ff]">PRO</span>
        `;
        
        accountTierBadge.onclick = () => {
             if (apiKeyModal) {
                manualApiKeyInput.value = manualApiKey; 
                const removeBtn = document.getElementById('remove-api-key-btn');
                if(removeBtn) {
                    if (manualApiKey) removeBtn.classList.remove('hidden');
                    else removeBtn.classList.add('hidden');
                }
                apiKeyModal.classList.remove('hidden');
                manualApiKeyInput.focus();
            }
        };

    } else {
        // FREE STATE - Blinking Red "API KEY"
        accountTierBadge.className = 'flex items-center gap-2 px-4 py-1.5 rounded-full border border-red-500/50 bg-red-900/20 text-red-400 cursor-pointer transition-all group blink-red';
        accountTierBadge.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
            <span class="text-[10px] font-black tracking-[0.2em]">API KEY</span>
        `;
        accountTierBadge.onclick = () => {
             if (apiKeyModal) {
                manualApiKeyInput.value = manualApiKey; 
                const removeBtn = document.getElementById('remove-api-key-btn');
                if(removeBtn) removeBtn.classList.add('hidden');
                apiKeyModal.classList.remove('hidden');
                manualApiKeyInput.focus();
            }
        };
    }
}

// Call on load
updateAccountStatusUI();

// --- API Key Modal Logic ---
const removeApiKeyBtn = document.querySelector('#remove-api-key-btn') as HTMLButtonElement;

if (removeApiKeyBtn) {
    removeApiKeyBtn.onclick = async () => {
        const confirmed = await showCustomConfirm("Are you sure you want to remove your API key and switch back to Free mode?");
        if (confirmed) {
            localStorage.removeItem('manualApiKey');
            manualApiKey = '';
            manualApiKeyInput.value = '';
            updateAccountStatusUI();
            apiKeyModal.classList.add('hidden');
        }
    };
}

if (apiKeyModal && closeApiKeyBtn) {
    closeApiKeyBtn.addEventListener('click', () => {
        apiKeyModal.classList.add('hidden');
    });
    // Close on click outside
    apiKeyModal.addEventListener('click', (e) => {
        if (e.target === apiKeyModal) apiKeyModal.classList.add('hidden');
    });
}

if (saveApiKeyBtn && manualApiKeyInput) {
    // Pre-fill
    manualApiKeyInput.value = manualApiKey;
    
    saveApiKeyBtn.addEventListener('click', async () => {
        const key = manualApiKeyInput.value.trim();
        if (key.length > 10) { 
            // Validate Logic
            const originalText = "SAVE KEY"; // Fixed text
            saveApiKeyBtn.innerText = "VERIFYING...";
            saveApiKeyBtn.disabled = true;
            saveApiKeyBtn.classList.add('opacity-50', 'cursor-wait');

            try {
                // Perform a dummy check (lightweight generation)
                const tempAi = new GoogleGenAI({ apiKey: key });
                await tempAi.models.generateContent({
                    model: 'gemini-3-flash-preview',
                    contents: { parts: [{ text: "ping" }] },
                    config: { maxOutputTokens: 1 }
                });

                // Valid - Update State
                manualApiKey = key;
                localStorage.setItem('manualApiKey', key);
                
                // Reset Cost on Key Change
                resetImageCount();
                
                // Immediately update Badge UI
                updateAccountStatusUI();
                
                // Visual Feedback on Button (Non-blocking)
                saveApiKeyBtn.innerText = "VERIFIED & SAVED!";
                saveApiKeyBtn.classList.remove('opacity-50', 'cursor-wait');
                saveApiKeyBtn.classList.add('bg-green-600', 'hover:bg-green-700', 'border-green-500');
                
                if(statusEl) {
                    statusEl.innerText = "API Key Verified. PRO features unlocked.";
                    setTimeout(() => statusEl.innerText = "System Standby", 3000);
                }
                
                // Close modal automatically after short delay
                setTimeout(() => {
                    apiKeyModal.classList.add('hidden');
                    // Reset button state for next time
                    saveApiKeyBtn.innerText = originalText;
                    saveApiKeyBtn.disabled = false;
                    saveApiKeyBtn.classList.remove('bg-green-600', 'hover:bg-green-700', 'border-green-500');
                }, 1000);

            } catch (error: any) {
                console.error("Key Validation Failed", error);
                
                // Error Feedback
                saveApiKeyBtn.innerText = "INVALID KEY";
                saveApiKeyBtn.classList.remove('opacity-50', 'cursor-wait');
                saveApiKeyBtn.classList.add('bg-red-600', 'hover:bg-red-700');
                
                // Reset button after 2s
                setTimeout(() => {
                    saveApiKeyBtn.innerText = originalText;
                    saveApiKeyBtn.classList.remove('bg-red-600', 'hover:bg-red-700');
                    saveApiKeyBtn.disabled = false;
                }, 2000);

                await showCustomAlert("Invalid API Key. Please check your key and try again.", "Validation Error");
            }
        } else {
            await showCustomAlert("Please enter a valid API Key (at least 10 characters).", "Invalid Input");
        }
    });
}

// --- API Key Button Logic Removed ---

// Help Elements
const helpBtn = document.querySelector('#help-btn') as HTMLButtonElement;
const helpModal = document.querySelector('#help-modal') as HTMLDivElement;
const closeHelpBtn = document.querySelector('#close-help-btn') as HTMLButtonElement;

// GPT Elements
const gptBtn = document.querySelector('#gpt-info-btn') as HTMLButtonElement;
const gptModal = document.querySelector('#gpt-modal') as HTMLDivElement;
const closeGptBtn = document.querySelector('#close-gpt-btn') as HTMLButtonElement;
const closeGptOkBtn = document.querySelector('#close-gpt-ok-btn') as HTMLButtonElement;
const gptImgBtn = document.querySelector('#gpt-img-btn') as HTMLButtonElement;
const gptVideoBtn = document.querySelector('#gpt-video-btn') as HTMLButtonElement;
const gptInstructionContainer = document.querySelector('#gpt-instruction-container') as HTMLDivElement;
const gptInstructionText = document.querySelector('#gpt-instruction-text') as HTMLParagraphElement;
const gptInstructionCommand = document.querySelector('#gpt-instruction-command') as HTMLParagraphElement;

// Add Listeners
if (helpBtn && helpModal && closeHelpBtn) {
    helpBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        helpModal.classList.remove('hidden');
    });
    closeHelpBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        helpModal.classList.add('hidden');
    });
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.add('hidden');
    });
}

if (gptBtn && gptModal) {
    gptBtn.addEventListener('click', () => {
        gptModal.classList.remove('hidden');
    });
    
    closeGptBtn.addEventListener('click', () => {
        gptModal.classList.add('hidden');
    });

    gptImgBtn.addEventListener('click', () => {
        gptImgBtn.className = 'flex-1 bg-[#262380] text-white font-black py-2 rounded-xl text-xs uppercase tracking-widest transition-all';
        gptVideoBtn.className = 'flex-1 bg-white/5 hover:bg-white/10 text-gray-400 font-black py-2 rounded-xl text-xs uppercase tracking-widest transition-all';
        gptInstructionText.innerText = 'Hãy phân tích thật chi tiết bức ảnh tôi vừa gửi và viết ngược lại thành 1 câu Prompt tiếng Anh (Image-to-Prompt) để tôi dùng cho các AI tạo ảnh siêu thực cho hình ảnh ngành Kiến Trúc - Nội Thất. Bao gồm mô tả: Chủ thể chính, Phong cách Kiến Trúc / Không Gian Nội Thất, Ánh sáng (Lighting), Bố cục (Composition), Góc Chụp và Môi trường, Tỷ Lệ Khung Ảnh.';
        gptInstructionCommand.innerText = 'LỆNH BẮT BUỘC: CHỈ TRẢ VỀ ĐÚNG 1 CÂU PROMPT TIẾNG ANH LIÊN TỤC NẰM TRONG 1 ĐOẠN VĂN, KHÔNG XUỐNG DÒNG, KHÔNG GIẢI THÍCH, KHÔNG CHÀO HỎI. Chỉ nhả ra Text để tôi copy.';
    });

    gptVideoBtn.addEventListener('click', () => {
        gptVideoBtn.className = 'flex-1 bg-[#262380] text-white font-black py-2 rounded-xl text-xs uppercase tracking-widest transition-all';
        gptImgBtn.className = 'flex-1 bg-white/5 hover:bg-white/10 text-gray-400 font-black py-2 rounded-xl text-xs uppercase tracking-widest transition-all';
        gptInstructionText.innerText = 'Hãy phân tích thật chi tiết bức ảnh tôi vừa gửi và viết ngược lại thành Prompt tiếng Anh (Image-to-Prompt) để tôi dùng cho các AI tạo VIDEO.';
        gptInstructionCommand.innerText = 'LỆNH BẮT BUỘC: CHỈ TRẢ VỀ ĐÚNG 1 CÂU PROMPT TIẾNG ANH LIÊN TỤC NẰM TRONG 1 ĐOẠN VĂN, KHÔNG XUỐNG DÒNG, KHÔNG GIẢI THÍCH, KHÔNG CHÀO HỎI. Chỉ nhả ra Text để tôi copy.';
    });

    if (closeGptOkBtn) {
        closeGptOkBtn.addEventListener('click', () => {
            // Đọc trực tiếp nội dung từ các phần tử con để đảm bảo lấy được nội dung mới nhất
            const textPart = gptInstructionText.textContent || "";
            const commandPart = gptInstructionCommand.textContent || "";
            const promptText = textPart.trim() + "\n\n" + commandPart.trim();
            
            // Direct approach for better SketchUp compatibility
            const textArea = document.createElement("textarea");
            textArea.value = promptText;
            textArea.style.position = "fixed";
            textArea.style.left = "-9999px";
            textArea.style.top = "0";
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            try {
                const successful = document.execCommand('copy');
                if (successful) {
                    gptModal.classList.add('hidden');
                } else {
                    console.error('Copy command failed');
                }
            } catch (err) {
                console.error('Failed to copy', err);
            }
            document.body.removeChild(textArea);
        });
    }
    gptModal.addEventListener('click', (e) => {
        if (e.target === gptModal) gptModal.classList.add('hidden');
    });
}

// Translation Buttons
const langBtnVn = document.querySelector('#lang-btn-vn') as HTMLButtonElement;
const langBtnEn = document.querySelector('#lang-btn-en') as HTMLButtonElement;
const togglePromptModifiersBtn = document.querySelector('#toggle-prompt-modifiers') as HTMLButtonElement;
const promptManual = document.querySelector('#prompt-manual') as HTMLTextAreaElement;
const pngInfoToggleModifiersTop = document.querySelector('#png-info-toggle-modifiers-top') as HTMLButtonElement;
const promptModifiers = "photorealistic, ultra detailed, sharp focus, 8k, crisp details, realistic materials, clean edges, precise geometry, global illumination, natural lighting, high detail textures, professional photography --no blurry, low quality, noise, soft focus, distorted, bad texture, artifacts";

if (togglePromptModifiersBtn && promptManual) {
    togglePromptModifiersBtn.addEventListener('click', () => {
        const currentVal = promptManual.value;
        if (currentVal.includes(promptModifiers)) {
            // Remove
            promptManual.value = currentVal.replace(promptModifiers, '').replace(/,\s*$/, '').trim();
        } else {
            // Append
            promptManual.value = (currentVal + (currentVal.trim().length > 0 ? ', ' : '') + promptModifiers).trim();
        }
        // Trigger auto-resize if the function exists
        // @ts-ignore
        if (typeof autoResize === 'function') autoResize(promptManual);
    });
}

if (pngInfoToggleModifiersTop && pngInfoContentTop) {
    pngInfoToggleModifiersTop.addEventListener('click', () => {
        const currentVal = pngInfoContentTop.innerText;
        if (currentVal.includes(promptModifiers)) {
            // Remove
            pngInfoContentTop.innerText = currentVal.replace(promptModifiers, '').replace(/,\s*$/, '').trim();
        } else {
            // Append
            pngInfoContentTop.innerText = (currentVal + (currentVal.trim().length > 0 ? ', ' : '') + promptModifiers).trim();
        }
    });
}

const pngInfoToggleModifiersBottom = document.querySelector('#png-info-toggle-modifiers-bottom') as HTMLButtonElement;

if (pngInfoToggleModifiersBottom && pngInfoContentBottom) {
    pngInfoToggleModifiersBottom.addEventListener('click', () => {
        const currentVal = pngInfoContentBottom.innerText;
        if (currentVal.includes(promptModifiers)) {
            // Remove
            pngInfoContentBottom.innerText = currentVal.replace(promptModifiers, '').replace(/,\s*$/, '').trim();
        } else {
            // Append
            pngInfoContentBottom.innerText = (currentVal + (currentVal.trim().length > 0 ? ', ' : '') + promptModifiers).trim();
        }
    });
}

// Inpainting UI
const inpaintingPromptToggle = document.querySelector('#inpainting-prompt-toggle') as HTMLInputElement;
const inpaintingPromptText = document.querySelector('#inpainting-prompt-text') as HTMLTextAreaElement;
const dropZone = document.querySelector('#drop-zone') as HTMLDivElement;
const imageInput = document.querySelector('#image-input') as HTMLInputElement;
const uploadPlaceholder = document.querySelector('#upload-placeholder') as HTMLDivElement;
const inpaintingContainer = document.querySelector('#inpainting-container') as HTMLDivElement;
const uploadPreview = document.querySelector('#upload-preview') as HTMLImageElement;
uploadPreview.addEventListener('dragstart', (e) => {
    if (activeTool !== 'select') {
        e.preventDefault();
        return;
    }
});

// Screenshot Overlay
const screenshotOverlay = document.querySelector('#screenshot-overlay') as HTMLDivElement;
const screenshotCanvas = document.querySelector('#screenshot-canvas') as HTMLCanvasElement;

// Canvas Elements
const maskCanvas = document.querySelector('#mask-canvas') as HTMLCanvasElement;
mainTextCanvas = document.querySelector('#main-text-canvas') as HTMLCanvasElement;
mainTextCtx = mainTextCanvas.getContext('2d')!;
const guideCanvas = document.querySelector('#guide-canvas') as HTMLCanvasElement;
const maskPreviewCanvas = document.querySelector('#mask-preview-canvas') as HTMLCanvasElement;
const brushCursor = document.querySelector('#brush-cursor') as HTMLDivElement;
const canvasContainer = document.querySelector('.group\\/canvas-container') as HTMLDivElement;

// Zoom Elements
const zoomOverlay = document.querySelector('#zoom-overlay') as HTMLDivElement;
const zoomMasterBtn = document.querySelector('#zoom-master-btn') as HTMLButtonElement;
const zoomOutputBtn = document.querySelector('#zoom-output-btn') as HTMLButtonElement;
const closeZoomBtn = document.querySelector('#close-zoom') as HTMLButtonElement;
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
eraserTextBtn = document.querySelector('#eraser-text-btn') as HTMLButtonElement;
mainEraserTextBtn = document.querySelector('#main-eraser-text-btn') as HTMLButtonElement;
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
const translateDropZone = document.querySelector('#translate-drop-zone') as HTMLDivElement;
const translateInput = document.querySelector('#translate-input') as HTMLInputElement;
const translationLangBtn = document.querySelector('#translation-lang-btn') as HTMLButtonElement;
const translateActiveIndicator = document.querySelector('#translate-active-indicator') as HTMLDivElement;

// Resolution Buttons
const resBtns = document.querySelectorAll('.res-btn') as NodeListOf<HTMLButtonElement>;

let currentDataFilter: 'ALL' | 'MEGA' | 'LIGHTING' | 'SCENE' | 'VIEW' = 'ALL';

// --- Data Filter Buttons ---
const filterBtns = document.querySelectorAll('.filter-btn') as NodeListOf<HTMLButtonElement>;
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
            b.classList.remove('active', 'bg-amber-500/20', 'text-amber-500', 'border-amber-500/50');
            b.classList.add('text-gray-400');
        });
        btn.classList.add('active', 'bg-amber-500/20', 'text-amber-500', 'border-amber-500/50');
        btn.classList.remove('text-gray-400');
        
        const id = btn.id;
        if (id === 'filter-all') currentDataFilter = 'ALL';
        else if (id === 'filter-mega') currentDataFilter = 'MEGA';
        else if (id === 'filter-lighting') currentDataFilter = 'LIGHTING';
        else if (id === 'filter-scene') currentDataFilter = 'SCENE';
        else if (id === 'filter-view') currentDataFilter = 'VIEW';
    });
});
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

// --- Undo/Redo for contenteditable ---
const undoStacks = new Map<HTMLElement, string[]>();
const undoIndex = new Map<HTMLElement, number>();

function setupUndo(el: HTMLElement) {
    undoStacks.set(el, [el.innerHTML]);
    undoIndex.set(el, 0);

    el.addEventListener('input', () => {
        const stack = undoStacks.get(el)!;
        let index = undoIndex.get(el)!;
        
        // If we are in the middle of the stack, remove future states
        if (index < stack.length - 1) {
            stack.splice(index + 1);
        }
        
        stack.push(el.innerHTML);
        undoIndex.set(el, stack.length - 1);
        
        if (stack.length > 50) { // Limit history
            stack.shift();
            undoIndex.set(el, stack.length - 1);
        }
    });

    el.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            const stack = undoStacks.get(el)!;
            let index = undoIndex.get(el)!;
            
            if (index > 0) {
                index--;
                undoIndex.set(el, index);
                el.innerHTML = stack[index];
            }
        }
    });
}

// Initialize Undo for PNG Info
if (pngInfoContentTop) {
    setupUndo(pngInfoContentTop);
    pngInfoContentTop.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
    });
}
if (pngInfoContentBottom) {
    setupUndo(pngInfoContentBottom);
    pngInfoContentBottom.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = e.clipboardData?.getData('text/plain') || '';
        document.execCommand('insertText', false, text);
    });
}

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

    // 2. Gather inputs
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

    // 3. Prepare Translation
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

        // Using gemini-3-flash-preview for text tasks as requested
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: `Translate this JSON: ${jsonStr}` }] },
            config: { 
                systemInstruction: systemPrompt,
                responseMimeType: 'application/json',
                // @ts-ignore
                thinkingConfig: { thinkingLevel: ThinkingLevel?.LOW || 'LOW' }
            }
        });

        if (response.text) {
            // Clean up Markdown code blocks if present
            let cleanText = response.text.trim();
            if (cleanText.startsWith('```json')) {
                cleanText = cleanText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanText.startsWith('```')) {
                 cleanText = cleanText.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }

            const result = JSON.parse(cleanText);
            if(megaEl && result.mega) { megaEl.value = result.mega; autoResize(megaEl); }
            if(lightEl && result.lighting) { lightEl.value = result.lighting; autoResize(lightEl); }
            if(sceneEl && result.scene) { sceneEl.value = result.scene; autoResize(sceneEl); }
            if(viewEl && result.view) { viewEl.value = result.view; autoResize(viewEl); }

            // AUTO COPY TO CLIPBOARD
            const combined = [
                result.mega || '', 
                result.lighting ? `Lighting: ${result.lighting}` : '', 
                result.scene ? `Scene: ${result.scene}` : '', 
                result.view ? `View: ${result.view}` : ''
            ].filter(Boolean).join('\n');
            
            try {
                await navigator.clipboard.writeText(combined);
                if(statusEl) statusEl.innerText = "Translated & Copied to Clipboard!";
            } catch (err) {
                console.error("Auto copy failed", err);
                if(statusEl) statusEl.innerText = "Translation Complete (Copy Failed)";
            }

        }
    } catch (e: any) {
        console.error("Translation failed", e);
        if (statusEl) statusEl.innerText = "Translation Error";
    } finally {
        if(megaEl) megaEl.disabled = false;
        if(lightEl) lightEl.disabled = false;
        if(sceneEl) sceneEl.disabled = false;
        if(viewEl) viewEl.disabled = false;
    }
}

if (langBtnVn) langBtnVn.addEventListener('click', () => translatePrompt('VN'));
if (langBtnEn) langBtnEn.addEventListener('click', () => translatePrompt('EN'));

// --- Icon Button Logic ---

async function translateTextGeneric(text: string, targetLang: 'VN' | 'EN'): Promise<string> {
    console.log(`translateTextGeneric called for ${targetLang}`);
    const ai = getGenAI();
    const systemPrompt = targetLang === 'VN' 
        ? `You are a professional translator. Translate the human-readable text content within the provided HTML string. You MUST strictly preserve all HTML tags, attributes, classes, and inline styles. Do not modify the structure, layout, or colors. Return ONLY the translated HTML string.`
        : `You are a professional translator. Translate the human-readable text content within the provided HTML string. You MUST strictly preserve all HTML tags, attributes, classes, and inline styles. Do not modify the structure, layout, or colors. Return ONLY the translated HTML string.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview', 
            contents: { parts: [{ text: text }] },
            config: { 
                systemInstruction: systemPrompt,
                // @ts-ignore
                thinkingConfig: { thinkingLevel: ThinkingLevel?.LOW || 'LOW' }
            }
        });
        const result = response.text || text;
        console.log("translateTextGeneric result received");
        return result;
    } catch (err) {
        console.error("translateTextGeneric failed:", err);
        return text;
    }
}

async function copyToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Clipboard write failed, trying fallback', err);
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        textArea.style.top = "0";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            return successful;
        } catch (err) {
            document.body.removeChild(textArea);
            return false;
        }
    }
}

async function copyImageToClipboard(blob: Blob): Promise<boolean> {
    if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && (window as any).ClipboardItem) {
        try {
            await navigator.clipboard.write([
                new (window as any).ClipboardItem({ 'image/png': blob })
            ]);
            return true;
        } catch (err) {
            console.warn('navigator.clipboard.write failed, trying fallback', err);
        }
    }

    // Fallback method: contenteditable trick for SketchUp/IE/Edge
    try {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(blob);
        
        const div = document.createElement('div');
        div.contentEditable = 'true';
        div.style.position = 'fixed';
        div.style.left = '-9999px';
        div.appendChild(img);
        document.body.appendChild(div);
        
        const range = document.createRange();
        range.selectNode(img);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            const successful = document.execCommand('copy');
            selection.removeAllRanges();
            document.body.removeChild(div);
            URL.revokeObjectURL(img.src);
            return successful;
        }
        document.body.removeChild(div);
        URL.revokeObjectURL(img.src);
    } catch (err) {
        console.error('Fallback image copy failed', err);
    }
    return false;
}

copyBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const targetId = btn.getAttribute('data-target');
        const el = document.getElementById(targetId!) as HTMLTextAreaElement;
        if (el && el.value) {
            const success = await copyToClipboard(el.value);
            if (success) {
                const originalContent = btn.innerHTML;
                btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                btn.style.color = '#4ade80';
                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.color = '';
                }, 1000);
            }
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
                if (!text) throw new Error("Empty clipboard");
                el.value = text;
                autoResize(el);
                
                const originalContent = btn.innerHTML;
                btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                btn.style.color = '#4ade80';
                setTimeout(() => {
                    btn.innerHTML = originalContent;
                    btn.style.color = '';
                }, 1000);
            } catch (err) { 
                console.warn('Clipboard read failed, opening manual paste modal', err); 
                const pastedText = await showCustomPaste();
                if (pastedText) {
                    el.value = pastedText;
                    autoResize(el);
                    
                    const originalContent = btn.innerHTML;
                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                    btn.style.color = '#4ade80';
                    setTimeout(() => {
                        btn.innerHTML = originalContent;
                        btn.style.color = '';
                    }, 1000);
                }
            }
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
        let textToExport = '';
        
        if (targetId === 'all-prompts') {
            const prompt = (document.getElementById('prompt-manual') as HTMLTextAreaElement)?.value || '';
            const lighting = (document.getElementById('lighting-manual') as HTMLTextAreaElement)?.value || '';
            const scene = (document.getElementById('scene-manual') as HTMLTextAreaElement)?.value || '';
            const view = (document.getElementById('view-manual') as HTMLTextAreaElement)?.value || '';
            
            textToExport = `PROMPT: ${prompt}\n\nLIGHTING: ${lighting}\n\nSCENE: ${scene}\n\nVIEW: ${view}`;
        } else {
            const el = document.getElementById(targetId!) as HTMLTextAreaElement;
            if (el) textToExport = el.value;
        }
        
        if (textToExport) {
            const blob = new Blob([textToExport], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${targetId || 'prompt'}-${Date.now()}.txt`;
            a.click();
            URL.revokeObjectURL(url);
        }
    });
});

// --- Image Count Logic ---
countBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const val = parseInt(btn.getAttribute('data-value') || '1');
        imageCount = val;
        
        countBtns.forEach(b => {
             b.classList.remove('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
             b.classList.add('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
        });
        btn.classList.add('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
        btn.classList.remove('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
        
        if (statusEl) statusEl.innerText = `Image Count: ${imageCount}`;
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
         // Switch Logic 
         resBtns.forEach(b => {
            b.classList.remove('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
            b.classList.add('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
         });
         btn.classList.add('active', 'border-[#262380]', 'bg-[#262380]/20', 'text-white');
         btn.classList.remove('border-[#27272a]', 'bg-[#121214]', 'text-gray-500');
         selectedResolution = targetRes || '1K';
         if(statusEl) statusEl.innerText = `Res set to ${selectedResolution}`;
         
         // Trigger UI Update for PRO/ULTRA badge check
         updateAccountStatusUI();
    });
});

// --- Model Selection Logic ---
const modelSelectEl = document.querySelector('#model-select') as HTMLSelectElement;
if (modelSelectEl && sizeSelect) {
    const updateSizeOptions = () => {
        const isImagen = modelSelectEl.value.startsWith('imagen');
        const options = sizeSelect.querySelectorAll('option');
        options.forEach(opt => {
            if (isImagen) {
                // Imagen 4 only supports 1:1, 9:16, 16:9, 4:3, 3:4
                if (opt.value === '3:2' || opt.value === '2:3') {
                    opt.disabled = true;
                    if (sizeSelect.value === opt.value) {
                        sizeSelect.value = '1:1';
                    }
                } else {
                    opt.disabled = false;
                }
            } else {
                opt.disabled = false;
            }
        });
    };
    modelSelectEl.addEventListener('change', updateSizeOptions);
    // Run once on init
    updateSizeOptions();
}

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
function uint8ToString(buf: Uint8Array) { 
    if (typeof TextDecoder !== 'undefined') {
        try {
            return new TextDecoder().decode(buf); 
        } catch (e) {}
    }
    // Fallback for environments without TextDecoder or if it fails
    let s = '';
    for (let i = 0; i < buf.length; i++) {
        s += String.fromCharCode(buf[i]);
    }
    try {
        return decodeURIComponent(escape(s));
    } catch (e) {
        return s; 
    }
}

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
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const buffer = e.target?.result as ArrayBuffer;
            if (!buffer) {
                resolve(null);
                return;
            }
            const view = new DataView(buffer);
            const uint8 = new Uint8Array(buffer);
            if (view.getUint32(0) !== 0x89504E47) {
                resolve(null);
                return;
            }

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
                            try { 
                                resolve(JSON.parse(uint8ToString(data.subarray(nullIndex + 1)))); 
                                return;
                            } 
                            catch(e) { console.error("JSON parse failed", e); }
                        }
                    }
                }
                offset += 12 + length;
                if (type === 'IEND') break;
            }
            resolve(null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(file);
    });
}

function populateMetadata(data: PromptData) {
    const filter = currentDataFilter;
    
    if (filter === 'ALL' || filter === 'MEGA') {
        if (promptEl) { promptEl.value = data.mega || ''; autoResize(promptEl); }
    }
    if (filter === 'ALL' || filter === 'LIGHTING') {
        const l = document.getElementById('lighting-manual') as HTMLTextAreaElement;
        if (l) { l.value = data.lighting || ''; autoResize(l); }
    }
    if (filter === 'ALL' || filter === 'SCENE') {
        const s = document.getElementById('scene-manual') as HTMLTextAreaElement;
        if (s) { s.value = data.scene || ''; autoResize(s); }
    }
    if (filter === 'ALL' || filter === 'VIEW') {
        const v = document.getElementById('view-manual') as HTMLTextAreaElement;
        if (v) { v.value = data.view || ''; autoResize(v); }
    }
    
    if (filter === 'ALL') {
        if (cameraProjToggle) cameraProjToggle.checked = !!data.cameraProjection;
        cameraProjectionEnabled = !!data.cameraProjection;

        if (inpaintingPromptToggle && inpaintingPromptText) {
            inpaintingPromptToggle.checked = !!data.inpaintEnabled;
            inpaintingPromptText.value = data.inpaint || '';
            if (data.inpaintEnabled) inpaintingPromptText.classList.remove('hidden');
            else inpaintingPromptText.classList.add('hidden');
            autoResize(inpaintingPromptText);
        }
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

// Undo/Redo Functions
function saveCanvasHistory() {
    if (!ctx || !maskCanvas) return;
    canvasHistoryStep++;
    // If we're not at the end of the array, discard the future states
    if (canvasHistoryStep < canvasHistory.length) {
         canvasHistory.length = canvasHistoryStep; 
    }
    canvasHistory.push({
        mask: ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height),
        text: JSON.parse(JSON.stringify(textElements))
    });
    if (canvasHistory.length > MAX_HISTORY) {
        canvasHistory.shift();
        canvasHistoryStep--;
    }
}

function performUndo() {
    if (canvasHistoryStep > 0) {
        canvasHistoryStep--;
        const state = canvasHistory[canvasHistoryStep];
        if (state.mask) ctx?.putImageData(state.mask, 0, 0);
        textElements = JSON.parse(JSON.stringify(state.text));
        
        editingTextIndex = -1;
        selectedTextIndex = -1;
        draggedTextIndex = -1;
        
        const textOverlayInput = document.querySelector('#text-overlay-input') as HTMLInputElement;
        const textColorInput = document.querySelector('#text-color-input') as HTMLInputElement;
        const textSizeInput = document.querySelector('#text-size-input') as HTMLInputElement;
        const mainTextOverlayInput = document.querySelector('#main-text-overlay-input') as HTMLInputElement;
        const mainTextColorInput = document.querySelector('#main-text-color-input') as HTMLInputElement;
        const mainTextSizeInput = document.querySelector('#main-text-size-input') as HTMLInputElement;
        
        textOverlayInput?.classList.add('hidden');
        textColorInput?.classList.add('hidden');
        textSizeInput?.classList.add('hidden');
        mainTextOverlayInput?.classList.add('hidden');
        mainTextColorInput?.classList.add('hidden');
        mainTextSizeInput?.classList.add('hidden');

        // Sync Zoom
         if(zoomCtx && maskCanvas) {
             zoomCtx.clearRect(0,0, zoomMaskCanvas.width, zoomMaskCanvas.height);
             zoomCtx.drawImage(maskCanvas, 0, 0);
        }
        redrawText();
    }
}

function performRedo() {
    if (canvasHistoryStep < canvasHistory.length - 1) {
        canvasHistoryStep++;
        const state = canvasHistory[canvasHistoryStep];
        if (state.mask) ctx?.putImageData(state.mask, 0, 0);
        textElements = JSON.parse(JSON.stringify(state.text));
        
        editingTextIndex = -1;
        selectedTextIndex = -1;
        draggedTextIndex = -1;
        
        const textOverlayInput = document.querySelector('#text-overlay-input') as HTMLInputElement;
        const textColorInput = document.querySelector('#text-color-input') as HTMLInputElement;
        const textSizeInput = document.querySelector('#text-size-input') as HTMLInputElement;
        const mainTextOverlayInput = document.querySelector('#main-text-overlay-input') as HTMLInputElement;
        const mainTextColorInput = document.querySelector('#main-text-color-input') as HTMLInputElement;
        const mainTextSizeInput = document.querySelector('#main-text-size-input') as HTMLInputElement;
        
        textOverlayInput?.classList.add('hidden');
        textColorInput?.classList.add('hidden');
        textSizeInput?.classList.add('hidden');
        mainTextOverlayInput?.classList.add('hidden');
        mainTextColorInput?.classList.add('hidden');
        mainTextSizeInput?.classList.add('hidden');

        // Sync Zoom
         if(zoomCtx && maskCanvas) {
             zoomCtx.clearRect(0,0, zoomMaskCanvas.width, zoomMaskCanvas.height);
             zoomCtx.drawImage(maskCanvas, 0, 0);
        }
        redrawText();
    }
}

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
    if (zoomTextCanvas) { zoomTextCanvas.width = maskCanvas.width; zoomTextCanvas.height = maskCanvas.height; }
    if (mainTextCanvas) { mainTextCanvas.width = maskCanvas.width; mainTextCanvas.height = maskCanvas.height; }

    ctx = maskCanvas.getContext('2d');
    previewCtx = maskPreviewCanvas?.getContext('2d') || null;
    guideCtx = guideCanvas.getContext('2d');
    
    zoomCtx = zoomMaskCanvas?.getContext('2d') || null;
    zoomPreviewCtx = zoomPreviewCanvas?.getContext('2d') || null;
    zoomGuideCtx = zoomGuideCanvas?.getContext('2d') || null;

    if(ctx) { 
        ctx.lineCap = 'round'; 
        ctx.lineJoin = 'round'; 
        ctx.lineWidth = currentBrushSize; 
        
        // Reset History
        canvasHistory = [];
        canvasHistoryStep = -1;
        saveCanvasHistory(); // Save initial blank state
    }
    
    // Sync Zoom Mask with Main Mask (Initial)
    if(zoomCtx) zoomCtx.drawImage(maskCanvas, 0, 0);
    redrawText();
}

function handleMainImage(file: File) {
    if (!file.type.startsWith('image/')) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const result = e.target?.result as string;
        uploadedImageData = { data: result.split(',')[1], mimeType: file.type };
        updateComparisonImages();
        
        // --- AUTO RATIO DETECTION LOGIC ---
        const imgObj = new Image();
        imgObj.onload = () => {
            const ratio = imgObj.width / imgObj.height;
            const ratios: Record<string, number> = {
                '1:1': 1,
                '3:2': 1.5,
                '2:3': 0.666,
                '16:9': 1.777,
                '9:16': 0.5625,
                '4:3': 1.333,
                '3:4': 0.75
            };
            
            let closest = '1:1';
            let minDiff = Infinity;
            
            for (const [key, val] of Object.entries(ratios)) {
                const diff = Math.abs(ratio - val);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = key;
                }
            }
            
            if (sizeSelect) {
                sizeSelect.value = closest;
                if(statusEl) statusEl.innerText = `Auto-set Ratio: ${closest}`;
            }

            if (uploadPreview) {
                uploadPreview.src = result;
                uploadPreview.onload = () => {
                     setupCanvas();
                     uploadPlaceholder?.classList.add('hidden');
                     inpaintingContainer?.classList.remove('hidden');
                     if(statusEl) setTimeout(() => statusEl.innerText = "Image Loaded", 1500);
                };
            }
        };
        imgObj.src = result;
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
// Global Paste Handler (Best for Plugins/Restricted Envs)
document.addEventListener('paste', (e) => {
    // If user is pasting into a specific input, let it handle it (unless it's an image)
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    
    if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                // It's an image! Handle it regardless of focus
                const blob = items[i].getAsFile();
                if (blob) {
                    e.preventDefault(); // Stop it from pasting into text inputs if it's an image
                    handleMainImage(blob);
                    if(statusEl) {
                        statusEl.innerText = "Image Pasted from Clipboard";
                        setTimeout(() => statusEl.innerText = "System Standby", 2000);
                    }
                }
                return;
            }
        }
    }
    
    // If not image, and not in input, maybe handle text paste for specific logic?
    // For now, let default text paste happen if in input.
});

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
    
    // Reset History
    canvasHistory = [];
    canvasHistoryStep = -1;
}
removeImageBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetImage(); });
removeImageOverlayBtn?.addEventListener('click', (e) => { e.stopPropagation(); resetImage(); });

// --- Screenshot Logic ---

async function captureScreen() {
    // Check if API is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showCustomAlert("Chức năng chụp màn hình không được hỗ trợ trong môi trường này (Plugin/Webview). Vui lòng sử dụng công cụ chụp màn hình của hệ điều hành (Snipping Tool) và dán ảnh vào đây (Ctrl+V).", "Not Supported");
        return;
    }

    try {
        // Fix: Cast video constraints to 'any' to allow 'cursor' property which is not in standard MediaTrackConstraints definition yet
        const stream = await navigator.mediaDevices.getDisplayMedia({ 
            video: { cursor: "never" } as any, // Don't capture cursor if possible
            audio: false 
        });
        
        // Create video element to grab frame
        const video = document.createElement('video');
        video.srcObject = stream;
        video.onloadedmetadata = async () => {
            video.play();
            // Wait a tick for frame to render
            await new Promise(r => setTimeout(r, 500));
            
            // Draw to temp canvas
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if(ctx) {
                ctx.drawImage(video, 0, 0);
                snapshotImage = await createImageBitmap(canvas);
                initCropMode(canvas.width, canvas.height);
            }
            
            // Stop stream
            stream.getTracks().forEach(track => track.stop());
        };
    } catch (err: any) {
        console.error("Screenshot error:", err);
        if (err.name === 'NotAllowedError' && err.message.includes('permissions policy')) {
             showCustomAlert("Screen capture is disabled by the browser or embedding environment permission policy. Please check if 'display-capture' is allowed.", "Permission Denied");
        } else if (err.name === 'NotAllowedError') {
             showCustomAlert("Screen capture cancelled by user.", "Cancelled");
        } else {
             showCustomAlert("Screen capture failed: " + err.message, "Error");
        }
    }
}

function initCropMode(w: number, h: number) {
    if(!screenshotOverlay || !screenshotCanvas || !snapshotImage) return;
    
    screenshotCanvas.width = window.innerWidth;
    screenshotCanvas.height = window.innerHeight;
    
    // Draw initial view
    const ctx = screenshotCanvas.getContext('2d');
    if(!ctx) return;
    
    // Draw the full image scaled to fit/fill
    ctx.drawImage(snapshotImage, 0, 0, w, h, 0, 0, window.innerWidth, window.innerHeight);
    // Draw dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, screenshotCanvas.width, screenshotCanvas.height);
    
    screenshotOverlay.classList.remove('hidden');
    isSnipping = false;
}

// Screenshot Canvas Events
if(screenshotCanvas) {
    screenshotCanvas.addEventListener('mousedown', (e) => {
        isSnipping = true;
        snipStartX = e.clientX;
        snipStartY = e.clientY;
    });

    screenshotCanvas.addEventListener('mousemove', (e) => {
        if(!isSnipping || !snapshotImage) return;
        const ctx = screenshotCanvas.getContext('2d');
        if(!ctx) return;
        
        // Redraw overlay
        ctx.clearRect(0,0,screenshotCanvas.width, screenshotCanvas.height);
        // Draw Image background
        ctx.drawImage(snapshotImage, 0, 0, snapshotImage.width, snapshotImage.height, 0, 0, window.innerWidth, window.innerHeight);
        
        // Draw Dark overlay everywhere EXCEPT selection
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        
        const currentX = e.clientX;
        const currentY = e.clientY;
        const w = currentX - snipStartX;
        const h = currentY - snipStartY;
        
        // Complex clipping path to create "hole"
        ctx.beginPath();
        ctx.rect(0, 0, screenshotCanvas.width, screenshotCanvas.height); // Outer
        ctx.rect(snipStartX, snipStartY, w, h); // Inner (Counter-clockwise implicitly handled by even-odd or direction if careful, but separate fillRects is easier)
        
        // Easier way: 4 Rects
        // Top
        ctx.fillRect(0, 0, screenshotCanvas.width, Math.min(snipStartY, currentY));
        // Bottom
        ctx.fillRect(0, Math.max(snipStartY, currentY), screenshotCanvas.width, screenshotCanvas.height - Math.max(snipStartY, currentY));
        // Left
        ctx.fillRect(0, Math.min(snipStartY, currentY), Math.min(snipStartX, currentX), Math.abs(h));
        // Right
        ctx.fillRect(Math.max(snipStartX, currentX), Math.min(snipStartY, currentY), screenshotCanvas.width - Math.max(snipStartX, currentX), Math.abs(h));
        
        // Stroke
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(snipStartX, snipStartY, w, h);
    });

    screenshotCanvas.addEventListener('mouseup', async (e) => {
        if(!isSnipping || !snapshotImage) return;
        isSnipping = false;
        screenshotOverlay.classList.add('hidden');
        
        const endX = e.clientX;
        const endY = e.clientY;
        
        const rectW = Math.abs(endX - snipStartX);
        const rectH = Math.abs(endY - snipStartY);
        
        if (rectW < 10 || rectH < 10) return; // Ignore tiny clicks
        
        const startX = Math.min(snipStartX, endX);
        const startY = Math.min(snipStartY, endY);
        
        // Calculate mapping from Screen Coordinates to Image Coordinates
        // We drew image at 0,0 to window.innerWidth, window.innerHeight
        const scaleX = snapshotImage.width / window.innerWidth;
        const scaleY = snapshotImage.height / window.innerHeight;
        
        const cropX = startX * scaleX;
        const cropY = startY * scaleY;
        const cropW = rectW * scaleX;
        const cropH = rectH * scaleY;
        
        // Crop
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = cropW;
        tempCanvas.height = cropH;
        const tCtx = tempCanvas.getContext('2d');
        if(tCtx) {
            tCtx.drawImage(snapshotImage, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            
            // Convert to file
            tempCanvas.toBlob((blob) => {
                if(blob) {
                    const file = new File([blob], "screenshot_snip.png", { type: "image/png" });
                    handleMainImage(file);
                }
            }, 'image/png');
        }
    });
}

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
            redrawText();
            
            // Show canvas overlays in zoom
            zoomPreviewCanvas?.classList.remove('hidden');

            // Calculate Fit Scale
            const vw = zoomViewport.clientWidth;
            const vh = zoomViewport.clientHeight;
            const iw = uploadPreview.naturalWidth;
            const ih = uploadPreview.naturalHeight;
            const scale = Math.min(vw / iw, vh / ih) * 0.9;

            // Reset Zoom/Pan to Fit
            zoomScale = scale; panX = 0; panY = 0;
            updateZoomTransform();
        }
    });

    closeZoomBtn?.addEventListener('click', () => {
        zoomOverlay.classList.add('opacity-0');
        setTimeout(() => { zoomOverlay.classList.add('hidden'); }, 300);
    });

    const downloadZoomedImage = document.querySelector('#download-zoomed-image') as HTMLButtonElement;
    downloadZoomedImage?.addEventListener('click', () => {
        if (!zoomedImage.src) return;
        
        const canvas = document.createElement('canvas');
        canvas.width = zoomedImage.naturalWidth;
        canvas.height = zoomedImage.naturalHeight;
        const exportCtx = canvas.getContext('2d');
        if (!exportCtx) return;

        // 1. Draw original image
        exportCtx.drawImage(zoomedImage, 0, 0);

        // 2. Draw mask/drawing
        if (zoomGuideCanvas && !zoomGuideCanvas.classList.contains('hidden')) {
            exportCtx.drawImage(zoomGuideCanvas, 0, 0);
        }
        
        if (zoomMaskCanvas && !zoomMaskCanvas.classList.contains('hidden')) {
            exportCtx.globalAlpha = 0.9;
            exportCtx.globalCompositeOperation = 'screen';
            exportCtx.drawImage(zoomMaskCanvas, 0, 0);
            exportCtx.globalAlpha = 1.0;
            exportCtx.globalCompositeOperation = 'source-over';
        }

        // 3. Draw text
        if (zoomTextCanvas && !zoomTextCanvas.classList.contains('hidden')) {
            exportCtx.drawImage(zoomTextCanvas, 0, 0);
        }

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `banana-pro-zoom-${Date.now()}.png`;
        link.click();
    });

    zoomTextCanvas = document.querySelector('#zoom-text-canvas') as HTMLCanvasElement;
    zoomTextCtx = zoomTextCanvas.getContext('2d')!;
    textOverlayInput = document.querySelector('#text-overlay-input') as HTMLInputElement;
    addTextBtn = document.querySelector('#add-text-btn') as HTMLButtonElement;
    mainAddTextBtn = document.querySelector('#main-add-text-btn') as HTMLButtonElement;
    mainTextOverlayInput = document.querySelector('#main-text-overlay-input') as HTMLInputElement;
    mainTextColorInput = document.querySelector('#main-text-color-input') as HTMLInputElement;
    mainTextSizeInput = document.querySelector('#main-text-size-input') as HTMLInputElement;
    mainDeleteTextBtn = document.querySelector('#main-delete-text-btn') as HTMLButtonElement;
    mainResetTextBtn = document.querySelector('#main-reset-text-btn') as HTMLButtonElement;

    const resetTextBtn = document.querySelector('#reset-text-btn') as HTMLButtonElement;
    
    mainResetTextBtn?.addEventListener('click', () => {
        textElements = [];
        selectedTextIndex = -1;
        redrawText();
    });

    resetTextBtn?.addEventListener('click', () => {
        textElements = [];
        selectedTextIndex = -1;
        redrawText();
        saveCanvasHistory();
    });

    toggleAddingTextMode = function(mode?: boolean) {
        isAddingTextMode = mode !== undefined ? mode : !isAddingTextMode;
        if (isAddingTextMode) {
            isTextEraserMode = false;
            // Deselect drawing tools
            toolBtns.forEach(b => { b.classList.remove('active', 'bg-[#262380]', 'text-white'); b.classList.add('text-gray-400'); });
            resetDraggable();
            const zoomBtns = document.querySelectorAll('#zoom-brush-panel .tool-btn');
            zoomBtns.forEach(zb => { zb.classList.remove('active', 'bg-[#262380]', 'text-white'); zb.classList.add('bg-white/5', 'text-gray-500'); });
            activeTool = '';
            if (brushCursor) brushCursor.classList.add('hidden');
        } else {
            // Switch to Select tool
            document.getElementById('tool-select')?.click();
        }
        
        const buttons = [addTextBtn, mainAddTextBtn];
        const eraserButtons = [eraserTextBtn, mainEraserTextBtn];
        const canvases = [zoomTextCanvas, mainTextCanvas];
        const inputs = [textOverlayInput, mainTextOverlayInput];

        buttons.forEach(btn => {
            if (btn) {
                if (isAddingTextMode) {
                    btn.classList.add('bg-orange-600');
                    btn.classList.remove('bg-[#262380]');
                } else {
                    btn.classList.remove('bg-orange-600');
                    btn.classList.add('bg-[#262380]');
                }
            }
        });
        eraserButtons.forEach(btn => {
            if (btn) {
                btn.classList.remove('bg-orange-600');
                btn.classList.add('bg-[#262380]');
            }
        });
        
        canvases.forEach(canvas => {
            if (canvas) {
                canvas.style.cursor = isAddingTextMode ? 'crosshair' : (isTextEraserMode ? 'not-allowed' : 'default');
                canvas.style.pointerEvents = (isAddingTextMode || isTextEraserMode) ? 'auto' : 'none';
            }
        });
        
        if (!isAddingTextMode) {
            inputs.forEach(input => input?.classList.add('hidden'));
            selectedTextIndex = -1;
            redrawText();
        }
    }

    toggleTextEraserMode = function(mode?: boolean) {
        isTextEraserMode = mode !== undefined ? mode : !isTextEraserMode;
        if (isTextEraserMode) {
            isAddingTextMode = false;
            // Deselect drawing tools
            toolBtns.forEach(b => { b.classList.remove('active', 'bg-[#262380]', 'text-white'); b.classList.add('text-gray-400'); });
            resetDraggable();
            const zoomBtns = document.querySelectorAll('#zoom-brush-panel .tool-btn');
            zoomBtns.forEach(zb => { zb.classList.remove('active', 'bg-[#262380]', 'text-white'); zb.classList.add('bg-white/5', 'text-gray-500'); });
            activeTool = '';
            if (brushCursor) brushCursor.classList.add('hidden');
        }

        const buttons = [addTextBtn, mainAddTextBtn];
        const eraserButtons = [eraserTextBtn, mainEraserTextBtn];
        const canvases = [zoomTextCanvas, mainTextCanvas];

        eraserButtons.forEach(btn => {
            if (btn) {
                if (isTextEraserMode) {
                    btn.classList.add('bg-orange-600');
                    btn.classList.remove('bg-[#262380]');
                } else {
                    btn.classList.remove('bg-orange-600');
                    btn.classList.add('bg-[#262380]');
                }
            }
        });
        buttons.forEach(btn => {
            if (btn) {
                btn.classList.remove('bg-orange-600');
                btn.classList.add('bg-[#262380]');
            }
        });

        canvases.forEach(canvas => {
            if (canvas) {
                canvas.style.cursor = isTextEraserMode ? 'not-allowed' : (isAddingTextMode ? 'crosshair' : 'default');
                canvas.style.pointerEvents = (isAddingTextMode || isTextEraserMode) ? 'auto' : 'none';
            }
        });
    }

    mainAddTextBtn?.addEventListener('click', () => toggleAddingTextMode());
    addTextBtn?.addEventListener('click', () => toggleAddingTextMode());
    mainEraserTextBtn?.addEventListener('click', () => toggleTextEraserMode());
    eraserTextBtn?.addEventListener('click', () => toggleTextEraserMode());

    const textColorInput = document.querySelector('#text-color-input') as HTMLInputElement;
    const textSizeInput = document.querySelector('#text-size-input') as HTMLInputElement;

    [textColorInput, mainTextColorInput].forEach(input => {
        input?.addEventListener('input', (e) => {
            if (editingTextIndex !== -1 && textElements[editingTextIndex]) {
                textElements[editingTextIndex].color = (e.target as HTMLInputElement).value;
                redrawText();
            }
        });
    });

    [textSizeInput, mainTextSizeInput].forEach(input => {
        input?.addEventListener('input', (e) => {
            if (editingTextIndex !== -1 && textElements[editingTextIndex]) {
                textElements[editingTextIndex].size = parseInt((e.target as HTMLInputElement).value) || 20;
                redrawText();
            }
        });
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                saveEditingText();
            }
        });
    });

    function saveEditingText() {
        if (editingTextIndex !== -1) {
            const ctxToUse = zoomTextCtx || mainTextCtx;
            if (!ctxToUse) return;

            const isZoom = !textOverlayInput?.classList.contains('hidden');
            const input = isZoom ? textOverlayInput : mainTextOverlayInput;
            const colorInp = isZoom ? textColorInput : mainTextColorInput;
            const sizeInp = isZoom ? textSizeInput : mainTextSizeInput;

            if (input && colorInp && sizeInp) {
                textElements[editingTextIndex].text = input.value;
                textElements[editingTextIndex].color = colorInp.value;
                textElements[editingTextIndex].size = parseInt(sizeInp.value) || 20;
                
                ctxToUse.font = `bold ${textElements[editingTextIndex].size}px Arial`;
                const metrics = ctxToUse.measureText(input.value);
                textElements[editingTextIndex].w = Math.max(20, metrics.width);
                textElements[editingTextIndex].h = textElements[editingTextIndex].size;
            }
            
            editingTextIndex = -1;
            if (textOverlayInput) textOverlayInput.value = '';
            if (mainTextOverlayInput) mainTextOverlayInput.value = '';
            
            textOverlayInput?.classList.add('hidden');
            textColorInput?.classList.add('hidden');
            textSizeInput?.classList.add('hidden');
            mainTextOverlayInput?.classList.add('hidden');
            mainTextColorInput?.classList.add('hidden');
            mainTextSizeInput?.classList.add('hidden');
            redrawText();
            saveCanvasHistory();
        }
    }

    function deleteSelectedText() {
        if (selectedTextIndex !== -1) {
            textElements.splice(selectedTextIndex, 1);
            selectedTextIndex = -1;
            redrawText();
            saveCanvasHistory();
        }
    }

    function attachTextListeners(canvas: HTMLCanvasElement) {
        if (!canvas) return;
        canvas.addEventListener('mousedown', (e) => {
            const { x, y } = getTransformedCanvasCoords(e, canvas);

            const clickedIndex = textElements.findIndex(el => 
                x >= el.x && x <= el.x + el.w &&
                y >= el.y && y <= el.y + el.h
            );

            // If we are currently editing text, clicking outside the text (on empty space) should save it
            // and NOT immediately start a new text.
            const activeEl = document.activeElement;
            const isEditing = activeEl === textOverlayInput || activeEl === mainTextOverlayInput || 
                              activeEl === textColorInput || activeEl === mainTextColorInput ||
                              activeEl === textSizeInput || activeEl === mainTextSizeInput;
            
            if (isEditing && editingTextIndex !== -1 && clickedIndex === -1) {
                saveEditingText();
                return;
            }

            if (clickedIndex !== -1) {
                if (isTextEraserMode) {
                    textElements.splice(clickedIndex, 1);
                    selectedTextIndex = -1;
                    draggedTextIndex = -1;
                    editingTextIndex = -1;
                    textOverlayInput?.classList.add('hidden');
                    mainTextOverlayInput?.classList.add('hidden');
                    textColorInput?.classList.add('hidden');
                    textSizeInput?.classList.add('hidden');
                    mainTextColorInput?.classList.add('hidden');
                    mainTextSizeInput?.classList.add('hidden');
                    redrawText();
                    saveCanvasHistory();
                    return;
                }

                selectedTextIndex = clickedIndex;
                draggedTextIndex = clickedIndex;
                dragOffsetX = x - textElements[draggedTextIndex].x;
                dragOffsetY = y - textElements[draggedTextIndex].y;
                
                // Ctrl + Drag to Copy
                if (e.ctrlKey) {
                    const el = textElements[draggedTextIndex];
                    const clone = { ...el };
                    textElements.push(clone);
                    draggedTextIndex = textElements.length - 1;
                    selectedTextIndex = draggedTextIndex;
                    saveCanvasHistory();
                }
                
                redrawText();
                return;
            }

            selectedTextIndex = -1;
            if (!isAddingTextMode) {
                redrawText();
                return;
            }
            
            // Create new text element
            const newText = { text: '', x: x, y: y, w: 100, h: 30, color: '#ffffff', size: 20 };
            textElements.push(newText);
            editingTextIndex = textElements.length - 1;
            selectedTextIndex = editingTextIndex;
            
            // Show input at screen coordinates
            const input = canvas.id === 'zoom-text-canvas' ? textOverlayInput : mainTextOverlayInput;
            const colorInp = canvas.id === 'zoom-text-canvas' ? textColorInput : mainTextColorInput;
            const sizeInp = canvas.id === 'zoom-text-canvas' ? textSizeInput : mainTextSizeInput;

            if (input && colorInp && sizeInp) {
                input.value = '';
                colorInp.value = '#ffffff';
                sizeInp.value = '20';
                
                input.style.position = 'fixed';
                input.style.left = e.clientX + 'px';
                input.style.top = e.clientY + 'px';
                input.style.width = '100px';
                input.classList.remove('hidden');
                
                colorInp.style.position = 'fixed';
                colorInp.style.left = (e.clientX + 105) + 'px';
                colorInp.style.top = e.clientY + 'px';
                colorInp.classList.remove('hidden');
                
                sizeInp.style.position = 'fixed';
                sizeInp.style.left = (e.clientX + 140) + 'px';
                sizeInp.style.top = e.clientY + 'px';
                sizeInp.classList.remove('hidden');
                
                input.focus();
            }
            redrawText();
        });

        canvas.addEventListener('mousemove', (e) => {
            const { x, y } = getTransformedCanvasCoords(e, canvas);

            if (draggedTextIndex !== -1) {
                isTextDragged = true;
                textElements[draggedTextIndex].x = x - dragOffsetX;
                textElements[draggedTextIndex].y = y - dragOffsetY;
                redrawText();
                return;
            }
        });

        canvas.addEventListener('mouseup', () => {
            if (draggedTextIndex !== -1) {
                if (isTextDragged) {
                    saveCanvasHistory();
                    isTextDragged = false;
                }
                draggedTextIndex = -1;
            }
        });

        canvas.addEventListener('dblclick', (e) => {
            const { x, y } = getTransformedCanvasCoords(e, canvas);

            const clickedIndex = textElements.findIndex(el => 
                x >= el.x && x <= el.x + el.w &&
                y >= el.y && y <= el.y + el.h
            );

            if (clickedIndex !== -1) {
                editingTextIndex = clickedIndex;
                selectedTextIndex = clickedIndex;
                
                const input = canvas.id === 'zoom-text-canvas' ? textOverlayInput : mainTextOverlayInput;
                const colorInp = canvas.id === 'zoom-text-canvas' ? textColorInput : mainTextColorInput;
                const sizeInp = canvas.id === 'zoom-text-canvas' ? textSizeInput : mainTextSizeInput;

                input.value = textElements[editingTextIndex].text;
                colorInp.value = textElements[editingTextIndex].color;
                sizeInp.value = textElements[editingTextIndex].size.toString();
                
                input.style.position = 'fixed';
                input.style.left = e.clientX + 'px';
                input.style.top = e.clientY + 'px';
                input.style.width = Math.max(100, textElements[editingTextIndex].w) + 'px';
                
                colorInp.style.position = 'fixed';
                colorInp.style.left = (e.clientX + Math.max(100, textElements[editingTextIndex].w) + 5) + 'px';
                colorInp.style.top = e.clientY + 'px';
                colorInp.classList.remove('hidden');
                
                sizeInp.style.position = 'fixed';
                sizeInp.style.left = (e.clientX + Math.max(100, textElements[editingTextIndex].w) + 40) + 'px';
                sizeInp.style.top = e.clientY + 'px';
                sizeInp.classList.remove('hidden');
                
                input.classList.remove('hidden');
                input.focus();
                redrawText();
            }
        });
    }

    attachTextListeners(zoomTextCanvas);
    attachTextListeners(mainTextCanvas);

    textOverlayInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEditingText();
    });
    mainTextOverlayInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEditingText();
    });

    textOverlayInput?.addEventListener('blur', (e) => {
        if (e.relatedTarget === textColorInput || e.relatedTarget === textSizeInput) {
            return;
        }
        saveEditingText();
    });
    mainTextOverlayInput?.addEventListener('blur', (e) => {
        if (e.relatedTarget === mainTextColorInput || e.relatedTarget === mainTextSizeInput) {
            return;
        }
        saveEditingText();
    });

    [textColorInput, mainTextColorInput].forEach(input => {
        input?.addEventListener('blur', (e) => {
            const isZoom = input.id === 'text-color-input';
            const textInp = isZoom ? textOverlayInput : mainTextOverlayInput;
            const sizeInp = isZoom ? textSizeInput : mainTextSizeInput;
            if (e.relatedTarget === textInp || e.relatedTarget === sizeInp) return;
            saveEditingText();
        });
    });

    [textSizeInput, mainTextSizeInput].forEach(input => {
        input?.addEventListener('blur', (e) => {
            const isZoom = input.id === 'text-size-input';
            const textInp = isZoom ? textOverlayInput : mainTextOverlayInput;
            const colorInp = isZoom ? textColorInput : mainTextColorInput;
            if (e.relatedTarget === textInp || e.relatedTarget === colorInp) return;
            saveEditingText();
        });
    });

    deleteTextBtn = document.querySelector('#delete-text-btn') as HTMLButtonElement;
    deleteTextBtn?.addEventListener('click', deleteSelectedText);
    mainDeleteTextBtn?.addEventListener('click', deleteSelectedText);

    resetTextBtn.addEventListener('click', () => {
        textElements = [];
        redrawText();
    });
    
    const updateZoomNavigation = () => {
        if (!prevZoomBtn || !nextZoomBtn) return;
        if (currentImageIndex > 0) prevZoomBtn.classList.remove('hidden');
        else prevZoomBtn.classList.add('hidden');
        
        if (currentImageIndex < generatedImages.length - 1) nextZoomBtn.classList.remove('hidden');
        else nextZoomBtn.classList.add('hidden');
    };

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

            // Show/Hide Zoom Navigation
            if (generatedImages.length > 1) {
                updateZoomNavigation();
            } else {
                prevZoomBtn?.classList.add('hidden');
                nextZoomBtn?.classList.add('hidden');
            }

            // Calculate Fit Scale
            const vw = zoomViewport.clientWidth;
            const vh = zoomViewport.clientHeight;
            const img = new Image();
            img.src = outputImage.src;
            img.onload = () => {
                const iw = img.naturalWidth;
                const ih = img.naturalHeight;
                const scale = Math.min(vw / iw, vh / ih) * 0.9;
                zoomScale = scale; panX = 0; panY = 0;
                updateZoomTransform();
            };
        }
    };

    if (prevZoomBtn) prevZoomBtn.addEventListener('click', (e) => { e.stopPropagation(); showImage(currentImageIndex - 1); });
    if (nextZoomBtn) nextZoomBtn.addEventListener('click', (e) => { e.stopPropagation(); showImage(currentImageIndex + 1); });

    // Keyboard Navigation
    window.addEventListener('keydown', (e) => {
        const target = (e.target as HTMLElement) || (document.activeElement as HTMLElement);
        const isTyping = target && (
                         target.tagName === 'TEXTAREA' || 
                         target.tagName === 'INPUT' || 
                         target.tagName === 'SELECT' ||
                         target.isContentEditable || 
                         target.closest('[contenteditable="true"]')
        );
        if (isTyping) return;

        // Navigation shortcuts (only if output is visible)
        if (!outputContainer.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft') {
                showImage(currentImageIndex - 1);
            } else if (e.key === 'ArrowRight') {
                showImage(currentImageIndex + 1);
            } else if (e.key === 'Escape') {
                if (!zoomOverlay.classList.contains('hidden')) {
                    closeZoomBtn.click();
                } else {
                    closeOutputBtn.click();
                }
            }
        }

        // Tool shortcuts (only if not typing in an input)
        const key = e.key.toLowerCase();
        if (key === 'v') {
            document.getElementById('tool-select')?.click();
        } else if (key === 'b') {
            document.getElementById('tool-brush')?.click();
        } else if (key === 'e') {
            document.getElementById('tool-eraser')?.click();
        } else if (key === 'r') {
            document.getElementById('tool-rect')?.click();
        } else if (key === 'l') {
            document.getElementById('tool-lasso')?.click();
        } else if (key === 'p') {
            document.getElementById('tool-polygon')?.click();
        } else if (key === 'a') {
            document.getElementById('tool-arrow')?.click();
        }
    });

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

    // Zoom Pan & Wheel
    zoomOverlay.addEventListener('wheel', (e) => {
        if (zoomOverlay.classList.contains('hidden')) return;
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = zoomScale * delta;
        if (newScale > 0.1 && newScale < 20) {
            zoomScale = newScale;
            updateZoomTransform();
        }
    }, { passive: false });

    zoomViewport.addEventListener('mousedown', (e) => {
        if (zoomOverlay.classList.contains('hidden')) return;
        if (e.button === 1) { // Middle button
            e.preventDefault();
            isPanning = true;
            panStartX = e.clientX - panX;
            panStartY = e.clientY - panY;
            zoomViewport.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
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
        const target = (e.target as HTMLElement) || (document.activeElement as HTMLElement);
        const isTyping = target && (
                         target.tagName === 'TEXTAREA' || 
                         target.tagName === 'INPUT' || 
                         target.tagName === 'SELECT' ||
                         target.isContentEditable || 
                         target.closest('[contenteditable="true"]')
        );
        if (isTyping) return;

        if (e.key === 'Escape' && !zoomOverlay.classList.contains('hidden')) {
            closeZoomBtn.click();
        }
        // ESC to close screenshot overlay if active
        if (e.key === 'Escape' && !screenshotOverlay.classList.contains('hidden')) {
            screenshotOverlay.classList.add('hidden');
            isSnipping = false;
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
    const target = (e.target as HTMLElement) || (document.activeElement as HTMLElement);
    const isTyping = target && (
                     target.tagName === 'TEXTAREA' || 
                     target.tagName === 'INPUT' || 
                     target.tagName === 'SELECT' ||
                     target.isContentEditable || 
                     target.closest('[contenteditable="true"]')
    );

    // CRITICAL: Block ALL shortcuts if editing text
    if (isTyping) {
        // Exception: Allow Ctrl+Enter to generate even when focused
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('generate-button')?.click();
        }
        return;
    }

    // Undo/Redo Shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        performUndo();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        performRedo();
        return;
    }

    // Priority check for Copy Image shortcut (Alt+C)
    if (e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        copyUploadedImageToClipboard();
        return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('generate-button')?.click();
        return;
    }

    // Paste PNG Info Shortcut (V)
    if (e.key.toLowerCase() === 'v' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        document.getElementById('paste-png-info-btn')?.click();
        return;
    }

    // Clear Arrows Shortcut
    if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        document.getElementById('clear-arrows-btn')?.click();
        return;
    }

    // Copy Image Shortcut (C)
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        copyUploadedImageToClipboard();
        return;
    }

    // Select Tool Shortcut (S)
    if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        document.getElementById('tool-select')?.click();
        return;
    }

    // Add Text Shortcut
    if (e.key.toLowerCase() === 't') {
        e.preventDefault();
        mainAddTextBtn?.click();
        return;
    }

    // Brush Size Shortcuts [ and ]
    if (e.key === '[' || e.key === ']') {
        const step = 5;
        if (e.key === '[') currentBrushSize = Math.max(5, currentBrushSize - step);
        else currentBrushSize = Math.min(150, currentBrushSize + step);

        if (brushSlider) brushSlider.value = currentBrushSize.toString();
        if (brushSizeVal) brushSizeVal.innerText = `${currentBrushSize}px`;
        if (zoomBrushSizeSlider) zoomBrushSizeSlider.value = currentBrushSize.toString();
        if (zoomBrushSizeVal) zoomBrushSizeVal.innerText = `${currentBrushSize}px`;
        if (ctx) ctx.lineWidth = currentBrushSize;
        
        // Auto-center visual cursor
        const brushCursor = document.getElementById('brush-cursor');
        if(brushCursor) {
            brushCursor.style.width = `${currentBrushSize}px`;
            brushCursor.style.height = `${currentBrushSize}px`;
            brushCursor.style.left = `${globalMouseX - (currentBrushSize / 2)}px`;
            brushCursor.style.top = `${globalMouseY - (currentBrushSize / 2)}px`;
        }
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
        div.className = 'relative w-12 h-12 group shrink-0';
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
    
    // Allow Paste directly into this zone by focusing it
    referenceDropZone.setAttribute('tabindex', '0');
    referenceDropZone.addEventListener('paste', async (e) => {
         e.preventDefault();
         const items = e.clipboardData?.items;
         if (items) {
             const dt = new DataTransfer();
             for (let i = 0; i < items.length; i++) {
                 if (items[i].type.startsWith('image/')) {
                     const file = items[i].getAsFile();
                     if (file) dt.items.add(file);
                 }
             }
             if (dt.files.length > 0) handleRefFiles(dt.files);
         }
    });
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

// --- PNG Info Viewport Logic ---
if (pngInfoTabBtn) {
    pngInfoTabBtn.addEventListener('click', () => {
        pngInfoViewport.classList.remove('hidden');
    });
}

if (pngInfoCloseBtn) {
    pngInfoCloseBtn.addEventListener('click', () => {
        pngInfoViewport.classList.add('hidden');
    });
}

// Font and Size
if (pngInfoFontSelect) {
    pngInfoFontSelect.addEventListener('change', () => {
        const font = pngInfoFontSelect.value;
        pngInfoContentTop.style.fontFamily = font;
        pngInfoContentBottom.style.fontFamily = font;
    });
}

if (pngInfoSizeInput) {
    pngInfoSizeInput.addEventListener('input', () => {
        const size = pngInfoSizeInput.value + 'px';
        pngInfoContentTop.style.fontSize = size;
        pngInfoContentBottom.style.fontSize = size;
    });
}

// Download
if (pngInfoDownloadDataBtn) {
    pngInfoDownloadDataBtn.addEventListener('click', () => {
        const text = pngInfoContentTop.innerText;
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'png_info_data.txt';
        a.click();
        URL.revokeObjectURL(url);
    });
}

const pngInfoDownloadPngBtn = document.querySelector('#png-info-download-png-btn') as HTMLButtonElement;
if (pngInfoDownloadPngBtn) {
    pngInfoDownloadPngBtn.addEventListener('click', () => {
        const text = pngInfoContentTop.innerText;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const fontSize = parseInt(pngInfoSizeInput.value) || 14;
        const fontFamily = pngInfoFontSelect.value || 'monospace';
        
        ctx.font = `${fontSize}px ${fontFamily}`;
        const lines = text.split('\n');
        
        // Calculate dimensions
        let maxWidth = 0;
        lines.forEach(line => {
            const width = ctx.measureText(line).width;
            if (width > maxWidth) maxWidth = width;
        });
        
        let contentWidth = maxWidth + 40;
        let contentHeight = lines.length * (fontSize + 10) + 40;
        
        // Force 4:3 aspect ratio
        const ratio = 4 / 3;
        
        // Ensure canvas fits content and matches 4:3 ratio
        if (contentWidth / contentHeight > ratio) {
            // Content is wider than 4:3, increase height to fit ratio
            canvas.width = contentWidth;
            canvas.height = contentWidth / ratio;
        } else {
            // Content is taller than 4:3, increase width to fit ratio
            canvas.height = contentHeight;
            canvas.width = contentHeight * ratio;
        }
        
        // Draw
        ctx.fillStyle = '#121214';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#d1d5db';
        ctx.font = `${fontSize}px ${fontFamily}`;
        
        lines.forEach((line, i) => {
            ctx.fillText(line, 20, 30 + i * (fontSize + 10));
        });
        
        // In a real app, we would use a library to embed metadata into the PNG blob.
        // For now, we just download the visual representation.
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = 'png_info.png';
        a.click();
    });
}

// Drag and Drop Helper
const setupDropZone = (dropZone: HTMLElement, fileInput: HTMLInputElement, contentArea: HTMLDivElement) => {
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => e.preventDefault());
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files[0];
        if (!file) return;

        if (file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = (e) => {
                contentArea.innerText = e.target?.result as string;
            };
            reader.readAsText(file);
        } else if (file.type === 'image/png') {
            try {
                const metadata = await exifr.parse(file);
                const text = JSON.stringify(metadata, null, 2);
                contentArea.innerText = text;
            } catch (err) {
                console.error('Failed to parse PNG metadata', err);
                contentArea.innerText = 'Failed to load metadata from image.';
            }
        }
    });
    fileInput.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        if (file.type === 'text/plain') {
            const reader = new FileReader();
            reader.onload = (e) => {
                contentArea.innerText = e.target?.result as string;
            };
            reader.readAsText(file);
        } else if (file.type === 'image/png') {
            try {
                const metadata = await exifr.parse(file);
                const text = JSON.stringify(metadata, null, 2);
                contentArea.innerText = text;
            } catch (err) {
                console.error('Failed to parse PNG metadata', err);
                contentArea.innerText = 'Failed to load metadata from image.';
            }
        }
    });
};

setupDropZone(pngInfoDropZoneTop, pngInfoFileInputTop, pngInfoContentTop);

const pngInfoDropZoneBottom = document.getElementById('png-info-drop-zone-bottom') as HTMLDivElement;
const pngInfoFileInputBottom = document.getElementById('png-info-file-input-bottom') as HTMLInputElement;
setupDropZone(pngInfoDropZoneBottom, pngInfoFileInputBottom, pngInfoContentBottom);

function setupPngInfoViewport(
    viewport: HTMLDivElement,
    content: HTMLDivElement,
    copyBtn: HTMLButtonElement,
    pasteBtn: HTMLButtonElement,
    clearBtn: HTMLButtonElement,
    templateBtn: HTMLButtonElement | null
) {
    // Copy
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const text = content.innerText;
            console.log("Copying text:", text); // Debugging
            if (text && text.trim() !== 'Drag a PNG image here to view its metadata...') {
                const success = await copyToClipboard(text);
                if (success) {
                    const originalClass = copyBtn.className;
                    copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
                    copyBtn.className = copyBtn.className.replace('text-blue-400', 'text-emerald-400').replace('border-blue-500/20', 'border-emerald-500/50');
                    setTimeout(() => {
                        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>';
                        copyBtn.className = originalClass;
                    }, 1000);
                }
            }
        });
    }

    // Paste (Removed per request)
    if (pasteBtn) {
        pasteBtn.style.display = 'none';
    }

    // Add scroll adjustment for Font and Size
    let lastScrollTime = 0;
    function setupScrollAdjust(element: HTMLElement, type: 'select' | 'number') {
        element.addEventListener('wheel', (e) => {
            const now = Date.now();
            if (now - lastScrollTime < 150) return; // Throttle to prevent rapid jumps
            lastScrollTime = now;
            
            e.preventDefault();
            const delta = e.deltaY > 0 ? -1 : 1;

            if (type === 'select') {
                const select = element as HTMLSelectElement;
                let newIndex = select.selectedIndex + (-delta);
                if (newIndex < 0) newIndex = 0;
                if (newIndex >= select.options.length) newIndex = select.options.length - 1;
                select.selectedIndex = newIndex;
                select.dispatchEvent(new Event('change'));
            } else if (type === 'number') {
                const input = element as HTMLInputElement;
                let val = parseInt(input.value) + delta;
                const min = parseInt(input.min) || 0;
                const max = parseInt(input.max) || 100;
                if (val < min) val = min;
                if (val > max) val = max;
                input.value = val.toString();
                input.dispatchEvent(new Event('input'));
            }
        }, { passive: false });
    }

const fontSelect = document.getElementById('png-info-font-select') as HTMLSelectElement;
if (fontSelect) setupScrollAdjust(fontSelect, 'select');

const sizeInput = document.getElementById('png-info-size-input') as HTMLInputElement;
if (sizeInput) setupScrollAdjust(sizeInput, 'number');

// Send To Top
    const sendTopBtn = document.getElementById('png-info-send-top-btn') as HTMLButtonElement;
    if (sendTopBtn) {
        sendTopBtn.addEventListener('click', () => {
            const contentTop = document.getElementById('png-info-content-top') as HTMLDivElement;
            if (contentTop && content !== contentTop) {
                contentTop.innerHTML += (contentTop.innerHTML ? '<br>' : '') + content.innerHTML;
                content.innerHTML = ''; // Xóa nội dung Viewport dưới
            }
        });
    }

    // Template
    if (templateBtn) {
        templateBtn.addEventListener('click', () => {
            const template = `<span class="text-amber-500">PROMPT (MÔ TẢ):</span>
Tạo ảnh siêu thực từ hình ảnh tải lên. Giữ nguyên chi tiết và thiết kế từ hình ảnh sketch tham chiếu.
Photorealistic, ultra detailed, sharp focus, 8k, crisp details, realistic materials, clean edges, precise geometry, global illumination, natural lighting, high detail textures, professional photography --no blurry, low quality, noise, soft focus, distorted, bad texture, artifacts.<br>
CHI TIẾT: <br>
<span class="text-amber-500">LIGHTING (ÁNH SÁNG):</span><br>
<span class="text-amber-500">SCENE (BỐI CẢNH):</span><br>
<span class="text-amber-500">VIEW (GÓC CHỤP):</span>`;
            
            // Replace content with template
            content.innerHTML = template;
        });

        // Add Color Buttons
        const yellowBtn = document.createElement('button');
        yellowBtn.innerHTML = '<div class="w-4 h-4 bg-yellow-400 rounded-full"></div>';
        yellowBtn.className = 'p-1 hover:bg-amber-900/40 rounded';
        yellowBtn.title = 'Set Yellow';
        yellowBtn.addEventListener('click', () => {
            document.execCommand('styleWithCSS', false, 'true');
            document.execCommand('foreColor', false, '#fbbf24'); // yellow-400
            yellowBtn.classList.add('ring-2', 'ring-white');
            whiteBtn.classList.remove('ring-2', 'ring-white');
        });
        templateBtn.parentElement!.insertBefore(yellowBtn, templateBtn.nextSibling);

        const whiteBtn = document.createElement('button');
        whiteBtn.innerHTML = '<div class="w-4 h-4 bg-white rounded-full"></div>';
        whiteBtn.className = 'p-1 hover:bg-amber-900/40 rounded';
        whiteBtn.title = 'Set White';
        whiteBtn.addEventListener('click', () => {
            document.execCommand('styleWithCSS', false, 'true');
            document.execCommand('foreColor', false, '#ffffff'); // white
            whiteBtn.classList.add('ring-2', 'ring-white');
            yellowBtn.classList.remove('ring-2', 'ring-white');
        });
        templateBtn.parentElement!.insertBefore(whiteBtn, yellowBtn.nextSibling);
    }

    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';
    deleteBtn.className = 'text-red-400 p-1 border border-red-500/20 rounded hover:bg-red-900/40';
    deleteBtn.title = 'Delete Selected';
    deleteBtn.addEventListener('click', () => {
        document.execCommand('delete', false, null);
    });
    copyBtn.parentElement!.insertBefore(deleteBtn, copyBtn.nextSibling);

    // Translate Button
    const translateBtn = document.createElement('button');
    translateBtn.innerText = 'VN-EN';
    translateBtn.className = 'text-xs bg-amber-900/20 border border-amber-500/20 text-amber-400 px-2 py-1 rounded hover:bg-amber-900/40';
    let currentLang: 'VN' | 'EN' = 'VN';
    translateBtn.addEventListener('click', async () => {
        translateBtn.innerText = 'Đang dịch...';
        const html = content.innerHTML;
        const targetLang = currentLang === 'VN' ? 'EN' : 'VN';
        content.innerHTML = await translateTextGeneric(html, targetLang);
        currentLang = targetLang;
        translateBtn.innerText = currentLang === 'VN' ? 'VN-EN' : 'EN-VN';
    });
    viewport.appendChild(translateBtn);

    // Ensure content is editable by default
    content.setAttribute('contenteditable', 'true');
    content.classList.add('border-amber-500/50');
    
    // Add Undo/Redo support
    setupUndo(content);
    
    // Drag and drop
    viewport.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    viewport.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        if (e.dataTransfer?.files?.[0]) {
            const file = e.dataTransfer.files[0];
            if (file.type === 'image/png') {
                const data = await extractMetadata(file);
                if (data) {
                    content.innerHTML = `<span class="text-amber-500">PROMPT:</span> ${(data.mega || '').replace(/&/g, "&amp;").replace(/</g, "&lt;")}<br><span class="text-amber-500">LIGHTING:</span> ${(data.lighting || '').replace(/&/g, "&amp;").replace(/</g, "&lt;")}<br><span class="text-amber-500">SCENE:</span> ${(data.scene || '').replace(/&/g, "&amp;").replace(/</g, "&lt;")}<br><span class="text-amber-500">VIEW:</span> ${(data.view || '').replace(/&/g, "&amp;").replace(/</g, "&lt;")}`;
                } else {
                    content.innerText = "No BananaProData metadata found in this image.";
                }
            } else {
                content.innerText = "Please drop a PNG image.";
            }
        }
    });

    // Clear
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            content.innerText = '';
            // Visual feedback
            const originalClass = clearBtn.className;
            clearBtn.className = clearBtn.className.replace('text-blue-400', 'text-emerald-400').replace('border-blue-500/20', 'border-emerald-500/50');
            setTimeout(() => clearBtn.className = originalClass, 500);
        });
    }
}

if (pngInfoViewportTop) {
    setupPngInfoViewport(
        pngInfoViewportTop,
        pngInfoContentTop,
        pngInfoCopyBtnTop,
        pngInfoPasteBtnTop,
        pngInfoClearBtnTop,
        pngInfoTemplateBtnTop
    );
    // Bind replace button separately
    if (pngInfoReplaceBtnTop) {
        pngInfoReplaceBtnTop.addEventListener('click', async () => {
            const result = await showBatchReplace();
            if (result) {
                const {find, replace} = result;
                if (pngInfoContentTop.innerText.includes(find)) {
                    pngInfoContentTop.innerText = pngInfoContentTop.innerText.split(find).join(replace);
                }
            }
        });
    }
}

if (pngInfoViewportBottom) {
    setupPngInfoViewport(
        pngInfoViewportBottom,
        pngInfoContentBottom,
        pngInfoCopyBtnBottom,
        pngInfoPasteBtnBottom,
        pngInfoClearBtnBottom,
        pngInfoTemplateBtnBottom
    );
    // Bind replace button separately
    if (pngInfoReplaceBtnBottom) {
        pngInfoReplaceBtnBottom.addEventListener('click', async () => {
            const result = await showBatchReplace();
            if (result) {
                const {find, replace} = result;
                if (pngInfoContentBottom.innerText.includes(find)) {
                    pngInfoContentBottom.innerText = pngInfoContentBottom.innerText.split(find).join(replace);
                }
            }
        });
    }
}

if (pngInfoSendBtn) {
    pngInfoSendBtn.addEventListener('click', () => {
        pngInfoContentTop.innerHTML += (pngInfoContentTop.innerHTML ? '<br>' : '') + pngInfoContentBottom.innerHTML;
    });
}

// Aspect Ratio buttons
document.querySelectorAll('.png-info-ar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const ar = btn.getAttribute('data-ar');
        const isActive = btn.classList.contains('bg-amber-900/40');
        
        // Find the parent viewport container
        const viewport = btn.closest('#png-info-viewport-top, #png-info-viewport-bottom');
        if (!viewport) return;
        
        // Find the content element within the viewport
        const contentEl = viewport.querySelector('#png-info-content-top, #png-info-content-bottom') as HTMLElement;
        if (!contentEl) return;

        // Remove active state from all buttons in the same viewport
        viewport.querySelectorAll('.png-info-ar-btn').forEach(b => {
            b.classList.remove('bg-amber-900/40', 'border-amber-500/50', 'text-amber-400');
            b.classList.add('bg-amber-900/20', 'border-amber-500/20', 'text-amber-400');
        });

        // Remove existing AR line from content
        let content = contentEl.innerHTML;
        // More robust regex to remove any existing AR line
        content = content.replace(/<br><span class="text-amber-500">AR:<\/span> --ar:.*$/g, '').replace(/<br><span class="text-amber-400">AR:<\/span> --ar:.*$/g, '');

        if (isActive) {
            // Deselected
            contentEl.innerHTML = content;
        } else {
            // Selected
            btn.classList.remove('bg-amber-900/20', 'border-amber-500/20', 'text-amber-400');
            btn.classList.add('bg-amber-900/40', 'border-amber-500/50', 'text-amber-400');
            contentEl.innerHTML = content + `<br><span class="text-amber-400">AR:</span> ${ar}`;
        }
        
        // Visual feedback
        const originalClass = btn.className;
        btn.className = btn.className.replace('text-amber-400', 'text-emerald-400').replace('border-amber-500/20', 'border-emerald-500/50');
        setTimeout(() => btn.className = originalClass, 500);
    });
});

// --- PNG Info Logic ---
if (pngInfoDropZone) {
    pngInfoDropZone.addEventListener('click', () => pngInfoInput?.click());
    pngInfoDropZone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.add('border-[#262380]', 'bg-[#262380]/10'); });
    pngInfoDropZone.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.remove('border-[#262380]', 'bg-[#262380]/10'); });
    pngInfoDropZone.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation(); pngInfoDropZone.classList.remove('border-[#262380]', 'bg-[#262380]/10');
        if (e.dataTransfer?.files?.[0]) {
            const data = await extractMetadata(e.dataTransfer.files[0]);
            if (data) populateMetadata(data); else showCustomAlert("No BananaProData metadata found.", "Metadata Error");
        }
    });
}

async function handleTranslationDrop(file: File) {
    console.log("handleTranslationDrop called with file:", file.name);
    const targetLang = translationLangBtn.getAttribute('data-lang') || 'vi';
    console.log("Target language:", targetLang);
    if (statusEl) statusEl.innerText = "Đang xử lý và dịch...";
    
    // Add visual effect
    if (translateDropZone) translateDropZone.classList.add('animate-pulse', 'border-blue-400', 'shadow-[0_0_15px_rgba(59,130,246,0.5)]');
    if (translateActiveIndicator) translateActiveIndicator.classList.replace('opacity-0', 'opacity-100');

    try {
        let data: any = null;
        if (file.name.endsWith('.png')) {
            console.log("Extracting metadata from PNG");
            data = await extractMetadata(file);
        } else if (file.name.endsWith('.txt')) {
            console.log("Reading metadata from TXT");
            const text = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string || '');
                reader.onerror = () => resolve('');
                reader.readAsText(file);
            });
            try {
                // Try to see if it's JSON metadata
                const trimmed = text.trim();
                if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                    data = JSON.parse(trimmed);
                } else {
                    data = { mega: text };
                }
            } catch {
                data = { mega: text };
            }
        }

        console.log("Data extracted:", data);
        if (data) {
            const translatedData = await translateMetadata(data, targetLang);
            console.log("Translated data:", translatedData);
            populateMetadata(translatedData);
            if (statusEl) statusEl.innerText = "Dịch và điền dữ liệu thành công";
        } else {
            showCustomAlert("Không tìm thấy dữ liệu trong tệp.", "Error");
        }
    } catch (err) {
        console.error("Translation drop failed:", err);
        showCustomAlert("Có lỗi xảy ra khi xử lý tệp.", "Error");
    } finally {
        // Remove visual effect
        if (translateDropZone) translateDropZone.classList.remove('animate-pulse', 'border-blue-400', 'shadow-[0_0_15px_rgba(59,130,246,0.5)]');
        if (translateActiveIndicator) translateActiveIndicator.classList.replace('opacity-100', 'opacity-0');
        setTimeout(() => { if(statusEl) statusEl.innerText = "System Standby"; }, 2000);
    }
}

if (translateDropZone && translateInput) {
    translateDropZone.addEventListener('click', () => translateInput.click());
    
    if (translationLangBtn) {
        translationLangBtn.addEventListener('click', () => {
            const currentLang = translationLangBtn.getAttribute('data-lang');
            if (currentLang === 'vi') {
                translationLangBtn.setAttribute('data-lang', 'en');
                translationLangBtn.innerText = 'ENGLISH';
            } else {
                translationLangBtn.setAttribute('data-lang', 'vi');
                translationLangBtn.innerText = 'VIỆT NAM';
            }
        });
    }

    translateInput.addEventListener('change', async () => {
        if (translateInput.files?.[0]) {
            await handleTranslationDrop(translateInput.files[0]);
            translateInput.value = '';
        }
    });

    translateDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateDropZone.classList.add('border-blue-500', 'bg-blue-500/10');
    });

    translateDropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateDropZone.classList.remove('border-blue-500', 'bg-blue-500/10');
    });

    translateDropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        translateDropZone.classList.remove('border-blue-500', 'bg-blue-500/10');
        if (e.dataTransfer?.files?.[0]) {
            await handleTranslationDrop(e.dataTransfer.files[0]);
        }
    });
}
if (pngInfoInput) {
    pngInfoInput.addEventListener('change', async () => {
        if (pngInfoInput.files?.[0]) {
            const data = await extractMetadata(pngInfoInput.files[0]);
            if (data) populateMetadata(data); else showCustomAlert("No BananaProData metadata found.", "Metadata Error");
            pngInfoInput.value = '';
        }
    });
}

// --- Paste PNG Info Button (UPDATED to Read JSON Text) ---
async function applyMetadata(data: any) {
    console.log("applyMetadata called with:", data);
    // Basic validation to check if it looks like our metadata structure
    const isPromptData = data && (
        'mega' in data || 
        'lighting' in data || 
        'scene' in data || 
        'view' in data ||
        'BananaProData' in data
    );

    if (isPromptData) {
        populateMetadata(data);
        if(statusEl) {
            statusEl.innerText = "Data Paste Success";
            setTimeout(() => statusEl.innerText = "System Standby", 2000);
        }
    } else {
        console.warn("Clipboard JSON does not match PromptData structure:", data);
        showCustomAlert("Clipboard JSON does not match the expected Data PNG Info format.", "Format Error");
    }
}

if (pastePngInfoBtn) {
    pastePngInfoBtn.addEventListener('click', async () => {
        try {
            window.focus();
            
            // Always show the custom paste modal as requested for SketchUp reliability
            // This provides the "board" the user can paste into.
            const text = await showCustomPaste();

            if (!text || !text.trim()) {
                if(statusEl) statusEl.innerText = "Paste cancelled or empty";
                return;
            }

            try {
                // Attempt to parse text as JSON (Data PNG info format)
                const trimmedText = text.trim();
                
                // If it doesn't look like JSON, treat it as a raw prompt
                if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
                    const data = { mega: trimmedText };
                    await applyMetadata(data);
                } else {
                    const data = JSON.parse(trimmedText);
                    await applyMetadata(data);
                }
            } catch (jsonErr) {
                console.warn("Pasted text is not valid JSON Data.", jsonErr);
                showCustomAlert("Dữ liệu không hợp lệ. Vui lòng đảm bảo bạn dán đúng nội dung Data PNG Info (JSON).", "Invalid Format");
            }
        } catch (err) {
            console.error("Failed to handle paste", err);
            showCustomAlert("Có lỗi xảy ra khi xử lý dữ liệu dán.", "Error");
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
        if (!file.name.endsWith('.txt') && !file.name.endsWith('.png')) return;
        try {
            let text = '';
            if (file.name.endsWith('.txt')) {
                text = await file.text();
            } else if (file.name.endsWith('.png')) {
                const data = await extractMetadata(file);
                if (data) {
                    // Map targetKey to the correct property in PromptData
                    // The targetKey for the input element is the ID of the textarea (e.g., 'prompt-manual')
                    const textareaId = input?.getAttribute('data-target');
                    if (textareaId === 'prompt-manual') text = data.mega || '';
                    else if (textareaId === 'lighting-manual') text = data.lighting || '';
                    else if (textareaId === 'scene-manual') text = data.scene || '';
                    else if (textareaId === 'view-manual') text = data.view || '';
                }
            }

            if (text && targetKey) {
                // We only update the textarea to avoid doubling in getCombinedText
                const textarea = document.getElementById(targetKey) as HTMLTextAreaElement;
                if (textarea) { 
                    textarea.value = text; 
                    autoResize(textarea); 
                }
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
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (file.name.endsWith('.txt')) {
             el.value = await file.text(); autoResize(el);
        } else if (file.name.endsWith('.png')) {
             const data = await extractMetadata(file);
             if (data) {
                 if (el.id === 'prompt-manual') el.value = data.mega || '';
                 else if (el.id === 'lighting-manual') el.value = data.lighting || '';
                 else if (el.id === 'scene-manual') el.value = data.scene || '';
                 else if (el.id === 'view-manual') el.value = data.view || '';
                 autoResize(el);
             }
        }
    });
});

// --- Canvas Drawing & Cursor ---

const pencilIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-[10%] w-[10%] text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><path d="M14.083 2.506a2.898 2.898 0 014.09 4.089l-9.605 9.603-4.326.865.867-4.326 9.605-9.604-.63-.627zM16.902 8.01l-1.258-1.259 1.258 1.259zm-10.74 8.35l.432 2.155 2.154-.431-2.586-1.724z" /></svg>`;
const dotIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-[10%] w-[10%] text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>`;
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
    } else if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'lasso' || activeTool === 'polygon') {
         brushCursor.innerHTML = pencilIcon;
    } else if (activeTool === 'arrow') {
         brushCursor.innerHTML = dotIcon;
    }
}

if (canvasContainer) {
    canvasContainer.addEventListener('mousemove', (e) => {
        if (activeTool === 'select') {
            brushCursor.classList.add('hidden');
            return;
        }
        brushCursor.classList.remove('hidden');
        updateBrushCursor(e as MouseEvent);
    });
    canvasContainer.addEventListener('mouseleave', () => { brushCursor.classList.add('hidden'); });
}

// Ensure zoom cursor consistency
if (zoomViewport) {
     zoomViewport.addEventListener('mousemove', (e) => {
        if (activeTool === 'select') {
            brushCursor.classList.add('hidden');
            return;
        }
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
    if (canvas.id === 'zoom-mask-canvas' || canvas.id === 'zoom-text-canvas') {
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
    if (!ctx) return;

    isDrawing = true;
    const { x, y } = getTransformedCanvasCoords(e, targetCanvas);
    startX = x; startY = y;

    if (activeTool === 'brush' || activeTool === 'eraser') {
        const op = activeTool === 'eraser' ? 'destination-out' : 'source-over';
        const color = 'rgba(255, 0, 0, 0.8)';
        
        ctx.beginPath();
        ctx.globalCompositeOperation = op;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = currentBrushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(x, y); ctx.lineTo(x, y); ctx.stroke();
        
        if (zoomCtx) {
            zoomCtx.beginPath();
            zoomCtx.globalCompositeOperation = op;
            zoomCtx.strokeStyle = color;
            zoomCtx.fillStyle = color;
            zoomCtx.lineWidth = currentBrushSize;
            zoomCtx.lineCap = 'round';
            zoomCtx.lineJoin = 'round';
            zoomCtx.moveTo(x, y); zoomCtx.lineTo(x, y); zoomCtx.stroke();
        }
    } else if (activeTool === 'lasso') {
        lassoPoints = [{x, y}];
        maskPreviewCanvas.classList.remove('hidden');
        if (zoomPreviewCanvas) zoomPreviewCanvas.classList.remove('hidden');
    } else if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'arrow') {
        maskPreviewCanvas.classList.remove('hidden');
        if (zoomPreviewCanvas) zoomPreviewCanvas.classList.remove('hidden');
    } else if (activeTool === 'polygon') {
        // Point-to-Point Polygon logic
        if (!isDrawingPolygon) {
            isDrawingPolygon = true;
            polygonPoints = [{x, y}];
            maskPreviewCanvas.classList.remove('hidden');
            if (zoomPreviewCanvas) zoomPreviewCanvas.classList.remove('hidden');
        } else {
            // Check if clicking near the first point to close
            const dist = Math.sqrt(Math.pow(x - polygonPoints[0].x, 2) + Math.pow(y - polygonPoints[0].y, 2));
            if (dist < 15 && polygonPoints.length > 2) {
                finishPolygon();
            } else {
                polygonPoints.push({x, y});
            }
        }
    }
}

function finishPolygon() {
    if (polygonPoints.length < 3) {
        isDrawingPolygon = false;
        polygonPoints = [];
        maskPreviewCanvas.classList.add('hidden');
        return;
    }
    
    if (ctx) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
        for (let i = 1; i < polygonPoints.length; i++) {
            ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
        }
        ctx.closePath();
        ctx.fill();
        
        // Sync zoom canvas
        if (zoomCtx) {
            zoomCtx.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height);
            zoomCtx.drawImage(maskCanvas, 0, 0);
        }
        
        saveCanvasHistory();
    }
    
    isDrawingPolygon = false;
    polygonPoints = [];
    if (drawRequest) cancelAnimationFrame(drawRequest);
    drawRequest = null;
    maskPreviewCanvas.classList.add('hidden');
    zoomPreviewCanvas.classList.add('hidden');
}

function draw(e: MouseEvent, targetCanvas: HTMLCanvasElement) {
    if (isAddingTextMode || (!isDrawing && !isDrawingPolygon)) return;
    const { x, y } = getTransformedCanvasCoords(e, targetCanvas);

    if (activeTool === 'brush' || activeTool === 'eraser') {
        if (ctx) {
            ctx.lineTo(x, y);
            ctx.stroke();
        }
        if (zoomCtx) {
            zoomCtx.lineTo(x, y);
            zoomCtx.stroke();
        }
    } else if (activeTool === 'polygon' || activeTool === 'lasso') {
        // Immediate preview for polygon and lasso for better responsiveness
        const pCtx = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCtx : previewCtx;
        const pCanvas = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCanvas : maskPreviewCanvas;
        if (!pCtx || !pCanvas) return;

        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        pCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        pCtx.lineWidth = 2;

        if (activeTool === 'polygon') {
            if (!isDrawingPolygon || polygonPoints.length === 0) return;
            pCtx.fillStyle = 'rgba(255, 0, 0, 0.2)';
            pCtx.beginPath();
            pCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
            for (let i = 1; i < polygonPoints.length; i++) {
                pCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
            }
            pCtx.lineTo(x, y);
            pCtx.stroke();

            const dist = Math.sqrt(Math.pow(x - polygonPoints[0].x, 2) + Math.pow(y - polygonPoints[0].y, 2));
            if (dist < 15 && polygonPoints.length > 2) {
                pCtx.beginPath();
                pCtx.arc(polygonPoints[0].x, polygonPoints[0].y, 8, 0, Math.PI * 2);
                pCtx.fillStyle = 'rgba(0, 255, 0, 0.5)';
                pCtx.fill();
            }
        } else if (activeTool === 'lasso') {
            lassoPoints.push({x, y});
            pCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
            pCtx.beginPath();
            pCtx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
            for (let i = 1; i < lassoPoints.length; i++) pCtx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
            pCtx.stroke();
            pCtx.fill();
        }
    } else {
        if (drawRequest) cancelAnimationFrame(drawRequest);
        drawRequest = requestAnimationFrame(() => {
            // For preview, decide which canvas to use
            const pCtx = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCtx : previewCtx;
            const pCanvas = (targetCanvas.id === 'zoom-mask-canvas') ? zoomPreviewCanvas : maskPreviewCanvas;

            if (!pCtx || !pCanvas) return;
            pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);

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
        });
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
    } else if (activeTool === 'polygon') {
        // Polygon is click-based, so stopDrawing (on mouseup) doesn't finish it
        return;
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
    
    if (drawRequest) cancelAnimationFrame(drawRequest);
    drawRequest = null;
    
    // Save history after any drawing operation
    saveCanvasHistory();
}

// Attach listeners
function attachCanvasListeners(canvas: HTMLCanvasElement) {
    canvas.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left click for inpainting
        startDrawing(e, canvas);
    });
    canvas.addEventListener('mousemove', (e) => draw(e, canvas));
    canvas.addEventListener('mouseup', (e) => stopDrawing(e, canvas));
    canvas.addEventListener('mouseout', (e) => {
        if (activeTool !== 'polygon') stopDrawing(e, canvas);
    });
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (activeTool === 'polygon' && isDrawingPolygon) {
            finishPolygon();
        }
    }); // Disable right-click menu
}

if (maskCanvas) attachCanvasListeners(maskCanvas);
if (zoomMaskCanvas) {
    attachCanvasListeners(zoomMaskCanvas);
    
    // Global handlers for drag out (for drag-based tools)
    window.addEventListener('mousemove', (e) => {
        if(isDrawing && !zoomOverlay.classList.contains('hidden')) {
             draw(e, zoomMaskCanvas);
        }
        if(isDrawingPolygon && !zoomOverlay.classList.contains('hidden') && activeTool === 'polygon') {
             draw(e, zoomMaskCanvas);
        }
    });
    window.addEventListener('mouseup', (e) => {
        if(isDrawing && !zoomOverlay.classList.contains('hidden')) {
             stopDrawing(e, zoomMaskCanvas);
        }
    });
}

// --- Gallery Storage (IndexedDB) ---
const DB_NAME = 'BananaGalleryDB';
const STORE_NAME = 'images';
const DB_VERSION = 1;

async function getDB() {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getMaskBase64(): string | null {
    if (!maskCanvas) return null;
    const context = maskCanvas.getContext('2d');
    if (!context) return null;
    
    const w = maskCanvas.width;
    const h = maskCanvas.height;
    if (w === 0 || h === 0) return null;

    const imageData = context.getImageData(0, 0, w, h);
    const data = imageData.data;
    let hasContent = false;
    for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0) {
            hasContent = true;
            break;
        }
    }
    if (!hasContent) return null;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return null;

    tempCtx.fillStyle = 'black';
    tempCtx.fillRect(0, 0, w, h);

    const tempImageData = tempCtx.getImageData(0, 0, w, h);
    const tempData = tempImageData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
            tempData[i] = 255;
            tempData[i + 1] = 255;
            tempData[i + 2] = 255;
            tempData[i + 3] = 255;
        }
    }
    tempCtx.putImageData(tempImageData, 0, 0);
    return tempCanvas.toDataURL('image/png').split(',')[1];
}

async function compositeInpaint(originalBase64: string, generatedBase64: string, maskBase64: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const originalImg = new Image();
        const generatedImg = new Image();
        const maskImg = new Image();
        
        let loadedCount = 0;
        const onLoaded = () => {
            loadedCount++;
            if (loadedCount === 3) {
                const canvas = document.createElement('canvas');
                canvas.width = originalImg.width;
                canvas.height = originalImg.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) { reject('No ctx'); return; }
                
                // 1. Draw original image
                ctx.drawImage(originalImg, 0, 0);
                
                // 2. Create a temporary canvas for the masked generated image
                const tempCanvas = document.createElement('canvas');
                tempCanvas.width = originalImg.width;
                tempCanvas.height = originalImg.height;
                const tempCtx = tempCanvas.getContext('2d');
                if (!tempCtx) { reject('No tempCtx'); return; }
                
                // 3. Draw mask on temp canvas
                tempCtx.filter = 'blur(2px)'; // Add a slight blur to the mask to improve blending
                tempCtx.drawImage(maskImg, 0, 0, originalImg.width, originalImg.height);
                tempCtx.filter = 'none'; // Reset filter
                
                // 4. Use 'source-in' to only keep generated pixels where mask is white
                tempCtx.globalCompositeOperation = 'source-in';
                tempCtx.drawImage(generatedImg, 0, 0, originalImg.width, originalImg.height);
                
                // 5. Draw the temp canvas onto the main canvas
                ctx.drawImage(tempCanvas, 0, 0);
                
                resolve(canvas.toDataURL('image/png').split(',')[1]);
            }
        };
        
        originalImg.onload = onLoaded;
        generatedImg.onload = onLoaded;
        maskImg.onload = onLoaded;
        
        originalImg.onerror = reject;
        generatedImg.onerror = reject;
        maskImg.onerror = reject;
        
        originalImg.src = `data:image/png;base64,${originalBase64}`;
        generatedImg.src = `data:image/png;base64,${generatedBase64}`;
        maskImg.src = `data:image/png;base64,${maskBase64}`;
    });
}

async function saveToGallery(src: string, promptData: PromptData) {
    try {
        const db = await getDB();
        const now = Date.now();
        const id = now.toString() + Math.random().toString(36).substr(2, 5);
        
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        await new Promise((resolve, reject) => {
            const request = store.add({ id, src, timestamp: now, metadata: promptData });
            request.onsuccess = resolve;
            request.onerror = reject;
        });
        
        // Cleanup old images (older than 24h)
        cleanupGallery();
    } catch (e) {
        console.error("Failed to save to gallery", e);
        if (statusEl) statusEl.innerText = "Gallery storage error.";
    }
}

async function getGalleryImages() {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        return new Promise<any[]>((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const now = Date.now();
                // Filter 24h on retrieval too
                resolve(request.result.filter(item => now - item.timestamp < 24 * 60 * 60 * 1000));
            };
            request.onerror = reject;
        });
    } catch (e) {
        console.error("Failed to get gallery", e);
        return [];
    }
}

async function deleteFromGallery(id: string) {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = resolve;
        request.onerror = reject;
    });
}

async function clearGallery() {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = resolve;
        request.onerror = reject;
    });
}

let isCleaningUp = false;
async function cleanupGallery() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const now = Date.now();
        
        const request = store.openCursor();
        request.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
                if (now - cursor.value.timestamp > 24 * 60 * 60 * 1000) {
                    cursor.delete();
                }
                cursor.continue();
            } else {
                isCleaningUp = false;
            }
        };
        request.onerror = () => {
            isCleaningUp = false;
        };
    } catch (e) {
        console.error("Cleanup failed", e);
        isCleaningUp = false;
    }
}

// --- History Logic ---
function addToHistory(imgSrc: string, promptData: PromptData) {
    if (!historyList) return;
    if (historyList.children.length === 1 && historyList.children[0].textContent === 'No history yet') { historyList.innerHTML = ''; }
    
    // Save to Gallery Storage
    saveToGallery(imgSrc, promptData);

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

const openGalleryBtn = document.getElementById('open-gallery-btn');
const galleryModal = document.getElementById('gallery-modal');
const closeGalleryModalBtn = document.getElementById('close-gallery-modal-btn');
const galleryModalList = document.getElementById('gallery-modal-list');
const gallerySaveAllBtn = document.getElementById('gallery-save-all-btn');
const galleryClearAllBtn = document.getElementById('gallery-clear-all-btn');

async function renderGalleryModal() {
    if (!galleryModalList) return;
    const gallery = await getGalleryImages();
    
    // Sort by timestamp descending
    gallery.sort((a, b) => b.timestamp - a.timestamp);

    // Limit to 100 most recent images to prevent memory crashes in embedded browsers
    const displayGallery = gallery.slice(0, 100);

    if (displayGallery.length === 0) {
        galleryModalList.innerHTML = '<div class="col-span-full text-center py-20 text-gray-600 font-black uppercase tracking-widest">No images in gallery</div>';
        return;
    }

    galleryModalList.innerHTML = '';
    displayGallery.forEach((item: any) => {
        const card = document.createElement('div');
        card.className = 'relative group rounded-lg overflow-hidden border border-white/10 hover:border-[#262380] transition-all bg-black/20 aspect-square cursor-pointer';
        card.innerHTML = `
            <img src="${item.src}" class="w-full h-full object-cover" alt="Generated Image" loading="lazy">
            <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-1 transition-opacity">
                <button class="p-1 bg-[#262380] rounded-full hover:scale-110 transition-transform gallery-download-item" data-src="${item.src}" data-id="${item.id}" title="Download">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </button>
                <button class="p-1 bg-emerald-600 rounded-full hover:scale-110 transition-transform gallery-paste-item" data-id="${item.id}" title="Upload to PNG Info">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4" /></svg>
                </button>
                <button class="p-1 bg-red-600 rounded-full hover:scale-110 transition-transform gallery-delete-item" data-id="${item.id}" title="Delete">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('button')) return;
            // Clicking the image now opens the Zoom Overlay instead of loading into main preview
            if (zoomedImage && zoomOverlay) {
                zoomedImage.src = item.src;
                zoomOverlay.classList.remove('hidden');
                setTimeout(() => zoomOverlay.classList.add('opacity-100'), 10);
                redrawText();
            }
        });

        galleryModalList.appendChild(card);
    });

    // Attach listeners to new buttons
    galleryModalList.querySelectorAll('.gallery-download-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const src = target.getAttribute('data-src');
            const id = target.getAttribute('data-id');
            if (src && id) triggerDownload(src, `banana-gallery-${id}.png`);
        });
    });

    galleryModalList.querySelectorAll('.gallery-paste-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const id = target.getAttribute('data-id');
            if (id) {
                const item = displayGallery.find(i => i.id === id);
                if (item && item.metadata) {
                    // Directly apply metadata without clipboard
                    applyMetadata(item.metadata);
                    galleryModal?.classList.add('hidden');
                } else {
                    if (statusEl) statusEl.innerText = "No metadata found for this image.";
                }
            }
        });
    });

    galleryModalList.querySelectorAll('.gallery-delete-item').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const target = e.currentTarget as HTMLElement;
            const id = target.getAttribute('data-id');
            if (id) {
                await deleteFromGallery(id);
                renderGalleryModal();
            }
        });
    });
}

function triggerDownload(src: string, filename: string) {
    // --- SketchUp Native Save Support ---
    if (window.sketchup && typeof window.sketchup.save_image === 'function') {
        try {
            window.sketchup.save_image(src, filename);
            console.log(`Sent to SketchUp for saving: ${filename}`);
            if (statusEl) statusEl.innerText = "Saved to SketchUp folder.";
            return;
        } catch (e) {
            console.error("SketchUp save_image failed", e);
        }
    } else if (window.sketchup) {
        console.warn("window.sketchup.save_image not found, falling back to browser download");
        if (statusEl) statusEl.innerText = "SketchUp save not configured. Trying browser...";
    }

    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    
    try {
        a.click();
        if (statusEl) statusEl.innerText = "Download triggered.";
    } catch (e) {
        console.error("Browser download failed", e);
        if (statusEl) statusEl.innerText = "Download failed. Try right-click save.";
    }
    
    setTimeout(() => {
        document.body.removeChild(a);
    }, 100);
}

if (galleryClearAllBtn) {
    galleryClearAllBtn.addEventListener('click', async () => {
        if (await showCustomConfirm("Are you sure you want to clear all images from the gallery?")) {
            await clearGallery();
            renderGalleryModal();
        }
    });
}

if (openGalleryBtn) {
    openGalleryBtn.addEventListener('click', () => {
        renderGalleryModal();
        galleryModal?.classList.remove('hidden');
    });
}

if (closeGalleryModalBtn) {
    closeGalleryModalBtn.addEventListener('click', () => {
        galleryModal?.classList.add('hidden');
    });
}

// Close modal on outside click
galleryModal?.addEventListener('click', (e) => {
    if (e.target === galleryModal) closeGalleryModalBtn?.click();
});

// Startup Cleanup
cleanupGallery();

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
    try {
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
            if (zoomGenerateBtn) {
                 zoomGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                 zoomGenerateBtn.classList.remove('bg-red-600'); zoomGenerateBtn.classList.add('bg-[#262380]');
            }
            if(statusEl) statusEl.innerText = "Generation Stopped"; 
            return;
        }

        if (!uploadedImageData && !promptEl.value.trim()) { 
            showCustomAlert("Please enter a prompt or upload an image first.", "Input Required"); 
            return; 
        }
        
        // 1. Check for API Key FIRST to avoid exception
        // We assume process.env.API_KEY is available (injected by environment or browser context)
        // If empty, the SDK call will fail naturally or be caught.

        // --- AUTOMATIC MODEL SELECTION & TIER CHECK ---
        // Refresh from storage
        manualApiKey = localStorage.getItem('manualApiKey') || '';
        
        // Check AI Studio status
        let hasSelected = false;
        if (typeof window.aistudio !== 'undefined' && window.aistudio.hasSelectedApiKey) {
            hasSelected = await window.aistudio.hasSelectedApiKey();
        }

        // Pro status if manual key OR AI Studio key
        let isPro = !!(manualApiKey && manualApiKey.length > 10) || hasSelected;
        
        // Update Badge UI just in case it wasn't refreshed
        updateAccountStatusUI();

        let modelId = '';
        // Config for image generation
        let imageConfig: any = { 
            aspectRatio: sizeSelect.value || '1:1' 
        };

        // --- MANUAL MODEL SELECTION ---
        const modelSelect = document.querySelector('#model-select') as HTMLSelectElement;
        const selectedModel = modelSelect?.value || 'gemini-3-pro-image-preview';

        modelId = selectedModel;
        
        // If Pro model selected, enforce Pro checks
        if (modelId === 'gemini-3-pro-image-preview') {
             if (!isPro) {
                 console.warn("User selected Pro model but no valid Pro key detected. Attempting anyway (will fallback if fails).");
             }
             imageConfig.imageSize = selectedResolution;
             if(statusEl) statusEl.innerText = `Generating with GEMINI 3 PRO (${selectedResolution})...`;
        } else if (modelId === 'gemini-3.1-flash-image-preview') {
             // BANANA PRO
             imageConfig.imageSize = selectedResolution;
             if(statusEl) statusEl.innerText = `Generating with BANANA PRO (${selectedResolution})...`;
        } else if (modelId.startsWith('imagen')) {
             // Imagen 4
             delete imageConfig.imageSize;
             if(statusEl) statusEl.innerText = "Generating with Imagen 4...";
        } else {
             // Fallback
             delete imageConfig.imageSize;
             if(statusEl) statusEl.innerText = "Generating...";
        }

        isGenerating = true; abortController = new AbortController(); 
        generateButton.classList.remove('bg-[#262380]'); generateButton.classList.add('bg-red-600');
        generateLabel.innerText = "STOP GENERATING (0%)";
        if (miniGenerateBtn) {
            miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>`;
            miniGenerateBtn.classList.remove('bg-[#262380]'); miniGenerateBtn.classList.add('bg-red-600');
        }
        if (zoomGenerateBtn) {
            zoomGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>`;
            zoomGenerateBtn.classList.remove('bg-[#262380]'); zoomGenerateBtn.classList.add('bg-red-600');
        }
        generateProgress.style.width = '0%'; let progressVal = 0;
        
        // Start Progress Interval
        currentProgressInterval = setInterval(() => {
            progressVal += 1; 
            if(progressVal > 95) progressVal = 95;
            generateProgress.style.width = `${progressVal}%`; 
            generateLabel.innerText = `STOP GENERATING (${progressVal}%)`;
            if (statusEl) statusEl.innerText = `Generating... ${progressVal}%`;
        }, 100);

        try {
            // Updated Logic: Combine text box value with loaded file content (if any)
            const getCombinedText = (elId: string, fileKey: string) => {
                const elVal = (document.getElementById(elId) as HTMLTextAreaElement)?.value || '';
                const fileVal = loadedFilesContent[fileKey] || '';
                // If both exist, join them. If one exists, use it.
                return [elVal, fileVal].filter(Boolean).join('\n').trim();
            };

            const p = getCombinedText('prompt-manual', 'prompt-manual');
            const l = getCombinedText('lighting-manual', 'lighting-manual');
            const s = getCombinedText('scene-manual', 'scene-manual');
            const v = getCombinedText('view-manual', 'view-manual');
            const i = inpaintingPromptToggle.checked ? inpaintingPromptText.value : '';
            const maskBase64 = getMaskBase64();
            
            // Build a professional architectural visualization prompt
            let fullPrompt = `[ARCHITECTURAL VISUALIZATION TASK]\n`;
            fullPrompt += `Goal: Transform the provided sketch/image into a high-end, photorealistic 3D architectural render.\n`;
            fullPrompt += `Main Description: ${p || 'Architectural space'}\n`;
            if (l) fullPrompt += `Lighting: ${l}\n`;
            if (s) fullPrompt += `Scene Context: ${s}\n`;
            if (v) fullPrompt += `Camera View: ${v}\n`;
            if (i) fullPrompt += `Specific Edit Instructions: ${i}\n`;
            if (cameraProjectionEnabled) fullPrompt += `Correction: Apply Camera Projection correction for accurate perspective.\n`;

            // Enhanced Reference Image Logic for Material Mapping
            if (referenceImages.length > 0) {
                fullPrompt += `\n\n[MATERIAL & TEXTURE REFERENCE SYSTEM - CRITICAL]
I have provided ${referenceImages.length} reference images. These images serve as the "Material Palette" or "Legend" for this project.
1. ANALYZE REFERENCES: Look for codes such as MS1, MS2, MS3, MS4, MS5, MS6, etc., in the reference images. Each code represents a specific material, texture, or color sample.
2. IDENTIFY MAPPING: In the main image (the sketch or line drawing), you will find these same codes (MS1, MS2, etc.) labeled on various surfaces (walls, furniture, flooring, etc.).
3. EXECUTION: You MUST apply the material from the reference sample to the corresponding area in the sketch based on the matching code. 
   - Example: If MS1 in the reference is a specific wood grain, all areas marked MS1 in the sketch must be rendered with that exact wood grain.
4. CONSISTENCY: Ensure the materials are rendered with realistic physical properties (reflectivity, roughness, bump) as suggested by the reference samples.`;
            }

            if (maskBase64 && uploadedImageData) {
                fullPrompt += `\n\n[INPAINTING MODE]
The provided black and white mask defines the modification area:
- WHITE pixels: Generate new content based on the prompt and references.
- BLACK pixels: Preserve the original image content EXACTLY. Do not re-render or change anything in the black areas.`;
            }

            const parts: any[] = [];
            referenceImages.forEach(ref => { parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } }); });
            if (uploadedImageData) {
                parts.push({ inlineData: { mimeType: uploadedImageData.mimeType, data: uploadedImageData.data } });
            }
            
            if (maskBase64 && uploadedImageData) {
                parts.push({ inlineData: { mimeType: 'image/png', data: maskBase64 } });
            }
            
            parts.push({ text: fullPrompt });

            // Use local Helper (SDK Client)
            // FIX: Prioritize AI Studio Selected Key over Manual Key if it exists
            let finalApiKey = manualApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
            
            if (typeof window.aistudio !== 'undefined' && window.aistudio.hasSelectedApiKey) {
                const hasSelected = await window.aistudio.hasSelectedApiKey();
                if (hasSelected && process.env.API_KEY) {
                    console.log("Using AI Studio Selected Key");
                    finalApiKey = process.env.API_KEY;
                }
            }

            if (!finalApiKey) {
                showCustomAlert("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Account (Badge FREE/PRO) hoặc đăng nhập vào AI Studio.", "API Key Missing");
                throw new Error("No API Key found");
            }
            
            const ai = new GoogleGenAI({ apiKey: finalApiKey });

            const processResults = async (results: any[]) => {
                  generatedImages = []; // Clear previous
                  for (const result of results) {
                    // Handle both GenerateContentResponse (Gemini) and GenerateImagesResponse (Imagen)
                    if (result.candidates) {
                        // Gemini Format
                        const cand = result.candidates?.[0];
                        if (cand) {
                            for (const part of cand.content.parts) {
                                if (part.inlineData) {
                                    const promptData: PromptData = { mega: p, lighting: l, scene: s, view: v, inpaint: i, inpaintEnabled: inpaintingPromptToggle.checked, cameraProjection: cameraProjectionEnabled };
                                    try {
                                        let pngBase64 = await convertToPngBase64(part.inlineData.data, part.inlineData.mimeType);
                                        
                                        // If inpainting with a mask, composite the result with the original image
                                        if (maskBase64 && uploadedImageData) {
                                            try {
                                                pngBase64 = await compositeInpaint(uploadedImageData.data, pngBase64, maskBase64);
                                            } catch (compErr) {
                                                console.error("Compositing error", compErr);
                                            }
                                        }

                                        const finalBase64 = await embedMetadata(pngBase64, promptData);
                                        const src = `data:image/png;base64,${finalBase64}`;
                                        generatedImages.push(src);
                                        addToHistory(src, promptData);
                                    } catch (err) {
                                        console.error("Image processing error", err);
                                        const src = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                                        generatedImages.push(src);
                                    }
                                }
                            }
                        }
                    } else if (result.generatedImages) {
                        // Imagen Format
                        for (const img of result.generatedImages) {
                            const promptData: PromptData = { mega: p, lighting: l, scene: s, view: v, inpaint: i, inpaintEnabled: inpaintingPromptToggle.checked, cameraProjection: cameraProjectionEnabled };
                            try {
                                let pngBase64 = await convertToPngBase64(img.image.imageBytes, img.image.mimeType || 'image/png');
                                
                                if (maskBase64 && uploadedImageData) {
                                    try {
                                        pngBase64 = await compositeInpaint(uploadedImageData.data, pngBase64, maskBase64);
                                    } catch (compErr) {
                                        console.error("Compositing error", compErr);
                                    }
                                }

                                const finalBase64 = await embedMetadata(pngBase64, promptData);
                                const src = `data:image/png;base64,${finalBase64}`;
                                generatedImages.push(src);
                                addToHistory(src, promptData);
                            } catch (err) {
                                console.error("Imagen processing error", err);
                                const src = `data:${img.image.mimeType || 'image/png'};base64,${img.image.imageBytes}`;
                                generatedImages.push(src);
                            }
                        }
                    }
                  }
                if (generatedImages.length > 0) {
                    outputContainer.classList.remove('hidden');
                    showImage(0);
                }
            };

            try {
                // 1. Hàm tạo thời gian nghỉ (Sleep) để chống lỗi 429
                const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                // 2. Chạy vòng lặp tuần tự thay vì song song
                const results = [];
                for (let k = 0; k < imageCount; k++) {
                    if (!abortController || abortController.signal.aborted) break;

                    if(statusEl) statusEl.innerText = `Đang tạo ảnh ${k + 1} / ${imageCount}...`;

                    try {
                        // Gọi API tạo từng ảnh một với cơ chế Retry cho lỗi 500 (Internal Server Error)
                        let result = null;
                        let retries = 0;
                        const maxRetries = 2;
                        
                        while (retries <= maxRetries) {
                            try {
                                if (modelId.startsWith('imagen')) {
                                    result = await ai.models.generateImages({
                                        model: modelId,
                                        prompt: fullPrompt,
                                        config: {
                                            numberOfImages: 1,
                                            aspectRatio: imageConfig.aspectRatio,
                                            outputMimeType: 'image/png'
                                        }
                                    });
                                } else {
                                    result = await ai.models.generateContent({ 
                                        model: modelId, 
                                        contents: { parts: parts }, 
                                        config: { imageConfig: imageConfig } 
                                    });
                                }
                                break; // Thành công thì thoát vòng lặp retry
                            } catch (retryErr: any) {
                                const errStr = retryErr.message || JSON.stringify(retryErr);
                                const is500 = errStr.includes("500") || errStr.includes("Internal Server Error");
                                const is503 = errStr.includes("503") || errStr.includes("Service Unavailable") || errStr.includes("high demand");
                                
                                if ((is500 || is503) && retries < maxRetries) {
                                    retries++;
                                    if(statusEl) statusEl.innerText = `Lỗi Server (${is503 ? '503' : '500'}). Đang thử lại ${retries}/${maxRetries} (chờ 5s)...`;
                                    await sleep(5000);
                                    continue;
                                }
                                throw retryErr; // Nếu không phải lỗi 500 hoặc hết lượt retry thì quăng lỗi ra ngoài
                            }
                        }

                        if (result) results.push(result);

                        // Update Cost (Vertex AI / Tier 1 Pricing)
                        // Estimate: Pro (Ultra) = $0.012, BANANA PRO = $0.003, Banana Free (Flash) = $0.0007
                        let costPerImg = 0.0007;
                        if (modelId.includes('pro') || modelId.includes('imagen')) costPerImg = 0.012;
                        else if (modelId.includes('3.1-flash')) costPerImg = 0.003;
                        
                        // Only track cost if using a Pro/Ultra tier (Tier 1 Billing)
                        if (isPro) updateImageCountDisplay(1);

                        // Nếu tạo thành công 1 ảnh, cập nhật thanh tiến trình thật
                        const realProgress = Math.floor(((k + 1) / imageCount) * 95);
                        generateProgress.style.width = `${realProgress}%`;
                        generateLabel.innerText = `STOP GENERATING (${realProgress}%)`;

                        // NGHỈ 4 GIÂY GIỮA CÁC LẦN GỌI ĐỂ BẢO VỆ API KEY (Trừ ảnh cuối cùng)
                        if (k < imageCount - 1) {
                            if(statusEl) statusEl.innerText = `Đang làm mát API (chờ 4 giây)...`;
                            await sleep(4000); 
                        }

                    } catch (imgErr: any) {
                        const errMsg = imgErr.message || JSON.stringify(imgErr);

                        // Rethrow 403/404 to trigger outer fallback logic
                        if (errMsg.includes("403") || errMsg.includes("404") || errMsg.includes("PERMISSION_DENIED")) {
                            // Suppress console error for expected 403s that we handle
                            // console.warn("Permission denied (403), triggering fallback...");
                            throw new Error("403 PERMISSION_DENIED");
                        }
                        
                        console.error(`Lỗi ở ảnh thứ ${k + 1}:`, imgErr);

                        // Nếu bị lỗi ở 1 ảnh, báo lỗi nhưng KHÔNG làm sập toàn bộ app
                        if (errMsg.includes("429")) {
                            showCustomAlert(`Đã chạm trần giới hạn API ở ảnh thứ ${k + 1}. Đang dừng lại để bảo vệ tài khoản.`, "API Limit Reached");
                            break; // Dừng vòng lặp ngay lập tức
                        }
                        
                        // Throw other errors to outer catch
                        throw imgErr;
                    }
                }
                
                if (!abortController || abortController.signal.aborted) return;
                
                // Stop fake progress and set to 100%
                clearInterval(currentProgressInterval);
                generateProgress.style.width = '100%'; 
                generateLabel.innerText = "STOP GENERATING (100%)";

                await processResults(results);

            } catch (e: any) {
                const errStr = e.message || JSON.stringify(e);
                
                // Handle "Requested entity was not found" by prompting for key selection
                if (errStr.includes("Requested entity was not found") && typeof window.aistudio !== 'undefined' && window.aistudio.openSelectKey) {
                    console.warn("Requested entity not found. Prompting for key selection.");
                    if(statusEl) statusEl.innerText = "Lỗi API: Không tìm thấy thực thể. Vui lòng chọn lại Key...";
                    await window.aistudio.openSelectKey();
                    // After opening key selection, we can't easily resume this specific generation, 
                    // but we've fulfilled the requirement to prompt the user.
                    throw e; 
                }

                // FALLBACK LOGIC for Paid Models (Pro, BANANA PRO, and Imagen 4) 403/404
                const isPaidModel = modelId === 'gemini-3-pro-image-preview' || 
                                   modelId === 'gemini-3.1-flash-image-preview' || 
                                   modelId.startsWith('imagen');
                if ((errStr.includes("403") || errStr.includes("404") || errStr.includes("PERMISSION_DENIED")) && isPaidModel) {
                     
                     // If manually selected, we still fallback but notify user
                     if (selectedModel === modelId) {
                         console.warn(`Manual ${modelId} selection failed (403). Falling back to Flash.`);
                         // Non-blocking notification via status text instead of Alert
                         if(statusEl) statusEl.innerText = "Lỗi quyền API (403). Đang chuyển sang Flash (1K)...";
                     } else {
                         console.warn(`Auto ${modelId} selection failed (403). Falling back to Flash.`);
                         if(statusEl) statusEl.innerText = "Paid Model failed. Falling back to Flash (1K)...";
                     }
                     
                     // If in AI Studio and it's a 403, it's likely a key selection/billing issue
                     if ((errStr.includes("403") || errStr.includes("PERMISSION_DENIED")) && typeof window.aistudio !== 'undefined' && window.aistudio.openSelectKey) {
                         console.warn("Permission denied. Offering to open key selection.");
                         const confirmed = await showCustomConfirm(
                             "Lỗi 403: Bạn không có quyền sử dụng Model này. Điều này thường do API Key chưa được kích hoạt thanh toán hoặc chưa được chọn đúng trong AI Studio. Bạn có muốn chọn lại API Key ngay bây giờ không?", 
                             "Permission Error"
                         );
                         if (confirmed) {
                             await window.aistudio.openSelectKey();
                             // Reset UI state before returning
                             return; 
                         }
                     }
                     
                     try {
                         const fallbackModelId = 'gemini-2.5-flash-image';
                         const fallbackConfig = { ...imageConfig };
                         delete fallbackConfig.imageSize; // Flash doesn't support imageSize
                         
                         // Use sequential loop for fallback too
                         const fallbackResults = [];
                         for (let k = 0; k < imageCount; k++) {
                            if (!abortController || abortController.signal.aborted) break;
                            
                            fallbackResults.push(await ai.models.generateContent({ 
                                model: fallbackModelId, 
                                contents: { parts: parts }, 
                                config: { imageConfig: fallbackConfig } 
                            }));
                            
                            // Update Cost for Fallback (Flash)
                            updateImageCountDisplay(1);
                         }
                         
                         if (!abortController || abortController.signal.aborted) return;

                         clearInterval(currentProgressInterval); 
                         generateProgress.style.width = '100%'; 
                         generateLabel.innerText = "STOP GENERATING (100%)";
                         
                         await processResults(fallbackResults);
                         
                         showCustomAlert("Lưu ý: API Key của bạn không hỗ trợ Model Pro/High Quality (2K/4K) hoặc Model chưa được kích hoạt. Hệ thống đã tự động chuyển về Model Flash (1K).", "Model Downgrade");
                         return; // Success after fallback

                     } catch (fallbackErr: any) {
                         console.error("Fallback failed", fallbackErr);
                         throw fallbackErr; // Throw to outer catch to handle generic error
                     }
                }
                throw e; // Re-throw if not handled by fallback
            }
        } catch (e: any) { 
            if (!abortController?.signal.aborted) { 
                console.error(e); 
                if(statusEl) statusEl.innerText = "Error encountered"; 
                if (e.message.includes("429")) {
                    showCustomAlert("API Quota exceeded. Please try again later.", "Quota Exceeded");
                } else if (e.message.includes("401") || e.message.includes("403")) {
                    showCustomAlert(`API Error: ${e.message}. Check your API Key and billing.`, "API Error");
                } else {
                    showCustomAlert(`Generation failed: ${e.message}`, "Generation Error");
                }
            }
        }
    } finally {
        // CRITICAL FIX: Ensure cleanup runs regardless of success or error
        clearInterval(currentProgressInterval);
        
        // Always reset UI state to be safe
        setTimeout(() => {
            isGenerating = false; 
            generateProgress.style.width = '0%';
            generateButton.classList.remove('bg-red-600'); 
            generateButton.classList.add('bg-[#262380]');
            generateLabel.innerText = "GENERATE (PROCESS)";
            
            if (miniGenerateBtn) {
                 miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                 miniGenerateBtn.classList.remove('bg-red-600'); 
                 miniGenerateBtn.classList.add('bg-[#262380]');
            }
            if (zoomGenerateBtn) {
                 zoomGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                 zoomGenerateBtn.classList.remove('bg-red-600'); 
                 zoomGenerateBtn.classList.add('bg-[#262380]');
            }
            
            if(statusEl && !abortController?.signal.aborted) {
                statusEl.innerText = "System Standby"; 
            } else if (statusEl && abortController?.signal.aborted) {
                statusEl.innerText = "Generation Stopped";
            }
            
            abortController = null;
        }, 300); 
    }
}

generateButton?.addEventListener('click', runGeneration);
miniGenerateBtn?.addEventListener('click', runGeneration);
zoomGenerateBtn?.addEventListener('click', runGeneration);

function showImage(index: number) {
    if (index < 0 || index >= generatedImages.length) return;
    currentImageIndex = index;
    outputImage.src = generatedImages[index];
    updateComparisonImages();
    
    // If zoom is open, update zoomed image too
    if (!zoomOverlay.classList.contains('hidden')) {
        zoomedImage.src = generatedImages[index];
        // @ts-ignore
        if (typeof updateZoomNavigation === 'function') updateZoomNavigation();
    }

    // Update Badge
    if (imageCounterBadge) {
        imageCounterBadge.innerText = `${currentImageIndex + 1} / ${generatedImages.length}`;
        if (generatedImages.length > 1) imageCounterBadge.classList.remove('hidden');
        else imageCounterBadge.classList.add('hidden');
    }

    // Update Buttons
    if (prevImageBtn) {
        if (currentImageIndex > 0) prevImageBtn.classList.remove('hidden');
        else prevImageBtn.classList.add('hidden');
    }
    if (nextImageBtn) {
        if (currentImageIndex < generatedImages.length - 1) nextImageBtn.classList.remove('hidden');
        else nextImageBtn.classList.add('hidden');
    }
}

if (prevImageBtn) prevImageBtn.addEventListener('click', () => showImage(currentImageIndex - 1));
if (nextImageBtn) nextImageBtn.addEventListener('click', () => showImage(currentImageIndex + 1));

closeOutputBtn?.addEventListener('click', () => { outputContainer.classList.add('hidden'); });
downloadButtonMain?.addEventListener('click', () => { if (outputImage.src) { const a = document.createElement('a'); a.href = outputImage.src; a.download = `banana-pro-${Date.now()}.png`; a.click(); } });

downloadUploadBtn?.addEventListener('click', async () => {
    if (!uploadPreview.src) return;
    
    try {
        const canvas = document.createElement('canvas');
        canvas.width = uploadPreview.naturalWidth;
        canvas.height = uploadPreview.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Draw background (white if transparent)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.drawImage(uploadPreview, 0, 0);
        
        // Draw mask/drawing
        if (guideCanvas) {
            ctx.drawImage(guideCanvas, 0, 0);
        }
        
        if (maskCanvas) {
            ctx.globalAlpha = 0.9;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(maskCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }
        
        // Draw text
        if (mainTextCanvas) {
            ctx.drawImage(mainTextCanvas, 0, 0);
        }
        
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        
        const promptData: PromptData = {
            mega: (document.getElementById('prompt-manual') as HTMLTextAreaElement).value || '',
            lighting: (document.getElementById('lighting-manual') as HTMLTextAreaElement).value || '',
            scene: (document.getElementById('scene-manual') as HTMLTextAreaElement).value || '',
            view: (document.getElementById('view-manual') as HTMLTextAreaElement).value || '',
            inpaint: (document.getElementById('inpainting-prompt-text') as HTMLTextAreaElement).value || '',
            inpaintEnabled: (document.getElementById('inpainting-prompt-toggle') as HTMLInputElement).checked || false,
            cameraProjection: (document.getElementById('camera-projection-toggle') as HTMLInputElement).checked || false
        };
        
        const finalBase64 = await embedMetadata(base64, promptData);
        const finalDataUrl = 'data:image/png;base64,' + finalBase64;
        
        const a = document.createElement('a');
        a.href = finalDataUrl;
        a.download = `banana-edit-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        const originalContent = downloadUploadBtn.innerHTML;
        downloadUploadBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
        downloadUploadBtn.style.color = '#4ade80';
        setTimeout(() => {
            downloadUploadBtn.innerHTML = originalContent;
            downloadUploadBtn.style.color = '';
        }, 2000);
    } catch (err) {
        console.error('Failed to download image: ', err);
    }
});

async function copyUploadedImageToClipboard() {
    if (!uploadPreview.src) return;
    
    try {
        const canvas = document.createElement('canvas');
        canvas.width = uploadPreview.naturalWidth;
        canvas.height = uploadPreview.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        // Draw background (white if transparent)
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.drawImage(uploadPreview, 0, 0);
        
        // Draw mask/drawing
        if (guideCanvas) {
            ctx.drawImage(guideCanvas, 0, 0);
        }
        
        if (maskCanvas) {
            ctx.globalAlpha = 0.9;
            ctx.globalCompositeOperation = 'screen';
            ctx.drawImage(maskCanvas, 0, 0);
            ctx.globalAlpha = 1.0;
            ctx.globalCompositeOperation = 'source-over';
        }
        
        // Draw text
        if (mainTextCanvas) {
            ctx.drawImage(mainTextCanvas, 0, 0);
        }
        
        canvas.toBlob(async (blob) => {
            if (blob) {
                try {
                    await navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': blob })
                    ]);
                    // Visual feedback
                    if (statusEl) {
                        const originalText = statusEl.innerText;
                        statusEl.innerText = "Copied to Clipboard!";
                        statusEl.style.color = "#4ade80";
                        setTimeout(() => {
                            statusEl.innerText = originalText;
                            statusEl.style.color = "";
                        }, 2000);
                    }
                } catch (err) {
                    console.error('Failed to copy image: ', err);
                    if (statusEl) statusEl.innerText = "Copy Failed";
                }
            }
        }, 'image/png');
    } catch (err) {
        console.error('Failed to capture image for copy: ', err);
    }
}

globalResetBtn?.addEventListener('click', () => {
    // 1. Reset Text Inputs
    if(promptEl) promptEl.value = ''; 
    manualCtxEntries.forEach(e => { e.value = ''; autoResize(e); });
    
    // 2. Clear Loaded Files Logic (but keep image inputs clean)
    document.querySelectorAll('.file-display-slot').forEach(slot => {
        const input = slot.querySelector('input[type="file"]') as HTMLInputElement;
        if(input) input.value = '';
        
        const info = slot.querySelector('.loaded-file-info');
        const status = slot.querySelector('.file-status');
        
        if(info) info.classList.add('hidden');
        if(status) status.classList.remove('hidden');
        slot.classList.remove('border-[#262380]/40', 'bg-[#262380]/5');
    });
    
    // 3. Clear Internal File Content Memory
    for (const key in loadedFilesContent) {
        loadedFilesContent[key] = '';
    }

    // 4. Reset Inpainting Text
    inpaintingPromptText.value = ''; 
    inpaintingPromptText.classList.add('hidden'); 
    inpaintingPromptToggle.checked = false;

    // 5. Reset References
    referenceImages = []; 
    renderRefs();

    // 6. Reset Text Elements
    textElements = [];
    redrawText();
    saveCanvasHistory();

    // NOTE: Intentionally NOT calling resetImage() to keep the uploaded image/mask active.
    if(statusEl) statusEl.innerText = "Text/Settings Reset (Image Kept)";
});

if (modalCopyBtn) {
    modalCopyBtn.addEventListener('click', async () => {
        if (customPasteTextarea && customPasteTextarea.value) {
            await copyToClipboard(customPasteTextarea.value);
        }
    });
}
if (copyAllBtn) {
    copyAllBtn.addEventListener('click', async () => {
        const allManualEntries = document.querySelectorAll('.manual-ctx-entry') as NodeListOf<HTMLTextAreaElement>;
        let allText = '';
        allManualEntries.forEach(el => {
            if (el.value) {
                allText += el.value + '\n\n';
            }
        });
        if (allText) {
            copyAllBtn.classList.add('pulse-ring');
            
            const success = await copyToClipboard(allText.trim());
            
            copyAllBtn.classList.remove('pulse-ring');
            
            if (success) {
                const originalContent = copyAllBtn.innerHTML;
                copyAllBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg><span class="text-[8px] font-black uppercase tracking-widest">OK</span>';
                copyAllBtn.style.color = '#4ade80';
                copyAllBtn.style.borderColor = '#4ade80';
                setTimeout(() => {
                    copyAllBtn.innerHTML = originalContent;
                    copyAllBtn.style.color = '';
                    copyAllBtn.style.borderColor = '';
                }, 1000);
            }
        }
    });
}

// --- Toolbar Buttons Wiring ---

if (clearMaskBtn) clearMaskBtn.addEventListener('click', () => { 
    ctx?.clearRect(0, 0, maskCanvas.width, maskCanvas.height); 
    zoomCtx?.clearRect(0, 0, zoomMaskCanvas.width, zoomMaskCanvas.height); 
    
    // Save history after clear
    saveCanvasHistory();
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
        
        resetDraggable();

        if (btn.id.includes('select')) {
            activeTool = 'select';
            updateBrushSizeVisibility();
            if (brushCursor) brushCursor.classList.add('hidden');
            uploadPreview.draggable = true;
            if (outputImage) outputImage.draggable = true;
            if (zoomedImage) {
                zoomedImage.draggable = true;
                zoomedImage.style.pointerEvents = 'auto';
            }
            canvasContainer.classList.add('select-mode');
            if (zoomOverlay) zoomOverlay.classList.add('select-mode');
            if (maskCanvas) maskCanvas.style.pointerEvents = 'none';
            if (zoomMaskCanvas) zoomMaskCanvas.style.pointerEvents = 'none';
        }
        else if (btn.id.includes('brush')) { activeTool = 'brush'; updateBrushSizeVisibility(); }
        else if (btn.id.includes('rect')) { activeTool = 'rect'; updateBrushSizeVisibility(); }
        else if (btn.id.includes('ellipse')) { activeTool = 'ellipse'; updateBrushSizeVisibility(); }
        else if (btn.id.includes('lasso')) { activeTool = 'lasso'; updateBrushSizeVisibility(); }
        else if (btn.id.includes('polygon')) {
            activeTool = 'polygon';
            updateBrushSizeVisibility();
            polygonPoints = [];
            isDrawingPolygon = false;
        }
        else if (btn.id.includes('arrow')) { activeTool = 'arrow'; updateBrushSizeVisibility(); }
        else if (btn.id.includes('eraser')) { activeTool = 'eraser'; updateBrushSizeVisibility(); }
        
        if (isAddingTextMode) toggleAddingTextMode(false);
        if (isTextEraserMode) toggleTextEraserMode(false);
        
        if(brushCursor && activeTool !== 'select') {
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
// --- Comparison Event Listeners ---
let comparisonZoom = 1;
let comparisonOffsetX = 0;
let comparisonOffsetY = 0;
let isComparePanning = false;
let compareStartX = 0;
let compareStartY = 0;

if (compareToggleBtn) {
    compareToggleBtn.addEventListener('click', () => {
        isComparisonMode = !isComparisonMode;
        if (isComparisonMode) {
            updateComparisonImages();
            comparisonContainer.classList.remove('hidden');
            outputContainer.classList.add('hidden');
            compareToggleBtn.classList.add('bg-[#262380]');
            compareToggleBtn.classList.remove('bg-white/5');
            // Reset zoom/pan on open
            comparisonZoom = 1;
            comparisonOffsetX = 0;
            comparisonOffsetY = 0;
            updateComparisonTransform();
        } else {
            comparisonContainer.classList.add('hidden');
            outputContainer.classList.remove('hidden');
            compareToggleBtn.classList.remove('bg-[#262380]');
            compareToggleBtn.classList.add('bg-white/5');
        }
    });
}

function updateComparisonTransform() {
    const transform = `translate(${comparisonOffsetX}px, ${comparisonOffsetY}px) scale(${comparisonZoom})`;
    compareImg1.style.transform = transform;
    compareImg2.style.transform = transform;
}

comparisonContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    comparisonZoom = Math.min(Math.max(comparisonZoom * delta, 1), 5);
    updateComparisonTransform();
}, { passive: false });

comparisonContainer.addEventListener('mousedown', (e) => {
    if (e.button === 1) { // Middle mouse button
        isComparePanning = true;
        compareStartX = e.clientX - comparisonOffsetX;
        compareStartY = e.clientY - comparisonOffsetY;
        comparisonContainer.style.cursor = 'grabbing';
    }
});

window.addEventListener('mousemove', (e) => {
    if (isComparePanning) {
        comparisonOffsetX = e.clientX - compareStartX;
        comparisonOffsetY = e.clientY - compareStartY;
        updateComparisonTransform();
    }
});

window.addEventListener('mouseup', () => {
    isComparePanning = false;
    comparisonContainer.style.cursor = 'default';
});

if (compareSlider) {
    compareSlider.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        compareImg2Wrapper.style.width = `${value}%`;
        const handle = document.getElementById('compare-slider-handle');
        if (handle) handle.style.left = `${value}%`;
    });
}

if (zoomBrushSizeSlider) {
    zoomBrushSizeSlider.addEventListener('input', () => {
        brushSlider.value = zoomBrushSizeSlider.value;
        brushSlider.dispatchEvent(new Event('input'));
    });
}

// --- Collage Extract Logic ---
if (collageExtractToggle && collageExtractControls) {
    collageExtractToggle.addEventListener('change', () => {
        if (collageExtractToggle.checked) {
            collageExtractControls.classList.remove('hidden');
        } else {
            collageExtractControls.classList.add('hidden');
        }
    });
}

if (collagePositionSelect) {
    collagePositionSelect.addEventListener('change', () => {
        const targetPosition = collagePositionSelect.value;
        const finalPrompt = COLLAGE_EXTRACT_PROMPT_TEMPLATE.replace('[ TARGET POSITION ]', targetPosition);
        const viewManual = document.getElementById('view-manual') as HTMLTextAreaElement;
        if (viewManual) {
            viewManual.value = finalPrompt;
            
            // Maintain current state: only auto-resize if NOT collapsed
            const isCollapsed = viewManual.classList.contains('h-[40px]');
            if (!isCollapsed) {
                // Trigger auto-resize if the function exists
                // @ts-ignore
                if (typeof autoResize === 'function') autoResize(viewManual);
            }
        }
    });
}

// --- Viewport Toggle Logic ---
const toggleViewManualBtn = document.getElementById('toggle-view-manual');
const expandIcon = document.getElementById('expand-icon');
const collapseIcon = document.getElementById('collapse-icon');
const viewManualArea = document.getElementById('view-manual') as HTMLTextAreaElement;

if (toggleViewManualBtn && viewManualArea && expandIcon && collapseIcon) {
    toggleViewManualBtn.addEventListener('click', () => {
        // Check if it's currently collapsed (either by class or by explicit height)
        const isCollapsed = viewManualArea.classList.contains('h-[40px]') || viewManualArea.style.height === '40px';
        
        if (isCollapsed) {
            // Expand
            viewManualArea.classList.remove('h-[40px]', 'overflow-hidden');
            viewManualArea.classList.add('h-full', 'min-h-[140px]');
            viewManualArea.style.height = ''; // Clear inline height to allow auto-resize
            expandIcon.classList.add('hidden');
            collapseIcon.classList.remove('hidden');
            // @ts-ignore
            if (typeof autoResize === 'function') autoResize(viewManualArea);
        } else {
            // Collapse
            viewManualArea.classList.add('h-[40px]', 'overflow-hidden');
            viewManualArea.classList.remove('h-full', 'min-h-[140px]');
            viewManualArea.style.height = '40px'; // Force collapsed height
            expandIcon.classList.remove('hidden');
            collapseIcon.classList.add('hidden');
        }
    });
}

if (extractViewBtn) {
    extractViewBtn.addEventListener('click', runCollageExtraction);
}

async function runCollageExtraction() {
    if (!uploadedImageData) {
        showCustomAlert("Vui lòng tải lên ảnh ghép (collage) trước.", "Image Required");
        return;
    }

    if (isGenerating) return;

    try {
        // Refresh API Key
        manualApiKey = localStorage.getItem('manualApiKey') || '';
        let hasSelected = false;
        if (typeof window.aistudio !== 'undefined' && window.aistudio.hasSelectedApiKey) {
            hasSelected = await window.aistudio.hasSelectedApiKey();
        }
        let finalApiKey = manualApiKey || process.env.API_KEY || process.env.GEMINI_API_KEY;
        if (hasSelected && process.env.API_KEY) finalApiKey = process.env.API_KEY;

        if (!finalApiKey) {
            showCustomAlert("Không tìm thấy API Key. Vui lòng nhập API Key trong phần Account.", "API Key Missing");
            return;
        }

        const targetPosition = collagePositionSelect.value;
        const finalPrompt = COLLAGE_EXTRACT_PROMPT_TEMPLATE.replace('[ TARGET POSITION ]', targetPosition);

        isGenerating = true;
        extractViewBtn.disabled = true;
        extractViewBtn.innerText = "EXTRACTING...";
        
        // Sync with main Generate button UI
        generateButton.classList.remove('bg-[#262380]');
        generateButton.classList.add('bg-red-600');
        generateLabel.innerText = "EXTRACTING (0%)";
        if (miniGenerateBtn) {
            miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>`;
            miniGenerateBtn.classList.remove('bg-[#262380]');
            miniGenerateBtn.classList.add('bg-red-600');
        }
        if (zoomGenerateBtn) {
            zoomGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" /></svg>`;
            zoomGenerateBtn.classList.remove('bg-[#262380]');
            zoomGenerateBtn.classList.add('bg-red-600');
        }

        if(statusEl) statusEl.innerText = `Đang trích xuất khung hình ${targetPosition}...`;

        // Start progress bar
        generateProgress.style.width = '0%';
        let progress = 0;
        const progressInterval = setInterval(() => {
            progress += 2;
            if (progress > 90) progress = 90;
            generateProgress.style.width = `${progress}%`;
            generateLabel.innerText = `EXTRACTING (${progress}%)`;
        }, 100);

        const ai = new GoogleGenAI({ apiKey: finalApiKey });
        // Use gemini-3.1-flash-image-preview for extraction as it's fast and supports image output
        const modelId = 'gemini-3.1-flash-image-preview';

        const result = await ai.models.generateContent({
            model: modelId,
            contents: {
                parts: [
                    { inlineData: { mimeType: uploadedImageData.mimeType, data: uploadedImageData.data } },
                    { text: finalPrompt }
                ]
            },
            config: {
                imageConfig: {
                    imageSize: selectedResolution || '1K',
                    aspectRatio: sizeSelect.value || '1:1'
                }
            }
        });

        clearInterval(progressInterval);
        generateProgress.style.width = '100%';

        const cand = result.candidates?.[0];
        if (cand) {
            let foundImage = false;
            for (const part of cand.content.parts) {
                if (part.inlineData) {
                    const pngBase64 = await convertToPngBase64(part.inlineData.data, part.inlineData.mimeType);
                    const promptData: PromptData = { 
                        mega: `Collage Extract: ${targetPosition}`, 
                        lighting: '', 
                        scene: '', 
                        view: '', 
                        inpaint: '', 
                        inpaintEnabled: false, 
                        cameraProjection: false 
                    };
                    const finalBase64 = await embedMetadata(pngBase64, promptData);
                    const src = `data:image/png;base64,${finalBase64}`;
                    
                    generatedImages = [src]; // Replace with extracted image
                    currentImageIndex = 0;
                    addToHistory(src, promptData);
                    
                    outputContainer.classList.remove('hidden');
                    showImage(0);
                    foundImage = true;
                    break;
                }
            }
            if (!foundImage) {
                showCustomAlert("AI không trả về hình ảnh trích xuất. Vui lòng thử lại.", "Extraction Failed");
            }
        }

        if(statusEl) statusEl.innerText = "Trích xuất hoàn tất.";
        
        // Track cost
        if (!!(manualApiKey && manualApiKey.length > 10) || hasSelected) {
            updateImageCountDisplay(1); // Banana Pro pricing for Flash
        }

    } catch (error: any) {
        console.error("Collage Extraction Error", error);
        showCustomAlert(`Lỗi trích xuất: ${error.message || "Unknown error"}`, "Error");
    } finally {
        isGenerating = false;
        extractViewBtn.disabled = false;
        extractViewBtn.innerText = "Extract Now";
        
        // Reset main Generate button UI
        generateButton.classList.add('bg-[#262380]');
        generateButton.classList.remove('bg-red-600');
        generateLabel.innerText = "GENERATE (PROCESS)";
        if (miniGenerateBtn) {
            miniGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
            miniGenerateBtn.classList.add('bg-[#262380]');
            miniGenerateBtn.classList.remove('bg-red-600');
        }
        if (zoomGenerateBtn) {
            zoomGenerateBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
            zoomGenerateBtn.classList.add('bg-[#262380]');
            zoomGenerateBtn.classList.remove('bg-red-600');
        }

        generateProgress.style.width = '0%';
    }
}

// --- Custom Scrollbar Logic ---
function setupCustomScrollbar(wrapperId: string, contentId: string) {
    const wrapper = document.getElementById(wrapperId);
    const content = document.getElementById(contentId);
    if (!wrapper || !content) return;

    const upBtn = wrapper.querySelector('.scrollbar-up') as HTMLElement;
    const downBtn = wrapper.querySelector('.scrollbar-down') as HTMLElement;
    const track = wrapper.querySelector('.scrollbar-track') as HTMLElement;
    const thumb = wrapper.querySelector('.scrollbar-thumb') as HTMLElement;

    if (!upBtn || !downBtn || !track || !thumb) return;

    const updateThumb = () => {
        const ratio = content.clientHeight / content.scrollHeight;
        thumb.style.height = `${Math.max(ratio * track.clientHeight, 20)}px`;
        const scrollRatio = content.scrollTop / (content.scrollHeight - content.clientHeight);
        thumb.style.top = `${scrollRatio * (track.clientHeight - thumb.clientHeight)}px`;
    };

    content.addEventListener('scroll', updateThumb);
    window.addEventListener('resize', updateThumb);
    updateThumb();

    upBtn.addEventListener('click', () => {
        content.scrollTop -= 50;
    });

    downBtn.addEventListener('click', () => {
        content.scrollTop += 50;
    });

    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    thumb.addEventListener('mousedown', (e) => {
        isDragging = true;
        startY = e.clientY;
        startScrollTop = content.scrollTop;
        document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        const scrollRatio = (content.scrollHeight - content.clientHeight) / (track.clientHeight - thumb.clientHeight);
        content.scrollTop = startScrollTop + deltaY * scrollRatio;
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.userSelect = '';
    });
}

document.addEventListener("DOMContentLoaded", () => {
    setupCustomScrollbar('png-info-viewport', 'png-info-scroll-wrapper');
});