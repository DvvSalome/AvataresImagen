# Cowork Avatars - Como Funciona la Generacion de Avatares

## Descripcion General

Cowork Avatars es un sistema de generacion de avatares 3D estilo Chibi que utiliza
inteligencia artificial (Google Gemini) para modificar atributos visuales sobre una
base geometrica fija. El sistema opera como un "texturizador" preciso, no como un
generador artistico libre.

---

## Arquitectura: 3 Capas

```
USUARIO (Frontend React)
    |
    | 1. Selecciona: Base + Estilo de Pelo
    | 2. Click en boton de generacion
    v
BACKEND (Supabase Edge Function - Deno)
    |
    | 3. Descarga imagen base del Storage
    | 4. Envia a Gemini con prompt de precision
    | 5. Recibe imagen modificada
    | 6. Sube resultado al Storage
    v
IA (Google Gemini 2.0 Flash)
    |
    | Procesa la imagen con restricciones:
    | - Temperatura 0.1 (minima creatividad)
    | - topP 0.1, topK 1
    | - Solo modifica el pelo, nada mas
    v
RESULTADO: URL publica del avatar generado
```

---

## Flujo Paso a Paso

### Paso 1: El Usuario Elige (Frontend)
El frontend presenta dos opciones:
- **Base**: Masculina o Femenina (maniqui 3D Chibi en T-Pose)
- **Pelo**: 5 estilos disponibles (corto negro, rizado cafe, largo rubio, puntiagudo rojo, ondulado plateado)

Al hacer click, se invoca la Edge Function via `supabase.functions.invoke()`.

### Paso 2: Validacion (Edge Function)
La funcion valida:
- Que `config.base` sea 'male' o 'female'
- Que `config.hairId` sea uno de los IDs permitidos
- Que `GEMINI_API_KEY` este configurada y no este vacia

Si `MOCK_MODE=true`, retorna la imagen base sin llamar a Gemini (ahorra cuota).

### Paso 3: Descarga de Imagen Base (Edge Function -> Storage)
- Ruta: `{SUPABASE_URL}/storage/v1/object/public/avatars/bases/base_{genero}.jpg`
- Se convierte a Base64 usando una funcion iterativa por bloques de 8KB
- Esto evita el error "Maximum call stack size exceeded" que ocurria con el spread operator

### Paso 4: Generacion con IA (Edge Function -> Gemini)
Se envia a Gemini 2.0 Flash:
- **Imagen**: La base en Base64 como `inlineData`
- **Prompt**: Instrucciones estrictas para solo modificar el pelo
- **Config**: `responseModalities: ['TEXT', 'IMAGE']` para que devuelva imagen

Parametros de precision:
| Parametro    | Valor | Efecto                                      |
|-------------|-------|---------------------------------------------|
| temperature | 0.1   | Casi determinista, minima variacion          |
| topP        | 0.1   | Solo los pixeles mas probables               |
| topK        | 1     | Elige la unica mejor opcion                  |

### Paso 5: Manejo de Rate Limits (Edge Function)
Si Gemini responde con error 429 (Too Many Requests):
1. Espera 3 segundos
2. Reintenta (hasta 2 veces con backoff exponencial: 3s, 6s)
3. Si falla 3 veces, retorna error descriptivo al frontend

### Paso 6: Upload del Resultado (Edge Function -> Storage)
- Ruta: `avatars/generado/avatar_{timestamp}.jpg`
- Usa header `x-upsert: true` para evitar conflictos
- Verifica que el upload fue exitoso antes de responder

### Paso 7: Mostrar Resultado (Frontend)
- Muestra la imagen generada con la URL publica
- Si hay error, lo muestra en un panel rojo descriptivo
- Si es mock, muestra un banner amarillo indicandolo

---

## Errores Conocidos y Soluciones

### 1. Ruta Duplicada en Storage ("Efecto Matrioshka")
**Problema**: Carpeta `avatars/` dentro del bucket `avatars` creaba `avatars/avatars/bases/...`
**Solucion**: Las carpetas `bases/` y `generado/` deben estar en la RAIZ del bucket.
**Prevencion**: El codigo usa rutas relativas al bucket: `bases/base_{genero}.jpg`

### 2. Stack Overflow al Convertir Imagen
**Problema**: `String.fromCharCode(...bytes)` con spread operator excedia el stack.
**Solucion**: `arrayBufferToBase64()` procesa en bloques de 8KB de forma iterativa.
**Codigo**: Lineas 16-28 de `index.ts`

### 3. API Key Invalida (Error 400)
**Problema**: Espacios extra o key mal propagada en Supabase secrets.
**Solucion**: El codigo ahora usa `apiKey.trim()` y valida que no este vacia.
**Prevencion**: Validacion explicita antes de crear instancia de GoogleGenerativeAI.

### 4. Modelo No Encontrado (Error 404)
**Problema**: Modelos experimentales (`gemini-2.0-flash-exp`) no disponibles.
**Solucion**: Usar modelo estable `gemini-2.0-flash` con `responseModalities`.
**Config actual**: `GEMINI_MODEL = 'gemini-2.0-flash'`

### 5. Cuota Agotada (Error 429)
**Problema**: Plan gratuito de Google AI Studio tiene limites por minuto/dia.
**Solucion triple**:
1. Reintentos automaticos con backoff exponencial (3s, 6s)
2. Modo simulacro (`MOCK_MODE=true`) para desarrollo
3. Mensaje descriptivo al usuario indicando cuando se reinicia la cuota

---

## Estructura de Archivos Actual

```
cowork-avatars/
â”œâ”€â”€ frontend/src/
â”‚   â”œâ”€â”€ App.tsx          <- UI principal (seleccion + resultado)
â”‚   â”œâ”€â”€ main.tsx         <- Entry point React
â”‚   â”œâ”€â”€ index.css        <- Estilos globales (dark theme)
â”‚   â””â”€â”€ App.css          <- Estilos adicionales
â”‚
â”œâ”€â”€ supabase/functions/generate-avatar/
â”‚   â”œâ”€â”€ index.ts         <- Logica principal (validacion + Gemini + Storage)
â”‚   â”œâ”€â”€ deno.json        <- Import map para Deno
â”‚   â”œâ”€â”€ deno.d.ts        <- Tipos de Deno runtime
â”‚   â””â”€â”€ google-generative-ai.d.ts  <- Tipos del SDK de Gemini
â”‚
â””â”€â”€ supabase/config.toml <- Configuracion del proyecto Supabase
```

## Supabase Storage (Bucket: avatars)

```
avatars/
â”œâ”€â”€ bases/
â”‚   â”œâ”€â”€ base_male.jpg      <- Maniqui masculino Chibi T-Pose
â”‚   â””â”€â”€ base_female.jpg    <- Maniqui femenino Chibi T-Pose
â””â”€â”€ generado/
    â””â”€â”€ avatar_*.jpg       <- Avatares generados (timestamped)
```

---

## Variables de Entorno

### Frontend (.env)
- `VITE_SUPABASE_URL` - URL del proyecto Supabase
- `VITE_SUPABASE_ANON_KEY` - Clave anonima publica

### Edge Function (Supabase Dashboard > Secrets)
- `SUPABASE_URL` - Inyectada automaticamente
- `SUPABASE_SERVICE_ROLE_KEY` - Inyectada automaticamente
- `GEMINI_API_KEY` - Clave de Google AI Studio (MANUAL)
- `MOCK_MODE` - "true" para modo simulacro, omitir para produccion (OPCIONAL)

---

## Mejoras Implementadas (respecto al codigo original)

### Edge Function
| Mejora | Antes | Ahora |
|--------|-------|-------|
| Modelo | `gemini-2.0-flash-exp-image-generation` (404) | `gemini-2.0-flash` (estable) |
| Imagen a Base64 | Procesaba byte a byte sin chunking | Bloques de 8KB (mas robusto) |
| Validacion de entrada | Ninguna | Valida base, hairId, y API key |
| Rate limit (429) | Fallaba inmediatamente | Reintentos con backoff exponencial |
| Mock mode | No existia | `MOCK_MODE=true` para pruebas sin cuota |
| Upload verificacion | No verificaba respuesta | Verifica HTTP status + mensaje de error |
| Prompt | Generico, una linea | Estructurado con reglas explicitas |
| API key | Sin validar | Trim + validacion de existencia |
| Logging | Minimo | Progreso paso a paso [1/3], [2/3], [3/3] |
| Error 429 HTTP code | Retornaba 500 | Retorna 429 correcto |
| Response format | Solo `avatarUrl` | Incluye `success`, `config`, `mock` flag |

### Frontend
| Mejora | Antes | Ahora |
|--------|-------|-------|
| Errores | `alert()` generico | Panel visual con mensajes descriptivos |
| Estilos de pelo | 2 opciones hardcodeadas | 5 opciones desde constante `HAIR_OPTIONS` |
| Estado de error | No existia | Estado dedicado con clasificacion de errores |
| Mock indicator | No existia | Banner amarillo cuando MOCK_MODE esta activo |
| UX durante carga | Emoji basico | Mensaje limpio con tiempo estimado |
| Responsive | No | `flexWrap` + `maxWidth: 90vw` en imagen |
| Botones durante carga | Solo pelo deshabilitado | Base y pelo deshabilitados |

### Tipos TypeScript
| Mejora | Antes | Ahora |
|--------|-------|-------|
| Gemini SDK types | Solo `model: string` | Incluye `GenerationConfig`, `Part`, `Candidate` |
| responseModalities | No tipado | Incluido en `GenerationConfig` |

---

## Checklist para Manana (cuando se reinicie la cuota)

1. [ ] Redesplegar la Edge Function:
   ```
   supabase functions deploy generate-avatar
   ```

2. [ ] Si tienes MOCK_MODE activado, desactivarlo:
   ```
   supabase secrets unset MOCK_MODE
   ```

3. [ ] Verificar que GEMINI_API_KEY esta bien:
   ```
   supabase secrets list
   ```

4. [ ] Verificar Storage:
   - Bucket `avatars` existe y es publico
   - `bases/base_male.jpg` y `bases/base_female.jpg` estan presentes
   - Carpeta `generado/` existe (o se creara automaticamente)

5. [ ] Iniciar frontend:
   ```
   cd frontend
   npm run dev
   ```

6. [ ] Probar con UNA generacion primero para no gastar cuota innecesariamente

---

## Futuro (Fase 2)

### Sistema de Capas (Layers)
Generar assets individuales (pelo, ropa, accesorios) con fondo transparente en PNG.
Componer las capas en el frontend via canvas. Esto permite mezclar opciones sin
regenerar la imagen completa cada vez.

### Entrenamiento LoRA
Entrenar una capa de conocimiento ligera con ~20 imagenes del estilo Chibi exacto.
La IA dejaria de "adivinar" el estilo y lo tendria memorizado matematicamente.

### Base de Datos de Usuarios
Tabla `avatars` (id, user_id, config, image_url, created_at) vinculada a Supabase Auth.
Historial de avatares por usuario. Sistema de login/registro.

### Plan Pro
Migrar a plan de pago de Google AI para eliminar el error 429 permanentemente.
Alternativa: implementar cola de generacion con reintentos.
