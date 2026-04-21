export type IgLead = {
  username: string;
  fullName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  category: string | null;
  externalUrl: string | null;
  isBusinessAccount: boolean | null;
  profilePicUrl: string | null;
  raw: Record<string, unknown>;
};

export type LinkedInProfile = {
  publicIdentifier: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  company: string | null;
  linkedinUrl: string | null;
};
