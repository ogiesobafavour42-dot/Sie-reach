import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  encrypted: boolean("encrypted").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const leads = pgTable(
  "leads",
  {
    id: serial("id").primaryKey(),
    osmId: text("osm_id").unique(),
    name: text("name").notNull(),
    website: text("website"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    city: text("city"),
    niche: text("niche"),
    facts: text("facts").notNull().default("{}"),
    status: text("status").notNull().default("new"),
    previewUrl: text("preview_url"),
    finalUrl: text("final_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("leads_status_idx").on(t.status)],
);

export const sites = pgTable("sites", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  kind: text("kind").notNull(), // sample | final
  files: text("files").notNull().default("{}"), // JSON {path: html}
  url: text("url"),
  netlifySiteId: text("netlify_site_id"),
  status: text("status").notNull().default("building"), // building | live | failed | undeployed
  attempts: integer("attempts").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull(),
    direction: text("direction").notNull(), // out | in
    kind: text("kind").notNull(), // pitch | reply | inbound
    toEmail: text("to_email"),
    fromEmail: text("from_email"),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    status: text("status").notNull(), // pending | approved | sent | rejected | failed | received
    classification: text("classification"),
    summary: text("summary"),
    replyToId: integer("reply_to_id"),
    messageId: text("message_id"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    sentAt: timestamp("sent_at"),
  },
  (t) => [index("messages_lead_idx").on(t.leadId), index("messages_status_idx").on(t.status)],
);

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  kind: text("kind").notNull(), // deposit | final
  amount: integer("amount").notNull(), // kobo
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("pending"), // pending | paid | failed
  mode: text("mode").notNull(), // paystack | manual
  paystackMode: text("paystack_mode"), // test | live
  reference: text("reference").notNull().unique(),
  paymentUrl: text("payment_url"),
  verified: boolean("verified").notNull().default(false),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const blocklist = pgTable("blocklist", {
  email: text("email").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const activity = pgTable("activity", {
  id: serial("id").primaryKey(),
  level: text("level").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pushSubs = pgTable("push_subs", {
  endpoint: text("endpoint").primaryKey(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
