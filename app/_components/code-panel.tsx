import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function CodePanel({ code, title }: { code: string; title: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border bg-muted/40 py-3">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon
            className="size-4 text-muted-foreground"
            icon="code"
          />
          <CardTitle className="text-sm text-card-foreground">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <pre className="max-h-[32rem] overflow-auto p-4 text-xs leading-6 text-foreground">
          <code>{code}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
