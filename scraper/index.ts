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
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  // Scroll 10 fois pour charger plus de cartes
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(2000 + Math.random() * 1500);
  }

  fs.mkdirSync('debug', { recursive: true });

  // 1. Sauvegarder le HTML et la capture
  await page.screenshot({
    path: `debug/${keyword}-${country}.png`,
    fullPage: true,
  });
  fs.writeFileSync(
    `debug/${keyword}-${country}.html`,
    await page.content()
  );

  // 2. Extraire TOUS les liens Ad Library
  const links = await page.evaluate(() => {
    const anchors = Array.from(
      document.querySelectorAll('a[href*="/ads/library"]')
    ) as HTMLAnchorElement[];
    return anchors.map((a) => ({
      href: a.href,
      text: a.innerText?.slice(0, 200) || '',
    }));
  });
  fs.writeFileSync(
    `debug/${keyword}-${country}-links.json`,
    JSON.stringify(links, null, 2)
  );
  console.log(`🔗 ${links.length} liens Ad Library trouvés`);

  // 3. Extraire TOUS les blocs de texte visibles (paragraphes, spans)
  const textBlocks = await page.evaluate(() => {
    const blocks: string[] = [];
    const seen = new Set<string>();
    document
      .querySelectorAll('div, span, p')
      .forEach((el) => {
        const txt = (el as HTMLElement).innerText?.trim() || '';
        if (txt.length > 30 && txt.length < 1000 && !seen.has(txt)) {
          seen.add(txt);
          blocks.push(txt);
        }
      });
    return blocks;
  });
  fs.writeFileSync(
    `debug/${keyword}-${country}-texts.json`,
    JSON.stringify(textBlocks, null, 2)
  );
  console.log(`📝 ${textBlocks.length} blocs de texte extraits`);

  // 4. Compter les images (souvent liées aux cartes d'annonces)
  const imgCount = await page.evaluate(
    () => document.querySelectorAll('img[src*="scontent"]').length
  );
  console.log(`🖼️ ${imgCount} images Facebook trouvées`);

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
