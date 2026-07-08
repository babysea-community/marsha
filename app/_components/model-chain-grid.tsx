'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { FontAwesomeIcon } from '@/components/icons/font-awesome-icon';
import { Button } from '@/components/ui/button';
import type {
  ModelChainCatalogGridEntry,
  ModelChainCatalogPage,
} from '@/lib/chains/catalog';

import { ModelChainCard } from './model-chain-card';

export function ModelChainGrid({
  initialEntries,
  initialTotal,
  pageSize = 25,
}: {
  initialEntries: ModelChainCatalogGridEntry[];
  initialTotal: number;
  pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [catalogPage, setCatalogPage] = useState({
    entries: initialEntries,
    page: 1,
    query: '',
    total: initialTotal,
  });
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const lastLoadedRef = useRef({ page: 1, query: '' });
  const pageCount = Math.max(1, Math.ceil(catalogPage.total / pageSize));
  const currentPage = Math.min(catalogPage.page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const visibleStart = catalogPage.total === 0 ? 0 : startIndex + 1;
  const visibleEnd = Math.min(
    startIndex + catalogPage.entries.length,
    catalogPage.total,
  );
  const visiblePageNumbers = getVisiblePageNumbers(currentPage, pageCount, 10);

  useEffect(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    if (page === 1 && normalizedQuery === '') {
      lastLoadedRef.current = { page: 1, query: '' };
      setCatalogPage({
        entries: initialEntries,
        page: 1,
        query: '',
        total: initialTotal,
      });
      setLoadError(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const searchParams = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });

    if (normalizedQuery) {
      searchParams.set('q', normalizedQuery);
    }

    setLoading(true);

    fetch(`/api/model-chain-catalog?${searchParams.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Catalog request failed.');
        }

        return response.json() as Promise<ModelChainCatalogPage>;
      })
      .then((data) => {
        lastLoadedRef.current = { page: data.page, query: data.query };
        setCatalogPage({
          entries: data.entries,
          page: data.page,
          query: data.query,
          total: data.total,
        });
        setLoadError(false);
        if (data.page !== page) {
          setPage(data.page);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadError(true);
          if (lastLoadedRef.current.query === normalizedQuery) {
            setPage(lastLoadedRef.current.page);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [deferredQuery, initialEntries, initialTotal, page, pageSize]);

  function goToPage(nextPage: number) {
    setPage(Math.min(Math.max(nextPage, 1), pageCount));
  }

  function updateQuery(nextQuery: string) {
    setQuery(nextQuery);
    setPage(1);
  }

  return (
    <div className="bg-background/50 p-5">
      <div className="mb-5 grid gap-3 border-b border-border pb-5 md:items-center xl:grid-cols-5">
        <div className="relative w-full xl:col-span-4">
          <FontAwesomeIcon
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            icon="magnifying-glass"
          />
          <input
            aria-label="Search model chains"
            className="h-10 w-full border border-border bg-card px-9 font-mono text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
            onChange={(event) => updateQuery(event.target.value)}
            placeholder="Search models or providers"
            type="text"
            value={query}
          />
          {query ? (
            <Button
              aria-label="Clear search"
              className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
              onClick={() => updateQuery('')}
              size="icon"
              type="button"
              variant="ghost"
            >
              <FontAwesomeIcon className="size-4" icon="xmark" />
            </Button>
          ) : null}
        </div>
        <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground xl:justify-self-end">
          {visibleStart}-{visibleEnd} of{' '}
          {catalogPage.total.toLocaleString('en-US')}
          {loading ? ' · loading' : ''}
          {loadError ? ' · retry later' : ''}
        </div>
      </div>

      {catalogPage.entries.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {catalogPage.entries.map((entry) => (
            <ModelChainCard entry={entry} key={entry.slug} />
          ))}
        </div>
      ) : (
        <div className="grid min-h-48 place-items-center border border-border bg-card p-6 text-center font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          No model chains found
        </div>
      )}

      {pageCount > 1 ? (
        <div className="mt-5 flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {visibleStart}-{visibleEnd} of{' '}
            {catalogPage.total.toLocaleString('en-US')}
            {loading ? ' · loading' : ''}
            {loadError ? ' · retry later' : ''}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              aria-label="Previous page"
              disabled={currentPage === 1}
              onClick={() => goToPage(currentPage - 1)}
              size="icon"
              type="button"
              variant="outline"
            >
              <FontAwesomeIcon icon="chevron-left" />
            </Button>
            {visiblePageNumbers.map((pageNumber) => {
              return (
                <Button
                  aria-current={pageNumber === currentPage ? 'page' : undefined}
                  key={`model-page-${pageNumber}`}
                  onClick={() => goToPage(pageNumber)}
                  size="sm"
                  type="button"
                  variant={pageNumber === currentPage ? 'default' : 'outline'}
                >
                  {pageNumber}
                </Button>
              );
            })}
            <Button
              aria-label="Next page"
              disabled={currentPage === pageCount}
              onClick={() => goToPage(currentPage + 1)}
              size="icon"
              type="button"
              variant="outline"
            >
              <FontAwesomeIcon icon="chevron-right" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function getVisiblePageNumbers(
  currentPage: number,
  pageCount: number,
  maxVisiblePages: number,
) {
  const visibleCount = Math.min(pageCount, maxVisiblePages);
  const halfWindow = Math.floor(visibleCount / 2);
  let startPage = currentPage - halfWindow;
  let endPage = startPage + visibleCount - 1;

  if (startPage < 1) {
    startPage = 1;
    endPage = visibleCount;
  }

  if (endPage > pageCount) {
    endPage = pageCount;
    startPage = Math.max(1, endPage - visibleCount + 1);
  }

  return Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage + index,
  );
}
