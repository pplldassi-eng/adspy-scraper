import { chromium } from 'playwright';
import fs from 'fs';

const KEYWORDS = ['blender'];
const COUNTRIES = ['CI'];

async function scrapeAds(keyword: string, country: string) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  const url =
    `https://www.facebook.com/ads/library/?active_status=active` +
    `&ad_type=all&country=${country}` +
    `&q=${encodeURIComponent(keyword)}` +
    `&search_type=keyword_unordered&media_type=all`;

  console.log(`Recherche : "${keyword}" en ${country}`);
  console.log(`URL : ${url}`);

  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  fs.mkdirSync('debug', { recursive: true });
  await page.screenshot({
    path: `debug/${keyword}-${country}.png`,
    fullPage: true,
  });

  const html = await page.content();
  fs.writeFileSync(`debug/${keyword}-${country}.html`, html);

  const title = await page.title();
  console.log(`Titre de la page : "${title}"`);

  const counts = await page.evaluate(() => {
    return {
      article: document.querySelectorAll('div[role="article"]').length,
      anchor: document.querySelectorAll('a[href*="/ads/library"]').length,
      img: document.querySelectorAll('img').length,
      bodyText: document.body.innerText.slice(0, 300),
    };
  });
  console.log('Diagnostic :', JSON.stringify(counts, null, 2));

  await browser.close();
}

async function main() {
  for (const keyword of KEYWORDS) {
    for (const country of COUNTRIES) {
      try {
        await scrapeAds(keyword, country);
      } catch (e) {
        console.error(`Erreur "${keyword}" (${country}):`, e);
      }
    }
  }
}

main().catch(console.error);
