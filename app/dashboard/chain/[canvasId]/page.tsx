import type { Metadata } from 'next';

import { CanvasPageView } from '../page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Canvas' };

type CanvasPageProps = {
  params: Promise<{ canvasId: string }> | { canvasId: string };
};

export default async function CanvasPage({ params }: CanvasPageProps) {
  const { canvasId } = await params;

  return <CanvasPageView canvasId={canvasId} />;
}
