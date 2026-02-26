import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

/** Carpeta dentro del bucket avatars donde se guardan todos los avatares (ej. Avatar_luisa, etc.) */
const AVATARES_PRUEBA_PREFIX = "avataresPrueba"

const MESHY_BASE = "https://api.meshy.ai/openapi/v1"

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const { jobId } = await req.json()
    if (!jobId) {
      return new Response(
        JSON.stringify({ error: "jobId es requerido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!.trim()
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!.trim()
    const meshyApiKey = (Deno.env.get("MESHY_API_KEY") ?? Deno.env.get("MESHI_API_KEY") ?? "").trim()

    if (!meshyApiKey) {
      return new Response(
        JSON.stringify({ error: "MESHY_API_KEY no configurada" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const supabase = createClient(supabaseUrl, serviceKey)
    const meshyHeaders = { Authorization: `Bearer ${meshyApiKey}` }

    const { data: job, error: fetchErr } = await supabase
      .from("avatar_jobs")
      .select("*")
      .eq("id", jobId)
      .single()

    if (fetchErr || !job) {
      return new Response(
        JSON.stringify({ error: "Job no encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    if (job.status === "completed" || job.status === "error") {
      return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null)
    }

    // ── STAGE 1: Poll 3D generation ──────────────────────────────────
    if (job.status === "creating_3d" || job.status === "remeshing" || job.status === "texturing") {
      const meshyRes = await fetch(
        `${MESHY_BASE}/multi-image-to-3d/${job.meshy_task_id}`,
        { headers: meshyHeaders },
      )
      const meshyData = await meshyRes.json()

      if (!meshyRes.ok) {
        console.error("[check-3d] meshy poll error:", JSON.stringify(meshyData))
        return respond("creating_3d", null, meshyData.message || "Error consultando Meshy")
      }

      console.log("[check-3d] 3D status:", meshyData.status, "progress:", meshyData.progress)

      if (isFailed(meshyData.status)) {
        const errMsg = meshyData.task_error?.message || "Meshy 3D task failed"
        await updateJob(supabase, jobId, { status: "error", error_message: errMsg })
        return respond("error", null, errMsg)
      }

      if (meshyData.status !== "SUCCEEDED") {
        return respond("creating_3d", null, null, meshyData.progress || 0)
      }

      // 3D model ready — start rigging
      console.log("[check-3d] 3D model SUCCEEDED, starting auto-rigging...")

      try {
        const rigRes = await fetch(`${MESHY_BASE}/rigging`, {
          method: "POST",
          headers: { ...meshyHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({
            input_task_id: job.meshy_task_id,
            height_meters: 1.7,
          }),
        })

        const rigData = await rigRes.json()
        console.log("[check-3d] rigging response:", rigRes.status, JSON.stringify(rigData))

        if (!rigRes.ok) {
          console.error("[check-3d] rigging start failed, falling back to non-rigged model")
          return await downloadAndStoreModel(supabase, job, meshyData.model_urls?.glb, jobId)
        }

        const rigTaskId = rigData.result
        await updateJob(supabase, jobId, {
          status: "rigging",
          meshy_rig_task_id: rigTaskId,
        })

        return respond("rigging", null, null, 0)
      } catch (rigErr) {
        console.error("[check-3d] rigging exception, falling back:", rigErr)
        return await downloadAndStoreModel(supabase, job, meshyData.model_urls?.glb, jobId)
      }
    }

    // ── STAGE 2: Poll rigging ────────────────────────────────────────
    if (job.status === "rigging" && job.meshy_rig_task_id) {
      const rigRes = await fetch(
        `${MESHY_BASE}/rigging/${job.meshy_rig_task_id}`,
        { headers: meshyHeaders },
      )
      const rigData = await rigRes.json()

      if (!rigRes.ok) {
        console.error("[check-3d] rig poll error:", JSON.stringify(rigData))
        return respond("rigging", null, null, 0)
      }

      console.log("[check-3d] rig status:", rigData.status, "progress:", rigData.progress)

      if (isFailed(rigData.status)) {
        console.error("[check-3d] rigging failed, falling back to non-rigged model")
        const tdRes = await fetch(
          `${MESHY_BASE}/multi-image-to-3d/${job.meshy_task_id}`,
          { headers: meshyHeaders },
        )
        const tdData = await tdRes.json()
        return await downloadAndStoreModel(supabase, job, tdData.model_urls?.glb, jobId)
      }

      if (rigData.status !== "SUCCEEDED") {
        return respond("rigging", null, null, rigData.progress || 0)
      }

      // Rigging succeeded — download rigged GLB
      console.log("[check-3d] rigging SUCCEEDED, downloading rigged model...")
      const riggedGlbUrl = rigData.result?.rigged_character_glb_url
      if (!riggedGlbUrl) {
        console.error("[check-3d] no rigged GLB URL, falling back")
        const tdRes = await fetch(
          `${MESHY_BASE}/multi-image-to-3d/${job.meshy_task_id}`,
          { headers: meshyHeaders },
        )
        const tdData = await tdRes.json()
        return await downloadAndStoreModel(supabase, job, tdData.model_urls?.glb, jobId)
      }

      // Solo subir el modelo 3D GLB (1.7m, sin animaciones). El sistema usará animaciones de Monica como fallback.
      const storagePath = `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}/model.glb`
      const dlOk = await downloadToStorage(supabase, riggedGlbUrl, storagePath)
      if (!dlOk) {
        await updateJob(supabase, jobId, { status: "error", error_message: "Error descargando modelo rigged" })
        return respond("error", null, "Error descargando modelo rigged")
      }

      const publicModelUrl = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl
      await updateJob(supabase, jobId, {
        status: "completed",
        model_url: publicModelUrl,
        walking_url: null,
        running_url: null,
        escala: 1.0,
      })

      await deleteFolderFilesExceptModelGlb(supabase, `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}`)
      console.log("[check-3d] pipeline complete with rigging! Model at:", publicModelUrl, "escala: 1.0 (1.7m)")
      return respond("completed", publicModelUrl, null, 100, 1.0)
    }

    // Fallback: unknown status, re-poll
    return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null)

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[check-3d] Exception:", message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})

function isFailed(status: string): boolean {
  return status === "FAILED" || status === "EXPIRED" || status === "CANCELED"
}

function respond(
  status: string,
  modelUrl?: string | null,
  errorMsg?: string | null,
  progress?: number,
  escala?: number | null,
) {
  return new Response(
    JSON.stringify({
      status,
      progress: progress ?? (status === "completed" ? 100 : null),
      model_url: modelUrl ?? null,
      error_message: errorMsg ?? null,
      escala: escala ?? null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
}

async function updateJob(supabase: any, jobId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from("avatar_jobs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", jobId)
  if (error) console.error("[check-3d] updateJob error:", error.message)
}

/** Elimina todos los archivos de la carpeta del avatar excepto model.glb. Deja solo el 3D al final del proceso. */
async function deleteFolderFilesExceptModelGlb(supabase: any, folderPath: string): Promise<void> {
  try {
    const { data: files, error: listErr } = await supabase.storage.from("avatars").list(folderPath)
    if (listErr) {
      console.error("[check-3d] list folder error:", folderPath, listErr.message)
      return
    }
    if (!files?.length) return
    const toRemove = files
      .filter((f: { name: string }) => f.name !== "model.glb")
      .map((f: { name: string }) => `${folderPath}/${f.name}`)
    if (toRemove.length === 0) return
    const { error: removeErr } = await supabase.storage.from("avatars").remove(toRemove)
    if (removeErr) console.error("[check-3d] remove perspectives error:", removeErr.message)
    else console.log("[check-3d] removed", toRemove.length, "files (solo queda model.glb)")
  } catch (e) {
    console.error("[check-3d] deleteFolderFilesExceptModelGlb exception:", e)
  }
}

async function downloadToStorage(supabase: any, url: string, storagePath: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error("[check-3d] download failed:", url, res.status)
      return false
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const { error } = await supabase.storage
      .from("avatars")
      .upload(storagePath, bytes, { contentType: "model/gltf-binary", upsert: true })
    if (error) {
      console.error("[check-3d] upload failed:", storagePath, error.message)
      return false
    }
    return true
  } catch (e) {
    console.error("[check-3d] downloadToStorage exception:", e)
    return false
  }
}

async function downloadAndStoreModel(supabase: any, job: any, glbUrl: string | undefined, jobId: string) {
  if (!glbUrl) {
    await updateJob(supabase, jobId, { status: "error", error_message: "No model URL available" })
    return respond("error", null, "No model URL returned")
  }

  const storagePath = `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}/model.glb`
  const ok = await downloadToStorage(supabase, glbUrl, storagePath)
  if (!ok) {
    await updateJob(supabase, jobId, { status: "error", error_message: "Error descargando modelo" })
    return respond("error", null, "Error descargando modelo")
  }

  const publicModelUrl = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl
  await updateJob(supabase, jobId, { status: "completed", model_url: publicModelUrl, escala: 0.85 })

  await deleteFolderFilesExceptModelGlb(supabase, `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}`)
  console.log("[check-3d] pipeline complete (no rigging). Model at:", publicModelUrl, "escala: 0.85 (modelo ~2u)")
  return respond("completed", publicModelUrl, null, 100, 0.85)
}
