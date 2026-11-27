// Picks the storage from HALDEN_DATA: "memory" (default) or "supabase".

import { MemoryRepository } from "./memory";
import { SupabaseRepository, serviceClient, userClient } from "./supabase";
import type { Repository } from "./types";

export type DataMode = "memory" | "supabase";
export const dataMode = (): DataMode => (process.env.HALDEN_DATA === "supabase" ? "supabase" : "memory");

let memory: MemoryRepository | null = null;
export function memoryRepo(): MemoryRepository {
  return (memory ??= new MemoryRepository());
}
/** Tests start from a fresh copy of the sample company. */
export function resetMemoryRepo(repo?: MemoryRepository) {
  memory = repo ?? new MemoryRepository();
  return memory;
}

/** Storage used to check credentials (API keys, user lookups). */
export function systemRepo(): Repository {
  return dataMode() === "memory" ? memoryRepo() : new SupabaseRepository(serviceClient(), true);
}

/** Storage for one request, as the caller: a user's session goes through row-level security. */
export function repoFor(principal: { kind: "user"; accessToken: string | null } | { kind: "key" }): Repository {
  if (dataMode() === "memory") return memoryRepo();
  if (principal.kind === "user" && principal.accessToken) return new SupabaseRepository(userClient(principal.accessToken), false);
  return new SupabaseRepository(serviceClient(), true);
}

export type { Repository } from "./types";
