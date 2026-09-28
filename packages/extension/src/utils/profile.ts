import type { Profile } from "../types";
import { normalizeProfile } from "../lib/profile-shape";

export { EMPTY_PROFILE, normalizeProfile } from "../lib/profile-shape";

export function getProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    chrome.storage.local.get("profile", (result) => resolve(normalizeProfile(result.profile)));
  });
}

export function saveProfile(profile: Profile): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ profile }, () => resolve()));
}
