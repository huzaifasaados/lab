import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import weaviate from "weaviate-ts-client"
import OpenAI from "openai"

dotenv.config()

// ============================================================================
// INITIALIZE
// ============================================================================

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Weaviate Client
const weaviateClient = weaviate.client({
  scheme: process.env.WEAVIATE_SCHEME || "http",
  host: process.env.WEAVIATE_HOST || "localhost:8080",
})

// OpenAI Client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

const EMBEDDING_MODEL = "text-embedding-3-small"

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Build semantic query with occasion context
 */
function buildSemanticQuery(query, occasion, category) {
  let semanticQuery = query

  // Add occasion-specific context words
  const occasionContext = {
    workout: "athletic breathable moisture-wicking performance sportswear activewear gym fitness",
    party: "elegant dressy glamorous sparkle formal evening cocktail stylish festive",
    work: "professional business corporate office tailored polished structured career",
    date: "romantic chic sophisticated feminine elegant stylish trendy dressy",
    vacation: "resort casual travel lightweight comfortable relaxed breezy beach",
    everyday: "casual comfortable versatile everyday basic essential simple",
  }

  const contextWords = occasionContext[occasion] || occasionContext.everyday
  semanticQuery += ` ${contextWords}`

  // Add category context
  semanticQuery += ` ${category}`

  return semanticQuery
}

/**
 * Generate embedding for query
 */
async function generateEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.substring(0, 8000),
    })
    return response.data[0].embedding
  } catch (error) {
    console.error("❌ Embedding error:", error.message)
    return null
  }
}

/**
 * Post-filter products by occasion (safety net)
 */
function postFilterByOccasion(products, occasion, category) {
  if (!occasion || occasion === "everyday") return products

  return products.filter((product) => {
    const name = (product.product_name || "").toLowerCase()
    const desc = (product.description || "").toLowerCase()
    const combined = `${name} ${desc}`

    if (occasion === "workout") {
      const workoutKeywords = [
        "athletic",
        "sport",
        "gym",
        "fitness",
        "training",
        "workout",
        "activewear",
        "performance",
        "moisture",
        "breathable",
        "running",
        "yoga",
        "crossfit",
        "exercise",
        "legging",
        "jogger",
        "track",
        "tank",
        "compression",
        "sweat",
        "sneaker",
        "trainer",
        "runner",
        "ski",
        "water repellent",
        "windproof",
        "fleece",
        "anorak",
        "puffer",
        "hoodie",
        "tech",
        "stretch",
        "recco",
        "thermal",
        "insulated",
        "quick dry",
        "spandex",
        "lycra",
        "mesh",
        "wicking",
      ]

      if (category === "bottoms") {
        // Reject leather pants completely for workout
        if (/leather/i.test(combined)) {
          console.log(`  🚫 Rejected leather item for workout: ${name.substring(0, 50)}`)
          return false
        }

        // Accept leggings/joggers if not formal
        if (/legging|jogger|track pant|athletic pant|gym pant|workout pant|sport pant/i.test(combined)) {
          if (!/sequin|beaded|dress|formal|cocktail|velvet|satin/i.test(combined)) {
            return true
          }
        }
      }

      if (category === "tops") {
        if (/ski|snowboard|water repellent|windproof|anorak|fleece/i.test(combined)) {
          return true
        }
        if (/tank|crop.*(?:top|hoodie|jacket)/i.test(combined) && !/strapless|beaded|sequin/i.test(combined)) {
          return true
        }
      }

      const hasWorkoutKeyword = workoutKeywords.some((k) => combined.includes(k))

      if (!hasWorkoutKeyword) {
        const obviouslyNotWorkout = [
          "zw collection",
          "limited edition",
          "blazer",
          "suit",
          "formal",
          "business",
          "office",
          "dress pants",
          "dress shirt",
          "cocktail",
          "evening",
          "party dress",
          "gown",
          "wedding",
          "prom",
          "tuxedo",
          "bow tie",
          "cufflink",
          "silk blouse",
          "velvet",
          "satin dress",
          "lace dress",
          "sequin",
          "beaded",
          "rhinestone",
          "embroidered",
          "crochet",
          "ruffle",
          "pleated",
          "floral print",
          "polka dot",
          "striped shirt",
          "denim jacket",
          "leather jacket", // Added leather jacket to reject list
          "fur coat",
          "trench coat",
          "cardigan",
          "sweater",
          "wool",
          "cashmere",
          "flannel",
          "corduroy",
        ]

        const isObviouslyNotWorkout = obviouslyNotWorkout.some((k) => combined.includes(k))

        if (isObviouslyNotWorkout) {
          console.log(`  🚫 Rejected non-workout item: ${name.substring(0, 50)}`)
          return false
        }

        return true
      }

      const workoutReject = [
        "sequin",
        "beaded",
        "rhinestone",
        "formal dress",
        "cocktail dress",
        "evening gown",
        "party dress",
        "prom dress",
        "wedding dress",
        "ballgown",
        "tuxedo",
        "leather", // Added leather to formal reject list
      ]

      const hasRejectKeyword = workoutReject.some((k) => combined.includes(k))

      if (hasRejectKeyword) {
        console.log(`  🚫 Rejected formal item for workout: ${name.substring(0, 50)}`)
        return false
      }

      if (category === "shoes") {
        if (/heel|pump|stiletto|dress shoe|oxford.*(?!running)|boot(?!.*(?:running|hiking|athletic))/i.test(combined)) {
          console.log(`  🚫 Rejected non-athletic shoe for workout: ${name.substring(0, 50)}`)
          return false
        }
      }
    }

    if (occasion === "party") {
      const partyReject = [
        "athletic",
        "gym",
        "workout",
        "sport sweat",
        "jogger",
        "legging",
        "sneaker",
        "trainer",
        "running",
        "yoga",
        "fitness",
      ]
      if (partyReject.some((k) => combined.includes(k))) {
        console.log(`  🚫 Rejected athletic item for party: ${name.substring(0, 50)}`)
        return false
      }
    }

    if (occasion === "work") {
      const workReject = ["athletic", "gym", "workout", "sport sweat", "party dress", "sequin", "clubwear"]
      if (workReject.some((k) => combined.includes(k))) {
        console.log(`  🚫 Rejected inappropriate item for work: ${name.substring(0, 50)}`)
        return false
      }
    }

    return true
  })
}

/**
 * Deduplicate products by product_id
 */
function deduplicateProducts(products) {
  const seen = new Set()
  const unique = []

  for (const product of products) {
    if (!seen.has(product.product_id)) {
      seen.add(product.product_id)
      unique.push(product)
    }
  }

  if (seen.size < products.length) {
    console.log(`  🔄 Removed ${products.length - seen.size} duplicate products`)
  }

  return unique
}

/**
 * Calculate diversity score for product selection
 * Ensures variety in price, brand, style, and prevents near-duplicates
 */
function calculateDiversityScore(products) {
  if (products.length === 0) return products

  // Group products by price ranges
  const priceRanges = {
    budget: products.filter((p) => p.price < 50),
    mid: products.filter((p) => p.price >= 50 && p.price < 150),
    premium: products.filter((p) => p.price >= 150 && p.price < 300),
    luxury: products.filter((p) => p.price >= 300),
  }

  // Group by brand
  const brandCounts = {}
  products.forEach((p) => {
    const brand = p.brand || "unknown"
    brandCounts[brand] = (brandCounts[brand] || 0) + 1
  })

  // Track similar names to prevent near-duplicates
  const nameCounts = {}
  products.forEach((p) => {
    // Extract base name (first 3 words) to detect similar products
    const baseName = (p.product_name || "").toLowerCase().split(" ").slice(0, 3).join(" ")
    nameCounts[baseName] = (nameCounts[baseName] || 0) + 1
  })

  // Score each product for diversity
  const scoredProducts = products.map((product, index) => {
    let diversityScore = 0

    // Variety in price ranges (prefer even distribution)
    const priceRange =
      product.price < 50 ? "budget" : product.price < 150 ? "mid" : product.price < 300 ? "premium" : "luxury"
    const rangeCount = priceRanges[priceRange].length
    diversityScore += (1 / rangeCount) * 35 // Max 35 points for price diversity

    // Variety in brands (penalize over-represented brands)
    const brand = product.brand || "unknown"
    const brandFrequency = brandCounts[brand] / products.length
    diversityScore += (1 - brandFrequency) * 25 // Max 25 points for brand diversity

    const baseName = (product.product_name || "").toLowerCase().split(" ").slice(0, 3).join(" ")
    const nameFrequency = nameCounts[baseName] / products.length
    diversityScore += (1 - nameFrequency) * 30 // Max 30 points for name uniqueness

    // Position bonus (gradually decrease to encourage mixing)
    diversityScore += (1 - index / products.length) * 10 // Max 10 points for relevance

    return {
      ...product,
      diversityScore,
      _debug: {
        priceRange,
        brand,
        baseName,
        score: Math.round(diversityScore),
      },
    }
  })

  // Sort by diversity score and remove debug info
  return scoredProducts
    .sort((a, b) => b.diversityScore - a.diversityScore)
    .map(({ _debug, diversityScore, ...product }) => product)
}

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Vector search server is running",
    endpoints: {
      health: "GET /health",
      search: "POST /api/search",
      count: "GET /api/count",
    },
  })
})

app.get("/health", async (req, res) => {
  try {
    const meta = await weaviateClient.misc.metaGetter().do()
    res.json({
      status: "ok",
      service: "vector-search-server",
      weaviate: {
        connected: true,
        version: meta.version,
      },
      openai: {
        model: EMBEDDING_MODEL,
      },
    })
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: error.message,
    })
  }
})

/**
 * Get product count
 */
app.get("/api/count", async (req, res) => {
  try {
    const result = await weaviateClient.graphql.aggregate().withClassName("Product").withFields("meta { count }").do()

    const count = result.data.Aggregate.Product?.[0]?.meta?.count || 0

    res.json({
      success: true,
      count: count,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * MAIN SEARCH ENDPOINT (IMPROVED)
 * Uses hybrid search + occasion filtering + post-filtering + deduplication + diversity
 */
app.post("/api/search", async (req, res) => {
  try {
    const { query, limit = 80, category = "general", occasion = "everyday", priceRange = null } = req.body

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "Query is required",
      })
    }

    console.log(`\n🔍 IMPROVED VECTOR SEARCH:`)
    console.log(`   Query: "${query}"`)
    console.log(`   Category: ${category}`)
    console.log(`   Occasion: ${occasion}`)
    console.log(`   Limit: ${limit}`)

    const semanticQuery = buildSemanticQuery(query, occasion, category)
    console.log(`   Semantic: "${semanticQuery}"`)

    console.log(`   🤖 Generating embedding...`)
    const embedding = await generateEmbedding(semanticQuery)

    if (!embedding) {
      return res.status(500).json({
        success: false,
        error: "Failed to generate embedding",
      })
    }

    console.log(`   ✅ Embedding ready (${embedding.length} dims)`)

    const whereFilters = {
      operator: "And",
      operands: [
        {
          path: ["category"],
          operator: "Equal",
          valueText: category,
        },
      ],
    }

    if (occasion && occasion !== "everyday") {
      whereFilters.operands.push({
        path: ["suitableOccasions"],
        operator: "ContainsAny",
        valueTextArray: [occasion, "everyday"],
      })
    }

    if (occasion === "workout" && category === "shoes") {
      whereFilters.operands.push({
        path: ["heelType"],
        operator: "Equal",
        valueText: "athletic",
      })
      console.log(`   🎯 Forcing athletic shoes for workout`)
    }

    if (priceRange) {
      const minPrice = priceRange.min || 0
      const maxPrice = priceRange.max || 99999

      whereFilters.operands.push({
        path: ["price"],
        operator: "GreaterThanEqual",
        valueNumber: minPrice * 0.8, // 20% below minimum
      })

      if (maxPrice < 99999) {
        whereFilters.operands.push({
          path: ["price"],
          operator: "LessThanEqual",
          valueNumber: maxPrice * 1.2, // 20% above maximum
        })
      }

      console.log(`   💰 Budget: $${minPrice * 0.8} - $${maxPrice * 1.2} (±20% flexibility)`)
    }

    console.log(`   🔎 Searching Weaviate with hybrid search...`)

    const response = await weaviateClient.graphql
      .get()
      .withClassName("Product")
      .withFields(
        "product_id product_name description brand price color category suitableOccasions formalityLevel heelType",
      )
      .withNearVector({ vector: embedding })
      .withWhere(whereFilters)
      .withLimit(limit * 3) // Fetch 3x to ensure variety after all filtering
      .withHybrid({
        query: query,
        alpha: 0.7, // 70% vector, 30% keyword - balanced approach
      })
      .do()

    let products = response.data.Get.Product || []
    console.log(`   ✓ Found ${products.length} products before processing`)

    products = deduplicateProducts(products)
    console.log(`   ✓ ${products.length} unique products after deduplication`)

    products = postFilterByOccasion(products, occasion, category)
    console.log(`   ✓ ${products.length} products after post-filter`)

    products = calculateDiversityScore(products)
    console.log(`   ✓ Diversity scoring applied`)

    products = products.slice(0, limit)

    console.log(`   ✅ Returning ${products.length} products`)
    if (products.length > 0) {
      console.log(
        `   Top 3: ${products
          .slice(0, 3)
          .map((p) => p.product_name?.substring(0, 40))
          .join(", ")}`,
      )
    }

    res.json({
      success: true,
      product_ids: products.map((p) => p.product_id),
      count: products.length,
      query: query,
      category: category,
      occasion: occasion,
    })
  } catch (error) {
    console.error("❌ Search error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

/**
 * Batch search endpoint (for searching multiple categories at once)
 */
app.post("/api/search-batch", async (req, res) => {
  try {
    const { queries } = req.body

    if (!queries || !Array.isArray(queries)) {
      return res.status(400).json({
        success: false,
        error: "Queries array is required",
      })
    }

    console.log(`\n📦 Batch search: ${queries.length} queries`)

    const results = await Promise.all(
      queries.map(async (q) => {
        const semanticQuery = buildSemanticQuery(q.query, q.occasion || "everyday", q.category || "general")
        const embedding = await generateEmbedding(semanticQuery)

        if (!embedding) return { query: q.query, product_ids: [] }

        const whereFilters = {
          operator: "And",
          operands: [
            {
              path: ["category"],
              operator: "Equal",
              valueText: q.category || "general",
            },
          ],
        }

        if (q.occasion && q.occasion !== "everyday") {
          whereFilters.operands.push({
            path: ["suitableOccasions"],
            operator: "ContainsAny",
            valueTextArray: [q.occasion, "everyday"],
          })
        }

        const response = await weaviateClient.graphql
          .get()
          .withClassName("Product")
          .withFields("product_id product_name")
          .withNearVector({ vector: embedding })
          .withWhere(whereFilters)
          .withLimit(q.limit || 80)
          .do()

        const products = response.data.Get.Product || []

        return {
          query: q.query,
          category: q.category,
          occasion: q.occasion,
          product_ids: products.map((p) => p.product_id),
          count: products.length,
        }
      }),
    )

    console.log(`✅ Batch complete\n`)

    res.json({
      success: true,
      results: results,
    })
  } catch (error) {
    console.error("❌ Batch search error:", error)
    res.status(500).json({
      success: false,
      error: error.message,
    })
  }
})

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log("\n========================================")
  console.log("🚀 IMPROVED VECTOR SEARCH SERVER")
  console.log("========================================")
  console.log(`📍 Running on: http://localhost:${PORT}`)
  console.log(`🔗 Weaviate: ${process.env.WEAVIATE_SCHEME}://${process.env.WEAVIATE_HOST}`)
  console.log(`🤖 Model: ${EMBEDDING_MODEL}`)
  console.log("========================================")
  console.log("\n📋 Endpoints:")
  console.log(`   GET  /                    - Service info`)
  console.log(`   GET  /health              - Health check`)
  console.log(`   GET  /api/count           - Product count`)
  console.log(`   POST /api/search          - Vector search (MAIN)`)
  console.log(`   POST /api/search-batch    - Batch search`)
  console.log("\n✅ Server ready!\n")
})
