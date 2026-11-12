// File-backed store for local dev and the CLI.
import { readFileSync, appendFileSync, existsSync } from "node:fs";

export function fileStore(path) {
  const checks = new Map();
  return {
    async listOutcomes() {
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    },
    async appendOutcome(record) {
      appendFileSync(path, JSON.stringify(record) + "\n");
    },
    async putCheck(id, check) { checks.set(id, check); },
    async getCheck(id) { return checks.get(id) ?? null; },
  };
}
