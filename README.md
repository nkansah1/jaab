# Jaab Collection

A foundational full-stack commerce platform for a local-first fashion and lifestyle storefront.

## Run it

```bash
npm start
```

Then open http://localhost:3000.

## Supabase connection

Supabase credentials are loaded server-side from `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
SUPABASE_STORAGE_BUCKET=product-images
```

The service-role key must stay in the server `.env`; never add it to frontend code or commit it. After running `supabase/schema.sql` and adding the key, admin product creation writes product details to `public.products` and uploads selected JPG, PNG, or WebP images to the public `product-images` Storage bucket (or the bucket named by `SUPABASE_STORAGE_BUCKET`). The server creates the bucket on first upload when it does not exist. Product image links are saved in the `products.image` column. The admin form reports whether this server configuration is active.

Check the connection at http://localhost:3000/api/health/supabase. Sign-in credentials are verified by Supabase Auth. The app loads each account's name, email, and role from `public.profiles`; new registrations create a matching profile row.

### Create the database

The complete database schema is in [supabase/schema.sql](supabase/schema.sql). Open the Supabase Dashboard for the project in `SUPABASE_URL`, choose **SQL Editor**, paste that file, and run it once. It creates profiles, products, orders, order items, timestamps, the new-user profile trigger, and row-level security policies.

Products use Supabase when `SUPABASE_SERVICE_ROLE_KEY` is configured; orders still use the in-memory store. To grant administrator access, set the user's `role` to `admin` in `public.profiles`, then sign out and back in. A Supabase publishable key is intentionally not allowed to perform protected server writes. Never put the service-role key in frontend code or commit a real key to `.env.example`.

## Included foundation

- Storefront product listing, search, category filtering and cart persistence
- Customer registration and sign-in through Supabase Auth and `public.profiles`
- Authenticated checkout with address, phone and payment method capture
- Customer order history and delivery status
- Admin order queue with status updates
- Admin inventory controls with stock validation
- JSON API boundaries ready to replace the in-memory store with Postgres, Redis and a payment provider

## Next production steps

Use PostgreSQL for users, products, orders and inventory transactions; Redis for sessions and cart state; an external payment provider such as Flutterwave or a local gateway; object storage for product imagery; and a queue for delivery notifications. Add CSRF protection, rate limiting, email verification, password reset, audit logs, role permissions and automated tests before production launch.
