import { chromium } from 'playwright';
import fs from 'fs';
import { Pool } from 'pg';

const KEYWORD = process.env.SCRAPE_KEYWORD || 'livraison gratuite';
const COUNTRY = process.env.SCRAPE_COUNTRY || 'CI';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function scoreEcommerce(ad: any): number {
  const combined = (ad.text + ' ' + ad.advertiser + ' ' + ad.destinationUrl).toLowerCase();
  let score = 0;

  const jours = ad.daysActive || 0;
  if (jours >= 60) score += 20;
  else if (jours >= 30) score += 12;
  else if (jours >= 15) score += 6;

  if (/(whatsapp|api\.whatsapp)/i.test(combined)) score += 5;
  if (/\b(livraison|paiement à la livraison|cod|cash on delivery)\b/i.test(combined)) score += 4;
  if (/\d[\d\s.,]*\s*(fcfa|cfa|\bf\b)/i.test(ad.text)) score += 4;
  if (/\.(ci|sn|cm|bf|ml|tg|bj)\b/i.test(combined)) score += 4;

  if (/\b(meshy|vfx|after effects|cgi|render|animation|tutorial|course|ebook)\b/i.test(combined)) score -= 15;
  if (/\b(recipe|recette|vegan|dessert|gluten|ingredients)\b/i.test(combined)) score -= 15;
  if (/\b(plugin|wordpress|license|autocad|revit|bim)\b/i.test(combined)) score -= 15;
  if (/\b(english|tutor|learn|sculpting|game asset)\b/i.test(combined)) score -= 15;
  if (/\b(consultation|interior design|architecture|b2b|wholesaler)\b/i.test(combined)) score -= 15;

  return score;
}

function looksLikeEcommerce(ad: any): boolean {
  return scoreEcommerce(ad) >= 5;
}

function extractPrice(text: string): number | null {
  const patterns = [
    /(\d[\d\s.,]*)\s*(?:FCFA|F CFA|CFA)/i,
    /(\d{1,3}(?:[.\s]\d{3})+)\s*F\b/i,
    /(\d{4,6})\s*F\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      const n = m[1].replace(/[^\d]/g, '');
      if (n.length >= 3 && n.length <= 8) return parseInt(n);
    }
  }
  return null;
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  const mois: any = {
    'janv': 0, 'févr': 1, 'mars': 2, 'avr': 3, 'mai': 4, 'juin': 5,
    'juil': 6, 'août': 7, 'sept': 8, 'oct': 9, 'nov': 10, 'déc': 11
  };
  const m = dateStr.match(/(\d+)\s+([a-zéû]+)\s+(\d{4})/i);
  if (!m) return 0;
  const day = parseInt(m[1]);
  const monthKey = Object.keys(mois).find(k => m[2].toLowerCase().startsWith(k.slice(0, 4)));
  if (!monthKey) return 0;
  const date = new Date(parseInt(m[3]), mois[monthKey], day);
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

async function scrapeAds(keyword: string, country: string) {
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://localhost:8080' },
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'fr-FR',
  });
  const page = await context.newPage();

  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(keyword)}&search_type=keyword_unordered&media_type=all`;

  console.log(`Recherche : "${keyword}" en ${country} via Flaregun proxy`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 15; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await page.waitForTimeout(1500 + Math.random() * 1500);
  }

  fs.mkdirSync('debug', { recursive: true });
  const pageText: string = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`debug/${keyword}-${country}-fulltext.txt`, pageText);

  const adBlocks = pageText.split(/(?=(?:Actif|Inactif)\s*\n\s*ID dans la bibliothèque\s*:)/);
  console.log(`${adBlocks.length} blocs bruts detectes`);

  const rawAds: any[] = [];

  for (const block of adBlocks) {
    const libraryId = block.match(/ID dans la bibliothèque\s*:\s*(\d+)/)?.[1];
    if (!libraryId) continue;

    const startDate = block.match(/Début de diffusion le\s*(.+?)(?:\n|$)/)?.[1]?.trim() || '';
    const advertiser = block.match(/\n([^\n]+?)\nSponsorisé/)?.[1]?.trim() || '';
    const destinationUrl = block.match(/\n([A-Z][A-Z0-9.\-]+\.[A-Z]{2,})\n/)?.[1]?.trim() || '';
    const cta = block.match(/\n(Commander|Learn More|S'inscrire|Shop Now|Send WhatsApp Message|Acheter|Download|Order Now|Envoyer un message WhatsApp)\n?/)?.[1] || '';

    let text = '';
    const sponsoIdx = block.indexOf('Sponsorisé');
    if (sponsoIdx >= 0) {
      const after = block.slice(sponsoIdx + 'Sponsorisé'.length);
      const stop = after.match(/\n(?=\d+:\d+\s*\/|\n[A-Z][A-Z0-9.\-]+\.[A-Z]{2,}\n|Commander|Learn More|Shop Now)/);
      text = after.slice(0, stop ? stop.index! : Math.min(after.length, 3000)).trim();
    }

    // Extraction de l'image (gère les URLs échappées par Facebook)
    const imageMatch = block.match(/https:\\?\/\\?\/scontent[^\s"')]+\.(jpg|jpeg|png|webp)/i)
                    || block.match(/scontent[^\s"')]+\.(jpg|jpeg|png|webp)/i);
    let imageUrl = imageMatch ? imageMatch[0].replace(/\\\//g, '/') : null;
    
    // Extraction de la vidéo (gère les URLs échappées par Facebook)
    const videoMatch = block.match(/https:\\?\/\\?\/video[^\s"')]+\.mp4/i)
                    || block.match(/video[^\s"')]+\.mp4/i);
    let videoUrl = videoMatch ? videoMatch[0].replace(/\\\//g, '/') : null;

    if (imageUrl) console.log(`  🖼️ Image trouvée pour ${advertiser || 'inconnu'}`);
    if (videoUrl) console.log(`  🎥 Vidéo trouvée pour ${advertiser || 'inconnu'}`);

    const daysActive = daysSince(startDate);
    const price = extractPrice(text);

    const ad = {
      libraryId,
      advertiser,
      productName: text.split('\n')[0]?.slice(0, 200) || '',
      text,
      price,
      destinationUrl,
      cta,
      startDate,
      daysActive,
      status: 'Actif',
      country,
      keyword,
      imageUrl,
      videoUrl,
    };

    (ad as any).score = scoreEcommerce(ad);
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

  console.log(`${rawAds.length} brutes -> ${ads.length} e-commerce retenues`);

  for (const ad of ads) {
    try {
      await pool.query(
        `INSERT INTO ads (
          library_id, advertiser, product_name, ad_text, price, 
          destination_url, cta, start_date, days_active, status, 
          country, keyword, score, image_url, video_url
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
        )
        ON CONFLICT (library_id) DO UPDATE SET
          days_active = EXCLUDED.days_active,
          score = EXCLUDED.score,
          image_url = EXCLUDED.image_url,
          video_url = EXCLUDED.video_url,
          scraped_at = NOW()`,
        [
          ad.libraryId, ad.advertiser, ad.productName, ad.text,
          ad.price, ad.destinationUrl, ad.cta, ad.startDate,
          ad.daysActive, ad.status, ad.country, ad.keyword, 
          ad.score, ad.imageUrl, ad.videoUrl
        ]
      );
      console.log(`Sauvegarde : ${ad.advertiser} (score ${ad.score}, ${ad.daysActive}j)`);
    } catch (e) {
      console.error(`Erreur insert ${ad.libraryId}:`, e);
    }
  }

  await browser.close();
  return ads;
}

async function main() {
  try {
    await scrapeAds(KEYWORD, COUNTRY);
  } catch (e) {
    console.error(`Erreur "${KEYWORD}" (${COUNTRY}):`, e);
  }
  await pool.end();
}

main().catch(console.error);
