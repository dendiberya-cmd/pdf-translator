import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, ExternalLink, Key } from "lucide-react";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");

  const { data: settings } = useQuery<{ hasApiKey: boolean; apiKeyPreview: string | null }>({
    queryKey: ["/api/settings"],
  });

  const saveMutation = useMutation({
    mutationFn: async (key: string) => {
      await apiRequest("POST", "/api/settings", { apiKey: key });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Сохранено",
        description: "Ключ DeepL API успешно сохранён.",
      });
      setApiKey("");
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Ошибка",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="w-4 h-4" />
            Настройки DeepL API
          </DialogTitle>
          <DialogDescription>
            Для перевода используется DeepL API. Получите ключ бесплатно на сайте DeepL.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {settings?.hasApiKey && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-3 rounded-md">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Ключ настроен: {settings.apiKeyPreview}</span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="api-key">
              {settings?.hasApiKey ? "Заменить ключ API" : "Ключ DeepL API"}
            </Label>
            <Input
              id="api-key"
              type="password"
              placeholder="Введите ваш DeepL API ключ..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="input-api-key"
            />
            <p className="text-xs text-muted-foreground">
              DeepL Free API: 500 000 символов/месяц бесплатно.{" "}
              <a
                href="https://www.deepl.com/pro-api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Получить ключ <ExternalLink className="w-3 h-3" />
              </a>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-settings">
            Отмена
          </Button>
          <Button
            onClick={() => saveMutation.mutate(apiKey)}
            disabled={!apiKey.trim() || saveMutation.isPending}
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
