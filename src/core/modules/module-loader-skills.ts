import { readImportedSkillRecords } from "./imported-skills.js";
import type { LoaderState } from "./module-loader-state.js";

export function refreshImportedSkills(state: LoaderState, cwd: string): void {
  const records = readImportedSkillRecords(cwd);
  const moduleSkillNames = new Set<string>();
  for (const skills of state.moduleSkillDefs.values()) {
    for (const skill of skills) moduleSkillNames.add(skill.name);
  }

  for (const name of state.importedSkillNames) {
    if (!moduleSkillNames.has(name)) {
      state.skillContentsByName.delete(name);
      state.skillDefsByName.delete(name);
    }
    state.explicitOnlySkillNames.delete(name);
  }
  state.importedSkillNames.clear();

  for (const record of records) {
    if (moduleSkillNames.has(record.def.name)) continue;
    state.skillContentsByName.set(record.def.name, record.content);
    state.skillDefsByName.set(record.def.name, record.def);
    state.importedSkillNames.add(record.def.name);
    state.explicitOnlySkillNames.add(record.def.name);
  }
}
