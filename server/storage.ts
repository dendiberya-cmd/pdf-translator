import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { translations, type Translation, type InsertTranslation } from "@shared/schema";
import { eq } from "drizzle-orm";

const sqlite = new Database("database.sqlite");
const db = drizzle(sqlite);

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_path TEXT NOT NULL,
    translated_path TEXT,
    target_lang TEXT NOT NULL DEFAULT 'RU',
    engine TEXT NOT NULL DEFAULT 'google',
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    progress_message TEXT,
    error_message TEXT,
    page_count INTEGER,
    created_at TEXT NOT NULL
  );
`);

// Add engine column if missing (migration for existing databases)
try {
  sqlite.exec(`ALTER TABLE translations ADD COLUMN engine TEXT NOT NULL DEFAULT 'google';`);
} catch (e) {
  // Column already exists, ignore
}

export interface IStorage {
  createTranslation(data: InsertTranslation): Translation;
  getTranslation(id: number): Translation | undefined;
  getAllTranslations(): Translation[];
  updateTranslation(id: number, data: Partial<Translation>): Translation | undefined;
  deleteTranslation(id: number): void;
}

export class DatabaseStorage implements IStorage {
  createTranslation(data: InsertTranslation): Translation {
    return db.insert(translations).values(data).returning().get();
  }

  getTranslation(id: number): Translation | undefined {
    return db.select().from(translations).where(eq(translations.id, id)).get();
  }

  getAllTranslations(): Translation[] {
    return db.select().from(translations).all();
  }

  updateTranslation(id: number, data: Partial<Translation>): Translation | undefined {
    const result = db.update(translations).set(data).where(eq(translations.id, id)).returning().get();
    return result;
  }

  deleteTranslation(id: number): void {
    db.delete(translations).where(eq(translations.id, id)).run();
  }
}

export const storage = new DatabaseStorage();
