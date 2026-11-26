import { createFontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Card, CardContent } from '@/components/ui/card';

const BotIcon = createFontAwesomeIcon('robot');
const ChainIcon = createFontAwesomeIcon('layer-group');

export function MetricStrip({
  metrics,
}: {
  metrics: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {metrics.map((metric) => {
        const Icon = metricIcon(metric.label);

        return (
          <Card
            className={
              metric.label === 'chain templates'
                ? 'overflow-hidden bg-card sm:col-span-2'
                : 'overflow-hidden bg-card'
            }
            key={metric.label}
          >
            <CardContent className="flex min-h-32 flex-col justify-center p-4 md:min-h-36 md:p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="h-1.5 w-8 bg-primary" aria-hidden="true" />
                <span
                  aria-label={metric.label}
                  className="grid size-9 place-items-center border border-border bg-muted text-muted-foreground"
                  role="img"
                  title={metric.label}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-6">
                <div className="text-xs font-semibold uppercase leading-5 tracking-[0.12em] text-muted-foreground">
                  {metric.label}
                </div>
                <div className="mt-3 text-4xl font-semibold leading-none text-foreground md:text-5xl">
                  {metric.value}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function metricIcon(label: string) {
  switch (label) {
    case 'available models':
      return BotIcon;
    case 'chain templates':
      return ChainIcon;
    default:
      return BotIcon;
  }
}
