import type { Express } from "express";
import type { Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { storage } from "./storage";

// Ensure upload and output directories exist
const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const OUTPUT_DIR = path.join(process.cwd(), "outputs");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configure multer for PDF uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

const VALID_ENGINES = ["google", "bing", "alibaba", "baidu", "yandex"];

export function registerRoutes(httpServer: Server, app: Express) {
  // Upload PDF and start translation
  app.post("/api/translate", upload.single("file"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const targetLang = (req.body.targetLang as string) || "RU";
    if (!["RU", "EN"].includes(targetLang)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid target language" });
    }

    const engine = (req.body.engine as string) || "google";
    if (!VALID_ENGINES.includes(engine)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid translation engine" });
    }

    // Create translation record
    const translation = storage.createTranslation({
      filename: req.file.originalname,
      originalPath: req.file.path,
      targetLang,
      engine,
      createdAt: new Date().toISOString(),
    });

    // Start translation process in background
    startTranslation(translation.id, req.file.path, targetLang, engine);

    res.json({ id: translation.id, status: "processing" });
  });

  // Get translation status
  app.get("/api/translations/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const translation = storage.getTranslation(id);
    if (!translation) {
      return res.status(404).json({ error: "Translation not found" });
    }
    res.json(translation);
  });

  // Get all translations
  app.get("/api/translations", (req, res) => {
    const all = storage.getAllTranslations();
    res.json(all);
  });

  // Download translated PDF
  app.get("/api/translations/:id/download", (req, res) => {
    const id = parseInt(req.params.id);
    const translation = storage.getTranslation(id);
    if (!translation) {
      return res.status(404).json({ error: "Translation not found" });
    }
    if (translation.status !== "completed" || !translation.translatedPath) {
      return res.status(400).json({ error: "Translation not completed yet" });
    }
    if (!fs.existsSync(translation.translatedPath)) {
      return res.status(404).json({ error: "Translated file not found" });
    }

    const langSuffix = translation.targetLang === "RU" ? "_RU" : "_EN";
    const downloadName = translation.filename.replace(".pdf", `${langSuffix}.pdf`);
    
    res.download(translation.translatedPath, downloadName);
  });

  // Delete translation
  app.delete("/api/translations/:id", (req, res) => {
    const id = parseInt(req.params.id);
    const translation = storage.getTranslation(id);
    if (!translation) {
      return res.status(404).json({ error: "Translation not found" });
    }

    // Clean up files
    try {
      if (translation.originalPath && fs.existsSync(translation.originalPath)) {
        fs.unlinkSync(translation.originalPath);
      }
      if (translation.translatedPath && fs.existsSync(translation.translatedPath)) {
        fs.unlinkSync(translation.translatedPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }

    storage.deleteTranslation(id);
    res.json({ success: true });
  });
}

function startTranslation(translationId: number, inputPath: string, targetLang: string, engine: string) {
  const outputFilename = `${uuidv4()}_translated.pdf`;
  const outputPath = path.join(OUTPUT_DIR, outputFilename);

  const pythonScript = path.join(process.cwd(), "python", "translate_pdf.py");

  storage.updateTranslation(translationId, {
    status: "processing",
    progress: 0,
    progressMessage: "Запуск перевода...",
  });

  const proc = spawn("python3", [
    pythonScript,
    inputPath,
    outputPath,
    "--target-lang", targetLang,
    "--engine", engine,
  ]);

  let stderrData = "";

  proc.stdout.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((l: string) => l.trim());
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.type === "progress") {
          storage.updateTranslation(translationId, {
            progress: msg.progress,
            progressMessage: msg.message,
          });
        } else if (msg.type === "result" && msg.success) {
          storage.updateTranslation(translationId, {
            status: "completed",
            progress: 100,
            progressMessage: "Перевод завершён!",
            translatedPath: outputPath,
            pageCount: msg.pages,
          });
        } else if (msg.type === "error") {
          storage.updateTranslation(translationId, {
            status: "error",
            errorMessage: msg.message,
          });
        }
      } catch (e) {
        // Non-JSON output, ignore
      }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    stderrData += data.toString();
  });

  proc.on("close", (code: number | null) => {
    if (code !== 0) {
      const current = storage.getTranslation(translationId);
      if (current && current.status !== "completed") {
        storage.updateTranslation(translationId, {
          status: "error",
          errorMessage: stderrData || `Process exited with code ${code}`,
        });
      }
    }
  });

  proc.on("error", (err: Error) => {
    storage.updateTranslation(translationId, {
      status: "error",
      errorMessage: `Failed to start translation process: ${err.message}`,
    });
  });
}
