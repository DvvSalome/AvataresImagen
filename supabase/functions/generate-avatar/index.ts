import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GoogleGenAI } from "https://esm.sh/@google/genai@0.14.0"

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

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
    back: "Rotate this EXACT character 180 degrees to show the BACK view. The character must face completely AWAY from the camera. We see the back of the head, the back of the hair, the back of the outfit, and the back of the arms still in T-pose. The hair from behind must be consistent: if it is long hair, the full length of hair must be visible from behind hanging down the back. If it is short hair, it must look short from behind too.",
    left: "Rotate this EXACT character 90 degrees to the left to show the LEFT SIDE profile view. The character's left shoulder faces the camera. We see a clean side profile of the head, hair, and outfit. The hair length and style must wrap around the head consistently with the front view.",
    right: "Rotate this EXACT character 90 degrees to the right to show the RIGHT SIDE profile view. The character's right shoulder faces the camera. We see a clean side profile of the head, hair, and outfit. The hair length and style must wrap around the head consistently with the front view.",
  }

  const prompt = `You are creating a character model sheet (turnaround). This is the FRONT view of a 3D chibi character in T-pose. ${genderContext} The character has "${hairDescription}" and is wearing "${outfitDescription}".

CRITICAL RULES:
- This is the SAME character, just seen from a different angle. Do NOT change ANY design detail.
- The hair color, length, volume, and style must be IDENTICAL — just shown from the new angle.
- The outfit design, color, and fit must be IDENTICAL — just shown from the new angle.
- Keep the EXACT same body proportions, T-pose, 3D chibi style, background, and lighting.
- Do NOT add or remove any accessories, patterns, or details.

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
    const frontPrompt = `You are modifying a 3D chibi character model in T-pose. ${genderContext} Using this character as reference: (1) Change the hair to: "${hairDescription}". (2) Dress the character in: "${outfitDescription}". Keep the EXACT same face, body proportions, and T-pose. Keep the same 3D chibi style. Only modify the hair and the clothing. Same background and lighting. Result must look like the same character with new hair and new outfit. Show the character from the FRONT view, facing directly towards the camera.`

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
    for (const { key, result } of allPerspectives) {
      if (result.status === "rejected") {
        console.warn(`[generate-avatar] perspectiva "${key}" falló:`, (result as PromiseRejectedResult).reason?.message || (result as PromiseRejectedResult).reason)
        continue
      }

      const { base64, mimeType, ext } = (result as PromiseFulfilledResult<{ base64: string; mimeType: string; ext: string }>).value
      const filePath = `${folderName}/${key}.${ext}`
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

      const publicUrl = supabase.storage.from("avatars").getPublicUrl(uploadData.path).data.publicUrl
      console.log(`[generate-avatar] ${key} uploaded:`, publicUrl)

      if (key === "front") {
        frontUrl = publicUrl
      }
    }

    const successCount = allPerspectives.filter((p) => p.result.status === "fulfilled").length
    console.log(`[generate-avatar] done. ${successCount}/4 perspectives generated. Folder: ${folderName}`)

    // Solo devolver la URL frontal al frontend
    return new Response(
      JSON.stringify({ success: true, avatarUrl: frontUrl }),
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
