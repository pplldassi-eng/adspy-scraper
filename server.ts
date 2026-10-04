import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { scrapeAds, KEYWORDS, COUNTRIES } from './scraper/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const port = process.env.PORT || 3000;

  app.use(express.json());

  // API Endpoints
  app.get('/api/config', (req, res) => {
    res.json({ keywords: KEYWORDS, countries: COUNTRIES });
  });

  app.post('/api/scrape', async (req, res) => {
    const { keyword, country } = req.body;
    
    if (!keyword || !country) {
      return res.status(400).json({ error: 'Keyword and country are required' });
    }

    try {
      const results = await scrapeAds(keyword, country);
      res.json({ success: true, data: results });
    } catch (error) {
      console.error('Scrape error:', error);
      res.status(500).json({ error: 'Failed to scrape ads' });
    }
  });

  // Vite integration
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);
    
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        let template = await vite.transformIndexHtml(url, 
          await (await import('fs/promises')).readFile(path.resolve(__dirname, 'index.html'), 'utf-8')
        );
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
