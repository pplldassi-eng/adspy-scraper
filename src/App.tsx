import { useState, useEffect } from 'react';
import { Search, Globe, Loader2, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AdResult {
  rawText: string;
  keyword: string;
  country: string;
  timestamp: string;
}

interface Config {
  keywords: string[];
  countries: string[];
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [results, setResults] = useState<AdResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setConfig(data);
        if (data.keywords.length > 0) setSelectedKeyword(data.keywords[0]);
        if (data.countries.length > 0) setSelectedCountry(data.countries[0]);
      })
      .catch(err => console.error('Failed to load config', err));
  }, []);

  const handleScrape = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: selectedKeyword, country: selectedCountry }),
      });
      
      const result = await response.json();
      if (result.success) {
        setResults(prev => [...result.data, ...prev]);
      } else {
        setError(result.error || 'Une erreur est survenue');
      }
    } catch (err) {
      setError('Erreur de connexion au serveur');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Search size={18} />
            </div>
            <h1 className="font-bold text-xl tracking-tight">AdSpy Africa</h1>
          </div>
          <div className="text-xs font-medium text-slate-500 uppercase tracking-widest">
            Meta Ads Explorer
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Controls */}
          <aside className="lg:col-span-1 space-y-6">
            <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-500 mb-4 uppercase tracking-wider">Configuration</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Mot-clé</label>
                  <div className="relative">
                    <select 
                      value={selectedKeyword}
                      onChange={(e) => setSelectedKeyword(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm appearance-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    >
                      {config?.keywords.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <ChevronRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Pays</label>
                  <div className="relative">
                    <select 
                      value={selectedCountry}
                      onChange={(e) => setSelectedCountry(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm appearance-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"
                    >
                      {config?.countries.map(c => (
                        <option key={c} value={c}>
                          {c === 'CI' ? '🇨🇮 Côte d\'Ivoire' : c === 'SN' ? '🇸🇳 Sénégal' : c === 'CM' ? '🇨🇲 Cameroun' : c}
                        </option>
                      ))}
                    </select>
                    <ChevronRight size={14} className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <button
                  onClick={handleScrape}
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Extraction...</span>
                    </>
                  ) : (
                    <>
                      <Globe size={18} />
                      <span>Lancer le Scan</span>
                    </>
                  )}
                </button>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-4 p-3 bg-red-50 border border-red-100 rounded-xl flex gap-2 text-red-700 text-sm"
                  >
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <p>{error}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            <section className="bg-indigo-900 p-6 rounded-2xl text-white shadow-xl shadow-indigo-100">
              <h3 className="font-bold mb-2">Guide Rapide</h3>
              <ul className="text-indigo-100 text-sm space-y-3">
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-indigo-800 rounded flex items-center justify-center text-[10px] shrink-0">1</span>
                  <span>Sélectionnez un mot-clé pertinent pour votre marché.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-indigo-800 rounded flex items-center justify-center text-[10px] shrink-0">2</span>
                  <span>Choisissez le pays cible en Afrique.</span>
                </li>
                <li className="flex gap-2">
                  <span className="w-5 h-5 bg-indigo-800 rounded flex items-center justify-center text-[10px] shrink-0">3</span>
                  <span>Analysez les textes publicitaires extraits.</span>
                </li>
              </ul>
            </section>
          </aside>

          {/* Results */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-lg text-slate-800">Résultats ({results.length})</h2>
              <button 
                onClick={() => setResults([])}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 uppercase tracking-wider transition-colors"
              >
                Effacer
              </button>
            </div>

            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {results.length === 0 && !loading && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-center py-20 bg-white border border-dashed border-slate-300 rounded-3xl"
                  >
                    <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                      <Search size={32} />
                    </div>
                    <p className="text-slate-500 font-medium">Aucun résultat pour le moment</p>
                    <p className="text-slate-400 text-sm">Lancez une extraction pour voir les annonces.</p>
                  </motion.div>
                )}

                {results.map((ad, idx) => (
                  <motion.div
                    key={ad.timestamp + idx}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                  >
                    <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded uppercase tracking-wider">
                          {ad.country}
                        </span>
                        <span className="text-[10px] font-bold bg-slate-200 text-slate-600 px-2 py-0.5 rounded uppercase tracking-wider">
                          {ad.keyword}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium italic">
                        {new Date(ad.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="p-5">
                      <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-slate-50 p-4 rounded-xl border border-slate-100">
                        {ad.rawText}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
