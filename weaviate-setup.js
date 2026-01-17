import weaviate from "weaviate-ts-client"
import dotenv from "dotenv"

dotenv.config()

// ============================================================================
// WEAVIATE CLIENT
// ============================================================================

const client = weaviate.client({
  scheme: process.env.WEAVIATE_SCHEME || "http",
  host: process.env.WEAVIATE_HOST || "localhost:8080",
})

// ============================================================================
// IMPROVED SCHEMA WITH OCCASION METADATA
// ============================================================================

const PRODUCT_SCHEMA = {
  class: "Product",
  description: "Fashion products with occasion-aware embeddings",
  vectorizer: "none", // We provide our own embeddings from OpenAI
  properties: [
    // Basic product info
    {
      name: "product_id",
      dataType: ["int"],
      description: "Supabase product ID",
      indexInverted: true,
    },
    {
      name: "product_name",
      dataType: ["text"],
      description: "Product name",
      indexInverted: true,
      tokenization: "word",
    },
    {
      name: "description",
      dataType: ["text"],
      description: "Product description",
      indexInverted: true,
      tokenization: "word",
    },
    {
      name: "price",
      dataType: ["number"],
      description: "Product price",
    },
    {
      name: "category",
      dataType: ["text"],
      description: "Product category (tops/bottoms/shoes)",
      indexInverted: true,
      tokenization: "field",
    },
    {
      name: "brand",
      dataType: ["text"],
      description: "Brand name",
      indexInverted: true,
      tokenization: "field",
    },
    {
      name: "color",
      dataType: ["text"],
      description: "Product color",
      indexInverted: true,
      tokenization: "field",
    },
    {
      name: "suitableOccasions",
      dataType: ["text[]"],
      description: "Suitable occasions: workout, party, work, date, vacation, everyday",
      indexInverted: true,
    },
    {
      name: "formalityLevel",
      dataType: ["text"],
      description: "Formality: athletic, casual, smart-casual, business-casual, formal",
      indexInverted: true,
      tokenization: "field",
    },
    {
      name: "heelType",
      dataType: ["text"],
      description: "For shoes: athletic, flat, low-heel, mid-heel, high-heel",
      indexInverted: true,
      tokenization: "field",
    },
  ],
  vectorIndexType: "hnsw",
  vectorIndexConfig: {
    skip: false,
    cleanupIntervalSeconds: 300,
    ef: 100,
    efConstruction: 128,
    maxConnections: 64,
    distance: "cosine",
  },
}

// ============================================================================
// SETUP FUNCTION
// ============================================================================

async function setupWeaviate() {
  console.log("========================================")
  console.log("🔧 WEAVIATE SETUP (IMPROVED)")
  console.log("========================================\n")

  try {
    // Step 1: Test connection
    console.log("1️⃣  Testing connection...")
    const meta = await client.misc.metaGetter().do()
    console.log(`   ✅ Connected to Weaviate ${meta.version}\n`)

    // Step 2: Delete existing schema if exists
    console.log("2️⃣  Checking existing schema...")
    try {
      await client.schema.classDeleter().withClassName("Product").do()
      console.log("   🗑️  Deleted existing Product class\n")
    } catch (e) {
      console.log("   ℹ️  No existing Product class\n")
    }

    // Step 3: Create improved schema
    console.log("3️⃣  Creating improved Product schema...")
    console.log("   📋 New features:")
    console.log("      - suitableOccasions (array)")
    console.log("      - formalityLevel (athletic/casual/formal)")
    console.log("      - heelType (for shoes)")
    await client.schema.classCreator().withClass(PRODUCT_SCHEMA).do()
    console.log("   ✅ Schema created\n")

    // Step 4: Verify
    console.log("4️⃣  Verifying schema...")
    const schema = await client.schema.getter().do()
    const productClass = schema.classes?.find((c) => c.class === "Product")

    if (productClass) {
      console.log("   ✅ Verified! Properties:")
      productClass.properties.forEach((prop) => {
        console.log(`      - ${prop.name} (${prop.dataType.join(", ")})`)
      })
    }

    console.log("\n========================================")
    console.log("✅ SETUP COMPLETE")
    console.log("========================================")
    console.log("\nNext steps:")
    console.log("  1. Run: node embed-products.js")
    console.log("  2. Run: node server.js")
    console.log("========================================\n")
  } catch (error) {
    console.error("\n❌ Setup failed:", error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

setupWeaviate()
