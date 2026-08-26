import { Select } from "@/components/ui/select";
import { useScopeContext } from "@/lib/scope-context";

/**
 * Header scope selector. Hidden when the daemon hosts exactly one directory
 * scope so KOTA-on-itself keeps the single-scope presentation.
 */
export function ScopeSelector() {
  const { scopeRegistry, scopeId, setScopeId, loading } = useScopeContext();
  const scopes = scopeRegistry?.scopes.filter(
    (scope) => scope.directoryRoot !== undefined,
  );

  if (loading || !scopes) {
    return null;
  }
  if (scopes.length <= 1) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs"
      data-testid="scope-selector"
    >
      <span className="text-muted-foreground">Scope</span>
      <Select
        className="h-7 flex-1 text-xs"
        value={scopeId}
        onChange={(e) => setScopeId(e.target.value)}
        aria-label="Active scope"
      >
        {scopes.map((p) => (
          <option key={p.scopeId} value={p.scopeId}>
            {p.displayName}
          </option>
        ))}
      </Select>
    </div>
  );
}
