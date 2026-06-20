import { useEffect, useState } from "react";
import { Profile } from "../../types";
import { getProfile, saveProfile } from "../../utils/profile";

interface Props {
  onSaved: (profile: Profile) => void;
}

export function ProfileEditor({ onSaved }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  if (!profile) return <div className="text-xs">Loading profile…</div>;

  const fields: (keyof Profile)[] = [
    "fullName",
    "email",
    "phone",
    "linkedin",
    "github",
    "website",
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Your Profile</h3>
      {fields.map((key) => (
        <input
          key={key}
          type="text"
          placeholder={key}
          value={profile[key]}
          onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
          className="w-full border rounded px-2 py-1 text-xs"
        />
      ))}
      <button
        onClick={async () => {
          await saveProfile(profile);
          onSaved(profile);
        }}
        className="w-full bg-gray-700 text-white py-1 rounded text-xs"
      >
        Save Profile
      </button>
    </div>
  );
}
