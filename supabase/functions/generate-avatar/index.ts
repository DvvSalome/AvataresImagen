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

serve(async (req) => {
  // Preflight: debe devolver 204 y CORS para que el navegador permita la petición desde cualquier origen (ej. 192.168.1.3:3000)
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
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    if (!userName) {
      return new Response(
        JSON.stringify({ error: "El nombre es obligatorio para generar el avatar.", success: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
    // Nombre seguro para el archivo: minúsculas, solo letras/números/guion bajo (ej: Luisa García → avatar_luisa_garcia_1739123456)
    const safeName = userName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 30) || "avatar"

    const base = config.base === "male" ? "male" : "female"
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim()
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim()
    if (!supabaseUrl || !serviceKey) {
      const msg = "Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"
      console.error("[generate-avatar]", msg)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 1. Descargar imagen base desde Storage (bucket avatars, carpeta bases)
    const baseImageUrl = `${supabaseUrl}/storage/v1/object/public/avatars/bases/base_${base}.jpg`
    const imageRes = await fetch(baseImageUrl)
    if (!imageRes.ok) {
      const msg = `No se encontró la imagen base (base_${base}.jpg). Crea la carpeta 'bases' en el bucket 'avatars' y sube base_female.jpg y base_male.jpg.`
      console.error("[generate-avatar]", msg, "status:", imageRes.status)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const arrayBuffer = await imageRes.arrayBuffer()
    const base64Image = arrayBufferToBase64(arrayBuffer)
    console.log("[generate-avatar] base image downloaded, calling Gemini...")

    // 2. Llamar a Gemini con la imagen base + prompt de pelo y ropa
    const genderContext = base === "male" 
      ? "This is a MALE character. Use masculine hairstyles and clothing appropriate for men."
      : "This is a FEMALE character. Use feminine hairstyles and clothing appropriate for women."
    const prompt = `You are modifying a 3D chibi character model in T-pose. ${genderContext} Using this character as reference: (1) Change the hair to: "${hairDescription}". (2) Dress the character in: "${outfitDescription}". Keep the EXACT same face, body proportions, and T-pose. Keep the same 3D chibi style. Only modify the hair and the clothing. Same background and lighting. Result must look like the same character with new hair and new outfit.`

    const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY")! })
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Image } },
          ],
        },
      ],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    })

    const part = response.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data: string; mimeType?: string } }) => p.inlineData
    )
    const generatedBase64 = part?.inlineData?.data
    const mimeType = part?.inlineData?.mimeType || "image/png"
    const ext = mimeType.includes("png") ? "png" : "jpg"

    console.log("[generate-avatar] Gemini response received")
    if (!generatedBase64) {
      const msg = "Gemini no devolvió imagen"
      console.error("[generate-avatar]", msg, "response:", JSON.stringify(response?.candidates?.[0]))
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 3. Subir resultado a Storage (avatars/generado/) con nombre de la persona: avatar_luisa_1739123456.png
    console.log("[generate-avatar] uploading to Storage...")
    const fileName = `generado/avatar_${safeName}_${Date.now()}.${ext}`
    const imageBytes = Uint8Array.from(atob(generatedBase64), (c) => c.charCodeAt(0))
    const supabase = createClient(supabaseUrl, serviceKey)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(fileName, imageBytes, { contentType: mimeType, upsert: false })

    if (uploadError) {
      const msg = `Error al subir imagen: ${uploadError.message}`
      console.error("[generate-avatar]", msg)
      return new Response(
        JSON.stringify({ error: msg, success: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const avatarUrl = supabase.storage.from("avatars").getPublicUrl(uploadData.path).data.publicUrl
    console.log("[generate-avatar] success, avatarUrl:", avatarUrl)

    // Devolver solo avatarUrl (no base64) para evitar respuestas enormes que causen timeout
    return new Response(
      JSON.stringify({ success: true, avatarUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    const stack = error instanceof Error ? error.stack : undefined
    console.error("[generate-avatar] Exception:", message, stack ?? "")
    return new Response(
      JSON.stringify({ error: message, success: false }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})
