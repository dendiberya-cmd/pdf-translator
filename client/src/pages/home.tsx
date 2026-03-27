import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  FileText,
  Languages,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  FileUp,
  Globe,
} from "lucide-react";
import type { Translation } from "@shared/schema";

const ENGINES = [
  { value: "google", label: "Google Translate", description: "Лучшее качество для большинства текстов" },
  { value: "bing", label: "Bing (Microsoft)", description: "Альтернативный движок Microsoft" },
  { value: "alibaba", label: "Alibaba", description: "Хорошо для технических текстов ZH" },
  { value: "baidu", label: "Baidu", description: "Специализируется на китайском языке" },
  { value: "yandex", label: "Yandex", description: "Хорош для перевода на русский" },
];

export default function Home() {
  const { toast } = useToast();
  const [targetLang, setTargetLang] = useState<string>("RU");
  const [engine, setEngine] = useState<string>("google");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Query translations list
  const { data: translationsList } = useQuery<Translation[]>({
    queryKey: ["/api/translations"],
    refetchInterval: 2000,
  });

  // Upload and translate mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("targetLang", targetLang);
      formData.append("engine", engine);
      
      const res = await fetch("/api/translate", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
      toast({
        title: "PDF загружен",
        description: "Перевод начался. Следите за прогрессом ниже.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/translations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/translations"] });
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.type === "application/pdf") {
          uploadMutation.mutate(file);
        } else {
          toast({
            title: "Неверный формат",
            description: `${file.name} — не PDF файл.`,
            variant: "destructive",
          });
        }
      }
    },
    [targetLang, engine, uploadMutation, toast]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDownload = async (id: number) => {
    try {
      const response = await fetch(`/api/translations/${id}/download`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const contentDisposition = response.headers.get("content-disposition");
      let filename = "translated.pdf";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match && match[1]) {
          filename = match[1].replace(/['"]/g, "");
        }
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({
        title: "Ошибка скачивания",
        description: "Не удалось скачать файл.",
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = (t: Translation) => {
    switch (t.status) {
      case "pending":
        return <Badge variant="secondary" data-testid={`status-pending-${t.id}`}><Loader2 className="w-3 h-3 mr-1 animate-spin" />В очереди</Badge>;
      case "processing":
        return <Badge variant="default" className="bg-blue-600" data-testid={`status-processing-${t.id}`}><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Перевод...</Badge>;
      case "completed":
        return <Badge variant="default" className="bg-green-600" data-testid={`status-completed-${t.id}`}><CheckCircle2 className="w-3 h-3 mr-1" />Готово</Badge>;
      case "error":
        return <Badge variant="destructive" data-testid={`status-error-${t.id}`}><AlertCircle className="w-3 h-3 mr-1" />Ошибка</Badge>;
      default:
        return null;
    }
  };

  const getLangLabel = (lang: string) => lang === "RU" ? "Русский" : "English";
  const getEngineLabel = (eng: string) => ENGINES.find(e => e.value === eng)?.label || eng;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center">
            <Languages className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">PDF Translator</h1>
            <p className="text-xs text-muted-foreground">Технический перевод с китайского — без API ключей</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Upload Area */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Загрузить PDF для перевода</CardTitle>
            <CardDescription>
              Загрузите PDF с китайским текстом. Разметка, шрифты и изображения будут сохранены.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Settings row */}
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Исходник:</span>
                <Badge variant="outline">Китайский (ZH)</Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Перевести на:</span>
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="w-[150px]" data-testid="select-target-lang">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RU">Русский (RU)</SelectItem>
                    <SelectItem value="EN">English (EN)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Движок:</span>
                <Select value={engine} onValueChange={setEngine}>
                  <SelectTrigger className="w-[180px]" data-testid="select-engine">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGINES.map((eng) => (
                      <SelectItem key={eng.value} value={eng.value}>
                        {eng.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Engine hint */}
            <p className="text-xs text-muted-foreground px-1">
              {ENGINES.find(e => e.value === engine)?.description}. Перевод бесплатный, без ограничений и API-ключей.
            </p>

            {/* Drop zone */}
            <div
              className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
                ${isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50"}
                ${uploadMutation.isPending ? "pointer-events-none opacity-60" : ""}
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-testid="dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                className="hidden"
                onChange={(e) => handleFiles(e.target.files)}
                data-testid="input-file"
              />
              {uploadMutation.isPending ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-10 h-10 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Загрузка файла...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FileUp className="w-10 h-10 text-muted-foreground/50" />
                  <p className="text-sm font-medium">Перетащите PDF сюда или нажмите для выбора</p>
                  <p className="text-xs text-muted-foreground">Поддерживаются файлы PDF до 100 МБ</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Translations List */}
        {translationsList && translationsList.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Переводы</CardTitle>
              <CardDescription>{translationsList.length} файл(ов)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[...translationsList].reverse().map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                    data-testid={`card-translation-${t.id}`}
                  >
                    <FileText className="w-8 h-8 text-muted-foreground shrink-0" />
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-sm font-medium truncate">{t.filename}</span>
                        {getStatusBadge(t)}
                        <Badge variant="outline" className="text-xs">
                          → {getLangLabel(t.targetLang)}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {getEngineLabel(t.engine)}
                        </Badge>
                      </div>
                      
                      {t.status === "processing" && (
                        <div className="space-y-1">
                          <Progress value={t.progress || 0} className="h-1.5" data-testid={`progress-${t.id}`} />
                          <p className="text-xs text-muted-foreground">{t.progressMessage || "Обработка..."}</p>
                        </div>
                      )}
                      
                      {t.status === "completed" && t.pageCount && (
                        <p className="text-xs text-muted-foreground">{t.pageCount} стр. переведено</p>
                      )}
                      
                      {t.status === "error" && (
                        <p className="text-xs text-destructive truncate">{t.errorMessage}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {t.status === "completed" && (
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => handleDownload(t.id)}
                          data-testid={`button-download-${t.id}`}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          Скачать
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteMutation.mutate(t.id)}
                        disabled={t.status === "processing"}
                        data-testid={`button-delete-${t.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
