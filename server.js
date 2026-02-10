
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
    
    // Call Google GenAI
    const result = await ai.models.generateContent({
      model: model,
      contents: contents,
      config: config
    });

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
  console.log(`Banana Pro Studio Server running on http://localhost:${PORT}`);
});
