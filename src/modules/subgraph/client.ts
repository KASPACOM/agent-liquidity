/**
 * Lightweight GraphQL client for The Graph Node subgraphs.
 * Uses native fetch() (Node 22+).
 */
export class SubgraphClient {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async query<T>(gql: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables }),
    });

    if (!res.ok) {
      throw new Error(`Subgraph HTTP ${res.status}: ${res.statusText}`);
    }

    const json = (await res.json()) as { data?: T; errors?: unknown[] };

    if (json.errors?.length) {
      throw new Error(`Subgraph query errors: ${JSON.stringify(json.errors)}`);
    }

    if (!json.data) {
      throw new Error('Subgraph returned no data');
    }

    return json.data;
  }

  /**
   * Paginate a query that uses $first/$skip variables.
   * Returns all collected items from the specified field.
   */
  async paginate<T>(
    gql: string,
    field: string,
    variables?: Record<string, unknown>,
    pageSize = 1000,
  ): Promise<T[]> {
    const all: T[] = [];
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      const data = await this.query<Record<string, T[]>>(gql, {
        ...variables,
        first: pageSize,
        skip,
      });

      const items = data[field] ?? [];
      all.push(...items);
      skip += pageSize;
      hasMore = items.length === pageSize;
    }

    return all;
  }
}
