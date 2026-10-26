export interface EmailConfig {
  host: string; port: number; secure: boolean;
  user: string; password: string; from: string;
}
export const EMAIL_CONFIG_KEY = 'pageAgentEmailConfigV1';
