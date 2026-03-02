import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as path from "https://deno.land/std@0.208.0/path/mod.ts"
import { DenoIO } from "https://esm.sh/@gltf-transform/core@4"
import { copyToDocument, unpartition } from "https://esm.sh/@gltf-transform/functions@4"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

/** Carpeta dentro del bucket avatars donde se guardan todos los avatares (ej. Avatar_luisa, etc.) */
const AVATARES_PRUEBA_PREFIX = "avataresPrueba"

const MESHY_BASE = "https://api.meshy.ai/openapi/v1"
const IDLE_ACTION_ID = 244

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
      return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null, job.idle_url ?? null)
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

      // Rigging succeeded — download rigged GLB and basic animations
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

      const folderPath = `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}`
      const storagePath = `${folderPath}/model.glb`

      // Descargar modelo base y animaciones como bytes para fusionar en un solo GLB
      const baseBytes = await downloadBytes(riggedGlbUrl)
      if (!baseBytes) {
        await updateJob(supabase, jobId, { status: "error", error_message: "Error descargando modelo rigged" })
        return respond("error", null, "Error descargando modelo rigged")
      }

      const walkUrl = rigData.result?.basic_animations?.walking_glb_url
      const runUrl = rigData.result?.basic_animations?.running_glb_url
      const walkBytes = walkUrl ? await downloadBytes(walkUrl) : null
      const runBytes = runUrl ? await downloadBytes(runUrl) : null

      let idleBytes: Uint8Array | null = null
      if (job.meshy_rig_task_id) {
        try {
          idleBytes = await generateIdleAnimationAndGetBytes(job.meshy_rig_task_id, meshyHeaders)
        } catch (idleErr) {
          console.error("[check-3d] idle animation generation failed:", idleErr)
        }
      }

      // Re-exportar: un solo model.glb con modelo + animaciones embebidas
      let mergedBytes: Uint8Array | null = null
      try {
        mergedBytes = await mergeGlbWithAnimations(baseBytes, walkBytes, runBytes, idleBytes)
      } catch (mergeErr) {
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
        const stack = mergeErr instanceof Error ? mergeErr.stack : ""
        console.error("[check-3d] merge GLB failed, falling back to separate files:", msg, stack)
      }

      if (mergedBytes && mergedBytes.length > 0) {
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(storagePath, mergedBytes, { contentType: "model/gltf-binary", upsert: true })
        if (upErr) {
          console.error("[check-3d] upload merged model failed:", upErr.message)
          mergedBytes = null
        }
      }

      if (!mergedBytes) {
        // Fallback: guardar modelo y animaciones por separado (filtradas para evitar deformación de cara)
        console.log("[check-3d] storing model + anims as separate files (fallback)")
        await downloadToStorage(supabase, riggedGlbUrl, storagePath)
        if (walkBytes) {
          const filtered = await filterFaceChannelsFromGlb(walkBytes)
          await supabase.storage
            .from("avatars")
            .upload(`${folderPath}/anim_walking.glb`, filtered ?? walkBytes, {
              contentType: "model/gltf-binary",
              upsert: true,
            })
        }
        if (runBytes) {
          const filtered = await filterFaceChannelsFromGlb(runBytes)
          await supabase.storage
            .from("avatars")
            .upload(`${folderPath}/anim_running.glb`, filtered ?? runBytes, {
              contentType: "model/gltf-binary",
              upsert: true,
            })
        }
        if (idleBytes) {
          const filtered = await filterFaceChannelsFromGlb(idleBytes)
          await supabase.storage
            .from("avatars")
            .upload(`${folderPath}/anim_idle.glb`, filtered ?? idleBytes, {
              contentType: "model/gltf-binary",
              upsert: true,
            })
        }
      }

      const publicModelUrl = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl
      const walkingUrl = mergedBytes ? null : (walkBytes ? supabase.storage.from("avatars").getPublicUrl(`${folderPath}/anim_walking.glb`).data.publicUrl : null)
      const runningUrl = mergedBytes ? null : (runBytes ? supabase.storage.from("avatars").getPublicUrl(`${folderPath}/anim_running.glb`).data.publicUrl : null)
      const idleUrl = mergedBytes ? null : (idleBytes ? supabase.storage.from("avatars").getPublicUrl(`${folderPath}/anim_idle.glb`).data.publicUrl : null)
      await updateJob(supabase, jobId, {
        status: "completed",
        model_url: publicModelUrl,
        walking_url: walkingUrl,
        running_url: runningUrl,
        idle_url: idleUrl,
        escala: 1.0,
      })

      const filesToKeep = mergedBytes
        ? [MODEL_GLB_ONLY]
        : ["model.glb", "anim_walking.glb", "anim_running.glb", "anim_idle.glb"]
      await deleteFolderFilesExcept(supabase, folderPath, filesToKeep)
      console.log(
        "[check-3d] pipeline complete:",
        mergedBytes ? "model.glb (animaciones embebidas)" : "model + 3 anims (fallback)",
        "escala 1.0 (1.7m)",
      )
      return respond("completed", publicModelUrl, null, 100, 1.0, null)
    }

    // Fallback: unknown status, re-poll
    return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null, job.idle_url ?? null)

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
  idleUrl?: string | null,
) {
  return new Response(
    JSON.stringify({
      status,
      progress: progress ?? (status === "completed" ? 100 : null),
      model_url: modelUrl ?? null,
      error_message: errorMsg ?? null,
      escala: escala ?? null,
      idle_url: idleUrl ?? null,
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

const MODEL_GLB_ONLY = "model.glb"

/** Elimina todo excepto los nombres indicados en keepFiles. */
async function deleteFolderFilesExcept(
  supabase: any,
  folderPath: string,
  keepFiles: string[],
): Promise<void> {
  try {
    const { data: files, error: listErr } = await supabase.storage.from("avatars").list(folderPath)
    if (listErr) {
      console.error("[check-3d] list folder error:", folderPath, listErr.message)
      return
    }
    if (!files?.length) return
    const keepSet = new Set(keepFiles)
    const toRemove = files
      .filter((f: { name: string }) => !keepSet.has(f.name))
      .map((f: { name: string }) => `${folderPath}/${f.name}`)
    if (toRemove.length === 0) return
    const { error: removeErr } = await supabase.storage.from("avatars").remove(toRemove)
    if (removeErr) console.error("[check-3d] remove extra files error:", removeErr.message)
    else console.log("[check-3d] removed", toRemove.length, "files")
  } catch (e) {
    console.error("[check-3d] deleteFolderFilesExcept exception:", e)
  }
}

/** Descarga una URL y devuelve los bytes, o null si falla. */
async function downloadBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.error("[check-3d] download failed:", url, res.status)
      return null
    }
    return new Uint8Array(await res.arrayBuffer())
  } catch (e) {
    console.error("[check-3d] downloadBytes exception:", e)
    return null
  }
}

async function downloadToStorage(supabase: any, url: string, storagePath: string): Promise<boolean> {
  const bytes = await downloadBytes(url)
  if (!bytes) return false
  try {
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

  await deleteFolderFilesExcept(supabase, `${AVATARES_PRUEBA_PREFIX}/${job.folder_name}`, [
    MODEL_GLB_ONLY,
  ])
  console.log("[check-3d] pipeline complete (no rigging). Model at:", publicModelUrl, "escala: 0.85 (modelo ~2u)")
  return respond("completed", publicModelUrl, null, 100, 0.85, null)
}

/** Genera la animación idle en Meshy y devuelve el GLB en bytes (sin subir a Storage). */
async function generateIdleAnimationAndGetBytes(
  rigTaskId: string,
  meshyHeaders: Record<string, string>,
): Promise<Uint8Array | null> {
  console.log("[check-3d] starting idle animation generation...", { rigTaskId, actionId: IDLE_ACTION_ID })

  const startRes = await fetch(`${MESHY_BASE}/animations`, {
    method: "POST",
    headers: { ...meshyHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      rig_task_id: rigTaskId,
      action_id: IDLE_ACTION_ID,
    }),
  })

  const startData = await startRes.json()
  if (!startRes.ok) {
    console.error("[check-3d] idle animation start failed:", JSON.stringify(startData))
    return null
  }

  const animationTaskId = startData.result
  if (!animationTaskId) {
    console.error("[check-3d] idle animation start did not return task id")
    return null
  }

  const maxAttempts = 20
  const delayMs = 3000

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const pollRes = await fetch(`${MESHY_BASE}/animations/${animationTaskId}`, {
      headers: meshyHeaders,
    })
    const pollData = await pollRes.json()

    if (!pollRes.ok) {
      console.error("[check-3d] idle animation poll error:", JSON.stringify(pollData))
      return null
    }

    if (isFailed(pollData.status)) {
      console.error("[check-3d] idle animation failed")
      return null
    }

    if (pollData.status === "SUCCEEDED") {
      const idleGlbUrl = pollData.result?.animation_glb_url
      if (!idleGlbUrl) return null
      const bytes = await downloadBytes(idleGlbUrl)
      if (bytes) console.log("[check-3d] idle animation GLB downloaded for merge")
      return bytes
    }

    await sleep(delayMs)
  }

  console.warn("[check-3d] idle animation polling timeout")
  return null
}

/** Nodos que pueden deformar la cara si se animan (walk/run). Los excluimos del merge. */
const FACE_HEAD_BONE_PATTERNS = [
  "head", "neck", "jaw", "face", "eye", "skull", "cabeza", "cuello", "mandibula",
  "cc_base_head", "cc_base_neck", "mixamorighead", "mixamorigneck",
  "armature_head", "armature_neck", "bone_head", "bone_neck",
]

function isFaceOrHeadBone(nodeName: string): boolean {
  const lower = nodeName.toLowerCase()
  return FACE_HEAD_BONE_PATTERNS.some((p) => lower.includes(p))
}

/** Quita canales de cabeza/cara de un GLB animado para evitar deformación. Devuelve null si falla. */
async function filterFaceChannelsFromGlb(glbBytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const io = new DenoIO(path)
    const doc = await io.readBinary(glbBytes)
    const root = doc.getRoot()
    let removed = 0
    for (const anim of root.listAnimations()) {
      const toRemove = anim.listChannels().filter((ch) => {
        const target = ch.getTargetNode()
        return target && isFaceOrHeadBone(target.getName() ?? "")
      })
      for (const ch of toRemove) {
        anim.removeChannel(ch)
        removed++
      }
    }
    if (removed > 0) console.log("[check-3d] filtered", removed, "face/head animation channels")
    return await io.writeBinary(doc)
  } catch (e) {
    console.error("[check-3d] filterFaceChannelsFromGlb failed:", e)
    return null
  }
}

/**
 * Fusiona el modelo base (rigged, sin animaciones) con las animaciones walk/run/idle
 * en un solo GLB con animaciones embebidas. Usa glTF-Transform.
 * Excluye canales que animan cabeza/cara para evitar deformación (cara ancha al caminar).
 */
async function mergeGlbWithAnimations(
  baseBytes: Uint8Array,
  walkBytes: Uint8Array | null,
  runBytes: Uint8Array | null,
  idleBytes: Uint8Array | null,
): Promise<Uint8Array | null> {
  const io = new DenoIO(path)
  const baseDoc = await io.readBinary(baseBytes)

  const root = baseDoc.getRoot()
  const nameToNode = new Map<string, ReturnType<typeof root.listNodes>[number]>()
  for (const node of root.listNodes()) {
    const n = node.getName()
    if (n) nameToNode.set(n, node)
  }

  const animatedGlbs: (Uint8Array | null)[] = [walkBytes, runBytes, idleBytes]
  for (const glbBytes of animatedGlbs) {
    if (!glbBytes || glbBytes.length === 0) continue
    const sourceDoc = await io.readBinary(glbBytes)
    const anims = sourceDoc.getRoot().listAnimations()
    if (anims.length === 0) continue

    const beforeIds = new Set(root.listAnimations())
    copyToDocument(baseDoc, sourceDoc, anims)

    for (const anim of root.listAnimations()) {
      if (beforeIds.has(anim)) continue
      const channelsToRemove: ReturnType<typeof anim.listChannels>[number][] = []
      for (const ch of anim.listChannels()) {
        const target = ch.getTargetNode()
        if (!target) continue
        const name = target.getName() ?? ""
        if (isFaceOrHeadBone(name)) {
          channelsToRemove.push(ch)
          continue
        }
        const baseNode = nameToNode.get(name)
        if (baseNode) ch.setTargetNode(baseNode)
      }
      for (const ch of channelsToRemove) anim.removeChannel(ch)
    }
  }

  await baseDoc.transform(unpartition())
  return await io.writeBinary(baseDoc)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
