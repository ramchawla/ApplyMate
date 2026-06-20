import { Profile } from "../types";

const EMPTY: Profile = {
  fullName: "",
  email: "",
  phone: "",
  linkedin: "",
  github: "",
  website: "",
};

export function getProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    chrome.storage.local.get("profile", (result) => {
      resolve({ ...EMPTY, ...(result.profile as Partial<Profile>) });
    });
  });
}

export function saveProfile(profile: Profile): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ profile }, () => resolve());
  });
}
