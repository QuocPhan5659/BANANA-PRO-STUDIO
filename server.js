
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Enable CORS
app.use(cors());

// Increase payload limit for Base64 images
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from the current directory
app.use(express.static(__dirname));

// API Proxy Route
app.post('/api/generate', async (req, res) => {
  try {
    const { model, contents, config } = req.body;
    
    // Priority: User's provided key (via header) > Server Env Key
    // This maintains the "Bring Your Own Key" functionality from the frontend
    const userApiKey = req.headers['x-api-key'];
    const apiKey = userApiKey && userApiKey !== 'undefined' && userApiKey.length > 10 
      ? userApiKey 
      : process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey.includes('PLACEHOLDER')) {
      return res.status(401).json({ error: 'Missing valid API Key on server or client.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // Call Google GenAI with retry logic for 500/503
    let retries = 0;
    const maxRetries = 3;
    let result;
    
    while (retries <= maxRetries) {
      try {
        result = await ai.models.generateContent({
          model: model,
          contents: contents,
          config: config
        });
        break; // Success
      } catch (error) {
        const errStr = error.message || JSON.stringify(error);
        const is500 = errStr.includes("500") || errStr.includes("Internal Server Error");
        const is503 = errStr.includes("503") || errStr.includes("Service Unavailable") || errStr.includes("high demand");
        
        if ((is500 || is503) && retries < maxRetries) {
          retries++;
          console.warn(`Retry ${retries}/${maxRetries} due to ${is503 ? '503' : '500'} error.`);
          await new Promise(resolve => setTimeout(resolve, 5000 * retries)); // Exponential backoff
          continue;
        }
        throw error;
      }
    }

    // Return the response object directly
    res.json(result);

  } catch (error) {
    console.error('Proxy Error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal Server Error',
      details: error.toString() 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`BANANA PRO Studio Server running on http://localhost:${PORT}`);
});
