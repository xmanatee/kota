export function formatAge(createdAt: string): string {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}
