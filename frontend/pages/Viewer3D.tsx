import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { check3DStatus, Check3DResponse } from '../services/meshyService';
import type { Job3DStatus } from '../types';
import '@google/model-viewer';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          alt?: string;
          'camera-controls'?: boolean;
          'auto-rotate'?: boolean;
          'shadow-intensity'?: string;
          'environment-image'?: string;
          'exposure'?: string;
          poster?: string;
        },
        HTMLElement
      >;
    }
  }
}

const STATUS_LABELS: Record<Job3DStatus, string> = {
  creating_3d: 'Generando modelo 3D',
  remeshing: 'Optimizando geometría',
  texturing: 'Aplicando texturas',
  rigging: 'Agregando esqueleto',
  completed: 'Modelo listo',
  error: 'Error en el proceso',
};

const STATUS_DESCRIPTIONS: Record<Job3DStatus, string> = {
  creating_3d: 'Meshy está convirtiendo tus 4 vistas en un modelo 3D...',
  remeshing: 'Optimizando la malla del modelo para mejor calidad...',
  texturing: 'Aplicando colores y texturas al modelo 3D...',
  rigging: 'Generando esqueleto y animaciones básicas (walk/run)...',
  completed: 'Tu avatar 3D con esqueleto está listo. Rotalo con el mouse o dedo.',
  error: 'Hubo un error procesando tu modelo.',
};

const STAGE_ORDER: Job3DStatus[] = ['creating_3d', 'remeshing', 'texturing', 'rigging', 'completed'];

function getStageIndex(status: Job3DStatus): number {
  const idx = STAGE_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

const Viewer3D: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const [status, setStatus] = useState<Job3DStatus>('creating_3d');
  const [progress, setProgress] = useState<number>(0);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const intervalRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const res: Check3DResponse = await check3DStatus(jobId);
      setStatus(res.status);
      setProgress(res.progress ?? 0);

      if (res.status === 'completed' && res.model_url) {
        setModelUrl(res.model_url);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
      if (res.status === 'error') {
        setErrorMsg(res.error_message);
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (err) {
      console.error('Error polling 3D status:', err);
    }
  }, [jobId]);

  useEffect(() => {
    poll();
    intervalRef.current = window.setInterval(poll, 12000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const overallProgress = () => {
    const stageIdx = getStageIndex(status);
    const stageWeight = 100 / (STAGE_ORDER.length - 1); // 3 active stages
    const base = stageIdx * stageWeight;
    if (status === 'completed') return 100;
    if (status === 'error') return base;
    return Math.min(99, base + (progress / 100) * stageWeight);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              <span className="text-sm font-medium">Volver</span>
            </Link>
            <div className="h-6 w-px bg-slate-200" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-violet-200">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              </div>
              <h1 className="text-lg font-bold text-slate-800">Chibi 3D Viewer</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 md:p-8">
        {status !== 'completed' && status !== 'error' && (
          <div className="w-full max-w-lg space-y-8 text-center">
            {/* Animated cube */}
            <div className="relative mx-auto w-24 h-24">
              <div className="absolute inset-0 bg-violet-100 rounded-2xl animate-pulse" />
              <div className="absolute inset-2 bg-violet-200 rounded-xl animate-spin" style={{ animationDuration: '3s' }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-800">
                {STATUS_LABELS[status]}
              </h2>
              <p className="text-slate-500 text-sm">
                {STATUS_DESCRIPTIONS[status]}
              </p>
            </div>

            {/* Progress bar */}
            <div className="space-y-3">
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${overallProgress()}%` }}
                />
              </div>

              {/* Stage indicators */}
              <div className="flex justify-between text-xs font-medium">
                {STAGE_ORDER.slice(0, -1).map((stage, i) => {
                  const current = getStageIndex(status);
                  const isDone = i < current;
                  const isActive = i === current;
                  return (
                    <div
                      key={stage}
                      className={`flex items-center gap-1 ${
                        isDone ? 'text-violet-600' : isActive ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    >
                      {isDone ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : isActive ? (
                        <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
                      ) : (
                        <div className="w-2 h-2 bg-slate-300 rounded-full" />
                      )}
                      {STATUS_LABELS[stage]}
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Esto puede tomar 3-8 minutos. No cierres esta pestaña.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="w-full max-w-lg text-center space-y-6">
            <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" x2="9" y1="9" y2="15"/><line x1="9" x2="15" y1="9" y2="15"/></svg>
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Error</h2>
            <p className="text-red-500 text-sm bg-red-50 p-4 rounded-xl border border-red-100">
              {errorMsg || 'Ocurrió un error procesando el modelo 3D.'}
            </p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-slate-800 text-white rounded-xl font-semibold hover:bg-slate-700 transition-colors"
            >
              Volver al generador
            </Link>
          </div>
        )}

        {status === 'completed' && modelUrl && (
          <div className="w-full max-w-4xl space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-slate-800">Tu Chibi en 3D</h2>
              <p className="text-slate-500 text-sm">Arrastra para rotar, scroll para zoom</p>
            </div>

            <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden" style={{ height: '70vh' }}>
              <model-viewer
                src={modelUrl}
                alt="Avatar Chibi 3D"
                camera-controls
                auto-rotate
                shadow-intensity="1"
                environment-image="neutral"
                exposure="1"
                style={{ width: '100%', height: '100%' }}
              />
            </div>

            <div className="flex items-center justify-center gap-4">
              <Link
                to="/"
                className="px-6 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition-colors"
              >
                Volver al generador
              </Link>
              <a
                href={modelUrl}
                download="chibi_avatar.glb"
                className="px-6 py-3 bg-violet-600 text-white rounded-xl font-semibold hover:bg-violet-700 transition-colors flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                Descargar .glb
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Viewer3D;
