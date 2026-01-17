import weaviate from 'weaviate-ts-client';
import dotenv from 'dotenv';

dotenv.config();

const client = weaviate.client({
  scheme: 'https',
  host: 'weaviate-production-e0a8.up.railway.app',
});

async function deleteSchema() {
  console.log('🗑️ Deleting existing Product class...');
  
  try {
    await client.schema.classDeleter().withClassName('Product').do();
    console.log('✓ Product class deleted successfully!');
  } catch (error) {
    if (error.message && error.message.includes('not found')) {
      console.log('✓ No existing Product class found (already clean)');
    } else {
      console.error('❌ Error deleting schema:', error.message);
      throw error;
    }
  }
}

deleteSchema()
  .then(() => {
    console.log('✅ Schema deletion complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('💥 Schema deletion failed:', err);
    process.exit(1);
  });