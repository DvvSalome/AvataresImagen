import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GoogleGenAI } from "https://esm.sh/@google/genai@0.14.0"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

/** Carpeta dentro del bucket avatars donde se guardan todos los avatares (ej. avatar_luisa, etc.) */
const AVATARES_PRUEBA_PREFIX = "avataresPrueba"

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 8192
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j])
  }
  return btoa(binary)
}

interface Perspective {
  key: string
  label: string
}

const SECONDARY_PERSPECTIVES: Perspective[] = [
  { key: "back", label: "trasera" },
  { key: "left", label: "lateral izquierdo" },
  { key: "right", label: "lateral derecho" },
]

function extractImage(response: any): { base64: string; mimeType: string; ext: string } {
  const part = response.candidates?.[0]?.content?.parts?.find(
    (p: { inlineData?: { data: string; mimeType?: string } }) => p.inlineData,
  )
  const base64 = part?.inlineData?.data
  if (!base64) throw new Error("Gemini no devolvió imagen")
  const mimeType = part?.inlineData?.mimeType || "image/png"
  const ext = mimeType.includes("png") ? "png" : "jpg"
  return { base64, mimeType, ext }
}

async function generateRotatedView(
  ai: GoogleGenAI,
  perspective: Perspective,
  frontBase64: string,
  frontMime: string,
  hairDescription: string,
  outfitDescription: string,
  genderContext: string,
): Promise<{ base64: string; mimeType: string; ext: string }> {
  const viewMap: Record<string, string> = {
    back: "Show the BACK view (180° rotation). The character faces completely AWAY from the camera. We must see the FULL BODY from behind: back of the head, hair from behind, back of the outfit, back of both arms in T-pose, back of both legs, and the BACK OF THE SHOES/FEET. The spine line should be centered. Every body part visible in the front view must also be visible here.",
    left: "Show the LEFT SIDE profile view (90° rotation). The character's LEFT shoulder faces the camera. We must see the FULL BODY in profile: side of the head, hair wrapping around the head, side of the torso and outfit, arms extending horizontally (one toward camera, one away), BOTH LEGS in profile, and SHOES/FEET clearly visible at the bottom.",
    right: "Show the RIGHT SIDE profile view (90° rotation). The character's RIGHT shoulder faces the camera. We must see the FULL BODY in profile: side of the head, hair wrapping around the head, side of the torso and outfit, arms extending horizontally (one toward camera, one away), BOTH LEGS in profile, and SHOES/FEET clearly visible at the bottom.",
  }

  const prompt = `You are creating a professional 3D CHARACTER MODEL SHEET (turnaround) for FULL BODY 3D model generation. This is the FRONT view of the character. Generate the ${perspective.label} view.

${genderContext} The character has "${hairDescription}" and is wearing "${outfitDescription}".

CRITICAL - FULL BODY VISIBILITY:
- The ENTIRE character must be visible: head, torso, both arms, both legs, and FEET/SHOES. Do NOT crop or cut off ANY body part.
- The feet/shoes MUST be visible at the bottom. The head MUST be visible at the top.
- The character occupies the same amount of space as in the front view — from head to feet.

ABSOLUTE REQUIREMENTS FOR 3D TEXTURING CONSISTENCY:
- This is the EXACT SAME character rotated to a different angle. NOT a new character.
- BACKGROUND: Pure solid light gray (#D0D0D0). Identical to the front view. NO gradients, NO shadows, NO floor, NO ground plane.
- COLORS: Use the EXACT SAME colors as the front view. Every color (skin tone, hair color, clothing color, shoe color) must be pixel-perfect identical.
- LIGHTING: Same soft, even, uniform lighting as the front view. NO dramatic shadows.
- SCALE & POSITION: Character must be the EXACT same size and centered in the EXACT same position as the front view. The top of the head and bottom of the feet must be at the same vertical positions.
- PROPORTIONS: Identical body proportions, head size, limb length, leg length. The full silhouette height must match exactly.
- POSE: Same T-pose. Arms at the same height and angle. Legs same stance.
- EDGES: Clean, sharp boundaries between skin, hair, and clothing regions.
- STYLE: Same clean 3D render style. NOT painterly, NOT sketchy.

${viewMap[perspective.key]}`

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { mimeType: frontMime, data: frontBase64 } },
        ],
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  })

  return extractImage(response)
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { config } = body
    console.log("[generate-avatar] request start", JSON.stringify({ base: config?.base, hairDescription: config?.hairDescription || config?.hairId }))

    const hairDescription = config?.hairDescription || config?.hairId || ""
    const outfitDescription = (config?.outfitDescription ?? "casual t-shirt").trim()
    const userName = (config?.userName ?? "").trim()
    if (!config?.base || !hairDescription) {
      return new Response(
        JSON.stringify({ error: "Faltan config.base y config.hairDescription", success: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }
    if (!userName) {
      return new Response(
        JSON.stringify({ error: "El nombre es obligatorio para generar el avatar.", success: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const safeName = userName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 30) || "avatar"
    const folderDisplayName = userName.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("_")
    const folderName = `Avatar_${folderDisplayName}`

    const base = config.base === "male" ? "male" : "female"
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim()
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim()
    if (!supabaseUrl || !serviceKey) {
      const msg = "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
      console.error("[generate-avatar]", msg)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    // 1. Descargar imagen base desde Storage
    const baseImageUrl = `${supabaseUrl}/storage/v1/object/public/avatars/bases/base_${base}.jpg`
    const imageRes = await fetch(baseImageUrl)
    if (!imageRes.ok) {
      const msg = `No se encontró la imagen base (base_${base}.jpg). Crea la carpeta 'bases' en el bucket 'avatars' y sube base_female.jpg y base_male.jpg.`
      console.error("[generate-avatar]", msg, "status:", imageRes.status)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }

    const arrayBuffer = await imageRes.arrayBuffer()
    const base64Image = arrayBufferToBase64(arrayBuffer)
    console.log("[generate-avatar] base image downloaded, generating 4 perspectives...")

    // 2. Generar la vista FRONTAL primero (es la referencia para las demás)
    const genderContext = base === "male"
      ? "This is a MALE character. Use masculine hairstyles and clothing appropriate for men."
      : "This is a FEMALE character. Use feminine hairstyles and clothing appropriate for women."
    const frontPrompt = `You are creating a professional 3D CHARACTER MODEL SHEET for a stylized character. This image will be used by an AI system to generate a FULL BODY 3D model, so the ENTIRE body from head to feet must be clearly visible.

${genderContext}

Using this base character as reference, make ONLY these changes:
1. Change the hair to: "${hairDescription}"
2. Dress the character in: "${outfitDescription}"

CRITICAL - FULL BODY VISIBILITY:
- The character must be shown as a COMPLETE FULL BODY figure: head, torso, both arms, both legs, and FEET/SHOES visible.
- The FEET must be clearly visible at the bottom of the character. Do NOT crop or cut off any body part.
- Use a slightly taller proportion than extreme chibi: head should be about 1/3 of total height (NOT 1/2). The body, legs, and feet must be substantial and clearly defined — not tiny.
- Arms must be fully extended in T-pose, clearly visible from shoulder to fingertips.
- Legs must be clearly separated, standing straight, with visible shoes/feet at the bottom.
- Leave a small margin of empty background BELOW the feet and ABOVE the head.

TECHNICAL REQUIREMENTS FOR 3D MODEL TEXTURING:
- BACKGROUND: Pure solid light gray (#D0D0D0) background. NO gradients, NO shadows on background, NO floor, NO ground plane, NO environment.
- POSE: Exact T-pose with arms extended perfectly horizontally. Legs straight, slightly apart.
- COLORS: Use flat, solid, well-defined colors with good contrast. Each region (skin, hair, clothing, shoes) must have a distinct, clean, uniform color. The body and clothing must have STRONG contrast against the gray background.
- LIGHTING: Soft, even, frontal lighting. NO dramatic shadows. The lighting must be perfectly uniform across the ENTIRE character from head to feet.
- EDGES: Clean, sharp edges between different colored regions.
- CENTERING: Character must be perfectly centered horizontally. Vertically, the full body should be centered with equal margins top and bottom.
- SCALE: The FULL BODY (head to feet) should occupy approximately 85% of the image height, ensuring every body part is large enough to be clearly seen.
- VIEW: FRONT view, character facing directly towards the camera.
- STYLE: Clean 3D render look, like a game asset reference sheet. NOT a painting, NOT a sketch.`

    const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY")! })

    console.log("[generate-avatar] generating FRONT view...")
    const frontResponse = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        {
          role: "user",
          parts: [
            { text: frontPrompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    })

    let frontResult: { base64: string; mimeType: string; ext: string }
    try {
      frontResult = extractImage(frontResponse)
    } catch {
      const msg = "Gemini no devolvió imagen para la vista frontal"
      console.error("[generate-avatar]", msg)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      )
    }
    console.log("[generate-avatar] FRONT view generated, now generating back/left/right using front as reference...")

    // 3. Generar las 3 perspectivas restantes EN PARALELO, usando la imagen frontal como referencia
    const secondaryResults = await Promise.allSettled(
      SECONDARY_PERSPECTIVES.map((p) =>
        generateRotatedView(ai, p, frontResult.base64, frontResult.mimeType, hairDescription, outfitDescription, genderContext),
      ),
    )

    // 4. Subir todas las perspectivas a Storage en carpeta Avatar_{Nombre}/
    console.log("[generate-avatar] uploading perspectives to Storage folder:", folderName)
    const supabase = createClient(supabaseUrl, serviceKey)

    const allPerspectives = [
      { key: "front", result: { status: "fulfilled" as const, value: frontResult } },
      ...SECONDARY_PERSPECTIVES.map((p, i) => ({ key: p.key, result: secondaryResults[i] })),
    ]

    let frontUrl = ""
    const uploadedPaths: Record<string, string> = {}

    for (const { key, result } of allPerspectives) {
      if (result.status === "rejected") {
        console.warn(`[generate-avatar] perspectiva "${key}" falló:`, (result as PromiseRejectedResult).reason?.message || (result as PromiseRejectedResult).reason)
        continue
      }

      const { base64, mimeType, ext } = (result as PromiseFulfilledResult<{ base64: string; mimeType: string; ext: string }>).value
      const filePath = `${AVATARES_PRUEBA_PREFIX}/${folderName}/${key}.${ext}`
      const imageBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, imageBytes, { contentType: mimeType, upsert: true })

      if (uploadError) {
        console.error(`[generate-avatar] error subiendo ${key}:`, uploadError.message)
        if (key === "front") {
          return new Response(
            JSON.stringify({ error: `Error al subir imagen frontal: ${uploadError.message}`, success: false }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          )
        }
        continue
      }

      uploadedPaths[key] = uploadData.path
      const publicUrl = supabase.storage.from("avatars").getPublicUrl(uploadData.path).data.publicUrl
      console.log(`[generate-avatar] ${key} uploaded:`, publicUrl)

      if (key === "front") {
        frontUrl = publicUrl
      }
    }

    const successCount = Object.keys(uploadedPaths).length
    console.log(`[generate-avatar] done. ${successCount}/4 perspectives uploaded. Folder: ${folderName}`)

    // 5. Iniciar pipeline Meshy (Multi Image → 3D) con las URLs públicas
    let jobId: string | null = null
    let meshyDebug: string | null = null
    const meshyApiKey = (Deno.env.get("MESHY_API_KEY") ?? Deno.env.get("MESHI_API_KEY") ?? "").trim()

    if (!meshyApiKey) {
      meshyDebug = "MESHY_API_KEY/MESHI_API_KEY not found in env"
      console.warn("[generate-avatar]", meshyDebug)
    } else {
      const imageUrls = ["front", "back", "left", "right"]
        .filter((k) => uploadedPaths[k])
        .map((k) => supabase.storage.from("avatars").getPublicUrl(uploadedPaths[k]).data.publicUrl)

      if (imageUrls.length === 0) {
        meshyDebug = "No images were uploaded successfully for Meshy"
        console.error("[generate-avatar]", meshyDebug)
      } else {
        console.log("[generate-avatar] starting Meshy multi-image-to-3d with", imageUrls.length, "images:", JSON.stringify(imageUrls))

        try {
          const textureDesc = `Full body 3D stylized character with ${hairDescription} hair, wearing ${outfitDescription}, with visible shoes. Complete figure from head to feet. Clean solid colors, smooth skin, game-ready asset.`
          const meshyBody: Record<string, unknown> = {
            image_urls: imageUrls,
            ai_model: "meshy-6",
            should_texture: true,
            enable_pbr: true,
            should_remesh: true,
            topology: "triangle",
            target_polycount: 30000,
            symmetry_mode: "auto",
            pose_mode: "t-pose",
            texture_prompt: textureDesc.slice(0, 600),
          }
          const meshyRes = await fetch("https://api.meshy.ai/openapi/v1/multi-image-to-3d", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${meshyApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(meshyBody),
          })

          const meshyData = await meshyRes.json()
          console.log("[generate-avatar] Meshy response status:", meshyRes.status, "body:", JSON.stringify(meshyData))

          if (!meshyRes.ok) {
            meshyDebug = `Meshy API ${meshyRes.status}: ${JSON.stringify(meshyData)}`
          } else {
            const meshyTaskId = meshyData.result
            console.log("[generate-avatar] Meshy task started:", meshyTaskId)

            const { data: jobData, error: jobError } = await supabase
              .from("avatar_jobs")
              .insert({
                user_name: userName,
                folder_name: folderName,
                front_url: frontUrl,
                meshy_task_id: meshyTaskId,
                status: "creating_3d",
              })
              .select("id")
              .single()

            if (jobError) {
              meshyDebug = `DB insert failed: ${jobError.message}`
              console.error("[generate-avatar]", meshyDebug)
            } else {
              jobId = jobData.id
              console.log("[generate-avatar] avatar_job created:", jobId)
            }
          }
        } catch (meshyErr) {
          meshyDebug = `Exception: ${meshyErr instanceof Error ? meshyErr.message : String(meshyErr)}`
          console.error("[generate-avatar] Meshy pipeline error:", meshyDebug)
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, avatarUrl: frontUrl, jobId, meshyDebug }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const stack = error instanceof Error ? error.stack : undefined
    console.error("[generate-avatar] Exception:", message, stack ?? "")
    return new Response(
      JSON.stringify({ error: message, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }
})
