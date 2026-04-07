import extract from 'png-chunks-extract';
import encode from 'png-chunks-encode';
import { Buffer } from 'buffer';

/**
 * Extracts text metadata (tEXt chunks) from a PNG data URL.
 */
export const extractPngInfo = (dataUrl: string): string | null => {
  try {
    const base64 = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64, 'base64');
    const chunks = extract(buffer);
    
    // Look for tEXt chunks
    const textChunks = chunks.filter(chunk => chunk.name === 'tEXt');
    
    for (const chunk of textChunks) {
      const text = Buffer.from(chunk.data).toString('utf8');
      // SD format usually is "parameters\0Prompt text..."
      // Or just key\0value
      if (text.includes('\0')) {
        const [key, value] = text.split('\0');
        if (key === 'parameters' || key === 'Description' || key === 'Prompt') {
          return value;
        }
      } else {
        // Fallback: if no null byte, just return the whole thing if it looks like a prompt
        return text;
      }
    }
    return null;
  } catch (err) {
    console.error('Error extracting PNG info:', err);
    return null;
  }
};

/**
 * Injects text metadata into a PNG data URL.
 */
export const injectPngInfo = (dataUrl: string, prompt: string): string => {
  try {
    const base64 = dataUrl.split(',')[1];
    const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];
    const buffer = Buffer.from(base64, 'base64');
    const chunks = extract(buffer);
    
    // Create a new tEXt chunk
    // Format: key\0value
    const textData = Buffer.from(`parameters\0${prompt}`, 'utf8');
    const newChunk = {
      name: 'tEXt',
      data: textData
    };
    
    // Insert before IEND (last chunk)
    chunks.splice(chunks.length - 1, 0, newChunk);
    
    const newBuffer = encode(chunks);
    return `data:${mimeType};base64,${Buffer.from(newBuffer).toString('base64')}`;
  } catch (err) {
    console.error('Error injecting PNG info:', err);
    return dataUrl;
  }
};
