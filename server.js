const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!match) return;
    const value = match[2].replace(/^['"]|['"]$/g, '').trim();
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  });
}
const PORT = process.env.PORT || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseStorageBucket = process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
const sessionSecret = process.env.SESSION_SECRET || '';
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const missingSupabaseVars = [['SUPABASE_URL', supabaseUrl], ['SUPABASE_ANON_KEY', supabaseAnonKey], ['SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey]].filter(([, value]) => !value).map(([name]) => name);
function listVarNames(names) {
  if (names.length > 2) return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  return names.join(' and ');
}
function supabaseSetupMessage(names) {
  console.error(`Supabase configuration missing: ${names.join(', ')}. Locally add ${names.length > 1 ? 'them' : 'it'} to .env; on a deployed build add ${names.length > 1 ? 'them' : 'it'} in the host's Environment settings, because .env is never committed, then restart.`);
  return `Sign-in is temporarily unavailable because this server is missing ${listVarNames(names)}. Site owner: add ${names.length > 1 ? 'them' : 'it'} in your host's Environment settings, then redeploy.`;
}
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const productsFile = path.join(dataDir, 'products.json');
const sessions = new Map();
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !allowedOrigins.length || !(allowedOrigins.includes('*') || allowedOrigins.includes(origin))) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}

const seedProducts = [
  { id: 'JC-001', name: 'Abeni Woven Tote', category: 'Bags', price: 18500, stock: 18, badge: 'Bestseller', tone: 'clay', description: 'Hand-finished raffia carryall with a structured silhouette.', emoji: '◒' },
  { id: 'JC-002', name: 'Kente Weekender', category: 'Bags', price: 42000, stock: 9, badge: 'New drop', tone: 'indigo', description: 'A roomy travel bag with woven panels and vegetable-tanned leather.', emoji: '✦' },
  { id: 'JC-003', name: 'Asa Mini Crossbody', category: 'Bags', price: 24000, stock: 14, badge: 'Limited', tone: 'ochre', description: 'A compact crossbody with an adjustable strap for everyday movement.', emoji: '⌁' },
  { id: 'JC-004', name: 'Nhyira Eau de Parfum', category: 'Perfumes', price: 12500, stock: 23, badge: 'Everyday', tone: 'olive', description: 'Soft neroli, green fig and clean musk in a 50ml glass bottle.', emoji: '◌' },
  { id: 'JC-005', name: 'Cocoa Bloom Parfum', category: 'Perfumes', price: 16000, stock: 12, badge: 'Giftable', tone: 'wine', description: 'A warm blend of cocoa husk, amber and night-blooming jasmine.', emoji: '≈' },
  { id: 'JC-006', name: 'Volta Neroli Mist', category: 'Perfumes', price: 9500, stock: 31, badge: 'New', tone: 'sand', description: 'A bright, easy-wearing body mist with citrus and neroli leaf.', emoji: '♨' }
];
let products = fs.existsSync(productsFile) ? JSON.parse(fs.readFileSync(productsFile, 'utf8')) : seedProducts;
function saveProducts() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
}

const orders = [];

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
  });
}
function signSessionPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
function readSessionToken(token) {
  const [encoded, signature] = (token || '').split('.');
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  const provided = Buffer.from(signature);
  const valid = Buffer.from(expected);
  if (provided.length !== valid.length || !crypto.timingSafeEqual(provided, valid)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.user || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload.user;
  } catch { return null; }
}
function tokenFor(user) {
  if (!sessionSecret) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, user);
    return token;
  }
  return signSessionPayload({ sub: user.id, exp: Date.now() + sessionTtlMs, user });
}
function currentUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  if (sessionSecret) return readSessionToken(token);
  return sessions.get(token);
}
function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: 'Please sign in to continue.' }); return null; }
  return user;
}
function cleanProduct(product) { return { ...product }; }
function supabaseWriteConfigured() { return Boolean(supabaseUrl && supabaseServiceRoleKey); }
function supabaseHeaders(extra = {}) {
  return { apikey: supabaseServiceRoleKey, Authorization: `Bearer ${supabaseServiceRoleKey}`, ...extra };
}
async function supabaseResponse(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || data?.hint || `Supabase request failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
}
async function ensureProductImageBucket() {
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(supabaseStorageBucket)}`;
  const existing = await fetch(bucketUrl, { headers: supabaseHeaders() });
  if (existing.ok) return;
  if (existing.status !== 404) {
    const error = await existing.clone().json().catch(() => ({}));
    if (error.code !== 'NoSuchBucket' && error.statusCode !== '404') await supabaseResponse(existing);
  }
  const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ id: supabaseStorageBucket, name: supabaseStorageBucket, public: true, file_size_limit: 3145728, allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'] })
  });
  if (!created.ok && created.status !== 409) await supabaseResponse(created);
}
async function uploadProductImage(imageData, productId) {
  if (!imageData) return '';
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) throw new Error('Choose a valid JPG, PNG, or WebP image.');
  const imageBuffer = Buffer.from(match[2], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 3 * 1024 * 1024) throw new Error('Image must be smaller than 3MB.');
  await ensureProductImageBucket();
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[match[1]];
  const objectPath = `${productId}/${crypto.randomUUID()}.${extension}`;
  const uploaded = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseStorageBucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': match[1], 'x-upsert': 'true' }),
    body: imageBuffer
  });
  await supabaseResponse(uploaded);
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseStorageBucket)}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}
async function fetchSupabaseProducts() {
  const response = await fetch(`${supabaseUrl}/rest/v1/products?select=*&order=created_at.asc`, { headers: supabaseHeaders() });
  const records = await supabaseResponse(response);
  return records.map(product => ({ ...product, createdAt: product.created_at, updatedAt: product.updated_at }));
}
function mapSupabaseOrder(order) {
  return {
    id: order.id,
    reference: order.reference,
    userId: order.user_id,
    customer: order.customer,
    phone: order.phone,
    email: order.email,
    items: (order.items || []).map(item => ({ productId: item.productId || item.product_id, name: item.name, quantity: item.quantity, price: item.price })),
    total: order.total,
    status: order.status,
    payment: order.payment,
    address: order.address,
    deliveryAddress: order.deliveryAddress || order.delivery_address,
    createdAt: order.createdAt || order.created_at
  };
}
async function fetchSupabaseOrders(userId) {
  const query = new URLSearchParams({ select: '*,items:order_items(productId:product_id,name,quantity,price)', order: 'created_at.desc' });
  if (userId) query.set('user_id', `eq.${userId}`);
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?${query}`, { headers: supabaseHeaders() });
  return (await supabaseResponse(response)).map(mapSupabaseOrder);
}
async function supabaseOrdersFunctionReady() {
  if (!supabaseWriteConfigured()) return false;
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_order`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        p_order_id: 'JAAB-HEALTH-CHECK',
        p_user_id: '00000000-0000-0000-0000-000000000000',
        p_customer: '',
        p_phone: '',
        p_email: '',
        p_payment: 'Mobile Money',
        p_address: '',
        p_delivery_address: {},
        p_items: []
      })
    });
    const result = await response.json().catch(() => ({}));
    return response.status === 400 && /at least one item/i.test(result.message || '');
  } catch {
    return false;
  }
}
async function supabaseOrdersTablesReady() {
  if (!supabaseWriteConfigured()) return false;
  try {
    const checks = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/orders?select=id&limit=0`, { headers: supabaseHeaders() }),
      fetch(`${supabaseUrl}/rest/v1/order_items?select=id&limit=0`, { headers: supabaseHeaders() })
    ]);
    return checks.every(response => response.ok);
  } catch {
    return false;
  }
}
let ordersRpcChecked;
async function ordersRpcAvailable() {
  if (ordersRpcChecked === undefined) ordersRpcChecked = await supabaseOrdersFunctionReady();
  return ordersRpcChecked;
}
async function supabaseOrderMode() {
  if (await ordersRpcAvailable()) return 'rpc';
  return (await supabaseOrdersTablesReady()) ? 'rest' : 'unavailable';
}
async function fetchSupabaseProduct(productId) {
  const query = new URLSearchParams({ select: 'id,name,price,stock', id: `eq.${encodeURIComponent(productId)}` });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${query}`, { headers: supabaseHeaders() });
  const [product] = await supabaseResponse(response);
  return product || null;
}
async function adjustSupabaseStock(productId, fromStock, toStock) {
  const query = new URLSearchParams({ id: `eq.${encodeURIComponent(productId)}`, stock: `eq.${fromStock}`, select: 'id' });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${query}`, {
    method: 'PATCH',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
    body: JSON.stringify({ stock: toStock })
  });
  return (await supabaseResponse(response)).length > 0;
}
async function reserveSupabaseStock(productId, quantity) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const product = await fetchSupabaseProduct(productId);
    if (!product) throw new Error(`Product ${productId} is no longer available.`);
    if (product.stock < quantity) throw new Error(`${product.name} is no longer available in that quantity.`);
    if (await adjustSupabaseStock(product.id, product.stock, product.stock - quantity)) return product;
  }
  throw new Error('Another order is updating this product. Please try again.');
}
async function releaseSupabaseStock(productId, quantity) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const product = await fetchSupabaseProduct(productId);
    if (!product) return;
    if (await adjustSupabaseStock(product.id, product.stock, product.stock + quantity)) return;
  }
}
async function createSupabaseOrderDirectly(payload) {
  const reserved = [];
  try {
    const lineItems = [];
    for (const item of payload.items) {
      const product = await reserveSupabaseStock(item.productId, item.quantity);
      reserved.push({ productId: product.id, quantity: item.quantity });
      lineItems.push({ productId: product.id, name: product.name, quantity: item.quantity, price: product.price });
    }
    const total = lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderRow = {
      id: payload.orderId, reference: payload.orderId, user_id: payload.userId, customer: payload.customer,
      phone: payload.phone, email: payload.email, total, status: 'Order received', payment: payload.payment,
      address: payload.address, delivery_address: payload.deliveryAddress, created_at: new Date().toISOString()
    };
    const orderResponse = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(orderRow)
    });
    const [created] = await supabaseResponse(orderResponse);
    if (!created) throw new Error('Supabase did not return the new order.');
    const itemResponse = await fetch(`${supabaseUrl}/rest/v1/order_items`, {
      method: 'POST',
      headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify(lineItems.map(item => ({ order_id: payload.orderId, product_id: item.productId, name: item.name, quantity: item.quantity, price: item.price })))
    });
    await supabaseResponse(itemResponse);
    return mapSupabaseOrder({ ...created, items: lineItems });
  } catch (error) {
    for (const entry of reserved) await releaseSupabaseStock(entry.productId, entry.quantity);
    throw error;
  }
}
async function fetchSupabaseProfile(userId) {
  if (!supabaseWriteConfigured()) throw new Error('Supabase profile access is not configured on the server.');
  const query = new URLSearchParams({ select: 'id,name,email,role,created_at', id: `eq.${userId}`, limit: '1' });
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?${query}`, { headers: supabaseHeaders() });
  const [profile] = await supabaseResponse(response);
  return profile || null;
}
async function ensureSupabaseProfile(authUser, name) {
  const existing = await fetchSupabaseProfile(authUser.id);
  if (existing) return existing;
  const response = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ id: authUser.id, name: name || authUser.user_metadata?.name || authUser.email.split('@')[0], email: authUser.email, role: 'customer' })
  });
  const [profile] = await supabaseResponse(response);
  if (!profile) throw new Error('Supabase did not return the new customer profile.');
  return profile;
}
function sessionUserFromProfile(profile) {
  return { id: profile.id, supabaseUserId: profile.id, name: profile.name, email: profile.email, role: profile.role, createdAt: profile.created_at };
}

async function api(req, res, url) {
  const route = url.pathname;
  if (req.method === 'GET' && route === '/api/health/supabase') {
    const catalogSource = supabaseWriteConfigured() ? 'supabase' : 'data/products.json (seed file, not the live catalog)';
    if (!supabaseUrl || !supabaseAnonKey) return json(res, 503, { connected: false, catalogSource, missingVariables: missingSupabaseVars, error: 'Supabase environment variables are missing.' });
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: supabaseAnonKey } });
      const ordersMode = await supabaseOrderMode();
      return json(res, response.ok ? 200 : 502, { connected: response.ok, catalogSource, productUploadsConfigured: supabaseWriteConfigured(), ordersPersistenceConfigured: ordersMode !== 'unavailable', ordersMode, storageBucket: supabaseStorageBucket, project: new URL(supabaseUrl).hostname, service: 'Supabase Auth, product catalog, and orders' });
    } catch (error) {
      return json(res, 502, { connected: false, error: error.message });
    }
  }
  if (req.method === 'GET' && route === '/api/products') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const category = url.searchParams.get('category');
    const catalog = supabaseWriteConfigured() ? await fetchSupabaseProducts() : products;
    const result = catalog.filter(product => (!search || `${product.name} ${product.description} ${product.category}`.toLowerCase().includes(search)) && (!category || category === 'All' || product.category === category));
    return json(res, 200, { products: result.map(cleanProduct), categories: ['All', ...new Set(catalog.map(product => product.category))] });
  }
  if (req.method === 'POST' && route === '/api/auth/login') {
    const data = await body(req);
    const authMissing = missingSupabaseVars.filter(name => name !== 'SUPABASE_SERVICE_ROLE_KEY');
    if (authMissing.length) return json(res, 503, { error: supabaseSetupMessage(authMissing) });
    if (!data.email || !data.password) return json(res, 400, { error: 'Email and password are required.' });
    if (!supabaseWriteConfigured()) return json(res, 503, { error: 'Supabase profile lookup is not configured on the server.' });
    try {
      const supabaseResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.email, password: data.password }) });
      const supabaseData = await supabaseResponse.json();
      if (!supabaseResponse.ok || !supabaseData.user) return json(res, 401, { error: /confirm/i.test(supabaseData.error_description || '') ? 'Please confirm your email before signing in.' : 'Email or password is incorrect.' });
      const supabaseUser = supabaseData.user;
      const profile = await ensureSupabaseProfile(supabaseUser);
      const sessionUser = sessionUserFromProfile(profile);
      const publicUser = { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email, role: sessionUser.role };
      return json(res, 200, { token: tokenFor(sessionUser), user: publicUser });
    } catch (error) {
      return json(res, 502, { error: `Supabase sign in failed: ${error.message}` });
    }
  }
  if (req.method === 'POST' && route === '/api/auth/register') {
    const data = await body(req);
    if (!data.name || !data.email || !data.password || data.password.length < 8) return json(res, 400, { error: 'Name, email and an 8-character password are required.' });
    const authMissing = missingSupabaseVars.filter(name => name !== 'SUPABASE_SERVICE_ROLE_KEY');
    if (authMissing.length) return json(res, 503, { error: supabaseSetupMessage(authMissing) });
    if (!supabaseWriteConfigured()) return json(res, 503, { error: supabaseSetupMessage(['SUPABASE_SERVICE_ROLE_KEY']) });
    let supabaseUser;
    try {
      const supabaseResponse = await fetch(`${supabaseUrl}/auth/v1/signup`, { method: 'POST', headers: { apikey: supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: data.email, password: data.password, data: { name: data.name } }) });
      const supabaseData = await supabaseResponse.json();
      if (!supabaseResponse.ok) {
        const status = supabaseResponse.status === 422 ? 409 : supabaseResponse.status === 429 ? 429 : 502;
        const error = supabaseData.msg || supabaseData.error_description || 'Supabase could not create this account.';
        const emailError = /confirmation email|error sending.*email/i.test(error);
        return json(res, status, { error: status === 429 ? 'Supabase has temporarily limited signup emails. Wait a few minutes, then try one real email address once.' : emailError ? 'Supabase could not send the confirmation email. For local development, disable Confirm email in Authentication > Providers > Email, or configure SMTP in Authentication > SMTP Settings.' : error });
      }
      supabaseUser = supabaseData.user;
    } catch (error) {
      return json(res, 502, { error: `Supabase registration failed: ${error.message}` });
    }
    if (!supabaseUser?.id) return json(res, 502, { error: 'Supabase created the account without returning its user ID.' });
    try {
      const profile = await ensureSupabaseProfile(supabaseUser, data.name.trim());
      const sessionUser = sessionUserFromProfile(profile);
      const publicUser = { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email, role: sessionUser.role };
      return json(res, 201, { token: tokenFor(sessionUser), user: publicUser });
    } catch (error) {
      return json(res, 502, { error: `Account was created, but its Supabase profile could not be loaded: ${error.message}` });
    }
  }
  if (req.method === 'GET' && route === '/api/orders') {
    const user = requireUser(req, res); if (!user) return;
    if (supabaseWriteConfigured() && user.supabaseUserId) {
      try {
        return json(res, 200, { orders: await fetchSupabaseOrders(user.supabaseUserId) });
      } catch (error) {
        return json(res, 502, { error: `Could not load your Supabase orders: ${error.message}` });
      }
    }
    return json(res, 200, { orders: orders.filter(order => order.userId === user.id) });
  }
  if (req.method === 'POST' && route === '/api/orders') {
    const user = requireUser(req, res); if (!user) return;
    const data = await body(req);
    const deliveryAddress = {
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      zipCode: data.zipCode || ''
    };
    if (!Array.isArray(data.items) || !data.items.length || data.items.some(item => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1) || !deliveryAddress.address || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.zipCode || !data.phone || !['Mobile Money', 'Pay on delivery'].includes(data.payment)) return json(res, 400, { error: 'Cart items, delivery address, city, state/region, ZIP code, phone number and a valid payment method are required.' });
    if (supabaseWriteConfigured() && user.supabaseUserId) {
      const orderReference = `JAAB-${Date.now().toString(36).slice(-6).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const address = [deliveryAddress.address, deliveryAddress.city, deliveryAddress.state, deliveryAddress.zipCode].join(', ');
      const mode = await supabaseOrderMode();
      if (mode === 'unavailable') return json(res, 503, { error: 'Supabase order storage is not installed yet. Run the latest supabase/schema.sql in your Supabase SQL Editor, then retry checkout.' });
      try {
        if (mode === 'rpc') {
          const response = await fetch(`${supabaseUrl}/rest/v1/rpc/create_order`, {
            method: 'POST',
            headers: supabaseHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              p_order_id: orderReference,
              p_user_id: user.supabaseUserId,
              p_customer: user.name,
              p_phone: data.phone,
              p_email: user.email,
              p_payment: data.payment,
              p_address: address,
              p_delivery_address: deliveryAddress,
              p_items: data.items.map(item => ({ productId: item.productId, quantity: item.quantity }))
            })
          });
          const order = await supabaseResponse(response);
          return json(res, 201, { order: mapSupabaseOrder(order) });
        }
        const order = await createSupabaseOrderDirectly({
          orderId: orderReference,
          userId: user.supabaseUserId,
          customer: user.name,
          phone: data.phone,
          email: user.email,
          payment: data.payment,
          address,
          deliveryAddress,
          items: data.items.map(item => ({ productId: item.productId, quantity: item.quantity }))
        });
        return json(res, 201, { order });
      } catch (error) {
        if (/Could not find the function public\.create_order|schema cache/i.test(error.message)) {
          ordersRpcChecked = false;
          return json(res, 503, { error: 'Supabase order storage is not installed yet. Run the latest supabase/schema.sql in your Supabase SQL Editor, then retry checkout.' });
        }
        const status = /no longer available|not available in that quantity|Please try again/i.test(error.message) ? 409 : 502;
        return json(res, status, { error: `Supabase could not create the order: ${error.message}` });
      }
    }
    const lineItems = [];
    for (const item of data.items) {
      const product = products.find(entry => entry.id === item.productId);
      if (!product || product.stock < item.quantity) return json(res, 409, { error: `${product?.name || 'A product'} is no longer available in that quantity.` });
      lineItems.push({ productId: product.id, name: product.name, quantity: item.quantity, price: product.price });
    }
    lineItems.forEach(item => { products.find(product => product.id === item.productId).stock -= item.quantity; });
    saveProducts();
    const orderReference = `JAAB-${Date.now().toString(36).slice(-6).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const order = { id: orderReference, reference: orderReference, userId: user.id, customer: user.name, phone: data.phone || '', email: user.email, items: lineItems, total: lineItems.reduce((sum, item) => sum + item.price * item.quantity, 0), status: 'Order received', payment: data.payment, address: [deliveryAddress.address, deliveryAddress.city, deliveryAddress.state, deliveryAddress.zipCode].filter(Boolean).join(', '), deliveryAddress, createdAt: new Date().toISOString() };
    orders.unshift(order);
    return json(res, 201, { order });
  }
  if (req.method === 'POST' && route === '/api/admin/products') {
    const user = requireUser(req, res); if (!user || user.role !== 'admin') return user ? json(res, 403, { error: 'Admin access required.' }) : undefined;
    const data = await body(req);
    const allowedCategories = ['Bags', 'Perfumes'];
    if (typeof data.name !== 'string' || !data.name.trim() || !allowedCategories.includes(data.category) || !Number.isFinite(data.price) || data.price < 0 || !Number.isInteger(data.stock) || data.stock < 0 || typeof data.badge !== 'string' || typeof data.description !== 'string' || (data.image && (!data.image.startsWith('data:image/') || data.image.length > 4_000_000))) return json(res, 400, { error: 'Name, category, price, stock, badge and description are required. Images must be valid and under 3MB.' });
    if (!supabaseWriteConfigured()) return json(res, 503, { error: 'Supabase product uploads are not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server .env, then restart the app.' });
    const productId = `JC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    let image;
    try {
      image = await uploadProductImage(data.image || '', productId);
      const product = { id: productId, name: data.name.trim(), category: data.category, price: data.price, stock: data.stock, badge: data.badge.trim(), tone: data.category === 'Bags' ? 'clay' : 'olive', description: data.description.trim(), emoji: data.category === 'Bags' ? '◒' : '◌', image };
      const response = await fetch(`${supabaseUrl}/rest/v1/products`, {
        method: 'POST',
        headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(product)
      });
      const [created] = await supabaseResponse(response);
      return json(res, 201, { product: { ...created, createdAt: created.created_at, updatedAt: created.updated_at } });
    } catch (error) {
      const missingTable = /relation .*products.* does not exist|Could not find the table .*products/i.test(error.message);
      return json(res, 502, { error: missingTable ? 'The Supabase products table is missing. Run supabase/schema.sql in your Supabase SQL Editor, then retry.' : `Supabase could not save the product: ${error.message}` });
    }
  }
  if (route === '/api/admin/orders' && req.method === 'GET') {
    const user = requireUser(req, res); if (!user || user.role !== 'admin') return user ? json(res, 403, { error: 'Admin access required.' }) : undefined;
    if (supabaseWriteConfigured()) {
      try {
        return json(res, 200, { orders: await fetchSupabaseOrders() });
      } catch (error) {
        return json(res, 502, { error: `Could not load Supabase orders: ${error.message}` });
      }
    }
    return json(res, 200, { orders });
  }
  if (route === '/api/admin/users' && req.method === 'GET') {
    const user = requireUser(req, res); if (!user || user.role !== 'admin') return user ? json(res, 403, { error: 'Admin access required.' }) : undefined;
    if (!supabaseWriteConfigured()) return json(res, 503, { error: 'Supabase profile lookup is not configured on the server.' });
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id,name,email,role,created_at&order=created_at.desc`, { headers: supabaseHeaders() });
      const profiles = await supabaseResponse(response);
      return json(res, 200, { users: profiles.map(profile => ({ id: profile.id, name: profile.name, email: profile.email, role: profile.role, createdAt: profile.created_at })) });
    } catch (error) {
      return json(res, 502, { error: `Could not load Supabase profiles: ${error.message}` });
    }
  }
  if (route.startsWith('/api/admin/orders/') && req.method === 'PATCH') {
    const user = requireUser(req, res); if (!user || user.role !== 'admin') return user ? json(res, 403, { error: 'Admin access required.' }) : undefined;
    if (supabaseWriteConfigured()) {
      const data = await body(req);
      if (!['Order received', 'Processing', 'Out for delivery', 'Delivered', 'Cancelled'].includes(data.status)) return json(res, 400, { error: 'Unsupported order status.' });
      const orderId = route.split('/').pop();
      const query = new URLSearchParams({ id: `eq.${orderId}`, select: 'id' });
      try {
        const response = await fetch(`${supabaseUrl}/rest/v1/orders?${query}`, {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
          body: JSON.stringify({ status: data.status })
        });
        const updated = await supabaseResponse(response);
        if (!updated.length) return json(res, 404, { error: 'Order not found.' });
        const order = (await fetchSupabaseOrders()).find(item => item.id === orderId);
        return json(res, 200, { order });
      } catch (error) {
        return json(res, 502, { error: `Could not update the Supabase order: ${error.message}` });
      }
    }
    const order = orders.find(item => item.id === route.split('/').pop());
    if (!order) return json(res, 404, { error: 'Order not found.' });
    const data = await body(req); if (!['Order received', 'Processing', 'Out for delivery', 'Delivered', 'Cancelled'].includes(data.status)) return json(res, 400, { error: 'Unsupported order status.' });
    order.status = data.status; return json(res, 200, { order });
  }
  if (route.startsWith('/api/admin/products/') && req.method === 'PATCH') {
    const user = requireUser(req, res); if (!user || user.role !== 'admin') return user ? json(res, 403, { error: 'Admin access required.' }) : undefined;
    const data = await body(req);
    const allowedCategories = ['Bags', 'Perfumes'];
    if (typeof data.name !== 'string' || !data.name.trim() || !allowedCategories.includes(data.category) || !Number.isFinite(data.price) || data.price < 0 || !Number.isInteger(data.stock) || data.stock < 0 || typeof data.badge !== 'string' || typeof data.description !== 'string' || (data.image && (!data.image.startsWith('data:image/') || data.image.length > 4_000_000))) return json(res, 400, { error: 'Name, category, price, stock, badge and description are required. Images must be valid and under 3MB.' });
    const productId = route.split('/').pop();
    if (supabaseWriteConfigured()) {
      try {
        const image = data.image ? await uploadProductImage(data.image, productId) : undefined;
        const updates = { name: data.name.trim(), category: data.category, price: data.price, stock: data.stock, badge: data.badge.trim(), description: data.description.trim(), tone: data.category === 'Bags' ? 'clay' : 'olive', emoji: data.category === 'Bags' ? '◒' : '◌' };
        if (image !== undefined) updates.image = image;
        const response = await fetch(`${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(productId)}&select=*`, {
          method: 'PATCH',
          headers: supabaseHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
          body: JSON.stringify(updates)
        });
        const [updated] = await supabaseResponse(response);
        if (!updated) return json(res, 404, { error: 'Product not found in Supabase.' });
        return json(res, 200, { product: { ...updated, createdAt: updated.created_at, updatedAt: updated.updated_at } });
      } catch (error) {
        return json(res, 502, { error: `Supabase could not update the product: ${error.message}` });
      }
    }
    const product = products.find(item => item.id === productId); if (!product) return json(res, 404, { error: 'Product not found.' });
    product.name = data.name.trim(); product.category = data.category; product.price = data.price; product.stock = data.stock; product.badge = data.badge.trim(); product.description = data.description.trim(); if (data.image !== undefined) product.image = data.image;
    saveProducts();
    return json(res, 200, { product });
  }
  return json(res, 404, { error: 'Route not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  Object.entries(corsHeaders(req)).forEach(([header, value]) => res.setHeader(header, value));
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); } catch (error) { json(res, 500, { error: error.message || 'Unexpected server error.' }); }
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
  fs.readFile(filePath, (error, content) => {
    if (error) return json(res, 404, { error: 'Page not found.' });
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' }); res.end(content);
  });
});
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Close the other Jaab process (run: lsof -ti:${PORT} | xargs kill) or set PORT in .env to a free port.`);
  else if (error.code === 'EACCES') console.error(`Port ${PORT} needs administrator rights. Use a port above 1024.`);
  else console.error(`Server failed to start: ${error.message}`);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`Jaab Collection running at http://localhost:${PORT}`);
  if (missingSupabaseVars.length) console.warn(`WARNING: missing ${missingSupabaseVars.join(', ')}. Sign-in and sign-up stay disabled, and the catalog falls back to data/products.json until they are set.`);
  if (!sessionSecret) console.warn('WARNING: SESSION_SECRET is not set, so sign-in tokens are kept in this process memory. They break on every restart and on serverless hosts (Vercel, Railway) where each request may land on a fresh instance. Set SESSION_SECRET in .env or your host environment to issue signed tokens that any instance can verify.');
});
