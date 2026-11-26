import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ChainInputField } from '@/lib/chains/types';

type SchemaFieldTableLabels = {
  field: string;
  title: string;
  type: string;
};

export function SchemaFieldTable({
  fields,
  labels,
}: {
  fields: ChainInputField[];
  labels: SchemaFieldTableLabels;
}) {
  return (
    <Card className="overflow-hidden border-0 bg-card shadow-none">
      <CardHeader className="border-b border-border bg-muted/40 py-3">
        <div className="flex items-center gap-2">
          <FontAwesomeIcon
            className="size-4 text-muted-foreground"
            icon="code"
          />
          <CardTitle className="text-sm uppercase tracking-[0.14em] text-muted-foreground">
            {labels.title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.field}</TableHead>
              <TableHead>{labels.type}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.map((field) => (
              <TableRow key={field.name}>
                <TableCell className="min-w-52 font-mono text-foreground">
                  <div className="break-words">{field.name}</div>
                </TableCell>
                <TableCell>{field.type}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
