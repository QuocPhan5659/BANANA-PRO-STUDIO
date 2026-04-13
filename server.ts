import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Enable CORS
  app.use(cors());

  // Increase payload limit for Base64 images
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Socket.io logic for Mobile Mic Bridge
  io.on('connection', (socket) => {
    socket.on('join-session', (sessionId) => {
      socket.join(sessionId);
      console.log(`User joined session: ${sessionId}`);
    });

    socket.on('voice-transcript', (data) => {
      // data: { sessionId, transcript, isFinal }
      io.to(data.sessionId).emit('receive-transcript', data);
    });
  });

  // API Proxy Route
  app.post('/api/generate', async (req, res) => {
    try {
      const { model, contents, config } = req.body;
      const userApiKey = req.headers['x-api-key'];
      const apiKey = userApiKey && userApiKey !== 'undefined' && userApiKey.length > 10 
        ? userApiKey 
        : process.env.GEMINI_API_KEY;

      if (!apiKey || apiKey.includes('PLACEHOLDER')) {
        return res.status(401).json({ error: 'Missing valid API Key on server or client.' });
      }

      const ai = new GoogleGenAI({ apiKey });
      
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
          break;
        } catch (error: any) {
          const errStr = error.message || JSON.stringify(error);
          const is500 = errStr.includes("500") || errStr.includes("Internal Server Error");
          const is503 = errStr.includes("503") || errStr.includes("Service Unavailable") || errStr.includes("high demand");
          
          if ((is500 || is503) && retries < maxRetries) {
            retries++;
            await new Promise(resolve => setTimeout(resolve, 5000 * retries));
            continue;
          }
          throw error;
        }
      }
      res.json(result);
    } catch (error: any) {
      console.error('Proxy Error:', error);
      res.status(500).json({ 
        error: error.message || 'Internal Server Error'
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`BANANA PRO Studio Server running on http://localhost:${PORT}`);
  });
}

startServer();
