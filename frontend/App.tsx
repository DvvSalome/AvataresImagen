
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { HAIR_COLORS, HAIR_LENGTHS, LOADING_MESSAGES, OUTFIT_OPTIONS } from './constants';
import { Avatar, BaseOption, GenerationStatus, HairColor, HairLength, OutfitOption } from './types';
import { generateChibiAvatarViaEdgeFunction } from './services/avatarService';
import { Button } from './components/Button';

// URLs de las imágenes base en Storage
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lcryrsdyrzotjqdxcwtp.supabase.co';
const BASE_IMAGES = {
  female: `${SUPABASE_URL}/storage/v1/object/public/avatars/bases/base_female.jpg`,
  male: `${SUPABASE_URL}/storage/v1/object/public/avatars/bases/base_male.jpg`,
};

const App: React.FC = () => {
  const [userName, setUserName] = useState('');
  const [selectedColor, setSelectedColor] = useState<HairColor>(HAIR_COLORS[0]);
  const [selectedLength, setSelectedLength] = useState<HairLength>(HAIR_LENGTHS[0]);
  const [selectedOutfit, setSelectedOutfit] = useState<OutfitOption>(OUTFIT_OPTIONS[0]);
  const [selectedBase, setSelectedBase] = useState<BaseOption>('female');
  const [status, setStatus] = useState<GenerationStatus>(GenerationStatus.IDLE);
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState(LOADING_MESSAGES[0]);

  // Rotate loading messages
  useEffect(() => {
    let interval: number;
    if (status === GenerationStatus.LOADING) {
      interval = window.setInterval(() => {
        setLoadingText(prev => {
          const currentIndex = LOADING_MESSAGES.indexOf(prev);
          const nextIndex = (currentIndex + 1) % LOADING_MESSAGES.length;
          return LOADING_MESSAGES[nextIndex];
        });
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [status]);

  const handleGenerate = async () => {
    setStatus(GenerationStatus.LOADING);
    setError(null);
    try {
      const hairDescription = `${selectedColor.colorId} ${selectedLength.lengthId} hair`;
      const outfitDescription = selectedOutfit.outfitId;
      const result = await generateChibiAvatarViaEdgeFunction(hairDescription, selectedBase, userName.trim(), outfitDescription);
      const newAvatar: Avatar = {
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
        imageUrl: result.imageUrl,
        hairColor: selectedColor.color,
        createdAt: Date.now(),
        jobId: result.jobId ?? undefined,
        meshyDebug: result.meshyDebug ?? undefined,
      };
      setAvatars(prev => [newAvatar, ...prev]);
      setStatus(GenerationStatus.SUCCESS);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Error desconocido";
      setError(message);
      setStatus(GenerationStatus.ERROR);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-800">Cowork Avatars</h1>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Chibi Studio</p>
            </div>
          </div>
          
          <nav className="hidden md:flex gap-6">
            <a href="#" className="text-sm font-medium text-indigo-600">Generador</a>
            <a href="#" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">Galería</a>
            <a href="#" className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">Precios</a>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          
          {/* Customizer Sidebar */}
          <div className="lg:col-span-4 space-y-8">
            {/* Nombre (obligatorio) */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-600 text-sm">1</span>
                Tu nombre
              </h2>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="Ej: Luisa, Carlos..."
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                maxLength={50}
              />
              {userName.trim().length === 0 && (
                <p className="mt-2 text-xs text-amber-600">Obligatorio para generar tu avatar.</p>
              )}
            </section>

            {/* Selector de Base */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 text-sm">2</span>
                Elige la Base
              </h2>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSelectedBase('female')}
                  className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${
                    selectedBase === 'female'
                      ? 'bg-violet-50 ring-2 ring-violet-500'
                      : 'hover:bg-slate-50 ring-1 ring-slate-100'
                  }`}
                >
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shadow-sm">
                    <img 
                      src={BASE_IMAGES.female} 
                      alt="Base Femenina" 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">Femenino</span>
                </button>
                <button
                  onClick={() => setSelectedBase('male')}
                  className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${
                    selectedBase === 'male'
                      ? 'bg-violet-50 ring-2 ring-violet-500'
                      : 'hover:bg-slate-50 ring-1 ring-slate-100'
                  }`}
                >
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 shadow-sm">
                    <img 
                      src={BASE_IMAGES.male} 
                      alt="Base Masculina" 
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-slate-700">Masculino</span>
                </button>
              </div>
            </section>

            {/* Selector de Color de Cabello */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 text-sm">3</span>
                Color del Cabello
              </h2>
              
              <div className="grid grid-cols-4 gap-2">
                {HAIR_COLORS.map((option) => (
                  <button
                    key={option.name}
                    onClick={() => setSelectedColor(option)}
                    className={`group relative flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${
                      selectedColor.name === option.name 
                      ? 'bg-indigo-50 ring-2 ring-indigo-500' 
                      : 'hover:bg-slate-50 ring-1 ring-slate-100'
                    }`}
                  >
                    <div 
                      className="w-8 h-8 rounded-full border-2 border-white shadow-sm transition-transform group-hover:scale-110"
                      style={{ backgroundColor: option.color }}
                    />
                    <span className="text-[9px] font-semibold text-center leading-tight text-slate-600">
                      {option.name}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {/* Selector de Longitud de Cabello */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 text-sm">4</span>
                Longitud del Cabello
              </h2>
              
              <div className="grid grid-cols-3 gap-3">
                {HAIR_LENGTHS.map((option) => (
                  <button
                    key={option.name}
                    onClick={() => setSelectedLength(option)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl transition-all ${
                      selectedLength.name === option.name 
                      ? 'bg-cyan-50 ring-2 ring-cyan-500' 
                      : 'hover:bg-slate-50 ring-1 ring-slate-100'
                    }`}
                  >
                    <div className="flex items-end gap-0.5 h-8">
                      {option.lengthId === 'short' && (
                        <>
                          <div className="w-2 h-3 bg-slate-400 rounded-t"></div>
                          <div className="w-2 h-4 bg-slate-500 rounded-t"></div>
                          <div className="w-2 h-3 bg-slate-400 rounded-t"></div>
                        </>
                      )}
                      {option.lengthId === 'medium' && (
                        <>
                          <div className="w-2 h-4 bg-slate-400 rounded-t"></div>
                          <div className="w-2 h-6 bg-slate-500 rounded-t"></div>
                          <div className="w-2 h-4 bg-slate-400 rounded-t"></div>
                        </>
                      )}
                      {option.lengthId === 'long' && (
                        <>
                          <div className="w-2 h-5 bg-slate-400 rounded-t"></div>
                          <div className="w-2 h-8 bg-slate-500 rounded-t"></div>
                          <div className="w-2 h-5 bg-slate-400 rounded-t"></div>
                        </>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{option.name}</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Selector de Ropa */}
            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 text-sm">5</span>
                Ropa / Outfit
              </h2>
              
              <div className="grid grid-cols-2 gap-2">
                {OUTFIT_OPTIONS.map((option) => (
                  <button
                    key={option.name}
                    onClick={() => setSelectedOutfit(option)}
                    className={`flex items-center gap-2 p-3 rounded-xl transition-all text-left ${
                      selectedOutfit.name === option.name
                        ? 'bg-rose-50 ring-2 ring-rose-500'
                        : 'hover:bg-slate-50 ring-1 ring-slate-100'
                    }`}
                  >
                    <span className="text-sm font-semibold text-slate-700">{option.name}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 text-sm">6</span>
                Generar Avatar
              </h2>
              
              <p className="text-slate-500 text-sm mb-6">
                Nuestro sistema AI generará un avatar único en estilo Chibi (pelo + ropa) basado en tu selección. 
                Se guardará en Supabase con tu nombre (ej: avatar_luisa).
              </p>

              <Button 
                onClick={handleGenerate} 
                className="w-full h-14 text-lg"
                isLoading={status === GenerationStatus.LOADING}
                disabled={!userName.trim()}
              >
                Generar con AI
              </Button>
              {!userName.trim() && (
                <p className="mt-2 text-xs text-slate-500">Escribe tu nombre arriba para habilitar el botón.</p>
              )}

              {!import.meta.env.VITE_SUPABASE_ANON_KEY && (
                <div className="mt-4 p-3 bg-amber-50 text-amber-800 text-xs rounded-xl border border-amber-200">
                  Configura <code className="bg-amber-100 px-1 rounded">.env</code> con <code>VITE_SUPABASE_ANON_KEY</code> (Dashboard del proyecto → Settings → API).
                </div>
              )}
              {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                  {error}
                </div>
              )}
            </section>
          </div>

          {/* Result Area */}
          <div className="lg:col-span-8 space-y-8">
            {/* Active Generation Display */}
            <div className="aspect-square md:aspect-video bg-white rounded-[2.5rem] shadow-xl border border-white flex flex-col items-center justify-center p-8 relative overflow-hidden">
              {status === GenerationStatus.LOADING ? (
                <div className="text-center space-y-6">
                  <div className="relative">
                    <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 bg-indigo-50 rounded-full animate-pulse"></div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <p className="text-lg font-bold text-slate-800 animate-pulse">{loadingText}</p>
                    <p className="text-sm text-slate-400">Generando 4 perspectivas, esto tomará ~30-60 segundos</p>
                  </div>
                </div>
              ) : avatars.length > 0 ? (
                <div className="w-full h-full flex flex-col items-center justify-center relative gap-4">
                  <img 
                    src={avatars[0].imageUrl} 
                    alt="Generated Avatar" 
                    className="max-h-[80%] rounded-2xl shadow-2xl transition-all hover:scale-[1.02] cursor-pointer"
                  />
                  {avatars[0].jobId ? (
                    <Link
                      to={`/viewer/${avatars[0].jobId}`}
                      className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition-colors shadow-lg shadow-violet-200"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                      Ver tu chibi en 3D
                    </Link>
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-200 text-slate-500 rounded-xl font-semibold cursor-not-allowed">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        3D no disponible
                      </div>
                      {avatars[0].meshyDebug && (
                        <p className="text-[10px] text-red-400 max-w-xs text-center break-all">
                          {avatars[0].meshyDebug}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="absolute top-4 right-4 flex gap-2">
                    <button className="p-2 bg-white/80 backdrop-blur rounded-lg shadow hover:bg-white transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-4 max-w-sm">
                  <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mx-auto text-slate-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                  </div>
                  <h3 className="text-xl font-bold text-slate-700">Listo para crear</h3>
                  <p className="text-slate-500 text-sm">
                    Selecciona un color y presiona el botón para ver la magia de la inteligencia artificial.
                  </p>
                </div>
              )}

              {/* Decorative backgrounds */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 rounded-bl-full -z-10"></div>
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-50/50 rounded-tr-full -z-10"></div>
            </div>

            {/* Gallery Section */}
            {avatars.length > 1 && (
              <section>
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-slate-800">Recientes</h3>
                  <span className="text-xs font-semibold bg-slate-200 text-slate-600 px-2 py-1 rounded-full">{avatars.length} creados</span>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {avatars.slice(1).map((avatar) => (
                    <div key={avatar.id} className="group relative aspect-square bg-white rounded-2xl overflow-hidden border border-slate-100 shadow-sm transition-all hover:shadow-md hover:-translate-y-1">
                      <img src={avatar.imageUrl} alt="Past Avatar" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button className="p-2 bg-white rounded-lg text-slate-800 hover:scale-110 transition-transform">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </main>

      <footer className="mt-auto py-12 border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-slate-400 text-sm">
            Powered by <strong>Gemini 2.5 Image</strong>, <strong>Meshy 3D</strong> & React Studio
          </p>
          <p className="text-slate-300 text-[10px] mt-2 tracking-widest uppercase font-bold">
            © 2026 Cowork Avatars
          </p>
        </div>
      </footer>
    </div>
  );
};

export default App;
