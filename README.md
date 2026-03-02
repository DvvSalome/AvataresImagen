# Cowork Avatars — Avatares Chibi 3D

Generador de avatares 3D estilo Chibi para entornos de cowork virtual. El usuario elige base (masculino/femenino), color y longitud de cabello, nombre y vestimenta; la IA genera cuatro vistas del personaje (frontal, trasera, laterales), se convierten en un modelo 3D con Meshy y se obtiene un GLB con rigging y animaciones (caminar, correr, idle). Todo se guarda en Supabase Storage y puede visualizarse en un viewer 3D.

## Contexto

- **Objetivo:** Crear avatares personalizados tipo Chibi que luego podrán usarse en una escena 3D de cowork (escritorios, mesas, interacción “sentarse”, etc.).
- **Pipeline:** Imagen base → Gemini (4 vistas) → Meshy (multi-image-to-3D + rigging + animaciones) → GLB + animaciones en Storage.
- **Frontend:** Formulario de generación, galería en sesión y página de viewer 3D que hace polling del estado del job hasta tener el modelo listo.

## Arquitectura

```
┌──────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│   Frontend (React)   │────▶│  Edge Function          │────▶│   Google Gemini     │
│   Vite + TypeScript  │     │  generate-avatar        │     │   2.5 Flash Image   │
│   / + /viewer/:jobId │     │  (4 vistas + Meshy)    │     └─────────────────────┘
└──────────────────────┘     └──────────────────────────┘              │
        │                              │                               │
        │                              ▼                               │
        │                     ┌──────────────────────────┐            │
        │                     │  Meshy API                │◀───────────┘
        │                     │  multi-image-to-3d +      │   (imágenes públicas)
        │                     │  rigging (walk/run)       │
        │                     └──────────────────────────┘
        │                              │
        │                              ▼
        │                     ┌──────────────────────────┐
        │                     │  Supabase                 │
        │                     │  · Storage (avatars/)     │
        │                     │  · Table avatar_jobs      │
        └────────────────────▶│  · Edge check-3d-status  │
                              └──────────────────────────┘
```

### Flujo completo

1. **Usuario** en el frontend: nombre, base (hombre/mujer), color y longitud de pelo, vestimenta. Pulsa generar.
2. **Frontend** llama a la Edge Function `generate-avatar` con esa config.
3. **generate-avatar:**
   - Descarga la imagen base desde Storage (`avatars/bases/base_female.jpg` o `base_male.jpg`).
   - Con **Gemini 2.5 Flash Image** genera 4 vistas: frontal, trasera, lateral izquierdo, lateral derecho (mismo personaje, pelo y ropa indicados).
   - Sube las 4 imágenes a Storage en `avatars/avataresPrueba/Avatar_{Nombre}/` (front, back, left, right).
   - Si está configurado `MESHY_API_KEY`, inicia el job en **Meshy** (multi-image-to-3D) e inserta un registro en la tabla **avatar_jobs** (status `creating_3d`). Devuelve al frontend la URL de la vista frontal y el `jobId`.
4. **Frontend** muestra la vista frontal y un enlace al viewer 3D (`/viewer/:jobId`). El viewer hace polling a la Edge Function **check-3d-status** con ese `jobId`.
5. **check-3d-status:**
   - Lee el job en `avatar_jobs`, consulta el estado en Meshy (creating_3d → remeshing → texturing). Cuando el 3D está listo, inicia **rigging** en Meshy.
   - Cuando el rigging termina, descarga el modelo riggeado y las animaciones (walking, running, idle vía Animation API con `action_id = 244`).
   - **Re-exporta en un solo archivo:** con **glTF-Transform** fusiona modelo + animaciones en un único `model.glb` con animaciones embebidas y lo sube a Storage. Si la fusión falla, guarda modelo y animaciones por separado como respaldo.
   - Actualiza el job con `status: completed`, `model_url`, `escala`.
6. **Viewer 3D** muestra el modelo con `@google/model-viewer` (rotar, zoom) y opción de descargar el .glb.

### Estructura en Storage (bucket `avatars`)

- **bases/** — Imágenes base (maniquí Chibi T-Pose):
  - `base_female.jpg`
  - `base_male.jpg`
- **avataresPrueba/** — Por avatar queda **un solo archivo**:
  - `Avatar_{Nombre}/model.glb` — modelo 3D riggeado a 1.7 m **con animaciones embebidas** (walk, run, idle). Se genera fusionando el GLB de Meshy con las animaciones mediante glTF-Transform. Las 4 perspectivas se eliminan; en Storage solo queda este archivo.

### Escala del modelo (1.7 m) y exportación

- **Recomendación de exportación:** Resize = 1.70 m, Origin = Bottom, formato GLB.
- En **rigging** se usa `height_meters: 1.7` (API Meshy) para que el GLB salga a **1.7 m** de alto.
- En Supabase queda **un solo archivo** por avatar: `model.glb` (modelo + animaciones walk/run/idle embebidas). Las 4 perspectivas se eliminan al terminar.
- La textura se pide explícitamente consistente en todos los lados y en zonas poco visibles (sin artefactos).
- En la tabla **avatar_jobs** el campo **escala** indica cómo usar el modelo:
  - **escala = 1.0**: modelo ya a 1.7 m. Usar sin corrección.
  - **escala = 0.85**: modelo ~2 unidades (fallback sin rigging). En cliente aplicar `scale = 0.85` para 1.7 m (1.7 / 2 ≈ 0.85).
- La API `check-3d-status` devuelve `escala` cuando `status === "completed"`.

## Estructura del proyecto

```
AvataresImagen/
├── package.json                    # Scripts raíz (build/start para Railway)
├── README.md
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html, index.tsx, index.css
│   ├── App.tsx                     # Generador + galería de avatares
│   ├── types.ts                    # Avatar, Job3DStatus, etc.
│   ├── constants.ts                # Colores y longitudes de pelo
│   ├── .env                        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   ├── components/
│   │   └── Button.tsx
│   ├── pages/
│   │   └── Viewer3D.tsx            # Polling check-3d-status + model-viewer
│   └── services/
│       ├── supabaseClient.ts       # Cliente Supabase
│       ├── avatarService.ts        # Invoke generate-avatar
│       └── meshyService.ts         # Invoke check-3d-status
│
└── supabase/
    ├── config.toml
    ├── migrations/
    │   ├── 001_create_avatar_jobs.sql
    │   ├── 002_add_rigging_columns.sql
    │   ├── 003_add_escala.sql
    │   └── 004_add_idle_url.sql
    └── functions/
        ├── generate-avatar/        # Gemini 4 vistas + upload + Meshy + insert job
        │   ├── index.ts
        │   └── deno.json
        └── check-3d-status/        # Poll Meshy, rigging, merge model+anims → model.glb
            └── index.ts
```

## Stack

| Capa      | Tecnología                    | Uso                                       |
|-----------|-------------------------------|-------------------------------------------|
| Frontend  | React 19 + TypeScript         | UI generador, galería, viewer 3D          |
| Bundler   | Vite 6                        | Build y dev                               |
| Estilos   | Tailwind CSS (CDN) + Inter    | UI                                        |
| 3D viewer | @google/model-viewer          | Visualizar GLB (rotar, zoom, descarga)    |
| Backend   | Supabase Edge Functions (Deno)| generate-avatar, check-3d-status          |
| IA imagen | Google Gemini 2.5 Flash Image | Generar 4 vistas del personaje            |
| 3D + rig  | Meshy API                     | Multi-image-to-3D, rigging, walk/run/idle |
| Merge GLB | glTF-Transform               | Fusionar modelo + animaciones en un solo GLB |
| Storage   | Supabase Storage              | Bucket avatars (bases + avataresPrueba)   |
| DB        | Supabase (Postgres)           | Tabla avatar_jobs                         |
| Hosting   | Railway (opcional)           | Despliegue del frontend                   |

## Configuración

### 1. Supabase (proyecto)

- **Bucket `avatars`** (público):
  - `bases/base_female.jpg`, `bases/base_male.jpg`
  - Carpeta `avataresPrueba/` (se crea al subir; todo lo generado va ahí).
- **Tabla `avatar_jobs`:** ejecutar las migraciones en `supabase/migrations/` (SQL Editor o `supabase db push` si tienes link).
- **Edge Functions:** desplegar `generate-avatar` y `check-3d-status` (Dashboard o CLI con proyecto vinculado).
- **Secrets** (Project Settings → Edge Functions → Secrets):
  - `GEMINI_API_KEY` — `https://aistudio.google.com/apikey`.
  - `MESHY_API_KEY` — para pipeline 3D y rigging (si no está, la app solo devuelve las 4 vistas 2D y un mensaje en la UI).
  - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan automáticamente.

### 2. Frontend (`.env`)

```env
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...tu_anon_public_key...
```

Usar la **anon (public) key** del mismo proyecto donde están desplegadas las funciones y el bucket.

### 3. Desplegar Edge Functions (CLI)

```bash
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy generate-avatar
supabase functions deploy check-3d-status
```

Si no tienes permisos de link, un admin del proyecto puede desplegarlas o hacerlo desde el Dashboard.

## Desarrollo local

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173` (o el puerto que indique Vite). Genera un avatar y entra a “Ver en 3D” para abrir el viewer (`/viewer/:jobId`). El polling tarda unos minutos hasta que Meshy termina 3D y rigging (más la generación opcional de la animación idle).

## Variables de entorno

### Frontend (`.env`)

| Variable                 | Descripción                     |
|--------------------------|---------------------------------|
| `VITE_SUPABASE_URL`      | URL del proyecto Supabase       |
| `VITE_SUPABASE_ANON_KEY` | Anon (public) key del proyecto  |

### Edge Functions (Supabase Secrets)

| Variable                     | Descripción                                      |
|-----------------------------|--------------------------------------------------|
| `GEMINI_API_KEY`            | API key de Google AI Studio (obligatoria)       |
| `MESHY_API_KEY`             | API key de Meshy (opcional; sin ella no hay 3D) |
| `SUPABASE_URL`              | Inyectada por Supabase                          |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada por Supabase                          |

## Solución de problemas

| Síntoma                                  | Causa probable                              | Qué hacer                                                                 |
|------------------------------------------|--------------------------------------------|---------------------------------------------------------------------------|
| Página en blanco                         | Faltan variables en `.env`                 | Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, reiniciar dev  |
| 401 en generate-avatar                   | URL o anon key de otro proyecto            | Usar URL y anon key del proyecto donde están las funciones                |
| "Edge Function returned non-2xx"         | Error dentro de la función (base, Gemini, Meshy, DB) | Revisar Edge Functions → Logs; consola del navegador puede mostrar `data.error` |
| "No se encontró la imagen base"          | Faltan bases en Storage                    | Subir `base_female.jpg` y `base_male.jpg` en `avatars/bases/`            |
| "Error al subir imagen"                  | Permisos o nombre del bucket               | Bucket `avatars` público; rutas bajo `avataresPrueba/`                   |
| Viewer siempre "Generando modelo 3D"     | Sin `MESHY_API_KEY` o job fallido en Meshy | Revisar Secrets y logs de `check-3d-status`; en UI puede aparecer meshyDebug |
| Error 429                                | Cuota de Gemini o Meshy                    | Esperar o revisar límites en Google AI Studio / Meshy                    |

## Próximos pasos (contexto Cowork Virtual 3D)

- Escena 3D con **Three.js** (o React Three Fiber): cargar avatar GLB + muebles (mesas, escritorios, sillas).
- Objetos 3D low-poly (Blender → GLB) para mantener estilo Chibi.
- Puntos de “sit” en sillas y animación o pose de “sentado” para el avatar (rig ya existe; falta clip/pose de sentarse).

# Cowork Avatars — Avatares Chibi 3D

Generador de avatares 3D estilo Chibi para entornos de cowork virtual. El usuario elige base (masculino/femenino), color y longitud de cabello, nombre y vestimenta; la IA genera cuatro vistas del personaje (frontal, trasera, laterales), se convierten en un modelo 3D con Meshy y se obtiene un GLB con rigging y animaciones (caminar, correr). Todo se guarda en Supabase Storage y puede visualizarse en un viewer 3D.

## Contexto

- **Objetivo:** Crear avatares personalizados tipo Chibi que luego podrán usarse en una escena 3D de cowork (escritorios, mesas, interacción “sentarse”, etc.).
- **Pipeline:** Imagen base → Gemini (4 vistas) → Meshy (multi-image-to-3D + rigging) → GLB + animaciones en Storage.
- **Frontend:** Formulario de generación, galería en sesión y página de viewer 3D que hace polling del estado del job hasta tener el modelo listo.

## Arquitectura

```
┌──────────────────────┐     ┌──────────────────────────┐     ┌─────────────────────┐
│   Frontend (React)   │────▶│  Edge Function          │────▶│   Google Gemini     │
│   Vite + TypeScript  │     │  generate-avatar        │     │   2.5 Flash Image   │
│   / + /viewer/:jobId │     │  (4 vistas + Meshy)    │     └─────────────────────┘
└──────────────────────┘     └──────────────────────────┘              │
         │                              │                               │
         │                              ▼                               │
         │                     ┌──────────────────────────┐            │
         │                     │  Meshy API                │◀───────────┘
         │                     │  multi-image-to-3d +      │   (imágenes públicas)
         │                     │  rigging (walk/run)       │
         │                     └──────────────────────────┘
         │                              │
         │                              ▼
         │                     ┌──────────────────────────┐
         │                     │  Supabase                 │
         │                     │  · Storage (avatars/)     │
         │                     │  · Table avatar_jobs      │
         └────────────────────▶│  · Edge check-3d-status  │
                               └──────────────────────────┘
```

### Flujo completo

1. **Usuario** en el frontend: nombre, base (hombre/mujer), color y longitud de pelo, vestimenta. Pulsa generar.
2. **Frontend** llama a la Edge Function `generate-avatar` con esa config.
3. **generate-avatar:**
   - Descarga la imagen base desde Storage (`avatars/bases/base_female.jpg` o `base_male.jpg`).
   - Con **Gemini 2.5 Flash Image** genera 4 vistas: frontal, trasera, lateral izquierdo, lateral derecho (mismo personaje, pelo y ropa indicados).
   - Sube las 4 imágenes a Storage en `avatars/avataresPrueba/Avatar_{Nombre}/` (front, back, left, right).
   - Si está configurado `MESHY_API_KEY`, inicia el job en **Meshy** (multi-image-to-3D) e inserta un registro en la tabla **avatar_jobs** (status `creating_3d`). Devuelve al frontend la URL de la vista frontal y el `jobId`.
4. **Frontend** muestra la vista frontal y un enlace al viewer 3D (`/viewer/:jobId`). El viewer hace polling a la Edge Function **check-3d-status** con ese `jobId`.
5. **check-3d-status:**
   - Lee el job en `avatar_jobs`, consulta el estado en Meshy (creating_3d → remeshing → texturing). Cuando el 3D está listo, inicia **rigging** en Meshy.
   - Cuando el rigging termina, descarga el GLB riggeado y las animaciones (walking, running) y los sube a Storage en `avatars/avataresPrueba/Avatar_{Nombre}/` (model.glb, anim_walking.glb, anim_running.glb).
   - Actualiza el job con `status: completed`, `model_url`, `walking_url`, `running_url`.
6. **Viewer 3D** muestra el modelo con `@google/model-viewer` (rotar, zoom) y opción de descargar el .glb.

### Estructura en Storage (bucket `avatars`)

- **bases/** — Imágenes base (maniquí Chibi T-Pose):
  - `base_female.jpg`
  - `base_male.jpg`
- **avataresPrueba/** — Al final del proceso solo quedan el 3D y las 2 animaciones por avatar:
  - `Avatar_{Nombre}/model.glb` (modelo 3D riggeado a 1.7 m)
  - `Avatar_{Nombre}/anim_walking.glb`, `anim_running.glb` (animaciones de Meshy). Las 4 perspectivas se borran; en Supabase solo quedan estos 3 archivos.

### Escala del modelo (1.7 m) y exportación

- **Recomendación de exportación:** Resize = 1.70 m, Origin = Bottom, formato GLB.
- En **rigging** se usa `height_meters: 1.7` (API Meshy) para que el GLB salga a **1.7 m** de alto.
- En Supabase solo quedan **3 archivos** por avatar: `model.glb` + `anim_walking.glb` + `anim_running.glb`. Las 4 perspectivas se eliminan al terminar.
- La textura se pide explícitamente consistente en todos los lados y en zonas poco visibles (sin artefactos).
- En la tabla **avatar_jobs** el campo **escala** indica cómo usar el modelo:
  - **escala = 1.0**: modelo ya a 1.7 m. Usar sin corrección.
  - **escala = 0.85**: modelo ~2 unidades (fallback sin rigging). En cliente aplicar `scale = 0.85` para 1.7 m (1.7 / 2 ≈ 0.85).
- La API `check-3d-status` devuelve `escala` cuando `status === "completed"`.

## Estructura del proyecto

```
AvataresImagen/
├── package.json                    # Scripts raíz (build/start para Railway)
├── README.md
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html, index.tsx, index.css
│   ├── App.tsx                     # Generador + galería de avatares
│   ├── types.ts                    # Avatar, Job3DStatus, etc.
│   ├── constants.ts                # Colores y longitudes de pelo
│   ├── .env                        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   ├── components/
│   │   └── Button.tsx
│   ├── pages/
│   │   └── Viewer3D.tsx             # Polling check-3d-status + model-viewer
│   └── services/
│       ├── supabaseClient.ts       # Cliente Supabase
│       ├── avatarService.ts        # Invoke generate-avatar
│       └── meshyService.ts         # Invoke check-3d-status
│
└── supabase/
    ├── config.toml
    ├── migrations/
    │   ├── 001_create_avatar_jobs.sql
    │   ├── 002_add_rigging_columns.sql
    │   └── 003_add_escala.sql
    └── functions/
        ├── generate-avatar/        # Gemini 4 vistas + upload + Meshy + insert job
        │   ├── index.ts
        │   └── deno.json
        └── check-3d-status/        # Poll Meshy, rigging, download GLB + anims
            └── index.ts
```

## Stack

| Capa      | Tecnología                    | Uso                                      |
|-----------|-------------------------------|------------------------------------------|
| Frontend  | React 19 + TypeScript         | UI generador, galería, viewer 3D         |
| Bundler   | Vite 6                        | Build y dev                              |
| Estilos   | Tailwind CSS (CDN) + Inter    | UI                                       |
| 3D viewer | @google/model-viewer          | Visualizar GLB (rotar, zoom, descarga)   |
| Backend   | Supabase Edge Functions (Deno)| generate-avatar, check-3d-status         |
| IA imagen | Google Gemini 2.5 Flash Image | Generar 4 vistas del personaje            |
| 3D + rig  | Meshy API                     | Multi-image-to-3D, rigging, walk/run     |
| Storage   | Supabase Storage              | Bucket avatars (bases + avataresPrueba)  |
| DB        | Supabase (Postgres)           | Tabla avatar_jobs                        |
| Hosting   | Railway (opcional)           | Despliegue del frontend                  |

## Configuración

### 1. Supabase (proyecto)

- **Bucket `avatars`** (público):
  - `bases/base_female.jpg`, `bases/base_male.jpg`
  - Carpeta `avataresPrueba/` (se crea al subir; todo lo generado va ahí).
- **Tabla `avatar_jobs`:** ejecutar las migraciones en `supabase/migrations/` (SQL Editor o `supabase db push` si tienes link).
- **Edge Functions:** desplegar `generate-avatar` y `check-3d-status` (Dashboard o CLI con proyecto vinculado).
- **Secrets** (Project Settings → Edge Functions → Secrets):
  - `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com/apikey).
  - `MESHY_API_KEY` — para pipeline 3D y rigging (si no está, la app solo devuelve las 4 vistas 2D y un mensaje en la UI).
  - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan automáticamente.

### 2. Frontend (`.env`)

```env
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...tu_anon_public_key...
```

Usar la **anon (public) key** del mismo proyecto donde están desplegadas las funciones y el bucket.

### 3. Desplegar Edge Functions (CLI)

```bash
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy generate-avatar
supabase functions deploy check-3d-status
```

Si no tienes permisos de link, un admin del proyecto puede desplegarlas o hacerlo desde el Dashboard.

## Desarrollo local

```bash
cd frontend
npm install
npm run dev
```

Abre `http://localhost:5173` (o el puerto que indique Vite). Genera un avatar y entra a “Ver en 3D” para abrir el viewer (`/viewer/:jobId`). El polling tarda unos minutos hasta que Meshy termina 3D y rigging.

## Variables de entorno

### Frontend (`.env`)

| Variable                 | Descripción                    |
|--------------------------|--------------------------------|
| `VITE_SUPABASE_URL`      | URL del proyecto Supabase      |
| `VITE_SUPABASE_ANON_KEY` | Anon (public) key del proyecto  |

### Edge Functions (Supabase Secrets)

| Variable                     | Descripción                                      |
|-----------------------------|--------------------------------------------------|
| `GEMINI_API_KEY`            | API key de Google AI Studio (obligatoria)       |
| `MESHY_API_KEY`             | API key de Meshy (opcional; sin ella no hay 3D)|
| `SUPABASE_URL`               | Inyectada por Supabase                          |
| `SUPABASE_SERVICE_ROLE_KEY` | Inyectada por Supabase                          |

## Solución de problemas

| Síntoma                                  | Causa probable                              | Qué hacer                                                                 |
|------------------------------------------|--------------------------------------------|---------------------------------------------------------------------------|
| Página en blanco                         | Faltan variables en `.env`                 | Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`, reiniciar dev  |
| 401 en generate-avatar                   | URL o anon key de otro proyecto            | Usar URL y anon key del proyecto donde están las funciones                |
| "Edge Function returned non-2xx"         | Error dentro de la función (base, Gemini, Meshy, DB) | Revisar Edge Functions → Logs; consola del navegador puede mostrar `data.error` |
| "No se encontró la imagen base"         | Faltan bases en Storage                    | Subir `base_female.jpg` y `base_male.jpg` en `avatars/bases/`              |
| "Error al subir imagen"                  | Permisos o nombre del bucket              | Bucket `avatars` público; rutas bajo `avataresPrueba/`                      |
| Viewer siempre "Generando modelo 3D"     | Sin `MESHY_API_KEY` o job fallido en Meshy | Revisar Secrets y logs de `check-3d-status`; en UI puede aparecer meshyDebug |
| Error 429                                 | Cuota de Gemini o Meshy                   | Esperar o revisar límites en Google AI Studio / Meshy                      |

## Próximos pasos (contexto Cowork Virtual 3D)

- Escena 3D con **Three.js** (o React Three Fiber): cargar avatar GLB + muebles (mesas, escritorios, sillas).
- Objetos 3D low-poly (Blender → GLB) para mantener estilo Chibi.
- Puntos de “sit” en sillas y animación o pose de “sentado” para el avatar (rig ya existe; falta clip/pose de sentarse).
