/**
 * Seed the e-commerce schema with enough variety that questions like
 * "top 5 products by revenue last month" return differentiated answers.
 *
 * Run with:
 *   pnpm tsx --env-file=.env.local scripts/seed.ts
 *
 * Non-idempotent. To start fresh:
 *   truncate table public.order_items, public.orders, public.events,
 *                  public.products, public.users restart identity cascade;
 */

import { getSupabaseServiceClient } from "../lib/supabase.js";

const USERS = 100;
const PRODUCTS_PER_CATEGORY = 8;
const ORDERS = 500;
const MAX_ITEMS_PER_ORDER = 5;
const EVENTS = 500;

const CATEGORIES = [
  "Apparel",
  "Electronics",
  "Home",
  "Books",
  "Outdoor",
  "Beauty",
] as const;

const PRODUCT_NOUNS: Record<(typeof CATEGORIES)[number], string[]> = {
  Apparel: ["Tee", "Jacket", "Hoodie", "Cap", "Sneakers", "Jeans", "Scarf", "Belt"],
  Electronics: ["Headphones", "Charger", "Speaker", "Cable", "Mouse", "Keyboard", "Lamp", "Webcam"],
  Home: ["Pillow", "Mug", "Towel", "Blanket", "Candle", "Vase", "Plate", "Bowl"],
  Books: ["Novel", "Cookbook", "Atlas", "Memoir", "Manual", "Journal", "Anthology", "Primer"],
  Outdoor: ["Tent", "Lantern", "Mat", "Bottle", "Backpack", "Compass", "Stove", "Sleeping Bag"],
  Beauty: ["Lotion", "Balm", "Soap", "Cream", "Serum", "Mist", "Scrub", "Mask"],
};

const STATUSES = ["pending", "paid", "shipped", "cancelled"] as const;
// Weight: most orders are paid/shipped, fewer pending/cancelled.
const STATUS_WEIGHTS = [0.10, 0.45, 0.40, 0.05];

const EVENT_NAMES = ["signup", "view", "add_to_cart", "checkout"] as const;

const rand = (min: number, max: number) =>
  Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;
const pickWeighted = <T>(arr: readonly T[], weights: number[]): T => {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return arr[i]!;
  }
  return arr[arr.length - 1]!;
};

function isoDaysAgo(maxDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - randInt(0, maxDays));
  return d.toISOString();
}

async function main() {
  const supabase = getSupabaseServiceClient();
  console.log("→ seeding users...");

  const userRows = Array.from({ length: USERS }, (_, i) => {
    const signup = new Date();
    signup.setDate(signup.getDate() - randInt(0, 365));
    return {
      email: `user${Date.now()}_${i}@example.com`,
      signup_date: signup.toISOString().slice(0, 10),
    };
  });
  const { data: users, error: usersErr } = await supabase
    .from("users")
    .insert(userRows)
    .select("id");
  if (usersErr) throw usersErr;
  console.log(`  inserted ${users.length} users`);

  console.log("→ seeding products...");
  const productRows = CATEGORIES.flatMap((category) =>
    Array.from({ length: PRODUCTS_PER_CATEGORY }, () => ({
      name: `${pick(PRODUCT_NOUNS[category])} #${randInt(100, 999)}`,
      category,
      // Wide price range so revenue rankings are differentiated.
      unit_price: Number(rand(5, 250).toFixed(2)),
    }))
  );
  const { data: products, error: productsErr } = await supabase
    .from("products")
    .insert(productRows)
    .select("id, unit_price");
  if (productsErr) throw productsErr;
  console.log(`  inserted ${products.length} products`);

  console.log("→ seeding orders + order_items...");
  // ~6 months of order history, with a heavier weight on the last 30 days so
  // "last month" questions return non-trivial answers.
  const orderRows = Array.from({ length: ORDERS }, () => {
    const recentBias = Math.random() < 0.4 ? 30 : 180;
    return {
      user_id: pick(users).id,
      created_at: isoDaysAgo(recentBias),
      status: pickWeighted(STATUSES, STATUS_WEIGHTS),
    };
  });
  const { data: orders, error: ordersErr } = await supabase
    .from("orders")
    .insert(orderRows)
    .select("id");
  if (ordersErr) throw ordersErr;
  console.log(`  inserted ${orders.length} orders`);

  const itemRows = orders.flatMap((order) =>
    Array.from({ length: randInt(1, MAX_ITEMS_PER_ORDER) }, () => {
      const product = pick(products);
      return {
        order_id: order.id,
        product_id: product.id,
        quantity: randInt(1, 4),
        // Capture the price at order-time (slightly varied from current).
        unit_price: Number(
          (Number(product.unit_price) * rand(0.95, 1.05)).toFixed(2)
        ),
      };
    })
  );
  const { error: itemsErr } = await supabase
    .from("order_items")
    .insert(itemRows);
  if (itemsErr) throw itemsErr;
  console.log(`  inserted ${itemRows.length} order_items`);

  console.log("→ seeding events...");
  const eventRows = Array.from({ length: EVENTS }, () => ({
    user_id: pick(users).id,
    name: pick(EVENT_NAMES),
    created_at: isoDaysAgo(60),
    properties: { source: pick(["web", "ios", "android"]) },
  }));
  const { error: eventsErr } = await supabase.from("events").insert(eventRows);
  if (eventsErr) throw eventsErr;
  console.log(`  inserted ${eventRows.length} events`);

  console.log("✓ seed complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
