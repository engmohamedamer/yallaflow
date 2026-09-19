import { readFile } from 'node:fs/promises';
import { findSkill, instructionFilePath, SKILL_REGISTRY } from '../skills/registry.js';
import { validateSkillRegistry } from '../skills/validation.js';

export async function skillCommand(skillId) {
  await validateSkillRegistry();
  const entry = findSkill(skillId);
  if (!entry) {
    throw new Error(`Unknown skill ${JSON.stringify(skillId)}. Available skills: ${SKILL_REGISTRY.map((skill) => skill.id).join(', ')}.`);
  }
  const instructions = await readFile(instructionFilePath(entry), 'utf8');
  console.log(`Skill: ${entry.id}`);
  console.log(`Version: ${entry.version}`);
  console.log(`Capability: ${entry.capability}`);
  console.log(`Phase: ${entry.phase}`);
  console.log(`Mode: ${entry.mode}`);
  console.log('Prerequisites:');
  if (entry.prerequisites.length) entry.prerequisites.forEach((prerequisite) => console.log(`- ${prerequisite}`));
  else console.log('- none');
  console.log(`\n${instructions.trim()}\n`);
}
