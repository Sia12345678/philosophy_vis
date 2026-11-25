import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trails = JSON.parse(
  fs.readFileSync(path.join(root, "src/data/trails.json"), "utf8"),
).trails;
const philosophers = JSON.parse(
  fs.readFileSync(path.join(root, "src/data/philosophers.json"), "utf8"),
).philosophers;
const byId = new Map(philosophers.map((philosopher) => [philosopher.id, philosopher]));
const errors = [];
const seen = new Set();

if (trails.length !== 3) errors.push(`expected 3 trails, found ${trails.length}`);

for (const trail of trails) {
  if (seen.has(trail.id)) errors.push(`duplicate trail id: ${trail.id}`);
  seen.add(trail.id);
  if (trail.steps.length < 6 || trail.steps.length > 8) {
    errors.push(`${trail.id}: expected 6-8 steps, found ${trail.steps.length}`);
  }
  for (const [index, step] of trail.steps.entries()) {
    const where = `${trail.id}[${index + 1}]`;
    const philosopher = byId.get(step.philosopherId);
    if (!philosopher) {
      errors.push(`${where}: unknown philosopher ${step.philosopherId}`);
      continue;
    }
    if (!Number.isInteger(step.theoryIndex) || step.theoryIndex < 0 || step.theoryIndex >= philosopher.theories_zh.length) {
      errors.push(`${where}: invalid theoryIndex ${step.theoryIndex}`);
    }
    if (step.workIndex !== undefined && (!Number.isInteger(step.workIndex) || step.workIndex < 0 || step.workIndex >= philosopher.works.length)) {
      errors.push(`${where}: invalid workIndex ${step.workIndex}`);
    }
    for (const key of ["question_zh", "question_en", "bridge_zh", "bridge_en"]) {
      if (typeof step[key] !== "string" || !step[key].trim()) {
        errors.push(`${where}: missing ${key}`);
      }
    }
  }
}

if (errors.length) {
  console.error(`Trail validation failed:\n${errors.join("\n")}`);
  process.exit(1);
}

console.log(
  `Trail validation passed: ${trails.length} trails, ${trails.reduce((sum, trail) => sum + trail.steps.length, 0)} steps.`,
);
