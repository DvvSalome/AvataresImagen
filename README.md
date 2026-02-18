# Cowork Avatars

Generador de avatares 3D estilo Chibi impulsado por IA. El usuario elige una base (masculina o femenina), un color y una longitud de cabello, escribe su nombre y la IA genera un avatar personalizado que se guarda en Supabase Storage.

## Arquitectura

```
┌──────────────────────┐       ┌──────────────────────────┐       ┌─────────────────────┐
│   Frontend (React)   │──────▶│  Supabase Edge Function   │──────▶│   Google Gemini AI  │
│   Vite + TypeScript  │       │  generate-avatar (Deno)   │       │  2.5 Flash Image    │
└──────────────────────┘       └──────────────────────────┘       └─────────────────────┘
         │                              │          │
         │                              ▼          ▼
         │                     ┌──────────────────────────┐
         └────────────────────▶│    Supabase Storage       │
                               │    Bucket: avatars/       │
                               │    ├── bases/             │
                               │    │   ├── base_male.jpg  │
                               │    │   └── base_female.jpg│
                               │    └── generado/          │
                               │        └── avatar_*.png   │
                               └──────────────────────────┘
```

### Flujo

1. El usuario escribe su **nombre**, selecciona **base** (hombre/mujer), **color** y **longitud** de pelo.
2. El frontend llama a la Edge Function `generate-avatar` vía `supabase.functions.invoke()`.
3. La Edge Function:
   - Descarga la imagen base desde Storage (`avatars/bases/base_{genero}.jpg`).
   - La envía a **Gemini 2.5 Flash Image** con un prompt que indica el estilo de pelo y el género del personaje.
   - Sube la imagen resultante a Storage con el nombre del usuario: `generado/avatar_{nombre}_{timestamp}.png`.
   - Devuelve la URL pública.
4. El frontend muestra el avatar generado y lo añade a la galería de la sesión.

## Estructura del Proyecto

```
cowork-avatars/
├── package.json                          # Orquestador para Railway (build + start)
├── README.md                             # Este archivo
│
├── frontend/                             # Aplicación React
│   ├── package.json                      # Dependencias y scripts
│   ├── vite.config.ts                    # Configuración de Vite
│   ├── tsconfig.json                     # Configuración de TypeScript
│   ├── index.html                        # HTML raíz (carga Tailwind CDN + Inter)
│   ├── index.tsx                         # Entry point de React
│   ├── index.css                         # Estilos base
│   ├── App.tsx                           # Componente principal (UI completa)
│   ├── types.ts                          # Tipos: Avatar, HairColor, HairLength, BaseOption
│   ├── constants.ts                      # Opciones de color y longitud de pelo
│   ├── .env                              # Variables de entorno (Supabase URL + Anon Key)
│   ├── railway.toml                      # Config de despliegue en Railway
│   ├── components/
│   │   └── Button.tsx                    # Botón reutilizable con loading/disabled
│   └── services/
│       ├── supabaseClient.ts             # Cliente de Supabase (singleton)
│       └── avatarService.ts              # Llama a la Edge Function y parsea la respuesta
│
└── supabase/
    ├── config.toml                       # Configuración del proyecto Supabase
    └── functions/
        └── generate-avatar/
            ├── index.ts                  # Edge Function: valida, descarga base, llama Gemini, sube resultado
            ├── deno.json                 # Import map de Deno
            ├── deno.d.ts                 # Tipos de Deno
            └── google-generative-ai.d.ts # Tipos del SDK de Gemini
```

## Stack Tecnológico

| Capa       | Tecnología                          | Propósito                                  |
|------------|-------------------------------------|--------------------------------------------|
| Frontend   | React 19 + TypeScript               | UI de personalización y galería de avatares |
| Bundler    | Vite 6                              | Build y dev server                          |
| Estilos    | Tailwind CSS (CDN) + Google Inter   | Diseño moderno y responsivo                 |
| Backend    | Supabase Edge Functions (Deno)      | Lógica serverless de generación             |
| IA         | Google Gemini 2.5 Flash Image       | Generación y modificación de imágenes       |
| Storage    | Supabase Storage                    | Almacenamiento de bases y avatares          |
| Hosting    | Railway                             | Despliegue del frontend en producción       |

## Configuración

### 1. Supabase

Necesitas un proyecto en [supabase.com](https://supabase.com) con:

- **Bucket `avatars`** (público para lectura) con:
  - `bases/base_female.jpg` — Maniquí femenino Chibi en T-Pose.
  - `bases/base_male.jpg` — Maniquí masculino Chibi en T-Pose.
  - `generado/` — Carpeta donde se guardan los avatares generados.

- **Secrets de la Edge Function** (Dashboard → Project Settings → Edge Functions → Secrets):
  - `GEMINI_API_KEY` — Clave de [Google AI Studio](https://aistudio.google.com/apikey).
  - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se inyectan automáticamente.

### 2. Frontend (`.env`)

```env
VITE_SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...tu_anon_key...
```

Obtén estos valores en: Dashboard → Settings → API.

### 3. Desplegar la Edge Function

```bash
supabase functions deploy generate-avatar --project-ref TU_PROJECT_REF
```

## Desarrollo Local

```bash
# Instalar dependencias
cd frontend
npm install

# Arrancar dev server (http://localhost:3000)
npm run dev
```

## Despliegue en Railway

El `package.json` de la raíz está preparado para Railway:

1. **New Project** → **Deploy from GitHub repo** en [railway.app](https://railway.app).
2. En el servicio → **Variables**: añadir `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
3. Railway ejecutará `npm run build` (instala deps + `vite build`) y luego `npm run start` (`serve -s dist`).
4. En **Settings** → **Networking** → **Generate Domain** para obtener la URL pública.

Si prefieres que Railway solo mire la carpeta `frontend`, en **Settings** → **Root Directory** pon `frontend`.

## Variables de Entorno

### Frontend (`.env`)

| Variable                | Descripción                       |
|-------------------------|-----------------------------------|
| `VITE_SUPABASE_URL`    | URL del proyecto Supabase         |
| `VITE_SUPABASE_ANON_KEY`| Clave anónima pública de Supabase|

### Edge Function (Supabase Secrets)

| Variable                     | Descripción                                       |
|------------------------------|---------------------------------------------------|
| `SUPABASE_URL`               | URL del proyecto (inyectada automáticamente)       |
| `SUPABASE_SERVICE_ROLE_KEY`  | Clave de servicio (inyectada automáticamente)      |
| `GEMINI_API_KEY`             | Clave de API de Google AI Studio (configurar manual)|

## Personalización del Avatar

El usuario configura 4 opciones antes de generar:

| Paso | Opción             | Valores                                                                                                 |
|------|--------------------|---------------------------------------------------------------------------------------------------------|
| 1    | Nombre             | Texto libre (obligatorio, se usa para nombrar el archivo)                                               |
| 2    | Base               | Femenino / Masculino (con preview de la imagen base)                                                    |
| 3    | Color del cabello  | Negro, Castaño Oscuro/Claro, Rubio Dorado/Platino, Pelirrojo, Azul, Rosa, Verde, Morado, Blanco       |
| 4    | Longitud del cabello| Corto / Medio / Largo                                                                                  |

El archivo generado se guarda en Storage como `generado/avatar_{nombre}_{timestamp}.png` (ej: `avatar_luisa_1739823456789.png`).

## Solución de Problemas

| Problema                                | Causa probable                                | Solución                                                          |
|-----------------------------------------|-----------------------------------------------|-------------------------------------------------------------------|
| Página en blanco                        | Faltan `VITE_SUPABASE_URL` o `ANON_KEY`     | Revisa `.env` y reinicia `npm run dev`                            |
| "Edge Function returned non-2xx"        | Error interno en la función                   | Revisa Supabase → Edge Functions → Logs                           |
| "No se encontró la imagen base"         | Falta `base_female.jpg` o `base_male.jpg`    | Sube las bases a Storage → `avatars/bases/`                       |
| "Gemini no devolvió imagen"             | Problema con la API de Gemini                 | Verifica `GEMINI_API_KEY` en Secrets y cuota en AI Studio         |
| "Error al subir imagen"                 | Permisos de Storage                           | Verifica que el bucket `avatars` exista y sea público para lectura|
| Error 429 (Too Many Requests)           | Cuota de Gemini agotada                       | Espera a que se reinicie la cuota o usa plan de pago              |
| Railway: "could not determine how to build" | No detecta Node en la raíz               | Verifica que `package.json` existe en la raíz del repo            |
