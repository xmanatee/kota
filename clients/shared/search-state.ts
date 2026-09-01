export type SearchState<T> =
  | { readonly status: 'idle'; readonly items: readonly T[] }
  | {
      readonly status: 'success';
      readonly query: string;
      readonly items: readonly [T, ...T[]];
    }
  | { readonly status: 'empty'; readonly query: string };

export type SearchRefinement<T> = {
  readonly value: string;
  readonly matches: (item: T, value: string) => boolean;
};

export function searchItems<T>(
  items: readonly T[],
  query: string,
  searchableText: (item: T) => readonly string[],
  refinements: readonly SearchRefinement<T>[],
): SearchState<T> {
  const normalizedQuery = query.trim().toLowerCase();
  const hasRefinement = refinements.some(({ value }) => value !== '');
  if (normalizedQuery === '' && !hasRefinement) {
    return { status: 'idle', items };
  }

  const matches = items.filter(
    (item) =>
      (normalizedQuery === '' ||
        searchableText(item).some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        )) &&
      refinements.every(
        (refinement) =>
          refinement.value === '' ||
          refinement.matches(item, refinement.value),
      ),
  );
  return matches.length === 0
    ? { status: 'empty', query: normalizedQuery }
    : {
        status: 'success',
        query: normalizedQuery,
        items: matches as [T, ...T[]],
      };
}

export function searchItemsValue<T>(state: SearchState<T>): readonly T[] {
  return state.status === 'empty' ? [] : state.items;
}
