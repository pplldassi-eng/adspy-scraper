import { chromium } from 'playwright';
import fs from 'fs';

const KEYWORDS = ['blender'];
const COUNTRIES = ['CI'];

// ---- NOUVEAU : système de score ----
function scoreEcommerce(ad: any): number {
  const combined = (
    ad.text + ' ' + ad.advertiser + ' ' + ad.destinationUrl
  ).toLowerCase();
  let score = 0;

  // Signaux positifs (e-commerce réel)
  if (/\d[\d\s.,]*\s*(fcfa|cfa|\bf\b)/i.test(ad.text)) score += 4; // prix visible
  if (/(whatsapp|api\.whatsapp)/i.test(combined)) score += 3;
  if (/\b(livraison|livrer|commander|commandez|order|acheter|shop)\b/i.test(combined)) score += 2;
  if (/\.(ci|sn|cm|bf|ml|tg|bj)\b/i.test(combined)) score += 4; // domaine local
  if (/\b(promo|stock|offre|réduction|kdo|solde)\b/i.test(combined)) score += 1;
  if (/\b(abidjan|dakar|douala|yaoundé|bamako|ouagadougou|lomé|cotonou)\b/i.test(combined)) score += 2;

  // Signaux négatifs (bruit)
  if (/\b(meshy|vfx|after effects|cgi|render|animation|tutorial|course|formation|ebook)\b/i.test(combined)) score -= 12;
  if (/\b(recipe|recette|vegan|dessert|gluten|cookie|ingredients)\b/i.test(combined)) score -= 10;
  if (/\b(plugin|wordpress|license|logiciel|autocad|revit|bim)\b/i.test(combined)) score -= 12;
  if (/\b(english|tutor|learn|sculpting|game asset|unity|unreal|godot)\b/i.test(combined)) score -= 10;
  if (/\b(consultation|interior design|architecture|b2b|manufacturer|supplier|wholesale)\b/i.test(combined)) score -= 10;

  return score;
}

function looksLikeEcommerce(ad: any): boolean {
  return scoreEcommerce(ad) >= 4;
}

// ---- NOUVEAU : extraction du prix ----
function extractPrice(text: string): string {
  const patterns = [
    /(\d[\d\s.,]*)\s*(?:FCFA|F CFA|CFA)/i,
    /(?:FCFA|CFA)\s*(\d[\d\s.,]*)/i,
    /(\d{1,3}(?:[.\s]\d{3})+)\s*F\b/i,     // 13.000f, 20 000 F
    /(\d{4,6})\s*F\b/i,                    // 20000F
    /Prix[^\d]{0,20}(\d[\d\s.,]*)/i,
    /(?:kdo|promo)[^\d]{0,20}(\d[\d\s.,]*)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const n = m[1].replace(/\s/g, '').replace(/[.,]/g, (c, i) => {
        // garde le point comme séparateur de milliers si suivi de 3 chiffres
        return c;
      });
      const cleaned = n.replace(/[^\d]/g, '');
      if (cleaned.length >= 3 && cleaned.length <= 8) return cleaned;
    }
  }
  return '';
}

// ---- Extraction d'un nom de produit (heuristique) ----
function extractProductName(ad: any): string {
  // Essaie de trouver un nom après le domaine destination (ligne du lien)
  const lines = ad.text.split('\n').filter((l: string) => l.trim().length > 5);
  if (lines.length === 0) return '';
  // Souvent le produit est dans la 1ère ligne qui contient des mots techniques
  const productLine = lines.find((l: string) =>
    /(blender|mixeur|robot|bracelet|fond de teint|réfrigérateur|machine|pack|smart|technology|silvercrest|binatone)/i.test(l)
  );
  return (productLine || lines[0]).slice(0, 200).trim();
}

// ---- Scraper principal ----
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

  console.log(`🔍 Recherche : "${keyword}" en ${country}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1500 + Math.random() * 1500);
  }

  fs.mkdirSync('debug', { recursive: true });
  await page.screenshot({
    path: `debug/${keyword}-${country}.png`,
    fullPage: true,
  });

  const pageText: string = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`debug/${keyword}-${country}-fulltext.txt`, pageText);

  const adBlocks = pageText.split(
    /(?=(?:Actif|Inactif)\s*\n\s*ID dans la bibliothèque\s*:)/
  );

  console.log(`📦 ${adBlocks.length} blocs bruts détectés`);

  const rawAds: any[] = [];

  for (const block of adBlocks) {
    const libraryId = block.match(/ID dans la bibliothèque\s*:\s*(\d+)/)?.[1];
    if (!libraryId) continue;

    const startDateMatch = block.match(/Début de diffusion le\s*(.+?)(?:\n|$)/);
    const startDate = startDateMatch?.[1]?.trim() || '';

    const status = /^Actif/m.test(block.trim()) ? 'Actif' : 'Inactif';

    const advertiserMatch = block.match(/\n([^\n]+?)\nSponsorisé/);
    const advertiser = advertiserMatch?.[1]?.trim() || '';

    const urlMatch = block.match(/\n([A-Z][A-Z0-9.\-]+\.[A-Z]{2,})\n/);
    const destinationUrl = urlMatch?.[1]?.trim() || '';

    const ctaMatch = block.match(
      /\n(Commander|Learn More|S'inscrire|Shop Now|Send WhatsApp Message|Acheter|Download|Order Now|Envoyer un message WhatsApp)\n?/
    );
    const cta = ctaMatch?.[1] || '';

    let text = '';
    const sponsoIdx = block.indexOf('Sponsorisé');
    if (sponsoIdx >= 0) {
      const after = block.slice(sponsoIdx + 'Sponsorisé'.length);
      const stop = after.match(
        /\n(?=\d+:\d+\s*\/|\n[A-Z][A-Z0-9.\-]+\.[A-Z]{2,}\n|Commander|Learn More|Shop Now|S'inscrire|Acheter|Send WhatsApp)/
      );
      const end = stop ? stop.index! : Math.min(after.length, 3000);
      text = after.slice(0, end).trim();
    }

    const imageMatch = block.match(/https:\/\/scontent[^\s)]+\.(jpg|jpeg|png|webp)/);
    const imageUrl = imageMatch?.[0] || '';

    const ad = {
      libraryId,
      advertiser,
      text,
      imageUrl,
      destinationUrl,
      cta,
      startDate,
      status,
      country,
      keyword,
      scrapedAt: new Date().toISOString(),
    };

    // Enrichissement
    (ad as any).score = scoreEcommerce(ad);
    (ad as any).price = extractPrice(text);
    (ad as any).productName = extractProductName(ad);

    rawAds.push(ad);
  }

  const ads = rawAds.filter(looksLikeEcommerce);

  fs.writeFileSync(
    `debug/${keyword}-${country}-ads.json`,
    JSON.stringify(ads, null, 2)
  );
  fs.writeFileSync(
    `debug/${keyword}-${country}-raw.json`,
    JSON.stringify(rawAds, null, 2)
  );

  console.log(
    `✅ ${rawAds.length} annonces brutes → ${ads.length} e-commerce retenues`
  );

  ads.forEach((ad) => {
    console.log(`\n--- ${ad.advertiser} (score ${(ad as any).score}) ---`);
    console.log(`💰 Prix : ${(ad as any).price || '?'}`);
    console.log(`📦 Produit : ${(ad as any).productName}`);
    console.log(`🔗 ${ad.destinationUrl} | CTA: ${ad.cta}`);
  });

  await browser.close();
  return ads;
}

async function main() {
  for (const keyword of KEYWORDS) {
    for (const country of COUNTRIES) {
      try {
        await scrapeAds(keyword, country);
      } catch (e) {
        console.error(`❌ Erreur "${keyword}" (${country}):`, e);
      }
    }
  }
}

main().catch(console.error);