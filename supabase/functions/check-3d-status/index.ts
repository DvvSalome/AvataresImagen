import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import * as path from "https://deno.land/std@0.208.0/path/mod.ts"
import { DenoIO, Accessor as GltfAccessor } from "https://esm.sh/@gltf-transform/core@4"
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
      return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null, job.idle_url ?? null, job.walking_url ?? null, job.running_url ?? null)
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
        // Fallback: intentar embeber animaciones en el modelo base con una estrategia simplificada.
        // El cowork solo carga model.glb, así que NECESITAMOS animaciones embebidas.
        console.log("[check-3d] merge failed, attempting simplified embed of animations into model.glb")
        let fallbackBytes: Uint8Array | null = null
        try {
          fallbackBytes = await embedAnimationsIntoBase(baseBytes, walkBytes, runBytes, idleBytes)
        } catch (embedErr) {
          console.error("[check-3d] simplified embed also failed:", embedErr)
        }

        if (fallbackBytes && fallbackBytes.length > 0) {
          const { error: upErr } = await supabase.storage
            .from("avatars")
            .upload(storagePath, fallbackBytes, { contentType: "model/gltf-binary", upsert: true })
          if (upErr) {
            console.error("[check-3d] upload fallback model failed:", upErr.message)
            fallbackBytes = null
          }
        }

        if (!fallbackBytes) {
          // Last resort: upload raw rigged model with synthetic idle only
          console.log("[check-3d] last resort — uploading base model with synthetic idle")
          let lastResortBytes: Uint8Array | null = null
          try {
            const io = new DenoIO(path)
            const doc = await io.readBinary(baseBytes)
            createSyntheticIdleAnimation(doc)
            await doc.transform(unpartition())
            lastResortBytes = await io.writeBinary(doc)
          } catch (e) {
            console.error("[check-3d] synthetic idle injection failed:", e)
          }

          if (lastResortBytes && lastResortBytes.length > 0) {
            await supabase.storage
              .from("avatars")
              .upload(storagePath, lastResortBytes, { contentType: "model/gltf-binary", upsert: true })
          } else {
            // Absolute last resort: raw model without animations
            await downloadToStorage(supabase, riggedGlbUrl, storagePath)
          }
        }
      }

      const publicModelUrl = supabase.storage.from("avatars").getPublicUrl(storagePath).data.publicUrl
      // Animations are always embedded in model.glb now (both merge and fallback paths)
      await updateJob(supabase, jobId, {
        status: "completed",
        model_url: publicModelUrl,
        walking_url: null,
        running_url: null,
        idle_url: null,
        escala: 1.0,
      })

      await deleteFolderFilesExcept(supabase, folderPath, [MODEL_GLB_ONLY])
      console.log(
        "[check-3d] pipeline complete:",
        mergedBytes ? "model.glb (merge completo)" : "model.glb (fallback embed)",
        "escala 1.0 (1.7m), idle siempre incluido",
      )
      return respond("completed", publicModelUrl, null, 100, 1.0, null, null, null)
    }

    // Fallback: unknown status, re-poll
    return respond(job.status, job.model_url, job.error_message, undefined, job.escala ?? null, job.idle_url ?? null, job.walking_url ?? null, job.running_url ?? null)

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
  walkingUrl?: string | null,
  runningUrl?: string | null,
) {
  return new Response(
    JSON.stringify({
      status,
      progress: progress ?? (status === "completed" ? 100 : null),
      model_url: modelUrl ?? null,
      error_message: errorMsg ?? null,
      escala: escala ?? null,
      idle_url: idleUrl ?? null,
      walking_url: walkingUrl ?? null,
      running_url: runningUrl ?? null,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
}

async function updateJob(supabase: any, jobId: string, updates: Record<string, unknown>) {
  // Try different update strategies to handle missing columns gracefully
  const baseUpdate = { updated_at: new Date().toISOString() }
  
  // Strategy 1: Try full update
  try {
    const { error } = await supabase
      .from("avatar_jobs")
      .update({ ...updates, ...baseUpdate })
      .eq("id", jobId)
    if (!error) return
    console.log("[check-3d] Full update failed, trying without optional columns")
  } catch (e) {
    console.log("[check-3d] Full update exception, trying minimal")
  }
  
  // Strategy 2: Try without escala and idle_url (common missing columns)
  try {
    const { status, model_url, walking_url, running_url, ...rest } = updates
    const minimalUpdate = { status, model_url, walking_url, running_url, ...baseUpdate }
    const { error } = await supabase
      .from("avatar_jobs")
      .update(minimalUpdate)
      .eq("id", jobId)
    if (!error) return
    console.log("[check-3d] Update without escala/idle_url failed, trying core only")
  } catch (e) {
    console.log("[check-3d] Update without optional columns exception, trying core only")
  }
  
  // Strategy 3: Try only core columns that should always exist
  const { status, model_url } = updates
  const coreUpdate = { status, model_url, ...baseUpdate }
  const { error } = await supabase
    .from("avatar_jobs")
    .update(coreUpdate)
    .eq("id", jobId)
  if (error) throw error
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

/** Nodos que pueden deformar la cara si se animan (walk/run). Los excluimos del merge.
 *  On chibi models shoulder/arm skin weights bleed into the head, so we also
 *  strip spine, shoulder, arm, hand, and finger channels from locomotion clips.
 *  Only hips + legs should animate during walk/run.
 */
const UPPER_BODY_BONE_PATTERNS = [
  // Head & face
  "head", "neck", "jaw", "face", "eye", "skull", "cabeza", "cuello", "mandibula",
  "cc_base_head", "cc_base_neck", "mixamorighead", "mixamorigneck",
  "armature_head", "armature_neck", "bone_head", "bone_neck",
  // Spine (propagates to head)
  "spine",
  // Arms & shoulders (skin weights bleed into face on chibi)
  "shoulder", "clavicle", "arm", "forearm", "hand", "finger", "thumb",
  "elbow", "wrist",
]

/** Root bone patterns that must NOT be filtered even though they contain 'arm' substring (e.g. 'armature'). */
const ROOT_BONE_EXCLUSIONS = ["armature", "root", "hips", "pelvis"]

function isFaceOrHeadBone(nodeName: string): boolean {
  const lower = nodeName.toLowerCase()
  // Never filter root/hips bones — they are essential for locomotion
  if (ROOT_BONE_EXCLUSIONS.some((r) => lower === r || lower.startsWith(r + "_") || lower.endsWith("_" + r))) return false
  return UPPER_BODY_BONE_PATTERNS.some((p) => lower.includes(p))
}

interface FaceFilterOptions {
  skipFaceFilter?: boolean
}

/** Quita canales de cabeza/cara de un GLB animado para evitar deformación. Devuelve null si falla. */
async function filterFaceChannelsFromGlb(glbBytes: Uint8Array, options?: FaceFilterOptions): Promise<Uint8Array | null> {
  if (options?.skipFaceFilter) return glbBytes
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
 * Mapeo de nombres de huesos conocidos entre Mixamo y Meshy rig.
 * Clave: nombre sin prefijo "mixamorig" (case-insensitive), Valor: posibles nombres en Meshy.
 */
const BONE_ALIASES: Record<string, string[]> = {
  "hips": ["Hips", "hips"],
  "spine": ["Spine", "spine"],
  "spine1": ["Spine01", "spine01", "Spine1"],
  "spine2": ["Spine02", "spine02", "Spine2"],
  "neck": ["neck", "Neck"],
  "head": ["Head", "head"],
  "headtop_end": ["head_end", "headfront", "HeadTop_End"],
  "leftshoulder": ["LeftShoulder", "leftshoulder"],
  "leftarm": ["LeftArm", "leftarm"],
  "leftforearm": ["LeftForeArm", "leftforearm", "LeftForearm"],
  "lefthand": ["LeftHand", "lefthand"],
  "rightshoulder": ["RightShoulder", "rightshoulder"],
  "rightarm": ["RightArm", "rightarm"],
  "rightforearm": ["RightForeArm", "rightforearm", "RightForearm"],
  "righthand": ["RightHand", "righthand"],
  "leftupleg": ["LeftUpLeg", "leftupleg"],
  "leftleg": ["LeftLeg", "leftleg"],
  "leftfoot": ["LeftFoot", "leftfoot"],
  "lefttoebase": ["LeftToeBase", "lefttoebase"],
  "rightupleg": ["RightUpLeg", "rightupleg"],
  "rightleg": ["RightLeg", "rightleg"],
  "rightfoot": ["RightFoot", "rightfoot"],
  "righttoebase": ["RightToeBase", "righttoebase"],
}

/**
 * Construye un resolver que mapea nombres de huesos de animación (ej. mixamorigHips)
 * a nodos del modelo base (ej. Hips). Soporta:
 * 1. Match exacto
 * 2. Strip prefijo "mixamorig" + match exacto
 * 3. Alias conocidos (Spine2→Spine02, HeadTop_End→head_end, etc.)
 * 4. Match case-insensitive
 */
function buildBoneResolver(
  nameToNode: Map<string, any>,
): (animBoneName: string) => any | null {
  // Build lowercase→node map for case-insensitive fallback
  const lowerToNode = new Map<string, any>()
  for (const [name, node] of nameToNode) {
    lowerToNode.set(name.toLowerCase(), node)
  }

  const cache = new Map<string, any | null>()

  return (animBoneName: string) => {
    if (cache.has(animBoneName)) return cache.get(animBoneName)!

    let resolved = null

    // 1. Exact match
    if (nameToNode.has(animBoneName)) {
      resolved = nameToNode.get(animBoneName)
    }

    // 2. Strip "mixamorig" prefix
    if (!resolved) {
      const stripped = animBoneName.replace(/^mixamorig/i, "")
      if (stripped && nameToNode.has(stripped)) {
        resolved = nameToNode.get(stripped)
      }

      // 3. Use known aliases
      if (!resolved && stripped) {
        const aliasKey = stripped.toLowerCase()
        const aliases = BONE_ALIASES[aliasKey]
        if (aliases) {
          for (const alias of aliases) {
            if (nameToNode.has(alias)) {
              resolved = nameToNode.get(alias)
              break
            }
          }
        }
      }

      // 4. Case-insensitive fallback on stripped name
      if (!resolved && stripped) {
        resolved = lowerToNode.get(stripped.toLowerCase()) ?? null
      }
    }

    // 5. Case-insensitive fallback on full name
    if (!resolved) {
      resolved = lowerToNode.get(animBoneName.toLowerCase()) ?? null
    }

    cache.set(animBoneName, resolved)
    return resolved
  }
}

/**
 * Fusiona el modelo base (rigged, sin animaciones) con las animaciones walk/run/idle
 * en un solo GLB con animaciones embebidas. Usa glTF-Transform.
 * Excluye canales que animan cabeza/cara para evitar deformación (cara ancha al caminar).
 *
 * IMPORTANTE: Si idleBytes es null (generación Meshy falló), se crea una animación idle
 * sintética desde el bind pose del esqueleto para que el GLB SIEMPRE tenga un clip "idle".
 * Esto evita T-pose en el cowork Spatial World.
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

  // Build fuzzy resolver for Mixamo → model bone name mapping
  const resolveNode = buildBoneResolver(nameToNode)

  const animatedGlbs: [Uint8Array | null, "walking" | "running" | "idle"][] = [
    [walkBytes, "walking"],
    [runBytes, "running"],
    [idleBytes, "idle"],
  ]

  let hasIdle = false

  for (const [glbBytes, clipName] of animatedGlbs) {
    if (!glbBytes || glbBytes.length === 0) continue
    const sourceDoc = await io.readBinary(glbBytes)
    const anims = sourceDoc.getRoot().listAnimations()
    if (anims.length === 0) continue

    const beforeIds = new Set(root.listAnimations())
    copyToDocument(baseDoc, sourceDoc, anims)

    for (const anim of root.listAnimations()) {
      if (beforeIds.has(anim)) continue
      anim.setName(clipName)
      if (clipName === "idle") hasIdle = true
      const filterFaceChannels = clipName === "walking" || clipName === "running"
      const channelsToRemove: ReturnType<typeof anim.listChannels>[number][] = []
      let mapped = 0, unmapped = 0
      const unmappedNames: string[] = []
      for (const ch of anim.listChannels()) {
        const target = ch.getTargetNode()
        if (!target) continue
        const name = target.getName() ?? ""
        if (filterFaceChannels && isFaceOrHeadBone(name)) {
          channelsToRemove.push(ch)
          continue
        }
        const baseNode = resolveNode(name)
        if (baseNode) {
          ch.setTargetNode(baseNode)
          mapped++
        } else {
          unmapped++
          if (unmappedNames.length < 5) unmappedNames.push(name)
        }
      }
      console.log(`[check-3d] ${clipName}: ${mapped} channels retargeted, ${unmapped} unmapped, ${channelsToRemove.length} face-filtered`, unmappedNames.length > 0 ? `unmapped: ${unmappedNames.join(", ")}` : "")
      for (const ch of channelsToRemove) anim.removeChannel(ch)
    }
  }

  // Fallback: si no hay animación idle, crear una sintética desde el bind pose
  if (!hasIdle) {
    console.log("[check-3d] No idle animation available — generating synthetic idle from bind pose")
    createSyntheticIdleAnimation(baseDoc)
  }

  await baseDoc.transform(unpartition())
  return await io.writeBinary(baseDoc)
}

/**
 * Estrategia simplificada de fallback: lee el modelo base, intenta copiar animaciones
 * de los GLBs de walk/run/idle, y si no hay idle, crea una sintética.
 * No hace retargeteo de nodos (más simple, menos propenso a fallos).
 */
async function embedAnimationsIntoBase(
  baseBytes: Uint8Array,
  walkBytes: Uint8Array | null,
  runBytes: Uint8Array | null,
  idleBytes: Uint8Array | null,
): Promise<Uint8Array | null> {
  const io = new DenoIO(path)
  const baseDoc = await io.readBinary(baseBytes)
  const root = baseDoc.getRoot()

  // Build fuzzy resolver for Mixamo → model bone name mapping
  const nameToNode = new Map<string, ReturnType<typeof root.listNodes>[number]>()
  for (const node of root.listNodes()) {
    const n = node.getName()
    if (n) nameToNode.set(n, node)
  }
  const resolveNode = buildBoneResolver(nameToNode)

  let hasIdle = false
  const animSources: [Uint8Array | null, string][] = [
    [walkBytes, "walking"],
    [runBytes, "running"],
    [idleBytes, "idle"],
  ]

  for (const [bytes, clipName] of animSources) {
    if (!bytes || bytes.length === 0) continue
    try {
      const sourceDoc = await io.readBinary(bytes)
      const anims = sourceDoc.getRoot().listAnimations()
      if (anims.length === 0) continue

      const beforeIds = new Set(root.listAnimations())
      copyToDocument(baseDoc, sourceDoc, anims)

      for (const anim of root.listAnimations()) {
        if (beforeIds.has(anim)) continue
        anim.setName(clipName)
        if (clipName === "idle") hasIdle = true
        const filterFace = clipName === "walking" || clipName === "running"
        const channelsToRemove: ReturnType<typeof anim.listChannels>[number][] = []
        // Retarget channels to base model bones & filter upper body for locomotion
        for (const ch of anim.listChannels()) {
          const target = ch.getTargetNode()
          if (!target) continue
          const name = target.getName() ?? ""
          if (filterFace && isFaceOrHeadBone(name)) {
            channelsToRemove.push(ch)
            continue
          }
          const baseNode = resolveNode(name)
          if (baseNode) ch.setTargetNode(baseNode)
        }
        for (const ch of channelsToRemove) anim.removeChannel(ch)
        if (channelsToRemove.length > 0) {
          console.log(`[check-3d] embedAnimations: filtered ${channelsToRemove.length} upper-body channels from ${clipName}`)
        }
      }
    } catch (e) {
      console.error(`[check-3d] embedAnimationsIntoBase: failed to embed ${clipName}:`, e)
    }
  }

  if (!hasIdle) {
    console.log("[check-3d] embedAnimationsIntoBase: no idle found, creating synthetic")
    createSyntheticIdleAnimation(baseDoc)
  }

  await baseDoc.transform(unpartition())
  return await io.writeBinary(baseDoc)
}

/**
 * Crea una animación "idle" sintética de 2 segundos que mantiene el bind pose
 * (posición de reposo) de todos los huesos del esqueleto. Esto garantiza que
 * el GLB siempre tenga un clip "idle" para que los viewers 3D no muestren T-pose.
 */
function createSyntheticIdleAnimation(
  doc: any,
): void {
  const root = doc.getRoot()
  const anim = doc.createAnimation("idle")

  // Keyframe times: 0s and 2s (a short loopable idle)
  const timeAccessor = doc.createAccessor("idle_time")
    .setType(GltfAccessor.Type.SCALAR)
    .setArray(new Float32Array([0, 2]))

  // Find all skinned joints (skeleton bones) in the document
  const skinnedJoints = new Set<ReturnType<typeof root.listNodes>[number]>()
  for (const skin of root.listSkins()) {
    for (const joint of skin.listJoints()) {
      skinnedJoints.add(joint)
    }
  }

  // If no skins found, fall back to all nodes (some rigs don't use skins explicitly)
  const targetNodes = skinnedJoints.size > 0
    ? Array.from(skinnedJoints)
    : root.listNodes()

  let channelCount = 0
  for (const node of targetNodes) {
    // Translation channel — hold current position
    const t = node.getTranslation()
    const translationAccessor = doc.createAccessor(`idle_t_${node.getName() ?? channelCount}`)
      .setType(GltfAccessor.Type.VEC3)
      .setArray(new Float32Array([t[0], t[1], t[2], t[0], t[1], t[2]]))

    const tSampler = doc.createAnimationSampler()
      .setInput(timeAccessor)
      .setOutput(translationAccessor)
      .setInterpolation("LINEAR")

    anim.addChannel(
      doc.createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath("translation")
        .setSampler(tSampler),
    )

    // Rotation channel — hold current quaternion
    const r = node.getRotation()
    const rotationAccessor = doc.createAccessor(`idle_r_${node.getName() ?? channelCount}`)
      .setType(GltfAccessor.Type.VEC4)
      .setArray(new Float32Array([r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]]))

    const rSampler = doc.createAnimationSampler()
      .setInput(timeAccessor)
      .setOutput(rotationAccessor)
      .setInterpolation("LINEAR")

    anim.addChannel(
      doc.createAnimationChannel()
        .setTargetNode(node)
        .setTargetPath("rotation")
        .setSampler(rSampler),
    )

    channelCount++
  }

  console.log(`[check-3d] Synthetic idle animation created with ${channelCount} bone channels`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
