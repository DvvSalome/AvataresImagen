# Cowork Avatars - Documento de Contexto del Proyecto

## Resumen Ejecutivo

**Cowork Avatars** es una herramienta técnica de generación de avatares 3D estilo Chibi impulsada por IA. No es un juguete artístico: es un sistema de "texturización" preciso donde la IA modifica atributos visuales (pelo, accesorios) sobre una base geométrica fija (maniquí en T-Pose), manteniendo fidelidad absoluta a los bordes y proporciones originales.

---

## Arquitectura del Sistema

```
┌─────────────────────┐      ┌──────────────────────────┐      ┌─────────────────────┐
│   Frontend (React)  │─────▶│  Supabase Edge Function   │─────▶│  Google Gemini AI   │
│   Vite + TypeScript │      │  generate-avatar (Deno)   │      │  gemini-2.0-flash   │
└─────────────────────┘      └──────────────────────────┘      └─────────────────────┘
         │                            │          │
         │                            ▼          ▼
         │                   ┌──────────────────────────┐
         └──────────────────▶│   Supabase Storage        │
                             │   Bucket: avatars/        │
                             │   ├── bases/              │
                             │   │   ├── base_male.jpg   │
                             │   │   └── base_female.jpg │
                             │   └── generado/           │
                             │       └── avatar_*.jpg    │
                             └──────────────────────────┘
```

### Flujo de Datos

1. El usuario selecciona **Base** (masculina/femenina) y **Estilo de Pelo** en el frontend.
2. El frontend invoca la Edge Function `generate-avatar` vía `supabase.functions.invoke()`.
3. La Edge Function:
   - Descarga la imagen base desde Supabase Storage (`/avatars/bases/base_{genero}.jpg`).
   - Convierte la imagen a Base64.
   - Envía la imagen + prompt a **Gemini 2.0 Flash** con temperatura 0.1.
   - Recibe la imagen generada en Base64.
   - Sube el resultado a Storage (`/avatars/generado/avatar_{timestamp}.jpg`).
   - Retorna la URL pública del avatar generado.
4. El frontend muestra la imagen resultante.

---

## Stack Tecnológico

| Capa         | Tecnología                      | Versión    | Propósito                                   |
|--------------|---------------------------------|------------|---------------------------------------------|
| Frontend     | React                           | 19.2.0     | UI de selección y visualización de avatares  |
| Bundler      | Vite                            | 7.3.1      | Build tool y dev server                      |
| Lenguaje     | TypeScript                      | 5.9.3      | Tipado estático en frontend y backend        |
| Backend      | Supabase Edge Functions (Deno)  | Deno 2     | Lógica serverless de generación              |
| IA           | Google Gemini 2.0 Flash         | 0.21.0 SDK | Generación/modificación de imágenes          |
| Storage      | Supabase Storage                | -          | Almacenamiento de bases y avatares generados |
| Auth         | Supabase Auth (JWT)             | -          | Verificación de tokens en Edge Functions     |

---

## Estructura del Proyecto

```
cowork-avatars/
│
├── frontend/                          # Aplicación principal
│   ├── src/
│   │   ├── App.tsx                    # Componente principal - UI del generador
│   │   ├── main.tsx                   # Entry point de React
│   │   ├── index.css                  # Estilos globales (dark theme)
│   │   └── App.css                    # Estilos del componente App
│   ├── .env                           # Variables: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   ├── package.json                   # Dependencias: react, supabase-js
│   ├── vite.config.ts                 # Configuración de Vite
│   ├── tsconfig.json                  # Configuración de TypeScript
│   └── index.html                     # HTML raíz
│
├── frontend-avatars/                  # Template secundario (sin uso activo)
│
└── supabase/
    ├── functions/
    │   └── generate-avatar/           # Edge Function principal
    │       ├── index.ts               # Lógica: fetch base → Gemini → upload resultado
    │       ├── deno.json              # Import map para Deno
    │       ├── deno.d.ts              # Tipos de Deno
    │       └── google-generative-ai.d.ts  # Tipos del SDK de Gemini
    └── config.toml                    # Configuración del proyecto Supabase
```

---

## Componentes Clave en Detalle

### 1. Edge Function: `generate-avatar` (`supabase/functions/generate-avatar/index.ts`)

**Responsabilidades:**
- Manejo de CORS para peticiones cross-origin.
- Descarga de imagen base desde Storage público.
- Conversión de `ArrayBuffer` a Base64 (función auxiliar manual para evitar sobrecarga de memoria).
- Comunicación con Gemini 2.0 Flash usando parámetros de alta precisión.
- Upload del resultado a Storage con autenticación Service Role.

**Configuración de IA (Control de Precisión):**
```
temperature: 0.1    → Casi cero para máxima exactitud
topP: 0.1           → Limita la selección de píxeles a los más probables
topK: 1             → Elige solo la mejor opción
```

**Prompt actual (mejorado con reglas explicitas):**
```
You are editing a 3D chibi character model in T-pose.
Task: Add a {hairstyle} hairstyle to this character.
Rules:
- Keep the EXACT same face, body proportions, and T-pose.
- Keep the same 3D chibi art style.
- Only modify the hair. Do NOT change clothing, skin color, or pose.
- The result must look like the same character with a new hairstyle.
```

**Variables de entorno requeridas (Supabase Dashboard):**
- `SUPABASE_URL` — URL del proyecto Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — Clave de servicio para uploads
- `GEMINI_API_KEY` — Clave de API de Google AI Studio

### 2. Frontend: `App.tsx` (`frontend/src/App.tsx`)

**Estado de la aplicación:**
- `base`: Género seleccionado (`'female'` | `'male'`)
- `loading`: Indicador de generación en progreso
- `result`: URL del avatar generado

**Opciones disponibles actualmente:**
- Bases: Mujer / Hombre
- Estilos de pelo: Corto Negro (`short_black`), Rizado Cafe (`curly_brown`), Largo Rubio (`long_blonde`), Puntiagudo Rojo (`spiky_red`), Ondulado Plateado (`wavy_silver`)

**Conexión con Supabase:**
```typescript
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

### 3. Supabase Storage

**Bucket:** `avatars` (público para lectura de bases)

| Ruta                              | Tipo     | Descripción                        |
|-----------------------------------|----------|------------------------------------|
| `avatars/bases/base_male.jpg`     | Entrada  | Maniquí Chibi masculino en T-Pose  |
| `avatars/bases/base_female.jpg`   | Entrada  | Maniquí Chibi femenino en T-Pose   |
| `avatars/generado/avatar_*.jpg`   | Salida   | Avatares generados con timestamp   |

---

## Estado Actual del Proyecto (Fase 1)

### Implementado
- [x] Edge Function funcional que conecta Storage con Gemini.
- [x] Generación de avatares con 2 variables: Género + Estilo de Pelo.
- [x] Frontend básico con selección de base y estilo.
- [x] Almacenamiento de resultados en Supabase Storage.
- [x] Parámetros de IA ajustados para precisión (temperatura 0.1, topP 0.1, topK 1).
- [x] Manejo de CORS y errores en la Edge Function.

### Pendiente / Limitaciones actuales
- [x] ~~Solo 2 opciones de pelo hardcodeadas.~~ Ahora 5 estilos disponibles.
- [x] ~~Sin manejo de errores 429 (rate limit).~~ Reintentos con backoff exponencial.
- [x] ~~Sin modo de pruebas sin cuota.~~ MOCK_MODE implementado.
- [x] ~~Sin validacion de entrada.~~ Validacion de base, hairId y API key.
- [x] ~~Frontend usaba alert() para errores.~~ Panel visual con mensajes descriptivos.
- [ ] No hay sistema de autenticacion de usuario en el frontend.
- [ ] No hay base de datos para historial de avatares.
- [ ] Sin sistema de capas (cada generacion recrea la imagen completa).
- [ ] `frontend-avatars/` es un template sin uso — candidato a eliminacion.

---

## Hoja de Ruta (Fase 2)

### 1. Sistema de Capas (Layers)
**Objetivo:** Generar assets individuales con fondo transparente en vez de regenerar toda la imagen.

**Beneficio:** Combinar una camisa de opción A con un pelo de opción B sin que la cara cambie ni un milímetro.

**Implementación sugerida:**
- Separar la generación en capas: base, pelo, ropa, accesorios.
- Usar formato PNG con transparencia para cada capa.
- Componer las capas en el frontend (canvas o CSS z-index).
- Estructura en Storage: `avatars/layers/{tipo}/{variante}.png`.

### 2. Entrenamiento de Modelo Propio (LoRA)
**Objetivo:** Entrenar una capa de conocimiento ligera (LoRA) con ~20 imágenes del estilo 3D Chibi exacto del proyecto.

**Beneficio:** La IA no tiene que "adivinar" el estilo; lo tiene memorizado matemáticamente. Mayor consistencia entre generaciones.

**Consideraciones:**
- Requiere dataset curado de imágenes base en el estilo exacto.
- Plataformas: Google Vertex AI, Replicate, o Hugging Face para fine-tuning.
- Evaluar costo vs. beneficio en calidad de salida.

### 3. Escalabilidad y Usuarios
**Base de Datos:**
- Crear tabla `avatars` en Supabase con campos: `id`, `user_id`, `config`, `image_url`, `created_at`.
- Crear tabla `user_profiles` vinculada a Supabase Auth.
- Historial de avatares por usuario.

**Plan Pro / Rate Limits:**
- Migrar de Google AI Studio gratuito a un plan de pago para eliminar el error 429 (Too Many Requests).
- Alternativa: implementar cola de generación con reintentos exponenciales.

**Autenticación:**
- Implementar flujo de login/registro con Supabase Auth.
- Proteger la generación de avatares detrás de sesión autenticada.

---

## Variables de Entorno

### Frontend (`frontend/.env`)
| Variable                   | Descripción                        |
|----------------------------|------------------------------------|
| `VITE_SUPABASE_URL`       | URL del proyecto Supabase          |
| `VITE_SUPABASE_ANON_KEY`  | Clave anónima pública de Supabase  |

### Edge Function (Supabase Dashboard → Secrets)
| Variable                      | Descripción                              |
|-------------------------------|------------------------------------------|
| `SUPABASE_URL`                | URL del proyecto (inyectada automática)  |
| `SUPABASE_SERVICE_ROLE_KEY`   | Clave de servicio para operaciones admin |
| `GEMINI_API_KEY`              | Clave de API de Google AI Studio         |

---

## Conexión Remota de Supabase

- **Proyecto ID:** `cowork-avatars`
- **URL:** `https://oqqthloxxfxrblmpgyiq.supabase.co`
- **Región:** Configurada en Supabase Dashboard
- **Servicios activos:** Edge Functions, Storage, Auth

---

## Notas Técnicas

1. **Precisión de IA:** La temperatura ultra-baja (0.1) con `topP: 0.1` y `topK: 1` forza a Gemini a ser determinístico, minimizando variaciones creativas no deseadas. Esto es crítico para que los bordes del maniquí base se respeten.

2. **Conversión Base64:** Se usa una función manual `arrayBufferToBase64()` en vez de `Buffer.from()` porque el runtime de Deno en Edge Functions no soporta el Buffer de Node.js de forma nativa.

3. **Upload directo vs SDK:** El upload actual usa `fetch` directo a la API REST de Storage con el header `Authorization: Bearer {SERVICE_ROLE_KEY}`. Se recomienda migrar al SDK de Supabase para Deno para mejor manejo de errores y tipos.

4. **Modelo Gemini:** Se usa `gemini-2.0-flash` que es la variante rápida. Para mayor calidad en generación de imágenes, evaluar `gemini-2.0-pro` o futuros modelos especializados en imagen.
