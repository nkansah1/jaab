# Jaab Collection

A foundational full-stack commerce platform for a local-first fashion and lifestyle storefront.

## Run it

```bash
npm start
```

Then open http://localhost:3000.

## Host on Render

The repository includes a Render Blueprint in `render.yaml`.

1. Push the project to GitHub and open [Render](https://render.com).
2. Choose **New → Blueprint**, connect `nkansah1/jaab`, and deploy the `jaab-collection` service from `render.yaml`.
3. In the service's **Environment** settings, add the values for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from your private local `.env`. Add secrets directly in Render; never commit `.env` or paste the service-role key into GitHub.
4. Wait for the service to deploy, then test its Render URL and `/api/health/supabase`.
5. In Render **Settings → Custom Domains**, add your domain. Follow the DNS records Render displays at your domain registrar, then wait for domain verification and TLS/HTTPS to become active.
6. In Supabase **Authentication → URL Configuration**, set the production domain as the Site URL and add the production domain to the Redirect URLs list.

The Blueprint uses Render's free web-service plan, which can spin down when idle and is intended for initial setup/testing. Upgrade the plan for production availability. Orders become durable after you run the latest `supabase/schema.sql`; until that migration is applied, checkout reports a setup error rather than storing orders in volatile memory. App login sessions are still in memory and customers may need to sign in again after a server restart or redeploy.

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

After updating this project, run the latest `supabase/schema.sql` in the Supabase SQL Editor again to install the transactional `create_order` function. Checkout uses that function to reserve current stock and save the order and its line items atomically. Customer order history, the admin order queue, and status changes then read/write the Supabase tables instead of process memory.

Products and orders use Supabase when `SUPABASE_SERVICE_ROLE_KEY` is configured. To grant administrator access, set the user's `role` to `admin` in `public.profiles`, then sign out and back in. A Supabase publishable key is intentionally not allowed to perform protected server writes. Never put the service-role key in frontend code or commit a real key to `.env.example`.

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
