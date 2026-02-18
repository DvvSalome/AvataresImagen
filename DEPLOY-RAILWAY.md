# Subir Cowork Avatars a Railway

Solo el **frontend** (React + Vite) se despliega en Railway. Las Edge Functions siguen en Supabase.

## 1. Cuenta y proyecto en Railway

1. Entra en [railway.app](https://railway.app) e inicia sesión (GitHub).
2. **New Project** → **Deploy from GitHub repo**.
3. Conecta el repo donde está este código y elige el repositorio.

## 2. Configurar el servicio

No hace falta cambiar **Root Directory**: en la raíz del repo hay un `package.json` que hace `build` y `start` del frontend. Railway detectará Node y usará:

- **Build**: `npm run build` → instala dependencias en `frontend/` y ejecuta `vite build`.
- **Start**: `npm run start` → sirve la carpeta `frontend/dist` con `serve`.

Si prefieres desplegar solo desde la carpeta frontend, en **Settings** → **Root Directory** puedes poner `frontend` y entonces no se usará el `package.json` de la raíz.

## 3. Variables de entorno

En el servicio: **Variables** → **Add Variable** y añade:

| Variable | Valor | Dónde lo sacas |
|----------|--------|-----------------|
| `VITE_SUPABASE_URL` | `https://ejzyhwfpmjpwvfmpvfxo.supabase.co` | Tu proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (tu anon key) | Supabase → Settings → API → anon public |

Sin estas variables la app no podrá llamar a Supabase ni a la Edge Function.

## 4. Dominio público

1. **Settings** → **Networking** → **Generate Domain**.
2. Railway te dará una URL tipo `xxx.up.railway.app`. Ahí se verá la app.

## 5. Despliegue

- Cada **push** a la rama conectada (p. ej. `main`) puede redesplegar automáticamente si está activado.
- O en la pestaña **Deployments** usa **Redeploy** para lanzar un nuevo build.

## Resumen de comandos (en tu máquina)

```bash
# Desde la raíz del repo
cd frontend
npm install
npm run build
npm run start   # local: verifica que funciona en http://localhost:3000
```

Si algo falla en Railway, revisa la pestaña **Deployments** → último deployment → **View Logs** para ver el error de build o de inicio.
