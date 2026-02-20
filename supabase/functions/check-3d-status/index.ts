import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

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

    // Already finished
    if (job.status === "completed" || job.status === "error") {
      return respond(job.status, job.model_url, job.error_message)
    }

    // Poll Meshy multi-image-to-3d task
    const meshyRes = await fetch(
      `https://api.meshy.ai/openapi/v1/multi-image-to-3d/${job.meshy_task_id}`,
      { headers: { Authorization: `Bearer ${meshyApiKey}` } },
    )
    const meshyData = await meshyRes.json()

    if (!meshyRes.ok) {
      console.error("[check-3d] meshy poll error:", JSON.stringify(meshyData))
      return respond("creating_3d", null, meshyData.message || "Error consultando Meshy")
    }

    console.log("[check-3d] meshy status:", meshyData.status, "progress:", meshyData.progress)

    if (meshyData.status === "FAILED" || meshyData.status === "EXPIRED" || meshyData.status === "CANCELED") {
      const errMsg = meshyData.task_error?.message || meshyData.message || "Meshy task failed"
      await updateJob(supabase, jobId, { status: "error", error_message: errMsg })
      return respond("error", null, errMsg)
    }

    if (meshyData.status !== "SUCCEEDED") {
      const progress = meshyData.progress || 0
      return respond("creating_3d", null, null, progress)
    }

    // Task succeeded — download .glb and store in Supabase Storage
    const glbUrl = meshyData.model_urls?.glb
    if (!glbUrl) {
      await updateJob(supabase, jobId, { status: "error", error_message: "Meshy no devolvió URL del modelo GLB" })
      return respond("error", null, "No model URL returned")
    }

    console.log("[check-3d] downloading model from:", glbUrl)
    const modelRes = await fetch(glbUrl)
    if (!modelRes.ok) {
      await updateJob(supabase, jobId, { status: "error", error_message: "No se pudo descargar el modelo" })
      return respond("error", null, "Error descargando modelo")
    }

    const modelBytes = new Uint8Array(await modelRes.arrayBuffer())
    const storagePath = `${job.folder_name}/model.glb`

    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(storagePath, modelBytes, { contentType: "model/gltf-binary", upsert: true })

    if (uploadErr) {
      await updateJob(supabase, jobId, { status: "error", error_message: `Upload failed: ${uploadErr.message}` })
      return respond("error", null, uploadErr.message)
    }

    const publicModelUrl = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl
    await updateJob(supabase, jobId, { status: "completed", model_url: publicModelUrl })

    console.log("[check-3d] pipeline complete! Model at:", publicModelUrl)
    return respond("completed", publicModelUrl, null, 100)

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    console.error("[check-3d] Exception:", message)
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})

function respond(status: string, modelUrl?: string | null, errorMsg?: string | null, progress?: number) {
  return new Response(
    JSON.stringify({
      status,
      progress: progress ?? (status === "completed" ? 100 : null),
      model_url: modelUrl ?? null,
      error_message: errorMsg ?? null,
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
