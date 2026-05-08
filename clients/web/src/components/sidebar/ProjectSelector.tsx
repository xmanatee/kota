import { Select } from "@/components/ui/select";
import { useProjectContext } from "@/lib/project-context";

/**
 * Header project selector. Hidden when the daemon hosts exactly one
 * project so KOTA-on-itself looks identical to the pre-multi-project
 * experience.
 */
export function ProjectSelector() {
  const { projects, projectId, setProjectId, loading } = useProjectContext();

  if (loading || !projects) {
    return null;
  }
  if (projects.projects.length <= 1) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-xs"
      data-testid="project-selector"
    >
      <span className="text-muted-foreground">Project</span>
      <Select
        className="h-7 flex-1 text-xs"
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
        aria-label="Active project"
      >
        {projects.projects.map((p) => (
          <option key={p.projectId} value={p.projectId}>
            {p.displayName}
          </option>
        ))}
      </Select>
    </div>
  );
}
