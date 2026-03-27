import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const translations = sqliteTable("translations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filename: text("filename").notNull(),
  originalPath: text("original_path").notNull(),
  translatedPath: text("translated_path"),
  targetLang: text("target_lang").notNull().default("RU"),
  engine: text("engine").notNull().default("google"),
  status: text("status").notNull().default("pending"), // pending, processing, completed, error
  progress: integer("progress").default(0),
  progressMessage: text("progress_message"),
  errorMessage: text("error_message"),
  pageCount: integer("page_count"),
  createdAt: text("created_at").notNull(),
});

export const insertTranslationSchema = createInsertSchema(translations).omit({
  id: true,
  translatedPath: true,
  status: true,
  progress: true,
  progressMessage: true,
  errorMessage: true,
  pageCount: true,
});

export type InsertTranslation = z.infer<typeof insertTranslationSchema>;
export type Translation = typeof translations.$inferSelect;
