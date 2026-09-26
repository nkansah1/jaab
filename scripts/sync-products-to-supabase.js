const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  });
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
const productsPath = path.join(root, 'data', 'products.json');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.');
}

const headers = (extra = {}) => ({
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  ...extra,
});

async function readResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error_description || payload?.error || `Supabase request failed (${response.status}).`);
  }
  return payload;
}

async function ensureBucket() {
  const bucketResponse = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, {
    headers: headers(),
  });
  if (bucketResponse.ok) return;
  if (bucketResponse.status !== 404) {
    const error = await bucketResponse.clone().json().catch(() => ({}));
    if (error.code !== 'NoSuchBucket' && error.statusCode !== '404') await readResponse(bucketResponse);
  }

  const createResponse = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: bucket,
      name: bucket,
      public: true,
      file_size_limit: 3145728,
      allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    }),
  });
  if (!createResponse.ok && createResponse.status !== 409) await readResponse(createResponse);
}

async function uploadImage(product) {
  if (!product.image?.startsWith('data:image/')) return product.image || '';
  const match = product.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) throw new Error(`Product ${product.id} has an unsupported image format.`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024) {
    throw new Error(`Product ${product.id} image is empty or exceeds 3MB.`);
  }
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
  const objectPath = `catalog/${product.id}-${crypto.randomUUID()}.${extension}`;
  const uploadResponse = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: headers({ 'Content-Type': match[1], 'x-upsert': 'true' }),
    body: bytes,
  });
  await readResponse(uploadResponse);
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

async function main() {
  const products = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
  await ensureBucket();
  const records = [];
  for (const product of products) {
    records.push({
      id: product.id,
      name: product.name,
      category: product.category,
      price: product.price,
      stock: product.stock,
      badge: product.badge || '',
      tone: product.tone || 'clay',
      description: product.description || '',
      emoji: product.emoji || '◒',
      image: await uploadImage(product),
    });
  }

  const upsertResponse = await fetch(`${supabaseUrl}/rest/v1/products?on_conflict=id`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(records),
  });
  await readResponse(upsertResponse);
  console.log(`Synced ${records.length} products to Supabase; uploaded ${records.filter((record) => record.image.startsWith(`${supabaseUrl}/storage/`)).length} product images to bucket "${bucket}".`);
}

main().catch((error) => {
  console.error(`Product sync failed: ${error.message}`);
  process.exitCode = 1;
});
