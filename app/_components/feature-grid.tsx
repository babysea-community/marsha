import type { ComponentType, SVGProps } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function FeatureGrid({
  features,
}: {
  features: Array<{
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    text: string;
    title: string;
  }>;
}) {
  return (
    <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
      {features.map((feature) => (
        <Card className="border-0 bg-card shadow-none" key={feature.title}>
          <CardHeader>
            <div className="mb-8 flex size-11 items-center justify-center border border-border bg-muted text-foreground">
              <feature.icon className="size-5" aria-hidden="true" />
            </div>
            <CardTitle className="text-lg">{feature.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted-foreground">
              {feature.text}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
