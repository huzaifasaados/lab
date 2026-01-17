import { createClient } from "@supabase/supabase-js"
import weaviate from "weaviate-ts-client"
import OpenAI from "openai"
import dotenv from "dotenv"

dotenv.config()

// ============================================================================
// CLIENTS
// ============================================================================

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const weaviateClient = weaviate.client({
  scheme: process.env.WEAVIATE_SCHEME || "http",
  host: process.env.WEAVIATE_HOST || "localhost:8080",
})

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// ============================================================================
// CONFIG
// ============================================================================

const EMBEDDING_MODEL = "text-embedding-3-small"
const BATCH_SIZE = 50

// ============================================================================
// OCCASION & FORMALITY DETECTION (FROM ORIGINAL SYSTEM)
// ============================================================================

function detectSuitableOccasions(name, desc) {
  const combined = `${name} ${desc}`.toLowerCase()
  const occasions = []

  // WORKOUT - Strict criteria (must have athletic indicators AND no formal elements)
  const workoutKeywords = [
    "athletic",
    "sport",
    "gym",
    "fitness",
    "training",
    "workout",
    "activewear",
    "performance",
    "running",
    "yoga",
    "jogging",
    "moisture wicking",
    "breathable",
    "compression",
    "dri-fit",
    "sneaker",
    "trainer",
    "legging",
    "jogger athletic",
    "sports bra",
  ]
  const workoutReject = [
    "formal",
    "evening",
    "cocktail",
    "party dress",
    "gala",
    "sequin",
    "beaded",
    "velvet gown",
    "heel",
    "pump",
    "stiletto",
  ]

  const hasWorkout = workoutKeywords.some((k) => combined.includes(k))
  const hasWorkoutReject = workoutReject.some((k) => combined.includes(k))

  if (hasWorkout && !hasWorkoutReject) {
    occasions.push("workout")
  }

  // PARTY - Dressy items
  const partyKeywords = [
    "party",
    "evening",
    "cocktail",
    "formal",
    "sequin",
    "sparkle",
    "metallic",
    "satin",
    "velvet",
    "elegant",
    "dressy",
    "gala",
  ]
  if (partyKeywords.some((k) => combined.includes(k))) {
    occasions.push("party")
  }

  // WORK - Professional items
  const workKeywords = ["office", "business", "professional", "corporate", "blazer", "suit", "tailored", "structured"]
  if (workKeywords.some((k) => combined.includes(k))) {
    occasions.push("work")
  }

  // DATE - Stylish items
  const dateKeywords = ["date", "romantic", "elegant", "chic", "sophisticated", "feminine", "flirty", "dressy"]
  if (dateKeywords.some((k) => combined.includes(k))) {
    occasions.push("date")
  }

  // VACATION - Casual travel items
  const vacationKeywords = [
    "vacation",
    "resort",
    "beach",
    "summer",
    "tropical",
    "travel",
    "linen",
    "lightweight",
    "breezy",
  ]
  if (vacationKeywords.some((k) => combined.includes(k))) {
    occasions.push("vacation")
  }

  // EVERYDAY - Default for most items (but NOT workout-only items)
  if (occasions.length === 0 || (!occasions.includes("workout") && !occasions.includes("party"))) {
    occasions.push("everyday")
  }

  return occasions.length > 0 ? occasions : ["everyday"]
}

function detectFormalityLevel(name, desc, occasions) {
  const combined = `${name} ${desc}`.toLowerCase()

  if (occasions.includes("workout")) return "athletic"
  if (occasions.includes("party")) return "formal"
  if (occasions.includes("work")) return "business-casual"

  const casualKeywords = ["casual", "relaxed", "comfortable", "everyday", "basic"]
  if (casualKeywords.some((k) => combined.includes(k))) return "casual"

  const smartKeywords = ["smart", "polished", "tailored", "structured", "chic"]
  if (smartKeywords.some((k) => combined.includes(k))) return "smart-casual"

  return "casual"
}

function detectHeelType(name, desc, category) {
  if (category !== "shoes") return "n/a"

  const combined = `${name} ${desc}`.toLowerCase()

  if (/sneaker|trainer|runner|athletic|sport/i.test(combined)) return "athletic"
  if (/flat|loafer|slipper|ballet/i.test(combined)) return "flat"
  if (/stiletto|high heel|platform/i.test(combined)) return "high-heel"
  if (/kitten heel|low heel/i.test(combined)) return "low-heel"
  if (/mid heel|block heel|wedge/i.test(combined)) return "mid-heel"

  return "flat"
}

function detectCategory(product) {
  const name = (product.product_name || "").toLowerCase()
  const desc = (product.description || "").toLowerCase()
  const combined = `${name} ${desc}`

  if (/shirt|blouse|top|tank|tee|sweater|cardigan|hoodie|jacket|blazer|coat|vest/.test(combined)) {
    return "tops"
  }
  if (/pant|jean|trouser|legging|short|skirt|jogger|culotte|cargo|chino/.test(combined)) {
    return "bottoms"
  }
  if (/shoe|sneaker|boot|sandal|trainer|runner|loafer|heel|flat|pump/.test(combined)) {
    return "shoes"
  }
  return "unknown"
}

// ============================================================================
// CREATE RICH EMBEDDING TEXT WITH CONTEXT
// ============================================================================

function createEmbeddingText(product, category, occasions, formalityLevel, heelType) {
  const name = product.product_name || ""
  const desc = (product.description || "").substring(0, 500)
  const color = product.colour || product.color || ""
  const brand = product.brand || ""

  let text = `${name}. ${desc}`

  // Add category context
  text += ` This is a ${category} item.`

  // Add occasion context (CRITICAL for matching)
  text += ` Suitable for: ${occasions.join(", ")}.`

  // Add formality level
  text += ` Formality level: ${formalityLevel}.`

  // Add heel info for shoes
  if (category === "shoes" && heelType !== "n/a") {
    text += ` Heel type: ${heelType}.`
  }

  // Add color and brand
  if (color) text += ` Color: ${color}.`
  if (brand) text += ` Brand: ${brand}.`

  return text.trim()
}

// ============================================================================
// GENERATE EMBEDDINGS WITH OPENAI
// ============================================================================

async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000),
    })
    return response.data[0].embedding
  } catch (error) {
    console.error("   ❌ Embedding error:", error.message)
    return null
  }
}

// ============================================================================
// BATCH IMPORT TO WEAVIATE
// ============================================================================

async function batchImport(products) {
  let batcher = weaviateClient.batch.objectsBatcher()
  let counter = 0
  let successCount = 0

  for (const product of products) {
    if (!product.embedding) continue

    batcher = batcher.withObject({
      class: "Product",
      properties: {
        product_id: product.product_id,
        product_name: product.product_name || "Unknown",
        description: (product.description || "").substring(0, 1000),
        price: Number.parseFloat(product.price) || 0,
        category: product.category || "unknown",
        brand: product.brand || "Unknown",
        color: product.color || "N/A",
        suitableOccasions: product.suitableOccasions || ["everyday"],
        formalityLevel: product.formalityLevel || "casual",
        heelType: product.heelType || "n/a",
      },
      vector: product.embedding,
    })

    counter++

    if (counter % BATCH_SIZE === 0) {
      await batcher.do()
      successCount += BATCH_SIZE
      console.log(`   ✅ Imported ${successCount}`)
      batcher = weaviateClient.batch.objectsBatcher()
    }
  }

  if (counter % BATCH_SIZE !== 0) {
    await batcher.do()
    successCount += counter % BATCH_SIZE
    console.log(`   ✅ Imported ${successCount}`)
  }

  return successCount
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log("========================================")
  console.log("🚀 IMPROVED PRODUCT EMBEDDING")
  console.log("========================================\n")

  const startTime = Date.now()

  // Fetch products with pagination
  console.log("1️⃣  Fetching from Supabase with pagination...")

  let allProducts = []
  let page = 0
  const pageSize = 1000
  let hasMore = true

  while (hasMore) {
    const { data: products, error } = await supabase
      .from("zara_cloth_test")
      .select("*")
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) {
      console.error("   ❌ Supabase error:", error)
      process.exit(1)
    }

    if (products.length === 0) {
      hasMore = false
    } else {
      allProducts = [...allProducts, ...products]
      page++
      console.log(`   📄 Fetched page ${page}: ${products.length} products (total: ${allProducts.length})`)
    }
  }

  console.log(`   ✅ Fetched ${allProducts.length} total products\n`)

  // Filter valid products
  console.log("2️⃣  Filtering valid products...")
  const valid = allProducts.filter((p) => {
    const hasName = p.product_name?.trim() && p.product_name.length > 2
    const hasPrice = Number.parseFloat(p.price) > 0
    const category = detectCategory(p)
    return hasName && hasPrice && category !== "unknown"
  })
  console.log(`   ✅ ${valid.length} valid products (removed ${allProducts.length - valid.length})\n`)

  // Process and generate embeddings
  console.log("3️⃣  Generating embeddings with OpenAI...")
  console.log(`   Processing ${BATCH_SIZE} at a time\n`)

  const productsWithEmbeddings = []
  let embeddingCount = 0

  for (let i = 0; i < valid.length; i += BATCH_SIZE) {
    const batch = valid.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(valid.length / BATCH_SIZE)

    console.log(`   📦 Batch ${batchNum}/${totalBatches}`)

    const results = await Promise.all(
      batch.map(async (product) => {
        const category = detectCategory(product)
        const name = product.product_name || ""
        const desc = product.description || ""

        const occasions = detectSuitableOccasions(name, desc)
        const formalityLevel = detectFormalityLevel(name, desc, occasions)
        const heelType = detectHeelType(name, desc, category)

        const embeddingText = createEmbeddingText(product, category, occasions, formalityLevel, heelType)

        const embedding = await generateEmbedding(embeddingText)

        if (embedding) embeddingCount++

        return {
          product_id: product.id,
          product_name: product.product_name,
          description: product.description,
          price: product.price,
          brand: product.brand,
          color: product.colour || product.color,
          category: category,
          suitableOccasions: occasions,
          formalityLevel: formalityLevel,
          heelType: heelType,
          embedding: embedding,
        }
      }),
    )

    productsWithEmbeddings.push(...results)
    console.log(`      ✅ Generated ${results.filter((r) => r.embedding).length} embeddings`)

    // Rate limiting to avoid OpenAI rate limits
    if (i + BATCH_SIZE < valid.length) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  console.log(`\n   ✅ Total: ${embeddingCount} embeddings generated\n`)

  // Import to Weaviate
  console.log("4️⃣  Importing to Weaviate...\n")
  const imported = await batchImport(productsWithEmbeddings)

  // Verify
  console.log("\n5️⃣  Verifying...")
  const result = await weaviateClient.graphql.aggregate().withClassName("Product").withFields("meta { count }").do()

  const count = result.data.Aggregate.Product?.[0]?.meta?.count || 0
  console.log(`   ✅ Weaviate has ${count} products\n`)

  const duration = Math.round((Date.now() - startTime) / 1000)

  console.log("========================================")
  console.log("✅ EMBEDDING COMPLETE")
  console.log("========================================")
  console.log(`⏱️  Duration: ${duration}s`)
  console.log(`📊 Processed: ${valid.length}`)
  console.log(`🤖 Embeddings: ${embeddingCount}`)
  console.log(`✅ Imported: ${imported}`)
  console.log(`💾 In Weaviate: ${count}`)
  console.log("========================================\n")

  console.log("Next: node server.js\n")
}

main().catch((err) => {
  console.error("❌ Fatal error:", err)
  process.exit(1)
})
