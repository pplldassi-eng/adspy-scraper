import { chromium } from 'playwright';

const KEYWORDS = ['blender', 'montre', 'sac'];
const COUNTRIES = ['CI', 'SN', 'CM'];

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
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);

  try {
    await page.click('button:has-text("Autoriser tous les cookies")', {
      timeout: 3000,
    });
  } catch {}

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(2000 + Math.random() * 2000);
  }

  const ads = await page.evaluate(() => {
    const cards = document.querySelectorAll('div[role="article"]');
    const results: { rawText: string }[] = [];
    cards.forEach((card) => {
      const text = (card as HTMLElement).innerText;
      if (text && text.length > 50) {
        results.push({ rawText: text.slice(0, 500) });
      }
    });
    return results;
  });

  console.log(`${ads.length} annonces pour "${keyword}" (${country})`);
  if (ads.length > 0) {
    console.log('--- Apercu de la 1ere annonce ---');
    console.log(ads[0].rawText);
    console.log('----------------------------------');
  }

  await browser.close();
  return ads;
}

async function main() {
  for (const keyword of KEYWORDS) {
    for (const country of COUNTRIES) {
      try {
        await scrapeAds(keyword, country);
        await new Promise((r) => setTimeout(r, 5000));
      } catch (e) {
        console.error(`Erreur "${keyword}" (${country}):`, e);
      }
    }
  }
}

main().catch(console.error);
