import { chromium, Browser, BrowserContext, Page } from 'playwright';

export interface AdResult {
  rawText: string;
  keyword: string;
  country: string;
  timestamp: string;
}

export const KEYWORDS = ['blender', 'montre', 'sac'];
export const COUNTRIES = ['CI', 'SN', 'CM'];

export async function scrapeAds(keyword: string, country: string): Promise<AdResult[]> {
  console.log(`🔍 Recherche : "${keyword}" en ${country}`);
  
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Critical for containerized environments
    });
    
    const context: BrowserContext = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 900 },
      locale: 'fr-FR',
    });
    
    const page: Page = await context.newPage();

    const url =
      `https://www.facebook.com/ads/library/?active_status=active` +
      `&ad_type=all&country=${country}` +
      `&q=${encodeURIComponent(keyword)}` +
      `&search_type=keyword_unordered&media_type=all`;

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Accepter les cookies si la bannière apparaît
    try {
      await page.click('button:has-text("Autoriser tous les cookies")', {
        timeout: 3000,
      });
    } catch {
      /* pas de bannière, on continue */
    }

    // Scroll pour charger plus d'annonces
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1000 + Math.random() * 1000);
    }

    // Extraire le texte des cartes d'annonces
    const ads = await page.evaluate(({ keyword, country }) => {
      const cards = document.querySelectorAll('div[role="article"]');
      const results: { rawText: string; keyword: string; country: string; timestamp: string }[] = [];
      const now = new Date().toISOString();
      
      cards.forEach((card) => {
        const text = (card as HTMLElement).innerText;
        if (text && text.length > 50) {
          results.push({ 
            rawText: text.slice(0, 500),
            keyword,
            country,
            timestamp: now
          });
        }
      });
      return results;
    }, { keyword, country });

    console.log(`✅ ${ads.length} annonces pour "${keyword}" (${country})`);
    return ads;
  } catch (error) {
    console.error(`❌ Erreur lors du scraping de "${keyword}" (${country}):`, error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
